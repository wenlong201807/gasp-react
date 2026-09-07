/** TC-01 加载：菜单点入 → canvas=1、modelStatus ≤20s 'ready'、console 零非 CDN error */
import { MODEL_STATUS_BUDGET_S } from '../lib/config.mjs';

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	await ctx.newPage();
	const t0 = Date.now();
	await ctx.openThroughMenu();
	evidence.push(await ctx.shot('load'));

	const canvasCount = await ctx.page.locator('canvas').count();
	const { status, elapsedSec, history } = await ctx.waitModelStatus(MODEL_STATUS_BUDGET_S);
	await ctx.page.waitForTimeout(1500);
	const state = await ctx.getState();
	const nonNetwork = ctx.console.nonNetworkErrors();
	const network = ctx.console.networkErrors();

	evidence.push(ctx.saveEvidence('evidence', { canvasCount, status, elapsedSec, history, state, nonNetwork, network, failedRequests: ctx.console.failedRequests, pageErrors: ctx.console.pageErrors }));
	await ctx.close();

	const checks = {
		canvasCount: canvasCount === 1,
		modelStatusReady: status === 'ready',
		withinBudget: elapsedSec <= MODEL_STATUS_BUDGET_S,
		noNonNetworkConsoleError: nonNetwork.length === 0,
		noPageError: ctx.console.pageErrors.length === 0,
	};
	const notes = [];
	if (!checks.modelStatusReady) notes.push(`modelStatus=${status}（CDN 未在 ${MODEL_STATUS_BUDGET_S}s 内就绪或被降级）`);
	if (!checks.canvasCount) notes.push(`canvas 数=${canvasCount}（期望 1）`);
	if (nonNetwork.length) notes.push(`非网络 console error: ${nonNetwork[0]}`);
	return {
		pass: Object.values(checks).every(Boolean),
		note: notes.join('；') || `canvas=1, modelStatus=${status}@${elapsedSec}s, 非网络error=0, fps=${state?.fps}`,
		checks,
		evidence,
		state,
	};
}
