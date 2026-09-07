/**
 * TC-11 鲁棒性：①菜单切走→切回 ×2（dispose 重建链：canvas 恒 1、无新增 error、modelStatus 可恢复）
 * ②webglcontextlost → RAF 暂停（distanceM/fps 冻结）→ webglcontextrestored → 渲染恢复推进
 * ③WebGL 不可用降级卡片：headless Chrome 无法真实禁用 WebGL，登记为代码走查项（见 cases.md），不做假断言。
 */
import { MENU } from '../lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	await ctx.newPage();
	const page = ctx.page;
	await ctx.openThroughMenu();
	const model0 = await ctx.waitModelStatus(25);

	const entry = page.locator(MENU.entry);
	const scrollEntry = page.locator('button:has-text("Scroll Animation")');
	const canvasCount = () => page.locator('canvas').count();

	/**
	 * 点击菜单入口（有界重试）：dock 是 hover 展开 + 动画相位机（展开/收起/动画中），
	 * 入口不可见或动画拦截点击时先点「展开菜单」再重试——单次长超时点击在套件
	 * 连跑时曾 30s 卡死（面板收起动画与 aria-label 翻转竞态）。
	 */
	const clickMenuEntry = async (target, label) => {
		for (let attempt = 1; attempt <= 5; attempt++) {
			try {
				await target.click({ timeout: 2500 });
				return true;
			} catch {
				try {
					await page.locator(MENU.expand).click({ timeout: 1500 });
				} catch {
					/* 展开按钮不可点（动画相位中）→ 直接下轮重试 */
				}
				await sleep(600);
			}
		}
		throw new Error(`菜单入口点击重试耗尽：${label}`);
	};

	/* ① 切走（Scroll Animation）→ 切回 ×2：StrictMode 之外的真实卸载/重挂路径 */
	const rounds = [];
	let canvasAlwaysOne = true;
	for (let round = 1; round <= 2; round++) {
		await clickMenuEntry(scrollEntry, 'Scroll Animation');
		await page.waitForTimeout(500);
		const awayCanvas = await canvasCount(); // 期望 0：engine dispose 已摘除 canvas
		await clickMenuEntry(entry, 'Three Car Nav');
		await page.waitForSelector('canvas', { timeout: 20000 });
		const backCanvas = await canvasCount(); // 期望 1：无重复 canvas
		const rec = await ctx.waitModelStatus(20); // modelStatus 重挂后可恢复
		rounds.push({ round, awayCanvas, backCanvas, status: rec.status, elapsedSec: rec.elapsedSec });
		canvasAlwaysOne = canvasAlwaysOne && awayCanvas === 0 && backCanvas === 1;
	}
	const recoveredOk = rounds.every((r) => r.status === 'ready' || r.status === 'fallback');

	/* ② 上下文丢失/恢复（合成事件：engine 监听暂停 RAF；three r185 内部同步置 _isContextLost） */
	const d0 = (await ctx.getState()).distanceM;
	const f0 = await page.evaluate(() => window.__threeCarNav.getState().fps);
	await page.evaluate(() => {
		document.querySelector('canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
	});
	await sleep(1300);
	const lost1 = await ctx.getState();
	await sleep(600);
	const lost2 = await ctx.getState(); // 二次采样：RAF 停摆则两次读数完全一致
	const canvasAfterLost = await canvasCount();
	const frozenOk = lost1.distanceM === d0 && lost2.distanceM === d0 && lost1.fps === f0 && lost2.fps === f0;

	await page.evaluate(() => {
		document.querySelector('canvas').dispatchEvent(new Event('webglcontextrestored'));
	});
	await sleep(1600);
	const restored = await ctx.getState();
	const resumedOk =
		restored.distanceM > lost2.distanceM + 3 && restored.modelStatus === model0.status;

	await ctx.shot('robust-restored');
	const nonNetwork = ctx.console.nonNetworkErrors();

	evidence.push(
		ctx.saveEvidence('evidence', {
			model0,
			rounds,
			context: {
				lost: { d0, f0, d1: lost1.distanceM, f1: lost1.fps, d2: lost2.distanceM, f2: lost2.fps, canvasAfterLost },
				restored: { distanceM: restored.distanceM, fps: restored.fps, modelStatus: restored.modelStatus },
			},
			nonNetwork,
			network: ctx.console.networkErrors().length,
			pageErrors: ctx.console.pageErrors,
			webglUnavailableNote: 'headless 无法禁用 WebGL，降级卡片为代码走查项（cases.md TC-11 ③）',
		})
	);
	await ctx.close();

	const checks = {
		switchAwayBackCanvasAlwaysOne: canvasAlwaysOne,
		modelStatusRecoversBothRounds: recoveredOk,
		contextLostFreezesRender: frozenOk,
		contextLostKeepsCanvas: canvasAfterLost === 1,
		contextRestoredResumes: resumedOk,
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
				? `未过项：${failed.join('、')}`
				: `切走切回×2 canvas恒1且status可恢复(${rounds.map((r) => r.status).join('/')}), lost冻结Δd=${(lost2.distanceM - d0).toFixed(1)}m, restored推进Δd=${(restored.distanceM - lost2.distanceM).toFixed(1)}m`,
		checks,
		evidence,
	};
}
