/**
 * TC-10 控制面板：slider/快捷键 → speedKmh；暂停 → gear==='P' 且速度控件 disabled（DOM 断言）
 * 且 distanceM 冻结（RoadSystem 停滚链路）；恢复 → 'D' + 推进；视角/日夜三选逐一生效。
 * 模型就绪非前置（面板交互与模型无关，ready/fallback 皆可，等待只为避开加载期抖动）。
 */
import { PANEL } from '../lib/config.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询至谓词真或预算耗尽（React 面板由 5Hz stats 驱动，DOM 态最迟 ~200ms 跟上） */
async function pollUntil(fn, budgetMs, gapMs = 150) {
	const t0 = Date.now();
	for (;;) {
		if (await fn()) return true;
		if (Date.now() - t0 > budgetMs) return false;
		await sleep(gapMs);
	}
}

const CAMERA_STEPS = [
	{ label: '驾驶位', expect: 'driver' },
	{ label: '侧方', expect: 'side' },
	{ label: '追尾', expect: 'chase' },
];

const TOD_STEPS = [
	{ label: '白天', expect: 'day' },
	{ label: '夜晚', expect: 'night' },
	{ label: '黄昏', expect: 'dusk' },
];

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const trace = [];
	await ctx.newPage();
	await ctx.openThroughMenu();
	const model = await ctx.waitModelStatus(25);

	const page = ctx.page;
	const slider = page.locator(PANEL.speedSlider);
	const probeDisabled = () => page.evaluate(PANEL.disabledProbe);

	/** 点击/输入一步后记录 state 关键字段并核对期望 */
	const step = async (name, expect) => {
		const state = await ctx.getState();
		const ok = Object.entries(expect).every(([k, v]) => state?.[k] === v);
		trace.push({
			step: name,
			ok,
			expect,
			got: {
				speedKmh: state?.speedKmh,
				gear: state?.gear,
				cameraMode: state?.cameraMode,
				timeOfDay: state?.timeOfDay,
				distanceM: state?.distanceM,
			},
		});
		return ok;
	};

	/* 1. 速度：slider fill 90（Playwright 设 value + 派发 input → React onChange） */
	await slider.fill('90');
	const sliderOk = await step('slider→90', { speedKmh: 90 });

	/* 2. 速度：快捷键 30 → 90（与 slider 两条路径分别断言，90 为锁定断言值） */
	await page.locator(PANEL.quick(30)).click();
	const quick30Ok = await step('quick30', { speedKmh: 30 });
	await page.locator(PANEL.quick(90)).click();
	const quick90Ok = await step('quick90', { speedKmh: 90 });

	/* 3. 暂停：gear P + 速度控件 disabled（DOM）+ distanceM 冻结（RoadSystem 停滚） */
	await page.locator(PANEL.pause).click();
	const pauseOk = await step('pause', { gear: 'P', speedKmh: 90 });
	const pausedDisabled = await pollUntil(async () => {
		const d = await probeDisabled();
		return d.slider === true && d.presets.length === 3 && d.presets.every(Boolean);
	}, 2500);
	await ctx.shot('panel-paused');
	const dP1 = (await ctx.getState()).distanceM;
	await sleep(900);
	const dP2 = (await ctx.getState()).distanceM;
	const frozenOk = dP2 === dP1;

	/* 4. 恢复：gear D + 速度控件恢复可用 + distanceM 重新推进（90km/h ≈ 22.5m/0.9s） */
	await page.locator(PANEL.resume).click();
	const resumeOk = await step('resume', { gear: 'D', speedKmh: 90 });
	const resumedDisabled = await pollUntil(async () => {
		const d = await probeDisabled();
		return d.slider === false && d.presets.every((b) => b === false);
	}, 2500);
	const dR1 = (await ctx.getState()).distanceM;
	await sleep(900);
	const dR2 = (await ctx.getState()).distanceM;
	const advancingOk = dR2 - dR1 > 5;

	/* 5. 视角三选：逐个点击逐一断言（驾驶位/侧方/追尾 → driver/side/chase） */
	const cameraOk = [];
	for (const s of CAMERA_STEPS) {
		await page.locator(PANEL.opt(s.label)).click();
		cameraOk.push(await step(`camera:${s.label}`, { cameraMode: s.expect }));
	}

	/* 6. 日夜三选：逐个点击逐一断言（白天/夜晚/黄昏 → day/night/dusk） */
	const todOk = [];
	for (const s of TOD_STEPS) {
		await page.locator(PANEL.opt(s.label)).click();
		todOk.push(await step(`tod:${s.label}`, { timeOfDay: s.expect }));
	}

	await ctx.shot('panel');
	const nonNetwork = ctx.console.nonNetworkErrors();

	evidence.push(
		ctx.saveEvidence('evidence', {
			model,
			trace,
			distance: { paused: [dP1, dP2], resumed: [dR1, dR2] },
			nonNetwork,
			network: ctx.console.networkErrors().length,
			pageErrors: ctx.console.pageErrors,
		})
	);
	await ctx.close();

	const checks = {
		sliderSetsSpeed90: sliderOk,
		quickSetsSpeed30: quick30Ok,
		quickSetsSpeed90: quick90Ok,
		pauseGearP: pauseOk,
		pauseDisablesSpeedControls: pausedDisabled,
		pauseFreezesDistance: frozenOk,
		resumeGearD: resumeOk,
		resumeEnablesSpeedControls: resumedDisabled,
		resumeDistanceAdvances: advancingOk,
		cameraCycle: cameraOk.every(Boolean),
		todCycle: todOk.every(Boolean),
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
				: `speed 90 via slider+quick, P/D 切换含 disabled DOM 断言, 里程冻结→推进 Δ=${(dR2 - dR1).toFixed(1)}m, camera/tod 三选全中`,
		checks,
		evidence,
	};
}
