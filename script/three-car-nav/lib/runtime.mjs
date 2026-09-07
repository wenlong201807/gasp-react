/**
 * 运行时装配：playwright-core 解析 + Chrome 启动 + dev server 生命周期。
 *
 * playwright-core 不新增 devDependency：直接复用全局 playwright-cli 自带的
 * playwright-core（同一套浏览器驱动栈）。解析顺序：
 *   1. env TCN_PLAYWRIGHT_CORE
 *   2. `which playwright-cli` → realpath → ../lib/node_modules/@playwright/cli/node_modules/playwright-core
 *   3. `npm root -g` 下同路径（兜底）
 * 三者皆无 → 报错并给出安装指引（README「环境依赖」）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const quiet = (cmd, args) =>
	execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function resolvePlaywrightCore() {
	const candidates = [];
	if (process.env.TCN_PLAYWRIGHT_CORE) candidates.push(process.env.TCN_PLAYWRIGHT_CORE);
	try {
		const real = fs.realpathSync(quiet('which', ['playwright-cli']));
		candidates.push(
			path.resolve(path.dirname(real), '../lib/node_modules/@playwright/cli/node_modules/playwright-core')
		);
		candidates.push(path.resolve(path.dirname(real), '../node_modules/playwright-core'));
	} catch {}
	try {
		const root = quiet('npm', ['root', '-g']);
		candidates.push(path.join(root, '@playwright/cli/node_modules/playwright-core'));
		candidates.push(path.join(root, 'playwright-core'));
	} catch {}
	for (const c of candidates) {
		if (c && fs.existsSync(path.join(c, 'package.json'))) return c;
	}
	throw new Error(
		[
			'未找到 playwright-core。',
			'本套件不新增依赖，复用全局 playwright-cli 自带的 playwright-core：',
			'  npm install -g @playwright/cli@latest',
			'或用 env 指定：TCN_PLAYWRIGHT_CORE=/path/to/playwright-core pnpm 并跑 script/three-car-nav/run.mjs',
		].join('\n')
	);
}

export async function launchBrowser() {
	const core = resolvePlaywrightCore();
	const mod = await import(pathToFileURL(path.join(core, 'index.js')).href);
	const pw = mod.default ?? mod;
	const headed = process.env.TCN_HEADED === '1';
	const browser = await pw.chromium.launch({
		channel: 'chrome',
		headless: !headed,
		args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
	});
	return { browser, core, headed };
}

/* ------------------------------------------------------------------ */
/* dev server                                                         */
/* ------------------------------------------------------------------ */

import net from 'node:net';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isPortOpen(port, host = '127.0.0.1') {
	return new Promise((resolve) => {
		const s = net.connect({ port, host });
		s.setTimeout(800);
		s.on('connect', () => {
			s.destroy();
			resolve(true);
		});
		s.on('error', () => {
			s.destroy();
			resolve(false);
		});
		s.on('timeout', () => {
			s.destroy();
			resolve(false);
		});
	});
}

function listenerCmdline(pid) {
	try {
		return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

export function findListenerPid(port) {
	try {
		const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		return out ? Number(out.split('\n')[0]) : null;
	} catch {
		return null;
	}
}

/** 起 dev server 前确认 5173 无残留：同仓库 vite 残留则清掉，他进程占用则抛错 */
export async function ensurePortFree(port) {
	let pid = findListenerPid(port);
	if (pid == null) return { cleared: false };
	const cmd = listenerCmdline(pid);
	if (/vite|pnpm|node/i.test(cmd)) {
		process.stdout.write(`[preflight] 端口 ${port} 被 vite 残留进程占用 (pid ${pid}: ${cmd})，清理中…\n`);
		try {
			process.kill(-pid, 'SIGTERM');
		} catch {
			try {
				process.kill(pid, 'SIGTERM');
			} catch {}
		}
		for (let i = 0; i < 20; i++) {
			await sleep(250);
			if (findListenerPid(port) == null) return { cleared: true, pid, cmd };
		}
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {}
		}
		await sleep(500);
		if (findListenerPid(port) == null) return { cleared: true, pid, cmd };
	}
	throw new Error(`端口 ${port} 被非 vite 进程占用 (pid ${pid}: ${cmd})，请手动处理后重跑。`);
}

export async function startDevServer({ port, cwd, logPath }) {
	const log = fs.openSync(logPath, 'a');
	const child = spawn('pnpm', ['dev'], { cwd, detached: true, stdio: ['ignore', log, log] });
	fs.closeSync(log);
	const t0 = Date.now();
	while (Date.now() - t0 < 60000) {
		await sleep(400);
		if (await isPortOpen(port)) return { child, waitedMs: Date.now() - t0 };
		if (child.exitCode !== null) break;
	}
	throw new Error(`dev server 未在 60s 内监听 ${port}（日志：${logPath}）`);
}

export async function stopDevServer(child, { port }) {
	if (!child || child.exitCode !== null) return;
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		try {
			child.kill('SIGTERM');
		} catch {}
	}
	for (let i = 0; i < 40; i++) {
		await sleep(250);
		if (findListenerPid(port) == null) return;
	}
	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch {}
	await sleep(500);
}
