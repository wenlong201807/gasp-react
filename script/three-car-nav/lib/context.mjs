/**
 * 测试上下文：每个用例一个干净 browser context（console/网络互相不串），
 * 封装 菜单点入 / getState 采样 / modelStatus 轮询 / 页内像素采样 / 截图归档。
 */

import fs from 'node:fs';
import path from 'node:path';
import { installInPageToolkit } from './inpage.mjs';
import { APP_URL, MENU, VIEWPORT, MODEL_STATUS_BUDGET_S } from './config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ConsoleRecorder {
	constructor(page) {
		this.messages = [];
		this.pageErrors = [];
		this.failedRequests = [];
		page.on('console', (m) => {
			this.messages.push({ type: m.type(), text: String(m.text()).slice(0, 500) });
		});
		page.on('pageerror', (e) => {
			this.pageErrors.push(String(e && e.message ? e.message : e).slice(0, 500));
		});
		page.on('requestfailed', (r) => {
			this.failedRequests.push({ url: r.url().slice(0, 200), failure: String(r.failure()?.errorText ?? '').slice(0, 120) });
		});
	}
	/** 资源加载失败类 console error（net::ERR / Failed to load resource） */
	networkErrors() {
		return this.messages.filter(
			(m) => m.type === 'error' && (/Failed to load resource/.test(m.text) || /net::ERR/.test(m.text))
		);
	}
	/** 非网络类 error：CDN 之外的业务报错，任何用例都不容忍 */
	nonNetworkErrors() {
		const net = new Set(this.networkErrors());
		return this.messages.filter((m) => m.type === 'error' && !net.has(m)).map((m) => m.text);
	}
}

export class TestContext {
	constructor({ browser, artifactsDir, label }) {
		this.browser = browser;
		this.artifactsDir = artifactsDir;
		this.label = label;
		this.console = null;
		this.page = null;
		this.context = null;
		this.abortedCount = 0;
	}

	/** 新开 context；blockCdn=true 时 abort 全部 CDN 请求（TC-03） */
	async newPage({ blockCdn = false } = {}) {
		this.context = await this.browser.newContext({ viewport: VIEWPORT });
		if (blockCdn) {
			await this.context.route(`**/z2586300277.github.io/**`, () => {
				this.abortedCount++;
			});
		}
		this.page = await this.context.newPage();
		this.console = new ConsoleRecorder(this.page);
		return this.page;
	}

	async close() {
		try {
			if (this.context) await this.context.close();
		} catch {}
		this.page = null;
		this.context = null;
	}

	/** 首页 → 展开菜单 → 点入 Three Car Nav → 等 canvas 出现（历轮同一路径） */
	async openThroughMenu() {
		const page = this.page;
		await page.goto(APP_URL, { waitUntil: 'load' });
		await page.waitForSelector(MENU.expand, { timeout: 15000 });
		await page.click(MENU.expand);
		await page.waitForTimeout(600);
		try {
			await page.waitForSelector(MENU.entry, { timeout: 5000, state: 'visible' });
		} catch {
			await page.click(MENU.expandAlt);
			await page.waitForTimeout(800);
		}
		await page.click(MENU.entry);
		await page.waitForSelector('canvas', { timeout: 20000 });
		await this.installToolkit();
		return page;
	}

	getState() {
		return this.page.evaluate(() => {
			const h = window.__threeCarNav;
			if (!h) return null;
			const s = h.getState();
			return {
				modelStatus: s.modelStatus,
				fps: s.fps,
				speedKmh: s.speedKmh,
				gear: s.gear,
				cameraMode: s.cameraMode,
				timeOfDay: s.timeOfDay,
				distanceM: s.distanceM,
				laneIndex: s.laneIndex,
				laneChangeHint: s.laneChangeHint,
				trafficTargets: s.trafficTargets,
			};
		});
	}

	/** 轮询 modelStatus 至 ready/fallback；返回 {status, elapsedSec, history} */
	async waitModelStatus(budgetS = MODEL_STATUS_BUDGET_S) {
		const history = [];
		const t0 = Date.now();
		for (;;) {
			const elapsed = (Date.now() - t0) / 1000;
			let st = null;
			try {
				st = await this.page.evaluate(() => window.__threeCarNav?.getState()?.modelStatus ?? null);
			} catch {
				st = 'eval-error';
			}
			if (!history.length || history[history.length - 1][0] !== st) history.push([st, +elapsed.toFixed(2)]);
			if (st === 'ready' || st === 'fallback') return { status: st, elapsedSec: +elapsed.toFixed(2), history };
			if (elapsed > budgetS) return { status: st, elapsedSec: +elapsed.toFixed(2), history };
			await sleep(400);
		}
	}

	async installToolkit() {
		return this.page.evaluate(`(${installInPageToolkit.toString()})()`);
	}

	/** 连拍 n 帧后执行 op；返回 { cap, result } */
	async snap(op, args, { frames = 1, gapMs = 0 } = {}) {
		const cap = await this.page.evaluate(([n, g]) => window.__tcn.cap(n, g), [frames, gapMs]);
		const result = await this.page.evaluate(([o, a]) => window.__tcn.op(o, a), [op, args]);
		return { cap, result };
	}

	/** 连拍 n 帧（gapMs 间隔）；append=true 时追加到既有帧缓冲（跨动作对比用） */
	async snapOnly(frames, gapMs, append = false) {
		return this.page.evaluate(([n, g, k]) => window.__tcn.cap(n, g, k), [frames, gapMs, append]);
	}

	async px(op, args) {
		return this.page.evaluate(([o, a]) => window.__tcn.op(o, a), [op, args]);
	}

	/** 全页截图 → artifacts/tcXX-<name>.png */
	async shot(name) {
		const file = path.join(this.artifactsDir, `${this.label}-${name}.png`);
		await this.page.screenshot({ path: file });
		return file;
	}

	/** 页内裁剪帧 → PNG 归档 */
	async saveCrop(name, box, { frame = 0 } = {}) {
		const { w, h, dataUrl } = await this.px('crop', { box, frame });
		const file = path.join(this.artifactsDir, `${this.label}-${name}.png`);
		fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
		return { file, w, h };
	}

	/** 保存 JSON 证据 */
	saveEvidence(name, payload) {
		const file = path.join(this.artifactsDir, `${this.label}-${name}.json`);
		fs.writeFileSync(file, JSON.stringify(payload, null, 2));
		return file;
	}
}
