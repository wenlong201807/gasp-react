/**
 * TC-13 hash 路由（dev server）：
 * ①直链 `#/three-car-nav` 进入智驾页；②dock 点另一菜单项 → hash 变更 + 页面切换；
 * ③`#/unknown-id` → 落回智驾页（URL 归一）；④history.back() 回到上一页；
 * ⑤dev 模式无 SW（PROD gate 证据：controller 恒 null）。
 */
import { APP_URL, MENU } from '../lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const trace = [];
	await ctx.newPage();
	const page = ctx.page;

	const record = (step, ok, got) => {
		trace.push({ step, ok, ...got });
		return ok;
	};

	/* 1. 直链 #/three-car-nav：不点菜单直接进智驾页 */
	await page.goto(`${APP_URL}/#/three-car-nav`, { waitUntil: 'load' });
	await page.waitForSelector('canvas', { timeout: 20000 });
	const hash1 = await page.evaluate(() => location.hash);
	const canvas1 = await page.locator('canvas').count();
	const c1 = record('direct-link', hash1 === '#/three-car-nav' && canvas1 === 1, { hash: hash1, canvas: canvas1 });

	/* 2. dock 点「Scroll Animation」→ hash 变更 + 页面切换（scroll 无 canvas） */
	await page.click(MENU.expand);
	await page.waitForTimeout(600);
	try {
		await page.waitForSelector(MENU.entryScroll, { timeout: 5000, state: 'visible' });
	} catch {
		await page.click(MENU.expandAlt);
		await page.waitForTimeout(800);
	}
	await page.click(MENU.entryScroll);
	await page.waitForTimeout(600);
	const hash2 = await page.evaluate(() => location.hash);
	const scroll2 = await page.locator(MENU.scrollMarker).isVisible().catch(() => false);
	const canvas2 = await page.locator('canvas').count();
	const c2 = record(
		'dock-click-switch',
		hash2 === '#/scroll' && scroll2 && canvas2 === 0,
		{ hash: hash2, scrollVisible: scroll2, canvas: canvas2 }
	);

	/* 3. #/unknown-id → 落回智驾页且 URL 归一（replaceState 不追加历史） */
	await page.goto(`${APP_URL}/#/unknown-id`, { waitUntil: 'load' });
	await page.waitForSelector('canvas', { timeout: 20000 });
	await sleep(300);
	const hash3 = await page.evaluate(() => location.hash);
	const canvas3 = await page.locator('canvas').count();
	const c3 = record(
		'unknown-fallback',
		hash3 === '#/three-car-nav' && canvas3 === 1,
		{ hash: hash3, canvas: canvas3 }
	);

	/* 4. history.back() → 回到上一页（scroll） */
	await page.goBack();
	await page.waitForTimeout(600);
	const hash4 = await page.evaluate(() => location.hash);
	const scroll4 = await page.locator(MENU.scrollMarker).isVisible().catch(() => false);
	const canvas4 = await page.locator('canvas').count();
	const c4 = record(
		'history-back',
		hash4 === '#/scroll' && scroll4 && canvas4 === 0,
		{ hash: hash4, scrollVisible: scroll4, canvas: canvas4 }
	);

	/* 5. dev 模式无 SW：PROD gate 下 register 不执行，controller 恒 null */
	const swController = await page.evaluate(() => navigator.serviceWorker?.controller ?? null);
	const c5 = record('no-sw-in-dev', swController === null, { controller: swController });

	await ctx.shot('hash-route-final');
	const nonNetwork = ctx.console.nonNetworkErrors();
	evidence.push(
		ctx.saveEvidence('evidence', {
			trace,
			nonNetwork,
			pageErrors: ctx.console.pageErrors,
		})
	);
	await ctx.close();

	const checks = {
		directLinkEntersCarNav: c1,
		dockClickChangesHashAndPage: c2,
		unknownIdFallsBackToCarNav: c3,
		historyBackReturns: c4,
		noServiceWorkerInDev: c5,
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
				: '直链/dock 点击/未知回退/back 四路一致, dev 无 SW, hash 序列 ' +
					[trace[0].hash, trace[1].hash, trace[2].hash, trace[3].hash].join('→'),
		checks,
		evidence,
	};
}
