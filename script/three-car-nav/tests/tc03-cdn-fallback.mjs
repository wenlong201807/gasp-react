/** TC-03 CDN 降级：route-abort CDN 域 → modelStatus='fallback'、canvas 仍渲染、仅容忍网络 error */
import { CDN_GLOB } from '../lib/config.mjs';

const FALLBACK_BUDGET_S = 25; // CarSystem 15s 超时降级 + 余量

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	await ctx.newPage({ blockCdn: true });
	await ctx.openThroughMenu();

	const t0 = Date.now();
	let status = null;
	const history = [];
	for (;;) {
		const elapsed = (Date.now() - t0) / 1000;
		try {
			status = await ctx.page.evaluate(() => window.__threeCarNav?.getState()?.modelStatus ?? null);
		} catch {
			status = 'eval-error';
		}
		if (!history.length || history[history.length - 1][0] !== status) history.push([status, +elapsed.toFixed(2)]);
		if (status === 'fallback') break;
		if (elapsed > FALLBACK_BUDGET_S) break;
		await ctx.page.waitForTimeout(400);
	}
	const elapsedSec = +((Date.now() - t0) / 1000).toFixed(2);
	await ctx.page.waitForTimeout(2000); // 让场景稳定渲染几帧

	const canvasCount = await ctx.page.locator('canvas').count();
	const loadingHintGone = (await ctx.page.locator('text=模型加载中…').count()) === 0;
	const state = await ctx.getState();

	// canvas 仍在渲染：路面区平均亮度落在非空白区间 + 两帧差分 > 0（treadmill 车道线在滚动）
	const roadDash = { x0: 1050, y0: 700, x1: 1400, y1: 900 };
	const roadFlat = { x0: 900, y0: 1180, x1: 1500, y1: 1380 };
	await ctx.snapOnly(2, 700);
	const roadColor = (await ctx.px('meanColor', { box: roadFlat }))[0];
	const roadLum = (0.2126 * roadColor.r + 0.7152 * roadColor.g + 0.0722 * roadColor.b) / 255;
	const diffDash = await ctx.px('diff', { box: roadDash });
	const diffFlat = await ctx.px('diff', { box: roadFlat });

	evidence.push(await ctx.shot('cdn-abort-fallback'));
	evidence.push(
		ctx.saveEvidence('evidence', {
			abortedRequestCount: ctx.abortedCount,
			canvasCount,
			loadingHintGone,
			status,
			elapsedSec,
			history,
			state,
			roadColor,
			roadLum: +roadLum.toFixed(4),
			renderDiffDash: diffDash,
			renderDiffFlat: diffFlat,
			networkErrors: ctx.console.networkErrors(),
			nonNetworkErrors: ctx.console.nonNetworkErrors(),
			failedRequests: ctx.console.failedRequests,
		})
	);
	await ctx.close();

	const stillRendering = roadLum > 0.02 && roadLum < 0.95 && (diffDash[0].meanAbs > 0 || diffFlat[0].meanAbs > 0);
	const onlyNetworkErrors = ctx.console.nonNetworkErrors().length === 0;
	const notes = [];
	if (ctx.abortedCount === 0) notes.push('CDN 请求未被拦截');
	if (status !== 'fallback') notes.push(`modelStatus=${status}（期望 fallback）`);
	if (canvasCount < 1) notes.push('canvas 未渲染');
	if (!loadingHintGone) notes.push('「模型加载中…」提示未消失');
	if (!stillRendering) notes.push(`场景未在滚动渲染 roadLum=${roadLum.toFixed(3)} diffDash=${diffDash[0].meanAbs}`);
	if (!onlyNetworkErrors) notes.push(`非网络 error: ${ctx.console.nonNetworkErrors()[0]}`);
	return {
		pass: ctx.abortedCount > 0 && status === 'fallback' && canvasCount >= 1 && loadingHintGone && stillRendering && onlyNetworkErrors,
		note: notes.join('；') || `aborted=${ctx.abortedCount}, fallback@${elapsedSec}s, 场景仍在滚动渲染, 仅网络类 error`,
		checks: { aborted: ctx.abortedCount > 0, statusFallback: status === 'fallback', canvas: canvasCount >= 1, loadingHintGone, stillRendering, onlyNetworkErrors },
		evidence,
	};
}
