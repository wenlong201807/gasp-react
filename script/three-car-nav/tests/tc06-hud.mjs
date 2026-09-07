/**
 * TC-06 HUD 六块：
 * ① 时速数字与 state.speedKmh 对应（数字区有字形 + 归档裁剪供数字核对）
 * ② 中央 360° 小车完整在环（两个对侧侧视 = 整车绕环一周，归档裁剪）
 * ③ 路名 + 导航行（两采样随 distanceM 递减而变化）
 * ④ 车道图当前道高亮（accent 高亮质心落在 state.laneIndex 对应的道内）
 * ⑤ footer 行画在 y880..980 带、未叠到中部 y460..520（4291273 回归项，像素带断言）
 * ⑥ 雷达环 + 扫描扇形 + 目标点
 */
import { HUD_BANDS, HUD_THRESHOLDS, bandToScreen, CAR, RADAR, HUD_TEX } from '../lib/config.mjs';
import { pickSideViews } from '../lib/analyze.mjs';

const spread = (a) => Math.max(...a) - Math.min(...a);

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const detail = {};
	const checks = {};
	await ctx.newPage();
	await ctx.openThroughMenu();
	const { status } = await ctx.waitModelStatus();
	if (status !== 'ready') {
		await ctx.close();
		return { pass: false, note: `modelStatus=${status}，HUD 六块断言无意义`, checks: {}, evidence };
	}
	await ctx.page.waitForTimeout(2000);

	/* ---------- ①③④⑤⑥ 静态带 + 交互采样 ---------- */
	const bandIds = ['speedDigits', 'navRoadName', 'navLine', 'footerLeft', 'footerRight', 'midRightRegress'];
	const bands = bandIds.map((id) => ({ id, ...bandToScreen(HUD_BANDS[id]) }));
	const laneBand = bandToScreen(HUD_BANDS.laneTrap);
	const state1 = await ctx.getState();

	await ctx.snapOnly(2, 400);
	detail.bandRatiosByFrame = await ctx.px('bands', { list: bands });
	detail.bandRatios = detail.bandRatiosByFrame[1];
	// 导航行随 distanceM 递减而重绘：两帧差分
	detail.navLineDiff = (await ctx.px('diff', { box: bandToScreen(HUD_BANDS.navLine) }))[0];

	// ④ 车道图：accent 高亮像素质心 ↔ state.laneIndex
	detail.laneAccent = (await ctx.px('centroid', { box: laneBand, pred: 'accent', thr: 0 }))[1];
	const trapCentreX = (laneBand.x0 + laneBand.x1) / 2;
	const trapWidth = laneBand.x1 - laneBand.x0;
	const laneFrac = ((state1.laneIndex * 2 + 1) / 3) - 1; // 0→-2/3, 1→0, 2→+2/3
	const expectedCx = trapCentreX + (laneFrac / 2) * trapWidth * 0.5;
	detail.laneExpectedCx = +expectedCx.toFixed(1);

	// ⑥ 雷达：环拟合 + 目标点峰值（含 90/180/270° 对照组）+ 洞内活性
	const { cx, cy, r } = CAR.hole;
	detail.ringFit = (await ctx.px('fitRing', { cx0: cx, cy0: cy, ...RADAR.ringFit }))[1];
	const rmax = HUD_TEX.radarRMax * 0.3589;
	const pts = state1.trafficTargets.map((t, i) => ({
		id: 't' + i,
		dx: Math.round((t.relX / HUD_TEX.radarRangeX) * rmax),
		dy: Math.round((t.relZ / HUD_TEX.radarRangeZ) * rmax),
	}));
	detail.radarPeaks = (await ctx.px('peaks', { cx, cy, points: pts, half: RADAR.peakHalf, controlAnglesDeg: RADAR.controlAnglesDeg }))[1];
	detail.radarLive = (await ctx.px('diff', { box: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r } }))[0];

	evidence.push((await ctx.saveCrop('hud-speed', bandToScreen(HUD_BANDS.speedDigits))).file);
	evidence.push((await ctx.saveCrop('hud-nav', bandToScreen({ ...HUD_BANDS.navRoadName, y1: HUD_BANDS.navLine.y1 }))).file);
	evidence.push((await ctx.saveCrop('hud-lane', laneBand)).file);
	evidence.push((await ctx.saveCrop('hud-footer', { x0: 850, y0: bandToScreen(HUD_BANDS.footerLeft).y0, x1: 1560, y1: bandToScreen(HUD_BANDS.footerLeft).y1 })).file);
	evidence.push((await ctx.saveCrop('hud-radar', { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r })).file);

	/* ---------- ① 时速数字 ---------- */
	// 数字以 Math.round(state.speedKmh) 绘制（HudSystem.drawSpeedNumber）；OCR 不在本套件范围，
	// 这里锁定「数字区有稳定字形 + state 值随帧不变」，字形数值靠归档裁剪核对
	checks.speedDigitsDrawn = detail.bandRatios.speedDigits >= HUD_THRESHOLDS.speedDigitsMinRatio;
	checks.speedDigitsStable =
		spread(detail.bandRatiosByFrame.map((f) => f.speedDigits)) <= 0.1; // 数字稳定渲染，无闪烁/缺帧
	detail.speedKmh = state1.speedKmh;

	/* ---------- ③ 路名 + 导航行 ---------- */
	checks.roadNameDrawn = detail.bandRatios.navRoadName >= HUD_THRESHOLDS.navMinRatio;
	checks.navLineDrawn = detail.bandRatios.navLine >= HUD_THRESHOLDS.navMinRatio;
	checks.navLineLive = detail.navLineDiff.meanAbs > 0.0005;

	/* ---------- ④ 当前道高亮 ---------- */
	checks.laneHighlighted = detail.laneAccent.n >= 100;
	checks.laneMatchesState = Math.abs(detail.laneAccent.cx - expectedCx) <= trapWidth * 0.18;

	/* ---------- ⑤ footer 带断言（4291273 回归项） ---------- */
	checks.footerLeftDrawn = detail.bandRatios.footerLeft >= HUD_THRESHOLDS.footerMinRatio;
	checks.footerRightDrawn = detail.bandRatios.footerRight >= HUD_THRESHOLDS.footerMinRatio;
	checks.footerNotInMiddle =
		detail.bandRatios.midRightRegress <= HUD_THRESHOLDS.midMaxRatio &&
		detail.bandRatios.footerRight >= detail.bandRatios.midRightRegress * HUD_THRESHOLDS.midToFooterFactor;

	/* ---------- ⑥ 雷达 ---------- */
	checks.radarRings = detail.ringFit.n >= RADAR.ringFit.minPixels;
	checks.radarTargets =
		detail.radarPeaks.length > 0 &&
		detail.radarPeaks.filter(
			(p) => p.best >= RADAR.peakMinLum && p.best >= Math.min(...p.ctrls) + RADAR.peakMinMargin
		).length >= 1;
	checks.radarLive = detail.radarLive.meanAbs >= RADAR.liveMinDiff;

	/* ---------- ② 中央 360° 小车：两个对侧侧视 = 整车绕环一周 ---------- */
	const cap = await ctx.snapOnly(CAR.sideScan.frames, CAR.sideScan.gapMs);
	const strip = {
		x0: cx - Math.round(r * CAR.sideStrip.padX),
		y0: cy - CAR.sideStrip.halfH,
		x1: cx + Math.round(r * CAR.sideStrip.padX),
		y1: cy + CAR.sideStrip.halfH,
	};
	const widths = (await ctx.px('clusters', { box: strip, pred: CAR.sideMetric.pred, thr: 0, minGap: CAR.sideMetric.minGap })).map((list) =>
		list.length ? Math.max(...list.map((c) => c.w)) : 0
	);
	const { sideA, sideB } = pickSideViews(widths, cap.times, { minRatio: (strip.x1 - strip.x0 + 1) * CAR.sideMinWidthFrac });
	detail.sideViews = { widths, sideA, sideB };
	checks.car360Complete = Boolean(sideA && sideB);
	if (sideA) {
		const holeBox = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
		evidence.push((await ctx.saveCrop('hud360-sideA', holeBox, { frame: sideA.i })).file);
		if (sideB) evidence.push((await ctx.saveCrop('hud360-sideB', holeBox, { frame: sideB.i })).file);
	}

	const state2 = await ctx.getState();
	detail.state = { state1, state2, distanceDelta: +(state2.distanceM - state1.distanceM).toFixed(2) };
	evidence.push(await ctx.shot('hud-full'));
	evidence.push(ctx.saveEvidence('evidence', detail));
	await ctx.close();

	const blockChecks = {
		'①时速': checks.speedDigitsDrawn,
		'②360小车': checks.car360Complete,
		'③路名导航': checks.roadNameDrawn && checks.navLineDrawn && checks.navLineLive,
		'④车道高亮': checks.laneHighlighted && checks.laneMatchesState,
		'⑤footer带': checks.footerLeftDrawn && checks.footerRightDrawn && checks.footerNotInMiddle,
		'⑥雷达': checks.radarRings && checks.radarTargets && checks.radarLive,
	};
	const notes = [];
	if (!checks.speedDigitsDrawn) notes.push('时速数字区无字形');
	if (!checks.roadNameDrawn) notes.push('路名区无字形');
	if (!checks.navLineDrawn || !checks.navLineLive) notes.push('导航行缺失或未随里程刷新');
	if (!checks.laneHighlighted) notes.push('车道图无 accent 高亮');
	if (!checks.laneMatchesState) notes.push(`高亮质心 ${detail.laneAccent.cx} 偏离 lane${state1.laneIndex} 预期位置 ${detail.laneExpectedCx}`);
	if (!checks.footerLeftDrawn || !checks.footerRightDrawn) notes.push('footer 带无内容');
	if (!checks.footerNotInMiddle) notes.push('footer 文本出现在中部 y460..520 回归带');
	if (!checks.radarRings) notes.push('雷达环拟合失败');
	if (!checks.radarTargets) notes.push('雷达目标点未命中');
	if (!checks.radarLive) notes.push('雷达区无帧间变化');
	if (!checks.car360Complete) notes.push('360° 视口未捕捉到两个对侧侧视');
	return {
		pass: Object.values(blockChecks).every(Boolean),
		note: notes.join('；') || `六块齐备：${Object.keys(blockChecks).join('/')}；footerLeft=${detail.bandRatios.footerLeft} 中部回归带=${detail.bandRatios.midRightRegress}`,
		checks: blockChecks,
		evidence,
	};
}
