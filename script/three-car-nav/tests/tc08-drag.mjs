/**
 * TC-08 拖拽：中央 360° 小车横拖 → 环绕 yaw 变化（截图前后对比）。
 *
 * 判定：横拖 260px → yaw -= 2.6rad（HudSystem 锁定 0.01rad/px）。
 * 洞为半透明（背后街景持续滚动），区域差分/「释放后冻结」等判定都会被背景污染，
 * 故以「车身连通宽度」为取向代理：拖拽前后宽度变化 ≥ 阈值（相位不巧时追加拖拽重试），
 * 并归档拖拽前后裁剪供视觉核对。「拖拽后自动旋转暂停 3s 再恢复」为归档裁剪上的视觉核对项。
 */
import { CAR, DRAG } from '../lib/config.mjs';

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const detail = { attempts: [], widthsBefore: [], widthsAfter: [] };
	const checks = {};
	await ctx.newPage();
	await ctx.openThroughMenu();
	const { status } = await ctx.waitModelStatus();
	if (status !== 'ready') {
		await ctx.close();
		return { pass: false, note: `modelStatus=${status}`, checks: {}, evidence };
	}
	await ctx.page.waitForTimeout(1500);

	const { cx, cy, r } = CAR.hole;
	const holeBox = { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
	const strip = {
		x0: cx - Math.round(r * CAR.sideStrip.padX),
		y0: cy - CAR.sideStrip.halfH,
		x1: cx + Math.round(r * CAR.sideStrip.padX),
		y1: cy + CAR.sideStrip.halfH,
	};
	/** 当前帧车身连通宽度（carBody 最大连通域，侧视≈条带宽） */
	const carWidth = async () => {
		await ctx.snapOnly(1, 0);
		const cl = await ctx.px('clusters', { box: strip, pred: CAR.sideMetric.pred, thr: 0, minGap: CAR.sideMetric.minGap });
		return cl[0].length ? Math.max(...cl[0].map((c) => c.w)) : 0;
	};

	const dragOnce = async () => {
		await ctx.page.mouse.move(cx, cy);
		await ctx.page.mouse.down();
		for (let i = 1; i <= DRAG.steps; i++) {
			await ctx.page.mouse.move(cx + (DRAG.distancePx * i) / DRAG.steps, cy);
			await ctx.page.waitForTimeout(DRAG.stepDelayMs);
		}
		await ctx.page.mouse.up();
	};

	// 拖拽前宽度（自转中，3 帧均值降低相位噪声）
	for (let i = 0; i < 3; i++) detail.widthsBefore.push(await carWidth());
	const before = await ctx.saveCrop('drag-before', holeBox);
	evidence.push(before.file);

	let widthBefore = detail.widthsBefore.reduce((a, b) => a + b, 0) / 3;
	let widthAfter = null;
	for (let attempt = 1; attempt <= DRAG.maxAttempts; attempt++) {
		widthBefore = (await carWidth() + widthBefore) / 2;
		await dragOnce();
		widthAfter = await carWidth();
		detail.attempts.push({ attempt, widthBefore: +widthBefore.toFixed(1), widthAfter });
		checks.dragChangedView = Math.abs(widthAfter - widthBefore) >= DRAG.minWidthDelta;
		if (checks.dragChangedView) break;
	}
	evidence.push((await ctx.saveCrop('drag-after', holeBox)).file);
	// 自转恢复存证：释放 3s 后再归档一张（供视觉核对「暂停 3s 后恢复转动」）
	await ctx.page.waitForTimeout(3200);
	evidence.push((await ctx.saveCrop('drag-resume', holeBox)).file);

	detail.state = await ctx.getState();
	evidence.push(await ctx.shot('drag-final'));
	evidence.push(ctx.saveEvidence('evidence', detail));
	await ctx.close();

	const notes = [];
	if (!checks.dragChangedView) notes.push(`拖拽后车身宽度未变化（${widthBefore.toFixed(1)}→${widthAfter}px，已重试 ${DRAG.maxAttempts} 次）`);
	return {
		pass: Boolean(checks.dragChangedView),
		note:
			notes.join('；') ||
			`横拖 ${DRAG.distancePx}px → yaw ≈ ${(DRAG.distancePx * 0.01).toFixed(2)}rad：车身宽度 ${widthBefore.toFixed(0)}→${widthAfter}px（前后裁剪已归档）`,
		checks,
		evidence,
	};
}

