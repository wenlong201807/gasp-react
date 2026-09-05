#!/usr/bin/env node
// 事件循环 trace 真实性校验：
// 1) 真实执行预设代码，比对 console 输出顺序（Node 下 rAF 用 setTimeout(0) 模拟，顺序语义一致）
// 2) 结构不变量检查 I1~I4
// 3) Lottie 编译结构断言（lottieCompiler 实现后自动生效）
// 用法：node script/event-loop-trace-verify.mjs [--strict]
//   --strict：三个预设必须全部存在，否则退出码 1（最终验收用）
const PRESET_MODULES = [
	'../src/components/event-loop/presets/preset-basic.ts',
	'../src/components/event-loop/presets/preset-await.ts',
	'../src/components/event-loop/presets/preset-render.ts',
];

async function loadPresets() {
	const loaded = [];
	for (const path of PRESET_MODULES) {
		try {
			const mod = await import(path);
			loaded.push(Object.values(mod)[0]);
		} catch {
			console.warn(`⚠️  未找到 ${path}（该预设尚未实现，可忽略）`);
		}
	}
	return loaded;
}

async function captureConsoleOutput(code) {
	const logs = [];
	const fakeConsole = { log: (...args) => logs.push(args.map(String).join(' ')) };
	const prevRaf = globalThis.requestAnimationFrame;
	globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
	try {
		new Function('console', code)(fakeConsole);
		await new Promise((resolve) => setTimeout(resolve, 60));
	} finally {
		if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
		else delete globalThis.requestAnimationFrame;
	}
	return logs;
}

function checkInvariants(preset) {
	const errors = [];
	const steps = preset.trace;

	// I1 进入新一轮宏任务阶段前，微任务队列必须已清空
	for (let i = 1; i < steps.length; i++) {
		if (
			steps[i].phase === 'task' &&
			steps[i - 1].phase !== 'task' &&
			steps[i - 1].microQueue.length > 0
		) {
			errors.push(`I1 步骤${i}: 进入宏任务阶段，但上一步(${i - 1})微任务队列非空`);
		}
	}

	// I2 rAF 实体离开 Web APIs 的步骤必须处于 render 阶段
	for (let i = 1; i < steps.length; i++) {
		const prevRafIds = steps[i - 1].webApis.filter((e) => e.type === 'raf').map((e) => e.id);
		for (const id of prevRafIds) {
			const still = steps[i].webApis.some((e) => e.id === id);
			if (!still && steps[i].phase !== 'render') {
				errors.push(`I2 步骤${i}: rAF 实体 ${id} 离开 Web APIs，但阶段是 ${steps[i].phase}`);
			}
		}
	}

	// I3 consoleLines 只允许追加（公共前缀保持不变）
	for (let i = 1; i < steps.length; i++) {
		const prev = steps[i - 1].consoleLines;
		const cur = steps[i].consoleLines;
		const ok = cur.length >= prev.length && prev.every((line, j) => cur[j] === line);
		if (!ok) errors.push(`I3 步骤${i}: consoleLines 不是纯追加`);
	}

	// I4 实体 id 生命周期连续：消失后不得再次出现
	const seen = new Set();
	const ended = new Set();
	steps.forEach((st, i) => {
		const ids = new Set([
			...st.stack.map((f) => f.id),
			...st.webApis.map((e) => e.id),
			...st.macroQueue.map((q) => q.id),
			...st.microQueue.map((q) => q.id),
		]);
		for (const id of seen) if (!ids.has(id)) ended.add(id);
		for (const id of ids) {
			if (ended.has(id)) errors.push(`I4 步骤${i}: 实体 ${id} 消失后再次出现`);
			seen.add(id);
		}
	});

	return errors;
}

const strict = process.argv.includes('--strict');
const presets = await loadPresets();
let compiler = null;
try {
	compiler = await import('../src/components/event-loop/compiler/lottieCompiler.ts');
} catch {
	console.warn('⚠️  lottieCompiler 尚未实现，跳过编译断言');
}

if (strict && presets.length < PRESET_MODULES.length) {
	console.error(`❌ --strict 要求 ${PRESET_MODULES.length} 个预设全部存在，实际 ${presets.length}`);
	process.exit(1);
}

let failed = false;
for (const preset of presets) {
	const errors = checkInvariants(preset);

	const actual = await captureConsoleOutput(preset.code);
	if (JSON.stringify(actual) !== JSON.stringify(preset.expectedOutput)) {
		errors.push(
			`输出顺序不符\n      实际: [${actual.join(' | ')}]\n      期望: [${preset.expectedOutput.join(' | ')}]`
		);
	}
	const lastConsole = preset.trace[preset.trace.length - 1].consoleLines;
	if (JSON.stringify(lastConsole) !== JSON.stringify(preset.expectedOutput)) {
		errors.push('trace 最终 consoleLines 与 expectedOutput 不符');
	}

	let frameInfo = '';
	if (compiler) {
		const compiled = compiler.compilePreset(preset);
		errors.push(...compiler.validateCompilation(compiled, preset));
		frameInfo = `, ${compiled.totalFrames} 帧`;
	}

	if (errors.length > 0) {
		failed = true;
		console.error(`❌ ${preset.id}:`);
		for (const e of errors) console.error(`   - ${e}`);
	} else {
		console.log(`✅ ${preset.id}: 输出顺序一致(${actual.length} 条), ${preset.trace.length} 步${frameInfo}`);
	}
}

process.exit(failed ? 1 : 0);
