/**
 * TC-12 性能：①getRenderInfo() 多次采样 calls < 120（计划锁定阈值）
 * ②fps 30s 采样均值 ≥ 30 ③timeOfDay 不变窗口 staticRedraws 不增
 * （计数器活性经「切白天 → staticRedraws +1」对照验证，防假断言）④pixelRatio = min(dpr,2) 且 ≤ 2。
 */
import { PANEL } from '../lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	await ctx.newPage();
	const page = ctx.page;
	await ctx.openThroughMenu();
	const model = await ctx.waitModelStatus(25);
	await sleep(1500); // 躲开模型就绪瞬间的加载抖动

	const getRenderInfo = () => page.evaluate(() => window.__threeCarNav.getRenderInfo());

	/* ① draw calls：8 次采样（覆盖视锥内车流/段落变化），逐次 < 120 */
	const callSamples = [];
	for (let i = 0; i < 8; i++) {
		callSamples.push((await getRenderInfo()).calls);
		await sleep(400);
	}
	const callsMax = Math.max(...callSamples);
	const callsOk = callSamples.every((c) => c < 120);

	/* ② fps：31 次采样 × ~1s ≈ 30s 窗口，均值 ≥ 30 */
	const fpsSamples = [];
	for (let i = 0; i < 31; i++) {
		fpsSamples.push((await ctx.getState()).fps);
		await sleep(1000);
	}
	const fpsMean = +(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length).toFixed(1);
	const fpsMin = Math.min(...fpsSamples);
	const fpsOk = fpsMean >= 30;

	/* ③ HUD 静态层缓存：timeOfDay 不变窗口 staticRedraws 不增；切白天作活性对照（必须 +1） */
	const sr0 = (await getRenderInfo()).staticRedraws;
	await sleep(3000);
	const sr1 = (await getRenderInfo()).staticRedraws;
	const stableOk = sr0 === sr1 && sr0 >= 1;
	await page.locator(PANEL.opt('白天')).click();
	await sleep(900);
	const sr2 = (await getRenderInfo()).staticRedraws;
	const liveOk = sr2 > sr1;
	await page.locator(PANEL.opt('黄昏')).click(); // 还原默认档，供后续观察
	await sleep(500);

	/* ④ pixelRatio 钳制：= min(devicePixelRatio, 2) 且 ≤ 2 */
	const pr = await page.evaluate(() => ({
		got: window.__threeCarNav.getRenderInfo().pixelRatio,
		expect: Math.min(window.devicePixelRatio || 1, 2),
	}));
	const prOk = pr.got === pr.expect && pr.got <= 2;

	const info = await getRenderInfo();
	await ctx.shot('perf');
	const nonNetwork = ctx.console.nonNetworkErrors();

	evidence.push(
		ctx.saveEvidence('evidence', {
			model,
			calls: { callSamples, callsMax },
			fps: { fpsSamples, fpsMean, fpsMin },
			staticRedraws: { stableWindow: [sr0, sr1], afterTodSwitch: sr2 },
			pixelRatio: pr,
			finalRenderInfo: info,
			nonNetwork,
			pageErrors: ctx.console.pageErrors,
		})
	);
	await ctx.close();

	const checks = {
		callsBelow120: callsOk,
		fpsMean30sAbove30: fpsOk,
		staticRedrawsStableWhenTodUnchanged: stableOk,
		staticRedrawsCounterAlive: liveOk,
		pixelRatioClamped: prOk,
		noNonNetworkConsoleError: nonNetwork.length === 0,
		noPageError: ctx.console.pageErrors.length === 0,
	};
	const failed = Object.entries(checks)
		.filter(([, v]) => !v)
		.map(([k]) => k);
	return {
		pass: Object.values(checks).every(Boolean),
		note:
			failed.length > 0
				? `未过项：${failed.join('、')}(callsMax=${callsMax}, fpsMean=${fpsMean})`
				: `calls max=${callsMax}<120, fps 30s均值=${fpsMean}(min=${fpsMin}), staticRedraws ${sr0}→${sr1}稳定/切档${sr2}活, pixelRatio=${pr.got}`,
		checks,
		evidence,
	};
}
