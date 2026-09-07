/**
 * TC-14 SW 冒烟（vite preview 4173 生产服，起停自理）：
 * ①SW 注册成功且 controller 非空；②caches 含 app-shell-<version> 且关键资产（'/' 与 /assets/*）已缓存；
 * ③更新 toast 初始隐藏。更新流（改产物 → waiting → toast → SKIP_WAITING → 自动刷新）为手工验证项，
 * 步骤见 cases.md TC-14，不做自动化断言。
 *
 * 生产产物保障：仓库 .env 钉了 NODE_ENV=development（vite 构建会读取），默认 pnpm build 产出
 * dev 模式 bundle——import.meta.env.PROD=false，SW 注册代码被 DCE。故本用例在产物缺失或含
 * jsxDEV（dev 运行时标记）时，以 NODE_ENV=production 强制重建。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PREVIEW_SERVER_PORT, PREVIEW_URL, PROD_BUILD_ENV, REPO_ROOT } from '../lib/config.mjs';
import { ensurePortFree, isPortOpen, startPreviewServer, stopDevServer } from '../lib/runtime.mjs';

/** dist 是否为「真正的生产产物」：sw 二件套齐全且 bundle 无 jsxDEV（React dev 运行时标记） */
function isProdDist() {
	const dist = path.join(REPO_ROOT, 'dist');
	if (!fs.existsSync(path.join(dist, 'sw.js'))) return false;
	if (!fs.existsSync(path.join(dist, 'sw-manifest.json'))) return false;
	const assetsDir = path.join(dist, 'assets');
	if (!fs.existsSync(assetsDir)) return false;
	for (const name of fs.readdirSync(assetsDir)) {
		if (!name.endsWith('.js')) continue;
		if (fs.readFileSync(path.join(assetsDir, name), 'utf-8').includes('jsxDEV')) return false;
	}
	return true;
}

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	let server = null;
	let rebuilt = false;
	let released = null;

	try {
		/* 0. 生产产物保障（全量套件里 TC-09 的默认构建是 dev 模式 bundle，此处强制重建） */
		if (!isProdDist()) {
			execFileSync('pnpm', ['build'], { cwd: REPO_ROOT, env: PROD_BUILD_ENV, stdio: 'ignore' });
			rebuilt = true;
		}
		const prodOk = isProdDist();

		/* 1. preview 生产服起停自理（4173，与 dev 5173 不冲突） */
		await ensurePortFree(PREVIEW_SERVER_PORT);
		server = await startPreviewServer({
			port: PREVIEW_SERVER_PORT,
			cwd: REPO_ROOT,
			logPath: path.join(ctx.artifactsDir, 'TC-14-preview.log'),
		});

		await ctx.newPage();
		const page = ctx.page;
		await page.goto(`${PREVIEW_URL}/#/three-car-nav`, { waitUntil: 'load' });

		/* 2. ①注册成功（load 后 register）→ reload → controller 接管 */
		const registered = await page
			.waitForFunction(() => navigator.serviceWorker.getRegistration(), null, { timeout: 20000 })
			.then(() => true)
			.catch(() => false);
		await page.reload({ waitUntil: 'load' });
		const controlled = await page
			.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 })
			.then(() => true)
			.catch(() => false);
		const controllerUrl = controlled
			? await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)
			: null;

		/* 3. ②缓存断言：shell 缓存名与 manifest version 一致，关键资产在缓存里 */
		const cacheInfo = await page.evaluate(async () => {
			const names = await caches.keys();
			const shellName = names.find((n) => n.startsWith('app-shell-')) ?? null;
			const manifest = await fetch('/sw-manifest.json', { cache: 'no-store' })
				.then((r) => r.json())
				.catch(() => null);
			let entries = [];
			if (shellName) {
				entries = (await (await caches.open(shellName)).keys()).map((r) => new URL(r.url).pathname);
			}
			return {
				names,
				shellName,
				manifestVersion: manifest?.version ?? null,
				manifestAssets: manifest?.assets?.length ?? 0,
				entries,
			};
		});
		const shellOk = !!cacheInfo.shellName;
		const assetsCached =
			cacheInfo.entries.includes('/') && cacheInfo.entries.some((e) => e.startsWith('/assets/'));
		const versionMatch =
			!!cacheInfo.manifestVersion && !!cacheInfo.shellName && cacheInfo.shellName.endsWith(cacheInfo.manifestVersion);

		/* 4. ③toast 初始隐藏（首次安装不提示；页面本身可用） */
		await page.waitForSelector('canvas', { timeout: 20000 });
		const toastHidden = (await page.locator('[data-update-toast]').count()) === 0;

		const nonNetwork = ctx.console.nonNetworkErrors();
		await ctx.shot('sw-preview');
		evidence.push(
			ctx.saveEvidence('evidence', {
				prodBuild: { rebuilt, prodOk },
				registered,
				controllerUrl,
				cacheInfo,
				toastHidden,
				nonNetwork,
				pageErrors: ctx.console.pageErrors,
				manualUpdateFlowSteps: [
					'1. NODE_ENV=production pnpm build（记下 dist/sw-manifest.json 的 version）',
					'2. 改动任意源码后再次同命令构建 → version 变化且 dist/sw.js 字节变化',
					'3. pnpm preview --port 4173 --strictPort 起服务，打开已被旧 SW 控制的页面',
					'4. DevTools → Application → Service Workers → Update（或等 5 分钟轮询 / 切回标签页触发 visibilitychange 检查）',
					'5. 右下角出现「发现新版本」toast → 点「立即更新」→ 新 SW 接管（controllerchange）→ 页面自动刷新一次，刷新后 toast 消失',
				],
			})
		);
		await ctx.close();

		var checks = {
			prodDistReady: prodOk,
			swRegistered: registered,
			controllerActive: controlled && controllerUrl?.endsWith('/sw.js'),
			shellCacheExists: shellOk,
			keyAssetsCached: assetsCached,
			cacheVersionMatchesManifest: versionMatch,
			updateToastInitiallyHidden: toastHidden,
			noNonNetworkConsoleError: nonNetwork.length === 0,
			noPageError: ctx.console.pageErrors.length === 0,
		};
	} finally {
		if (server) {
			await stopDevServer(server.child, { port: PREVIEW_SERVER_PORT });
		}
		released = !(await isPortOpen(PREVIEW_SERVER_PORT));
	}

	const failed = Object.entries(checks)
		.filter(([, v]) => !v)
		.map(([k]) => k);
	return {
		pass: Object.values(checks).every(Boolean) && released,
		note:
			failed.length > 0 || !released
				? `未过项：${[...failed, released ? null : 'previewPortReleased'].filter(Boolean).join('、')}`
				: `controller=${checks.controllerActive ? '/sw.js' : 'none'}, shell=${checks.shellCacheExists ? 'app-shell-<v>' : '无'}, 关键资产已缓存, toast 隐藏, 端口已释放${rebuilt ? '（已重建生产产物）' : ''}`,
		checks: { ...checks, previewPortReleased: released },
		evidence,
	};
}
