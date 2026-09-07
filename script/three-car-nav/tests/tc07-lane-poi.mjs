/**
 * TC-07 变道 / POI（慢用例，~60s+）：
 *  - 导航剩余距离两采样递减，且与 POI 到达里程 − distanceM 一致（state 侧换算 + 导航行像素随动）
 *  - laneChangeHint 非 null 持续 ~4s 后归零
 *  - hint 消失沿后主车 lerp 变道，laneIndex 变化（~2.8s 收敛）
 */
import { LANE, HUD_BANDS, bandToScreen } from '../lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 依据累计里程反推当前 POI（与 HudSystem.updateScripts 的切换规则同源） */
function poiFor(distanceM) {
	let index = 0;
	let offset = 0;
	while (LANE.poi[index].arriveM + offset - distanceM < 50) {
		index = (index + 1) % LANE.poi.length;
		if (index === 0) offset += LANE.poiLoopM;
	}
	return { index, offset, name: LANE.poi[index].name, arrival: LANE.poi[index].arriveM + offset };
}

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const detail = { samples: [], hintWindows: [] };
	const checks = {};
	await ctx.newPage();
	await ctx.openThroughMenu();
	const { status } = await ctx.waitModelStatus();
	if (status !== 'ready') {
		await ctx.close();
		return { pass: false, note: `modelStatus=${status}`, checks: {}, evidence };
	}

	const navBand = bandToScreen({ ...HUD_BANDS.navRoadName, y1: HUD_BANDS.navLine.y1 });
	let hintStart = null;
	let hintEnd = null;
	let laneBeforeHint = null;
	let laneAfterHint = null;
	let navA = null;
	let navB = null;
	const started = Date.now();

	/* 轮询至 hint 触发 + 落位，或超时 */
	while ((Date.now() - started) / 1000 < LANE.budgetSec) {
		const s = await ctx.getState();
		const wall = +((Date.now() - started) / 1000).toFixed(1);

		if (!navA && s.distanceM > 5) {
			navA = { wall, distanceM: s.distanceM, ...poiFor(s.distanceM), remainPredicted: Math.round(poiFor(s.distanceM).arrival - s.distanceM) };
			await ctx.snapOnly(1, 0);
			navA.crop = await ctx.saveCrop('nav-line-t0', navBand);
		}
		if (navA && !navB && s.distanceM - navA.distanceM > 60) {
			navB = { wall, distanceM: s.distanceM, ...poiFor(s.distanceM), remainPredicted: Math.round(poiFor(s.distanceM).arrival - s.distanceM) };
			navB.crop = await ctx.saveCrop('nav-line-t1', navBand);
			evidence.push(navA.crop.file, navB.crop.file);
		}

		if (s.laneChangeHint && !hintStart) {
			hintStart = { wall, hint: s.laneChangeHint, lane: s.laneIndex, t: Date.now() };
			laneBeforeHint = s.laneIndex;
			detail.hintStartState = s;
			await ctx.snapOnly(1, 0);
			const shot = await ctx.saveCrop('lane-hint', bandToScreen(HUD_BANDS.laneTrap));
			evidence.push(shot.file);
		}
		if (hintStart && !hintEnd && !s.laneChangeHint) {
			hintEnd = { wall, heldSec: +((Date.now() - hintStart.t) / 1000).toFixed(2), lane: s.laneIndex };
			detail.hintEndState = s;
		}
		if (hintEnd && laneAfterHint === null && s.laneIndex !== laneBeforeHint) {
			laneAfterHint = { wall, lane: s.laneIndex, from: laneBeforeHint, settleSec: +(((Date.now() - hintStart.t) / 1000) - hintEnd.heldSec).toFixed(2) };
			await ctx.snapOnly(1, 0);
			const shot = await ctx.saveCrop('lane-after', bandToScreen(HUD_BANDS.laneTrap));
			evidence.push(shot.file);
		}
		detail.samples.push({
			wall,
			distanceM: +s.distanceM.toFixed(1),
			laneIndex: s.laneIndex,
			hint: s.laneChangeHint,
			poi: poiFor(s.distanceM).name,
			targets: s.trafficTargets.length,
		});
		if (laneAfterHint) break;
		await sleep(900);
	}

	/* 判定 1：导航剩余距离两采样递减且 ≈ POI 到达里程 − distanceM */
	if (navA && navB) {
		checks.navRemainDecreases = navA.remainPredicted > navB.remainPredicted;
		checks.navPoiConsistent =
			Math.abs(navA.remainPredicted - (navA.arrival - navA.distanceM)) <= 1 &&
			Math.abs(navB.remainPredicted - (navB.arrival - navB.distanceM)) <= 1;
		checks.navPoiSameTarget = navA.name === navB.name && navA.index === navB.index;
	} else {
		checks.navRemainDecreases = false;
		checks.navPoiConsistent = false;
		checks.navPoiSameTarget = false;
	}
	// 导航行像素随里程刷新（HUD 文案每帧重绘）
	await ctx.snapOnly(2, 500);
	checks.navLineLive = (await ctx.px('diff', { box: navBand }))[0].meanAbs > 0.0005;

	/* 判定 2：hint 非 null 持续 ~4s 后归零 */
	checks.hintSeen = Boolean(hintStart && hintEnd);
	checks.hintHeldAbout4s = Boolean(hintEnd && hintEnd.heldSec >= LANE.hintDuration.min && hintEnd.heldSec <= LANE.hintDuration.max);

	/* 判定 3：hint 消失沿后 lerp 变道，laneIndex 变化 */
	checks.laneChanged = Boolean(laneAfterHint) && laneAfterHint.lane !== laneBeforeHint;

	detail.navA = navA;
	detail.navB = navB;
	detail.hintStart = hintStart;
	detail.hintEnd = hintEnd;
	detail.laneAfterHint = laneAfterHint;
	detail.laneBeforeHint = laneBeforeHint;
	evidence.push(await ctx.shot('lane-poi-final'));
	evidence.push(ctx.saveEvidence('evidence', detail));
	await ctx.close();

	const notes = [];
	if (!checks.navRemainDecreases || !checks.navPoiConsistent) notes.push('导航剩余距离未随里程递减或与 POI 不一致');
	if (!checks.navPoiSameTarget) notes.push('两次采样分属不同 POI（窗口跨过切换点）');
	if (!checks.navLineLive) notes.push('导航行像素未随里程刷新');
	if (!checks.hintSeen) notes.push(`${LANE.budgetSec}s 内未观察到 laneChangeHint`);
	else if (!checks.hintHeldAbout4s) notes.push(`hint 持续 ${hintEnd.heldSec}s（期望 ~4s）`);
	if (!checks.laneChanged) notes.push('hint 结束后 laneIndex 未变化');
	return {
		pass: Object.values(checks).every(Boolean),
		note: notes.join('；') || `POI ${navA.name} 剩余 ${navA.remainPredicted}→${navB.remainPredicted}m；hint ${hintEnd.heldSec}s；lane ${laneBeforeHint}→${laneAfterHint.lane}`,
		checks,
		evidence,
	};
}
