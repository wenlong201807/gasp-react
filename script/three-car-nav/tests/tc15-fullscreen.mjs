/**
 * TC-15 全屏入口收敛（feat/fullscreen）：
 * ①title 栏（logo 旁）全屏按钮存在且 aria-label 正确（name=进入全屏、位于 header 内）；
 * ②点击进入全屏 → 沉浸 DOM（title 栏 logo 不可见、dock 隐藏、角落退出控件出现）。
 *   本仓 headless Chrome 实测 Fullscreen API 可用（requestFullscreen resolve、
 *   fullscreenElement=documentElement、fullscreenchange 触发）→ 主路径走真全屏断言；
 *   若环境受限（点击后 fullscreenElement 仍 null），如实降级：stub document.fullscreenElement +
 *   派发 fullscreenchange 断言「事件 → 状态 → DOM」UI 链路，evidence 记录 mode=stubbed，不造假；
 * ③两个旧页面（event-loop / url-lifecycle）stage 态：旧全屏入口在 DOM 缺席
 *   （getByRole name ⛶ 全屏 + ⛶/全屏 文本全零），title 栏新入口唯一，控制条非全屏功能仍在；
 * ④退出后布局恢复：真全屏路径先采 Esc 软证据（headless 实测 Esc 不退出全屏——
 *   浏览器 UI 层快捷键在 headless 缺失，属环境限制，如实记录不作硬断言），
 *   退出统一走角落退出控件；恢复断言：logo/dock 回来、退出控件消失、fullscreenElement 归空。
 */
import { APP_URL, FULLSCREEN, MENU } from '../lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 旧入口缺席审计：两页通用（要求 stage 已渲染） */
async function auditLegacyEntries(page) {
	const legacyIcon = await page.locator(`button:has-text("${FULLSCREEN.legacyIcon}")`).count();
	const legacyName = await page.getByRole('button', { name: FULLSCREEN.legacyName }).count();
	const anyFullscreenText = await page.locator('button', { hasText: '全屏' }).count();
	const enterCount = await page.getByRole('button', { name: '进入全屏' }).count();
	const inHeader = await page
		.getByRole('button', { name: '进入全屏' })
		.first()
		.evaluate((el) => !!el.closest('header'))
		.catch(() => false);
	const replayAlive = await page.locator('button', { hasText: '重播' }).count();
	return {
		ok:
			legacyIcon === 0 &&
			legacyName === 0 &&
			anyFullscreenText === 0 &&
			enterCount === 1 &&
			inHeader &&
			replayAlive >= 1,
		detail: { legacyIcon, legacyName, anyFullscreenText, enterCount, inHeader, replayAlive },
	};
}

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

	/* 1. title 栏按钮存在且 aria-label 正确 */
	await page.goto(`${APP_URL}/`, { waitUntil: 'load' });
	await page.waitForSelector(MENU.expand, { timeout: 15000 });
	const enterBtn = page.getByRole('button', { name: '进入全屏' });
	const enterCount0 = await enterBtn.count();
	const inHeader0 = await enterBtn.first().evaluate((el) => !!el.closest('header')).catch(() => false);
	const c1 = record('title-entry-exists', enterCount0 === 1 && inHeader0, {
		enterCount: enterCount0,
		inHeader: inHeader0,
	});

	/* 2. 点击进入全屏：真全屏优先，受限则 stub 降级 */
	await enterBtn.first().click();
	await sleep(600);
	const realFs = await page.evaluate(() => document.fullscreenElement !== null);
	const mode = realFs ? 'native' : 'stubbed';
	if (!realFs) {
		await page.evaluate(() => {
			Object.defineProperty(document, 'fullscreenElement', {
				get: () => document.documentElement,
				configurable: true,
			});
			document.dispatchEvent(new Event('fullscreenchange'));
		});
		await sleep(300);
	}
	const logoHidden = !(await page
		.getByText(FULLSCREEN.logo, { exact: true })
		.first()
		.isVisible()
		.catch(() => false));
	const dockHidden = (await page.locator(MENU.expand).count()) === 0;
	const exitCount = await page.getByRole('button', { name: '退出全屏' }).count();
	const c2 = record('immersive-dom', logoHidden && dockHidden && exitCount === 1, {
		mode,
		logoHidden,
		dockHidden,
		exitCount,
	});
	await ctx.shot('fullscreen-immersive');

	/* 3. 退出恢复：真全屏路径先采 Esc 软证据（headless 无浏览器 UI 层快捷键处理，
	   实测 Esc 不退出——环境限制如实记录，不作硬断言；未生效时 evaluate 自愈恢复常态），
	   再进入一次走角落退出控件（stub 路径仅走控件） */
	let escEffective = null;
	if (realFs) {
		await page.keyboard.press('Escape');
		await sleep(600);
		const fsAfterEsc = await page.evaluate(() => document.fullscreenElement !== null);
		escEffective = !fsAfterEsc;
		record('esc-native-exit-soft-evidence', true, { escEffective, fsAfterEsc });
		if (!escEffective) {
			await page.evaluate(() => {
				document.exitFullscreen().catch(() => {});
			});
			await sleep(600);
		}
		await page.getByRole('button', { name: '进入全屏' }).first().click();
		await sleep(600);
	}
	await page.getByRole('button', { name: '退出全屏' }).first().click();
	if (!realFs) {
		/* stub 态：控件点击已触发 exit()（真实环境无副作用，promise 被静默吞），
		   再恢复原生 getter（退出后为 null）并派发事件，等价模拟 exitFullscreen 完成序列 */
		await page.evaluate(() => {
			delete document.fullscreenElement;
			document.dispatchEvent(new Event('fullscreenchange'));
		});
	}
	await sleep(600);
	const fsFinal = await page.evaluate(() => document.fullscreenElement !== null);
	const logoBack = await page
		.getByText(FULLSCREEN.logo, { exact: true })
		.first()
		.isVisible()
		.catch(() => false);
	const dockBack = (await page.locator(MENU.expand).count()) === 1;
	const exitGone = (await page.getByRole('button', { name: '退出全屏' }).count()) === 0;
	const c4 = record('exit-restores-layout', !fsFinal && logoBack && dockBack && exitGone, {
		fsFinal,
		logoBack,
		dockBack,
		exitGone,
	});

	/* 4. 旧入口缺席：event-loop stage（直链 + 选第一个 preset） */
	await page.goto(`${APP_URL}/#/event-loop`, { waitUntil: 'load' });
	await sleep(400);
	await page.locator('[class*="presetCard"]').first().click();
	await sleep(500);
	const audit1 = await auditLegacyEntries(page);
	const c5 = record('legacy-absent-event-loop', audit1.ok, audit1.detail);

	/* 5. 旧入口缺席：url-lifecycle stage（直链 + 选第一幕） */
	await page.goto(`${APP_URL}/#/url-lifecycle`, { waitUntil: 'load' });
	await sleep(400);
	await page.locator('[class*="presetCard"]').first().click();
	await sleep(500);
	const audit2 = await auditLegacyEntries(page);
	const c6 = record('legacy-absent-url-lifecycle', audit2.ok, audit2.detail);
	await ctx.shot('fullscreen-legacy-absent');

	const nonNetwork = ctx.console.nonNetworkErrors();
	evidence.push(
		ctx.saveEvidence('evidence', {
			trace,
			mode,
			escEffective,
			nonNetwork,
			pageErrors: ctx.console.pageErrors,
		})
	);
	await ctx.close();

	const checks = {
		titleEntryExists: c1,
		immersiveDom: c2,
		exitRestoresLayout: c4,
		legacyAbsentEventLoop: c5,
		legacyAbsentUrlLifecycle: c6,
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
				: `title 入口唯一可用, ${mode} 全屏沉浸/退出恢复闭环, 两旧页入口清零`,
		checks,
		evidence,
	};
}
