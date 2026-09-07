#!/usr/bin/env node
/**
 * three-car-nav Playwright 验收集主入口。
 *
 * 流程：端口预检（清残留）→ 起 dev server（用完必杀）→ 顺序执行 TC-01..TC-09 →
 *       汇总判定表（每用例 ✅/❌ + 证据路径）→ 全绿 exit 0，否则 exit 1。
 *
 * 用法：node script/three-car-nav/run.mjs [--only TC01,TC03]
 * 环境变量：TCN_HEADED=1 有头 Chrome；TCN_KEEP_SERVER=1 复用已起服务（默认用完即杀）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	DEV_SERVER_PORT,
	REPO_ROOT,
	artifactRoot,
} from './lib/config.mjs';
import { ensurePortFree, isPortOpen, launchBrowser, startDevServer, stopDevServer } from './lib/runtime.mjs';
import { printEvidence, printHeader, printResults } from './lib/report.mjs';
import { TestContext } from './lib/context.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
	{ id: 'TC-01', name: '加载', file: './tests/tc01-load.mjs' },
	{ id: 'TC-02', name: '车流', file: './tests/tc02-traffic.mjs' },
	{ id: 'TC-03', name: 'CDN 降级', file: './tests/tc03-cdn-fallback.mjs' },
	{ id: 'TC-04', name: '轮位/辐条', file: './tests/tc04-wheels.mjs' },
	{ id: 'TC-05', name: '漆面存证', file: './tests/tc05-paint.mjs' },
	{ id: 'TC-06', name: 'HUD 六块', file: './tests/tc06-hud.mjs' },
	{ id: 'TC-07', name: '变道/POI(慢)', file: './tests/tc07-lane-poi.mjs' },
	{ id: 'TC-08', name: '拖拽', file: './tests/tc08-drag.mjs' },
	{ id: 'TC-09', name: '静态检查', file: './tests/tc09-static.mjs' },
	{ id: 'TC-10', name: '控制面板', file: './tests/tc10-panel.mjs' },
];

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg
	? onlyArg
			.slice(7)
			.split(',')
			.map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
	: null;
const selected = only ? CASES.filter((c) => only.includes(c.id.replace(/[^A-Z0-9]/g, ''))) : CASES;
if (!selected.length) {
	console.error(`--only 未匹配到任何用例：${onlyArg}`);
	process.exit(2);
}

/* ---------------- 1. 端口预检 ---------------- */
printHeader('PREFLIGHT');
console.log(`node ${process.version} · repo ${REPO_ROOT}`);
await ensurePortFree(DEV_SERVER_PORT);
const reused = process.env.TCN_KEEP_SERVER === '1' && (await isPortOpen(DEV_SERVER_PORT));
if (reused) console.log(`[server] 复用已监听 ${DEV_SERVER_PORT} 的 dev server（TCN_KEEP_SERVER=1，不负责关闭）`);

/* ---------------- 2. 起 dev server ---------------- */
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const artifactsDir = path.join(artifactRoot(), `suite-${stamp}`);
fs.mkdirSync(artifactsDir, { recursive: true });
console.log(`[artifacts] ${artifactsDir}`);

let server = null;
if (!reused) {
	console.log('[server] pnpm dev 启动中…');
	server = await startDevServer({
		port: DEV_SERVER_PORT,
		cwd: REPO_ROOT,
		logPath: path.join(artifactsDir, 'dev-server.log'),
	});
	console.log(`[server] http://localhost:${DEV_SERVER_PORT} 就绪（${(server.waitedMs / 1000).toFixed(1)}s）`);
}

/* ---------------- 3. 浏览器 ---------------- */
const { browser, core, headed } = await launchBrowser();
console.log(`[browser] playwright-core: ${core}`);
console.log(`[browser] Chrome (${headed ? 'headed' : 'headless'}) 已启动`);

/* ---------------- 4. 顺序执行 ---------------- */
const rows = [];
try {
	for (const testCase of selected) {
		const t0 = Date.now();
		process.stdout.write(`\n▶ ${testCase.id} ${testCase.name} … `);
		let result;
		try {
			const mod = await import(pathToFileURL(path.join(HERE, testCase.file)).href);
			const ctx = new TestContext({ browser, artifactsDir, label: testCase.id });
			result = await mod.run(ctx);
		} catch (e) {
			result = { pass: false, note: `用例异常：${String(e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e)}`, checks: {}, evidence: [] };
		}
		const durS = +((Date.now() - t0) / 1000).toFixed(1);
		rows.push({ id: testCase.id, name: testCase.name, pass: !!result.pass, note: result.note, evidence: result.evidence ?? [], durS });
		console.log(`${result.pass ? '✅ PASS' : '❌ FAIL'} (${durS}s) — ${result.note}`);
	}
} finally {
	printHeader('TEARDOWN');
	await browser.close().catch(() => {});
	console.log('[browser] 已关闭');
	if (server) {
		await stopDevServer(server.child, { port: DEV_SERVER_PORT });
		console.log(`[server] dev server 已停止（端口 ${DEV_SERVER_PORT} ${await isPortOpen(DEV_SERVER_PORT) ? '仍被占用!' : '已释放'}）`);
	}
}

/* ---------------- 5. 汇总 ---------------- */
printResults(rows);
printEvidence(rows);
fs.writeFileSync(
	path.join(artifactsDir, 'summary.json'),
	JSON.stringify({ stamp, allPass: rows.every((r) => r.pass), rows }, null, 2)
);
console.log(`\n汇总已写入 ${path.join(artifactsDir, 'summary.json')}`);
process.exit(rows.every((r) => r.pass) ? 0 : 1);
