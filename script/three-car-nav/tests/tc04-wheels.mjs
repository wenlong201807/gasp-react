/**
 * TC-04 轮位（三轮修复史回归项）：
 *  1) 轮拱内有轮（chase 视图可见拱 ×2：暗色轮胎 Blob 占比/位置）
 *  2) 无漂浮部件：三帧连拍（0.8s）轮 Blob 质心漂移 <5px + 整车包络暗色/车漆像素数稳定
 *  3) 辐条旋转可见（2d64a41）：轮区帧间差分 ≫ 车身控制区 + 轮辋亮色占比峰谷摆动
 *  4) HUD 360° 视口两个对侧侧视（相隔 ≥8s = 半圈）各归档一张整车存证，
 *     两侧视图合计覆盖 4 个轮拱（4 轮逐个清点为归档裁剪上的视觉核对项，见 cases.md）
 */
import { CAR, SPOKE } from '../lib/config.mjs';
import { pickSideViews } from '../lib/analyze.mjs';

const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
const spread = (arr) => Math.max(...arr) - Math.min(...arr);

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const detail = {};
	await ctx.newPage();
	await ctx.openThroughMenu();
	const { status } = await ctx.waitModelStatus();
	if (status !== 'ready') {
		await ctx.close();
		return { pass: false, note: `modelStatus=${status}，SU7 未就绪，轮位断言无意义`, checks: {}, evidence };
	}
	await ctx.page.waitForTimeout(1500);

	/* 1) 在搜索窗内定位两侧车轮（暗色轮胎质心） */
	await ctx.snapOnly(1, 0);
	const found = {};
	for (const side of ['rear', 'front']) {
		const c = (await ctx.px('centroid', { box: CAR.wheelSearch[side], pred: 'dark', thr: CAR.tireLum }))[0];
		found[side] = c;
	}
	detail.wheelFound = found;
	const located = ['rear', 'front'].every((s) => found[s].n > 500 && found[s].bbox);
	if (!located) {
		evidence.push(await ctx.shot('wheels-not-found'));
		evidence.push(ctx.saveEvidence('evidence', detail));
		await ctx.close();
		return { pass: false, note: '轮搜索窗内未找到暗色轮胎 Blob', checks: { located }, evidence };
	}
	const wheelBoxes = {
		rear: boxAround(found.rear, CAR.wheelHalf),
		front: boxAround(found.front, CAR.wheelHalf),
	};

	/* 2) 三帧连拍 0.8s：轮拱有轮 / 质心漂移 / 帧间差分 / 包络稳定 */
	await ctx.snapOnly(3, 800);
	const checks = {};
	for (const side of ['rear', 'front']) {
		const cents = await ctx.px('centroid', { box: wheelBoxes[side], pred: 'dark', thr: CAR.tireLum });
		const ratios = await ctx.px('ratio', { box: wheelBoxes[side], pred: 'dark', thr: CAR.tireLum });
		const rims = await ctx.px('ratio', { box: wheelBoxes[side], pred: 'bright', thr: SPOKE.rimBrightThr });
		const drift = Math.max(dist(cents[0], cents[1]), dist(cents[1], cents[2]), dist(cents[0], cents[2]));
		const centreOffset = Math.max(
			...cents.map((c) => Math.hypot(c.cx - (wheelBoxes[side].x0 + wheelBoxes[side].x1) / 2, c.cy - (wheelBoxes[side].y0 + wheelBoxes[side].y1) / 2))
		);
		const diffs = await ctx.px('diff', { box: wheelBoxes[side] });
		detail[side] = {
			box: wheelBoxes[side],
			centroids: cents.map((c) => [c.cx, c.cy]),
			driftPx: +drift.toFixed(2),
			tireRatio: ratios.map((r) => r.ratio),
			centreOffsetPx: +centreOffset.toFixed(1),
			rimBrightRatio: rims.map((r) => r.ratio),
			rimOscillation: +spread(rims.map((r) => r.ratio)).toFixed(4),
			diff: diffs,
		};
	}
	detail.bodyDiff = await ctx.px('diff', { box: CAR.bodyControl });
	detail.envelope = {
		dark: (await ctx.px('ratio', { box: CAR.envelope, pred: 'dark', thr: CAR.tireLum })).map((r) => r.hit),
		paint: (await ctx.px('ratio', { box: CAR.envelope, pred: 'car', thr: 0 })).map((r) => r.hit),
	};

	/* 3) 轮拱内有轮 + 无漂浮部件 */
	checks.tireInArch = ['rear', 'front'].every(
		(s) => detail[s].tireRatio.every((x) => x >= CAR.tireMinRatio) && detail[s].centreOffsetPx <= CAR.tireCentroidMaxOffset
	);
	checks.noFloatingParts =
		['rear', 'front'].every((s) => detail[s].driftPx < CAR.wheelDriftMaxPx) &&
		spread(detail.envelope.dark) / Math.max(1, detail.envelope.dark[0]) <= CAR.envelopeStability &&
		spread(detail.envelope.paint) / Math.max(1, detail.envelope.paint[0]) <= CAR.envelopeStability;

	/* 4) 辐条旋转可见：轮区变化占比显著高于静帧车身（辐条扫过 → 轮内纹理逐帧变化） */
	const bodyChanged = Math.max(...detail.bodyDiff.map((d) => d.changedRatio), 1e-4);
	detail.wheelChangedRatio = {
		rear: +(detail.rear.diff.reduce((a, d) => a + d.changedRatio, 0) / detail.rear.diff.length).toFixed(4),
		front: +(detail.front.diff.reduce((a, d) => a + d.changedRatio, 0) / detail.front.diff.length).toFixed(4),
	};
	detail.wheelVsBody = {
		rear: +(detail.wheelChangedRatio.rear / bodyChanged).toFixed(2),
		front: +(detail.wheelChangedRatio.front / bodyChanged).toFixed(2),
	};
	const bestWheel = Math.max(detail.wheelChangedRatio.rear, detail.wheelChangedRatio.front);
	const bestFactor = Math.max(detail.wheelVsBody.rear, detail.wheelVsBody.front);
	checks.spokeRotationVisible =
		(bestWheel >= SPOKE.minWheelChangedRatio && bestFactor >= SPOKE.minChangedFactor) ||
		Math.max(detail.rear.rimOscillation, detail.front.rimOscillation) >= SPOKE.minRimOscillation;

	/* 5) HUD 360° 视口：两个对侧侧视（相隔 ≈ 半圈），归档整车存证 */
	const { cx, cy, r } = CAR.hole;
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
	const picked = pickSideViews(widths, cap.times, { minRatio: stripWidth(strip) * CAR.sideMinWidthFrac });
	const { sideA, sideB } = picked;
	detail.sideViews = { widths, times: cap.times, sideA, sideB, stripWidth: stripWidth(strip) };
	checks.sideViewsFound = Boolean(sideA && sideB);
	if (sideA) {
		const holeBox = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
		const a = await ctx.saveCrop('hud360-sideA', holeBox, { frame: sideA.i });
		evidence.push(a.file);
		if (sideB) evidence.push((await ctx.saveCrop('hud360-sideB', holeBox, { frame: sideB.i })).file);
	}

	evidence.push(await ctx.shot('wheels'));
	evidence.push((await ctx.saveCrop('wheel-rear', wheelBoxes.rear)).file);
	evidence.push((await ctx.saveCrop('wheel-front', wheelBoxes.front)).file);
	evidence.push(ctx.saveEvidence('evidence', detail));
	await ctx.close();

	const notes = [];
	if (!checks.tireInArch) notes.push('可见轮拱内轮胎 Blob 缺失或偏心');
	if (!checks.noFloatingParts) notes.push('轮 Blob 质心漂移或包络像素数波动超限（漂浮部件）');
	if (!checks.spokeRotationVisible) notes.push('轮区帧间差分未见辐条纹理变化');
	if (!checks.sideViewsFound) notes.push('360° 视口未在扫描窗口内捕捉到两个对侧侧视');
	const wheelFactor = Math.max(detail.wheelVsBody.rear, detail.wheelVsBody.front);
	return {
		pass: checks.tireInArch && checks.noFloatingParts && checks.spokeRotationVisible && checks.sideViewsFound,
		note:
			notes.join('；') ||
			`轮拱有轮✓ 漂移<${CAR.wheelDriftMaxPx}px✓ 轮区差分/车身=${wheelFactor}x✓ 辐条摆动 ${Math.max(detail.rear.rimOscillation, detail.front.rimOscillation)}✓ 两个对侧侧视✓`,
		checks,
		evidence,
	};
}

function boxAround(c, half) {
	return { x0: Math.round(c.cx - half), y0: Math.round(c.cy - half), x1: Math.round(c.cx + half), y1: Math.round(c.cy + half) };
}

const stripWidth = (s) => s.x1 - s.x0 + 1;
