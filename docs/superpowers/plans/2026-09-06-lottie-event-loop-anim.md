# Lottie 事件循环动画演示 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「事件循环演示」页面——用户三选一预设 JS 代码，系统程序化生成 Lottie JSON 并与 DOM 叠加层同步，动画演示该代码在浏览器事件循环中的真实执行过程，全程高亮当前链路步骤。

**Architecture:** `Step[]` 是唯一真相源（手写声明式 trace）；`lottieCompiler` 纯函数把 Step[] 编译成 Lottie JSON（区块飞行/发光/阶段条）+ frameMap；lottie-react 按帧播放，`onEnterFrame` 反查 stepIndex 驱动 DOM 文本层（代码高亮/Console/解说），单向数据流。

**Tech Stack:** React 18 + TypeScript 5.5 + Vite 5 + lottie-react 2.4（均已安装，零新依赖）。校验用 Node 原生 TS 执行（Node 24 type stripping），零测试框架。

**设计文档:** `docs/superpowers/specs/2026-09-05-lottie-event-loop-anim-design.md`（已确认，本计划是其实现分解）

---

## 共享参考（每个 Task 开始前先读这一节）

**环境事实（已验证，直接依赖）：**

- Node `v24.13.1`：`.mjs` 脚本可直接 `import '../xxx.ts'`（原生类型剥离；只允许可擦除语法——本项目只用 interface/type/`import type`，无 enum）。
- `tsconfig.json` 已开 `allowImportingTsExtensions: true` + `noEmit: true`，所以**被 Node 脚本加载的 import 链必须带 `.ts` 扩展名**（值导入）；`import type` 可省扩展名（Node 会整句擦除，不求值）。
- `biome.json` 只覆盖 `src/**` 与 `vite.config.ts`（`script/` 不受管）；linter `recommended: false`（几乎不报规则错）；formatter：**tab 缩进、单引号、分号、行宽 100**。
- 命令：`pnpm lint`（biome lint）、`pnpm build`（`tsc -b && vite build`）、`pnpm dev`。
- commit 风格：`feat: xxx` / `docs: xxx`，中文描述。

**import 扩展名规则（严格遵守，错了 Node 脚本会挂）：**

| 场景 | 写法 |
|---|---|
| `presets/preset-*.ts` 引 helpers | `from './helpers.ts'`（值导入，带扩展名） |
| `compiler/lottieCompiler.ts` 引 layout/shapeBuilders | `from './layout.ts'` / `from './shapeBuilders.ts'`（值导入，带扩展名） |
| 任何文件引类型 | `import type { X } from '../types'`（可省扩展名） |
| UI 组件（.tsx）之间互引 | 相对路径省扩展名（应用侧，Node 不加载） |
| `script/*.mjs` 引 TS 模块 | 相对路径带 `.ts` |

> **勘误 3（执行时发现）**：Task 7-9 代码块中 `event-loop/` 根目录文件引用写作 `from '../compiler/layout'` / `from '../types'`，正确应为 `from './compiler/layout'` / `from './types'`（这些文件与 `compiler/`、`types.ts` 同在 `event-loop/` 下）。以仓库实现为准。

> **勘误 4（执行时发现）**：lottie-react v2 的 `lottieRef.current` 是封装层，**没有 `addEventListener/removeEventListener**。Task 7 的 effect 写法会抛 `player.addEventListener is not a function`。正确做法：hook 导出 `handleEnterFrame(e)`，组件上用 `<Lottie onEnterFrame={player.handleEnterFrame}>` prop（onComplete 等 prop 同理）。另：实测本版 lottie-web 的 enterFrame 事件**没有 `frame` 字段**，携带 `currentTime`（亚帧精度的当前帧号，可为小数）——帧号从 `currentTime` 取，滑条显示值需 `Math.round`。

**lottie-react API（仓库先例 `src/components/lottie/LottieAnimation.tsx`）：** `lottieRef.current` 上有 `play() / pause() / stop() / setSpeed(n) / goToAndStop(frame, true) / getDuration(true)`；组件 props：`lottieRef / animationData / loop / autoplay / style / onComplete`。本计划不用 `goToAndPlay`（重播用 `goToAndStop(0,true)+play()` 替代，类型最稳）。`enterFrame` 事件监听需断言，见 Task 7。

**舞台坐标系（全部来源 `compiler/layout.ts`，Lottie 与 DOM 共用同一坐标源，对齐由构造保证）：** 1200×800、60fps、每步 30 帧。区域：phase(40,24,1120,48) / code(40,96,336,428) / stack(408,96,240,428) / webapis(688,96,472,428) / console(40,548,336,116) / macro(408,548,372,116) / micro(808,548,352,116) / narration(40,688,1120,44)。播放控制栏在舞台**外**（页面级，响应式可读性优先；这是对 spec §7 示意图的唯一调整，其余布局不变）。

**与 spec 的两处实现细化（均为 spec 精神内的落地细节，如质疑请回报而不是擅自改）：**

1. 区块（栈帧/队列项/回调）在 Lottie 中是无文字的色块；文字标签由 DOM 层用**同一 slot 函数**定位渲染，带 0.25s CSS 位移过渡近似跟随飞行（倍速非 1x 时略有错位，可接受）。
2. WebAPIs 挂起项与后续入队的回调是**同一实体 id**（如 `cb-timeout` 从 webapis 直接飞入 macro 队列再飞入 stack），保证 spec §5「稳定 ID 跨步骤复用同一 layer」成立。

---

### Task 1: 布局常量与核心类型

**Files:**

- Create: `src/components/event-loop/types.ts`
- Create: `src/components/event-loop/compiler/layout.ts`

- [ ] **Step 1.1: 写 `src/components/event-loop/types.ts`（完整文件）**

```ts
export type Phase = 'task' | 'microtask' | 'render';

export type ActiveRegion =
	| 'code'
	| 'stack'
	| 'webapis'
	| 'macro'
	| 'micro'
	| 'console'
	| 'render';

export type StepEvent =
	| 'push'
	| 'pop'
	| 'enqueue'
	| 'dequeue'
	| 'callback-run'
	| 'render-frame';

export interface QueueItem {
	id: string;
	label: string;
	kind: 'macro' | 'micro';
}

export interface StackFrame {
	id: string;
	label: string;
}

export interface WebApiEntry {
	id: string;
	label: string;
	type: 'timer' | 'raf';
	remainingMs: number;
}

export interface Step {
	id: number;
	title: string;
	phase: Phase;
	codeLine: number | null;
	stack: StackFrame[];
	webApis: WebApiEntry[];
	macroQueue: QueueItem[];
	microQueue: QueueItem[];
	consoleLines: string[];
	active: ActiveRegion[];
	event: StepEvent | null;
}

export type PresetId = 'basic' | 'await' | 'render';

export interface Preset {
	id: PresetId;
	title: string;
	difficulty: 1 | 2 | 3;
	code: string;
	expectedOutput: string[];
	trace: Step[];
}

export interface CompiledAnimation {
	lottieJson: Record<string, unknown>;
	frameMap: number[];
	totalFrames: number;
}
```

- [ ] **Step 1.2: 写 `src/components/event-loop/compiler/layout.ts`（完整文件）**

```ts
// 舞台与区域布局常量 —— Lottie 编译器与 DOM 叠加层共用同一坐标源
export const STAGE = { w: 1200, h: 800 } as const;
export const FPS = 60;
export const FRAMES_PER_STEP = 30;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const BLOCK = { w: 160, h: 44 } as const;

export const REGION = {
	phase: { x: 40, y: 24, w: 1120, h: 48 },
	code: { x: 40, y: 96, w: 336, h: 428 },
	stack: { x: 408, y: 96, w: 240, h: 428 },
	webapis: { x: 688, y: 96, w: 472, h: 428 },
	console: { x: 40, y: 548, w: 336, h: 116 },
	macro: { x: 408, y: 548, w: 372, h: 116 },
	micro: { x: 808, y: 548, w: 352, h: 116 },
	narration: { x: 40, y: 688, w: 1120, h: 44 },
} as const satisfies Record<string, Rect>;

export type RegionKey = keyof typeof REGION;

export const COLOR = {
	bg: '#0d1117',
	macro: '#58a6ff',
	micro: '#bc8cff',
	stack: '#3fb950',
	webapis: '#d29922',
	render: '#ff7b72',
	text: '#e6edf3',
	dim: '#30363d',
} as const;

export function hexToRgb01(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 调用栈第 i 层（0=最底）的块中心坐标 */
export function stackSlot(i: number): [number, number] {
	const r = REGION.stack;
	return [
		r.x + (r.w - BLOCK.w) / 2 + BLOCK.w / 2,
		r.y + r.h - 16 - (i + 0.5) * (BLOCK.h + 8),
	];
}

/** 宏/微任务队列第 i 项（从左到右）的块中心坐标 */
export function queueSlot(kind: 'macro' | 'micro', i: number): [number, number] {
	const r = kind === 'macro' ? REGION.macro : REGION.micro;
	return [r.x + 16 + BLOCK.w / 2 + i * (BLOCK.w + 8), r.y + r.h / 2];
}

/** Web APIs 第 i 项（从左到右）的块中心坐标 */
export function apiSlot(i: number): [number, number] {
	const r = REGION.webapis;
	return [r.x + 16 + BLOCK.w / 2 + i * (BLOCK.w + 12), r.y + 24 + BLOCK.h / 2];
}

/** DOM 内联盒样式（面板定位用） */
export function box(rect: Rect): React.CSSProperties {
	return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}
```

注意：`React.CSSProperties` 需要类型可用——在文件顶部补 `import type { CSSProperties } from 'react';` 并把返回类型改为 `CSSProperties`（避免全局 React 命名空间依赖，`types.ts` 不引 React）。最终写法：

```ts
import type { CSSProperties } from 'react';
// ...（其余同上，box 函数改为：）
export function box(rect: Rect): CSSProperties {
	return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}
```

（写文件时直接用第二版 `box`，不要保留第一版。）

- [ ] **Step 1.3: 构建验证**

Run: `pnpm build`
Expected: `tsc -b` 无错误，vite build 成功（新文件未被引用也参与编译，`include: ["src"]`）。

- [ ] **Step 1.4: Commit**

```bash
git add src/components/event-loop/types.ts src/components/event-loop/compiler/layout.ts
git commit -m "feat: event-loop 舞台布局常量与核心类型"
```


### Task 2: 校验脚本 + 预设1（入门）—— TDD：脚本先行

**Files:**

- Create: `script/event-loop-trace-verify.mjs`
- Create: `src/components/event-loop/presets/helpers.ts`
- Create: `src/components/event-loop/presets/preset-basic.ts`

**规则：每个 `preset-*.ts` 文件只导出一个具名常量（如 `presetBasic`），校验脚本用 `Object.values(mod)[0]` 取预设，别加别的导出。**

> **勘误（执行时发现）**：下方 preset-basic 示例代码中 `console` 数组只出现在"打印步"——违反 I3（consoleLines 必须是累计快照，每步携带）。实际实现以仓库文件为准：文件顶部定义 `OUT1..OUT4` 累计数组，**每一步**都带 `console: OUTn`。展开预设 2/3 数据表时同样遵守：每步 console 数组 = 截至该步全部输出。

> **勘误 2（执行时发现）**：校验脚本的 rAF 垫片 `setTimeout(cb, 0)` 在 Node 中因同队列 FIFO 会抢到 `setTimeout(0)` 之前，与浏览器顺序（rAF 在 ~16ms 渲染时机、晚于 0ms 定时器任务）相反。已改为 `setTimeout(cb, 16)` 近似帧边界；预设 3 的期望输出（`3: timeout` 先于 `4: raf`）保持浏览器语义不变。

- [ ] **Step 2.1: 写 `script/event-loop-trace-verify.mjs`（完整文件）**

```js
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
```

- [ ] **Step 2.2: 跑脚本，确认"空跑"行为**

Run: `node script/event-loop-trace-verify.mjs`
Expected: 三行 `⚠️ 未找到 ...preset-*.ts`，退出码 0（没有预设就没有可失败项）。

- [ ] **Step 2.3: 写 `src/components/event-loop/presets/helpers.ts`（完整文件）**

```ts
import type {
	ActiveRegion,
	Phase,
	QueueItem,
	StackFrame,
	Step,
	StepEvent,
	WebApiEntry,
} from '../types';

export const sf = (id: string, label: string): StackFrame => ({ id, label });

export const q = (id: string, label: string, kind: 'macro' | 'micro'): QueueItem => ({
	id,
	label,
	kind,
});

export const timer = (id: string, label: string): WebApiEntry => ({
	id,
	label,
	type: 'timer',
	remainingMs: 0,
});

export const raf = (id: string, label: string): WebApiEntry => ({
	id,
	label,
	type: 'raf',
	remainingMs: 0,
});

interface StepInput {
	title: string;
	phase: Phase;
	line?: number;
	ev?: StepEvent;
	stack?: StackFrame[];
	webApis?: WebApiEntry[];
	macro?: QueueItem[];
	micro?: QueueItem[];
	console?: string[];
	active?: ActiveRegion[];
}

export const step = (s: StepInput): Step => ({
	id: 0,
	title: s.title,
	phase: s.phase,
	codeLine: s.line ?? null,
	stack: s.stack ?? [],
	webApis: s.webApis ?? [],
	macroQueue: s.macro ?? [],
	microQueue: s.micro ?? [],
	consoleLines: s.console ?? [],
	active: s.active ?? [],
	event: s.ev ?? null,
});

export const withIds = (steps: Step[]): Step[] => steps.map((s, i) => ({ ...s, id: i }));
```

- [ ] **Step 2.4: 写 `src/components/event-loop/presets/preset-basic.ts`（完整文件，24 步）**

```ts
import type { Preset } from '../types';
import { q, sf, step, timer, withIds } from './helpers.ts';

const CODE = `console.log('1: sync');
setTimeout(() => {
  console.log('4: timeout');
}, 0);
Promise.resolve().then(() => {
  console.log('3: then');
});
console.log('2: sync end');`;

export const presetBasic: Preset = {
	id: 'basic',
	title: '入门 · 宏任务 vs 微任务',
	difficulty: 1,
	code: CODE,
	expectedOutput: ['1: sync', '2: sync end', '3: then', '4: timeout'],
	trace: withIds([
		step({
			title: '整个脚本(script)本身就是一个宏任务，先进入宏任务队列',
			phase: 'task',
			macro: [q('script', 'script', 'macro')],
			active: ['macro'],
		}),
		step({
			title: 'script 出队，压入调用栈开始执行',
			phase: 'task',
			line: 1,
			ev: 'dequeue',
			stack: [sf('script', 'script')],
			active: ['stack', 'code'],
		}),
		step({
			title: "console.log('1: sync') 入栈",
			phase: 'task',
			line: 1,
			ev: 'push',
			stack: [sf('script', 'script'), sf('log-1', 'log')],
			active: ['stack', 'code'],
		}),
		step({
			title: '打印 1: sync，log 出栈',
			phase: 'task',
			line: 1,
			ev: 'pop',
			stack: [sf('script', 'script')],
			console: ['1: sync'],
			active: ['console'],
		}),
		step({
			title: '遇到 setTimeout：回调交给 Web APIs 计时 0ms',
			phase: 'task',
			line: 2,
			ev: 'enqueue',
			stack: [sf('script', 'script')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			active: ['code', 'webapis'],
		}),
		step({
			title: '遇到 Promise.then：Promise 已决议，回调直接进入微任务队列',
			phase: 'task',
			line: 5,
			ev: 'enqueue',
			stack: [sf('script', 'script')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			micro: [q('cb-then', 'then 回调', 'micro')],
			active: ['code', 'micro'],
		}),
		step({
			title: "console.log('2: sync end') 入栈",
			phase: 'task',
			line: 8,
			ev: 'push',
			stack: [sf('script', 'script'), sf('log-2', 'log')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			micro: [q('cb-then', 'then 回调', 'micro')],
			active: ['stack', 'code'],
		}),
		step({
			title: '打印 2: sync end',
			phase: 'task',
			line: 8,
			ev: 'pop',
			stack: [sf('script', 'script')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			micro: [q('cb-then', 'then 回调', 'micro')],
			console: ['1: sync', '2: sync end'],
			active: ['console'],
		}),
		step({
			title: 'script 执行完毕，出栈',
			phase: 'task',
			ev: 'pop',
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			micro: [q('cb-then', 'then 回调', 'micro')],
			active: ['stack'],
		}),
		step({
			title: '任务结束，检查微任务队列：非空，逐个清空',
			phase: 'microtask',
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			micro: [q('cb-then', 'then 回调', 'micro')],
			active: ['micro'],
		}),
		step({
			title: 'then 回调出队，压栈执行',
			phase: 'microtask',
			line: 6,
			ev: 'dequeue',
			stack: [sf('cb-then', 'then 回调')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			active: ['micro', 'stack', 'code'],
		}),
		step({
			title: "console.log('3: then') 入栈",
			phase: 'microtask',
			line: 6,
			ev: 'push',
			stack: [sf('cb-then', 'then 回调'), sf('log-3', 'log')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			active: ['stack'],
		}),
		step({
			title: '打印 3: then',
			phase: 'microtask',
			line: 6,
			ev: 'pop',
			stack: [sf('cb-then', 'then 回调')],
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			console: ['1: sync', '2: sync end', '3: then'],
			active: ['console'],
		}),
		step({
			title: 'then 回调执行完，出栈',
			phase: 'microtask',
			ev: 'pop',
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			active: ['stack'],
		}),
		step({
			title: '微任务队列已空',
			phase: 'microtask',
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			active: ['micro'],
		}),
		step({
			title: '渲染机会：本例无 rAF，浏览器可能跳过绘制',
			phase: 'render',
			webApis: [timer('cb-timeout', 'timer(0ms)')],
			active: ['render'],
		}),
		step({
			title: 'timer(0ms) 已到点，回调进入宏任务队列',
			phase: 'task',
			line: 2,
			ev: 'enqueue',
			macro: [q('cb-timeout', 'timeout 回调', 'macro')],
			active: ['webapis', 'macro'],
		}),
		step({
			title: '新一轮循环：宏任务出队，压栈',
			phase: 'task',
			line: 3,
			ev: 'dequeue',
			stack: [sf('cb-timeout', 'timeout 回调')],
			active: ['macro', 'stack', 'code'],
		}),
		step({
			title: "console.log('4: timeout') 入栈",
			phase: 'task',
			line: 3,
			ev: 'push',
			stack: [sf('cb-timeout', 'timeout 回调'), sf('log-4', 'log')],
			active: ['stack', 'code'],
		}),
		step({
			title: '打印 4: timeout',
			phase: 'task',
			line: 3,
			ev: 'pop',
			stack: [sf('cb-timeout', 'timeout 回调')],
			console: ['1: sync', '2: sync end', '3: then', '4: timeout'],
			active: ['console'],
		}),
		step({
			title: '回调执行完，出栈',
			phase: 'task',
			ev: 'pop',
			active: ['stack'],
		}),
		step({
			title: '微任务队列已空，快速通过',
			phase: 'microtask',
			active: ['micro'],
		}),
		step({
			title: '渲染机会：无 rAF，跳过',
			phase: 'render',
			active: ['render'],
		}),
		step({
			title: '队列全空，事件循环空闲——演示结束',
			phase: 'task',
			active: [],
		}),
	]),
};
```

- [ ] **Step 2.5: 跑脚本，确认预设1全绿**

Run: `node script/event-loop-trace-verify.mjs`
Expected: `✅ basic: 输出顺序一致(4 条), 24 步` + 两条 ⚠️（await/render 未实现）。

- [ ] **Step 2.6: 构建验证**

Run: `pnpm build`
Expected: 成功（preset-basic 未被 UI 引用，但参与编译）。

- [ ] **Step 2.7: Commit**

```bash
git add script/event-loop-trace-verify.mjs src/components/event-loop/presets/
git commit -m "feat: event-loop 校验脚本、trace 辅助函数与预设1(宏微对比)"
```


### Task 3: 预设2（进阶 · await 与微任务）

**Files:**

- Create: `src/components/event-loop/presets/preset-await.ts`

**表格展开规则（Task 3/4 通用）：** 下表每行展开为一次 `step({...})` 调用；实体首次出现写 `id(label)`，之后只写 `id`；`console 新增` 列填该步新增的行（该步 `console` 数组 = 之前所有新增按序拼接）；空单元格 = 不传该字段。示例（前 3 行展开）：

```ts
step({
	title: '整个脚本(script)本身就是一个宏任务，先进入宏任务队列',
	phase: 'task',
	macro: [q('script', 'script', 'macro')],
	active: ['macro'],
}),
step({
	title: 'script 出队压栈；函数声明已提升，从 a() 开始执行',
	phase: 'task',
	line: 6,
	ev: 'dequeue',
	stack: [sf('script', 'script')],
	active: ['stack', 'code'],
}),
step({
	title: 'a() 入栈',
	phase: 'task',
	line: 6,
	ev: 'push',
	stack: [sf('script', 'script'), sf('a', 'a()')],
	active: ['stack', 'code'],
}),
```

- [ ] **Step 3.1: 写 `src/components/event-loop/presets/preset-await.ts`**

文件骨架（先写好，再按表填充 trace）：

```ts
import type { Preset } from '../types';
import { q, sf, step, timer, withIds } from './helpers.ts';

const CODE = `async function a() {
  console.log('1: a start');
  await null; // 此行之后，剩余函数体作为微任务入队
  console.log('3: a resumed');
}
a();
queueMicrotask(() => {
  console.log('4: micro');
});
setTimeout(() => {
  console.log('5: timeout');
}, 0);
console.log('2: sync end');`;

export const presetAwait: Preset = {
	id: 'await',
	title: '进阶 · await 与微任务',
	difficulty: 2,
	code: CODE,
	expectedOutput: ['1: a start', '2: sync end', '3: a resumed', '4: micro', '5: timeout'],
	trace: withIds([
		// 按下表逐行展开（30 步）
	]),
};
```

trace 数据表（30 步）：

| # | phase | line | ev | stack（自底向上） | webApis | macro | micro | console 新增 | active | title |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | task | | | | | script(script) | | | macro | 整个脚本本身就是一个宏任务，先进入宏任务队列 |
| 1 | task | 6 | dequeue | script | | | | | stack, code | script 出队压栈；函数声明已提升，从 a() 开始执行 |
| 2 | task | 6 | push | script, a(a()) | | | | | stack, code | a() 入栈 |
| 3 | task | 2 | push | script, a, log-1(log) | | | | | stack, code | console.log('1: a start') 入栈 |
| 4 | task | 2 | pop | script, a | | | | 1: a start | console | 打印 1: a start |
| 5 | task | 3 | enqueue | script | | | cb-a(a 剩余体) | | micro, stack | await null：a 让出控制权出栈，剩余函数体作为微任务入队 |
| 6 | task | 7 | enqueue | script | | | cb-a, cb-micro(micro 回调) | | code, micro | queueMicrotask：排在 cb-a 之后（FIFO） |
| 7 | task | 10 | enqueue | script | cb-timeout(timer(0ms)) | | cb-a, cb-micro | | code, webapis | setTimeout 回调交给 Web APIs 计时 |
| 8 | task | 13 | push | script, log-2(log) | cb-timeout | | cb-a, cb-micro | | stack, code | console.log('2: sync end') 入栈 |
| 9 | task | 13 | pop | script | cb-timeout | | cb-a, cb-micro | 2: sync end | console | 打印 2: sync end |
| 10 | task | | pop | | cb-timeout | | cb-a, cb-micro | | stack | script 执行完毕，出栈 |
| 11 | microtask | | | | cb-timeout | | cb-a, cb-micro | | micro | 任务结束，检查微任务队列：2 个，逐个清空 |
| 12 | microtask | 4 | dequeue | cb-a | cb-timeout | | cb-micro | | micro, stack, code | cb-a 出队压栈：从 await 之后继续执行 |
| 13 | microtask | 4 | push | cb-a, log-3(log) | cb-timeout | | cb-micro | | stack, code | console.log('3: a resumed') 入栈 |
| 14 | microtask | 4 | pop | cb-a | cb-timeout | | cb-micro | 3: a resumed | console | 打印 3: a resumed |
| 15 | microtask | | pop | | cb-timeout | | cb-micro | | stack | cb-a 执行完，出栈 |
| 16 | microtask | 8 | dequeue | cb-micro | cb-timeout | | | | micro, stack, code | cb-micro 出队压栈 |
| 17 | microtask | 8 | push | cb-micro, log-4(log) | cb-timeout | | | | stack, code | console.log('4: micro') 入栈 |
| 18 | microtask | 8 | pop | cb-micro | cb-timeout | | | 4: micro | console | 打印 4: micro |
| 19 | microtask | | pop | | cb-timeout | | | | stack | cb-micro 执行完，出栈 |
| 20 | microtask | | | | cb-timeout | | | | micro | 微任务队列已空 |
| 21 | render | | | | cb-timeout | | | | render | 渲染机会：本例无 rAF，浏览器可能跳过绘制 |
| 22 | task | 10 | enqueue | | | cb-timeout | | | webapis, macro | timer(0ms) 已到点，回调进入宏任务队列 |
| 23 | task | 11 | dequeue | cb-timeout | | | | | macro, stack, code | 新一轮循环：宏任务出队，压栈 |
| 24 | task | 11 | push | cb-timeout, log-5(log) | | | | | stack, code | console.log('5: timeout') 入栈 |
| 25 | task | 11 | pop | cb-timeout | | | | 5: timeout | console | 打印 5: timeout |
| 26 | task | | pop | | | | | | stack | 回调执行完，出栈 |
| 27 | microtask | | | | | | | | micro | 微任务队列已空，快速通过 |
| 28 | render | | | | | | | | render | 渲染机会：无 rAF，跳过 |
| 29 | task | | | | | | | | | 队列全空，事件循环空闲——演示结束 |

注意：webApis 列的 `cb-timeout(timer(0ms))` 在步骤 22 变为 macro 列的 `cb-timeout(timeout 回调)`——同一实体换 label，按「id 相同」写 `q('cb-timeout', 'timeout 回调', 'macro')`。步骤 4/9/14/18/25 的 console 数组分别是累计：`['1: a start']`、`['1: a start','2: sync end']`、前三、前四、全部五行。

- [ ] **Step 3.2: 跑脚本**

Run: `node script/event-loop-trace-verify.mjs`
Expected: `✅ basic: ...` 与 `✅ await: 输出顺序一致(5 条), 30 步`，仅剩一条 ⚠️（render 未实现）。若 I1~I4 报错，修 trace 而不是改脚本。

- [ ] **Step 3.3: 构建验证 + Commit**

```bash
pnpm build
git add src/components/event-loop/presets/preset-await.ts
git commit -m "feat: event-loop 预设2(await 与微任务)"
```

### Task 4: 预设3（综合 · 渲染帧时机）

**Files:**

- Create: `src/components/event-loop/presets/preset-render.ts`

- [ ] **Step 4.1: 写 `src/components/event-loop/presets/preset-render.ts`**

文件骨架：

```ts
import type { Preset } from '../types';
import { q, raf, sf, step, timer, withIds } from './helpers.ts';

const CODE = `console.log('1: sync');
requestAnimationFrame(() => {
  console.log('4: raf');
});
setTimeout(() => {
  console.log('3: timeout');
}, 0);
Promise.resolve().then(() => {
  console.log('2: then');
});`;

export const presetRender: Preset = {
	id: 'render',
	title: '综合 · 渲染帧时机',
	difficulty: 3,
	code: CODE,
	expectedOutput: ['1: sync', '2: then', '3: timeout', '4: raf'],
	trace: withIds([
		// 按下表逐行展开（27 步）
	]),
};
```

trace 数据表（27 步；展开规则与 Task 3 相同）：

| # | phase | line | ev | stack | webApis | macro | micro | console 新增 | active | title |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | task | | | | | script(script) | | | macro | 整个脚本本身就是一个宏任务，先进入宏任务队列 |
| 1 | task | 1 | dequeue | script | | | | | stack, code | script 出队，压入调用栈开始执行 |
| 2 | task | 1 | push | script, log-1(log) | | | | | stack, code | console.log('1: sync') 入栈 |
| 3 | task | 1 | pop | script | | | | 1: sync | console | 打印 1: sync |
| 4 | task | 2 | enqueue | script | cb-raf(rAF) | | | | code, webapis | rAF 回调交给 Web APIs：挂在渲染时机，不进宏/微队列 |
| 5 | task | 5 | enqueue | script | cb-raf, cb-timeout(timer(0ms)) | | | | code, webapis | setTimeout 回调交给 Web APIs 计时 |
| 6 | task | 8 | enqueue | script | cb-raf, cb-timeout | | cb-then(then 回调) | | code, micro | Promise.then：回调进入微任务队列 |
| 7 | task | | pop | | cb-raf, cb-timeout | | cb-then | | stack | script 执行完毕，出栈 |
| 8 | microtask | | | | cb-raf, cb-timeout | | cb-then | | micro | 任务结束，清空微任务队列 |
| 9 | microtask | 9 | dequeue | cb-then | cb-raf, cb-timeout | | | | micro, stack, code | then 回调出队，压栈执行 |
| 10 | microtask | 9 | push | cb-then, log-2(log) | cb-raf, cb-timeout | | | | stack, code | console.log('2: then') 入栈 |
| 11 | microtask | 9 | pop | cb-then | cb-raf, cb-timeout | | | 2: then | console | 打印 2: then |
| 12 | microtask | | pop | | cb-raf, cb-timeout | | | | stack | then 回调执行完，出栈 |
| 13 | microtask | | | | cb-raf, cb-timeout | | | | micro | 微任务队列已空 |
| 14 | task | 5 | enqueue | | cb-raf | cb-timeout(timeout 回调) | | | webapis, macro | timer(0ms) 已到点，回调进入宏任务队列 |
| 15 | task | 6 | dequeue | cb-timeout | cb-raf | | | | macro, stack, code | 宏任务出队，压栈 |
| 16 | task | 6 | push | cb-timeout, log-3(log) | cb-raf | | | | stack, code | console.log('3: timeout') 入栈 |
| 17 | task | 6 | pop | cb-timeout | cb-raf | | | 3: timeout | console | 打印 3: timeout |
| 18 | task | | pop | | cb-raf | | | | stack | 回调执行完，出栈 |
| 19 | microtask | | | | cb-raf | | | | micro | 微任务队列已空，快速通过 |
| 20 | render | | | | cb-raf | | | | render | 渲染步骤：绘制前执行 rAF 回调 |
| 21 | render | 3 | callback-run | cb-raf | | | | | render, stack, code | rAF 回调进栈执行（注意：不经宏/微任务队列） |
| 22 | render | 3 | push | cb-raf, log-4(log) | | | | | stack, code | console.log('4: raf') 入栈 |
| 23 | render | 3 | pop | cb-raf | | | | 4: raf | console | 打印 4: raf |
| 24 | render | | pop | | | | | | stack | rAF 回调执行完，出栈 |
| 25 | render | | render-frame | | | | | | render | rAF 回调执行完，浏览器绘制这一帧 |
| 26 | task | | | | | | | | | 队列全空，事件循环空闲——演示结束 |

- [ ] **Step 4.2: 跑脚本（此时应三预设全绿）**

Run: `node script/event-loop-trace-verify.mjs --strict`
Expected: 三行 ✅（basic 24 步 / await 30 步 / render 27 步），无 ⚠️，退出码 0。

- [ ] **Step 4.3: 构建验证 + Commit**

```bash
pnpm build
git add src/components/event-loop/presets/preset-render.ts
git commit -m "feat: event-loop 预设3(渲染帧时机)"
```


### Task 5: Lottie shape 构造器

**Files:**

- Create: `src/components/event-loop/compiler/shapeBuilders.ts`

- [ ] **Step 5.1: 写 `src/components/event-loop/compiler/shapeBuilders.ts`（完整文件）**

```ts
// Lottie shape layer 构造器（纯数据工厂，无副作用）
import type { Rect } from './layout';

export type LottieLayer = Record<string, unknown>;
export type Prop = Record<string, unknown>;

export interface Keyframe {
	t: number;
	s: number[];
}

const EASE_IN_OUT = { ix: 0.4, iy: 1, ox: 0.6, oy: 0 };

export const staticProp = (k: number[]): Prop => ({ a: 0, k });

/** 多关键帧属性；仅 1 个关键帧时退化为静态属性（lottie 对单关键帧的 a:1 支持不稳定） */
export function propFrom(keys: Keyframe[]): Prop {
	if (keys.length <= 1) return staticProp(keys[0]?.s ?? [0]);
	return {
		a: 1,
		k: keys.map((key, i) => ({
			t: key.t,
			s: key.s,
			...(i < keys.length - 1
				? {
						i: { x: [EASE_IN_OUT.ix], y: [EASE_IN_OUT.iy] },
						o: { x: [EASE_IN_OUT.ox], y: [EASE_IN_OUT.oy] },
					}
				: {}),
		})),
	};
}

interface BlockLayerInput {
	ind: number;
	name: string;
	size: [number, number];
	fillColor: Prop;
	strokeColor: Prop;
	position: Prop;
	opacity: Prop;
	scale: Prop;
	ip: number;
	op: number;
}

/** 圆角块：半透明底色 + 实线描边（栈帧/队列项/回调实体） */
export function blockLayer(input: BlockLayerInput): LottieLayer {
	return {
		ddd: 0,
		ind: input.ind,
		ty: 4,
		nm: input.name,
		sr: 1,
		ks: {
			o: input.opacity,
			r: staticProp([0]),
			p: input.position,
			a: staticProp([0, 0, 0]),
			s: input.scale,
		},
		ao: 0,
		shapes: [
			{
				ty: 'gr',
				nm: `${input.name}-grp`,
				it: [
					{
						ty: 'rc',
						d: 1,
						s: staticProp([input.size[0], input.size[1]]),
						p: staticProp([0, 0]),
						r: staticProp([10]),
					},
					{ ty: 'fl', c: input.fillColor, o: staticProp([20]) },
					{
						ty: 'st',
						c: input.strokeColor,
						o: staticProp([100]),
						w: staticProp([2]),
						lc: 2,
						lj: 2,
					},
					{
						ty: 'tr',
						p: staticProp([0, 0]),
						a: staticProp([0, 0]),
						s: staticProp([100, 100]),
						r: staticProp([0]),
						o: staticProp([100]),
					},
				],
			},
		],
		ip: input.ip,
		op: input.op,
		st: 0,
		bm: 0,
	};
}

/** 区域发光框：圆角矩形 + 双层描边（外层粗柔光 + 内层实线），透明度由关键帧驱动 */
export function regionGlowLayer(input: {
	ind: number;
	name: string;
	rect: Rect;
	color: [number, number, number];
	opacity: Prop;
	op: number;
}): LottieLayer {
	const { rect } = input;
	return {
		ddd: 0,
		ind: input.ind,
		ty: 4,
		nm: input.name,
		sr: 1,
		ks: {
			o: staticProp([100]),
			r: staticProp([0]),
			p: staticProp([rect.x + rect.w / 2, rect.y + rect.h / 2]),
			a: staticProp([0, 0, 0]),
			s: staticProp([100, 100]),
		},
		ao: 0,
		shapes: [
			{
				ty: 'gr',
				nm: `${input.name}-grp`,
				it: [
					{
						ty: 'rc',
						d: 1,
						s: staticProp([rect.w - 8, rect.h - 8]),
						p: staticProp([0, 0]),
						r: staticProp([12]),
					},
					{
						ty: 'st',
						c: staticProp([...input.color, 1]),
						o: input.opacity,
						w: staticProp([9]),
						lc: 2,
						lj: 2,
					},
					{
						ty: 'st',
						c: staticProp([...input.color, 1]),
						o: input.opacity,
						w: staticProp([2.5]),
						lc: 2,
						lj: 2,
					},
					{
						ty: 'tr',
						p: staticProp([0, 0]),
						a: staticProp([0, 0]),
						s: staticProp([100, 100]),
						r: staticProp([0]),
						o: staticProp([100]),
					},
				],
			},
		],
		ip: 0,
		op: input.op,
		st: 0,
		bm: 0,
	};
}

/** 实心条（阶段条分段），填充透明度由关键帧驱动 */
export function barLayer(input: {
	ind: number;
	name: string;
	rect: Rect;
	color: [number, number, number];
	fillOpacity: Prop;
	op: number;
}): LottieLayer {
	const { rect } = input;
	return {
		ddd: 0,
		ind: input.ind,
		ty: 4,
		nm: input.name,
		sr: 1,
		ks: {
			o: staticProp([100]),
			r: staticProp([0]),
			p: staticProp([rect.x + rect.w / 2, rect.y + rect.h / 2]),
			a: staticProp([0, 0, 0]),
			s: staticProp([100, 100]),
		},
		ao: 0,
		shapes: [
			{
				ty: 'gr',
				nm: `${input.name}-grp`,
				it: [
					{
						ty: 'rc',
						d: 1,
						s: staticProp([rect.w, rect.h]),
						p: staticProp([0, 0]),
						r: staticProp([6]),
					},
					{ ty: 'fl', c: staticProp([...input.color, 1]), o: input.fillOpacity },
					{
						ty: 'tr',
						p: staticProp([0, 0]),
						a: staticProp([0, 0]),
						s: staticProp([100, 100]),
						r: staticProp([0]),
						o: staticProp([100]),
					},
				],
			},
		],
		ip: 0,
		op: input.op,
		st: 0,
		bm: 0,
	};
}
```

- [ ] **Step 5.2: 构建验证**

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 5.3: Commit**

```bash
git add src/components/event-loop/compiler/shapeBuilders.ts
git commit -m "feat: event-loop lottie shape 构造器"
```

### Task 6: Lottie 编译器 + 编译断言生效

**Files:**

- Create: `src/components/event-loop/compiler/lottieCompiler.ts`

- [ ] **Step 6.1: 写 `src/components/event-loop/compiler/lottieCompiler.ts`（完整文件）**

```ts
// Step[] → Lottie JSON 编译器（纯函数）
// 视觉主体：区块飞行（实体跨步骤复用同一 layer）+ 区域发光 + 阶段条
import type { ActiveRegion, CompiledAnimation, Phase, Preset, Step } from '../types';
import {
	apiSlot,
	BLOCK,
	COLOR,
	FPS,
	FRAMES_PER_STEP,
	hexToRgb01,
	queueSlot,
	REGION,
	stackSlot,
	STAGE,
} from './layout.ts';
import type { Keyframe, LottieLayer, Prop } from './shapeBuilders.ts';
import { barLayer, blockLayer, propFrom, regionGlowLayer, staticProp } from './shapeBuilders.ts';

type ItemRegion = 'stack' | 'webapis' | 'macro' | 'micro';
type GlowKey = Exclude<ActiveRegion, 'render'>;

interface Appearance {
	step: number;
	region: ItemRegion;
	slot: number;
}

const GLOW_REGIONS: { key: GlowKey; color: string }[] = [
	{ key: 'code', color: COLOR.text },
	{ key: 'stack', color: COLOR.stack },
	{ key: 'webapis', color: COLOR.webapis },
	{ key: 'macro', color: COLOR.macro },
	{ key: 'micro', color: COLOR.micro },
	{ key: 'console', color: COLOR.text },
];

const PHASES: { key: Phase; color: string }[] = [
	{ key: 'task', color: COLOR.macro },
	{ key: 'microtask', color: COLOR.micro },
	{ key: 'render', color: COLOR.render },
];

function collectEntities(steps: Step[]): Map<string, Appearance[]> {
	const map = new Map<string, Appearance[]>();
	const push = (id: string, app: Appearance) => {
		const list = map.get(id) ?? [];
		list.push(app);
		map.set(id, list);
	};
	steps.forEach((st, si) => {
		st.stack.forEach((frame, i) => push(frame.id, { step: si, region: 'stack', slot: i }));
		st.webApis.forEach((entry, i) => push(entry.id, { step: si, region: 'webapis', slot: i }));
		st.macroQueue.forEach((item, i) => push(item.id, { step: si, region: 'macro', slot: i }));
		st.microQueue.forEach((item, i) => push(item.id, { step: si, region: 'micro', slot: i }));
	});
	return map;
}

function slotPos(region: ItemRegion, slot: number): [number, number] {
	if (region === 'stack') return stackSlot(slot);
	if (region === 'webapis') return apiSlot(slot);
	return queueSlot(region, slot);
}

function regionColor(region: ItemRegion): [number, number, number] {
	const hex =
		region === 'stack'
			? COLOR.stack
			: region === 'webapis'
				? COLOR.webapis
				: region === 'macro'
					? COLOR.macro
					: COLOR.micro;
	return hexToRgb01(hex);
}

function entityLayer(ind: number, id: string, apps: Appearance[], steps: Step[]): LottieLayer {
	const first = apps[0].step;
	const last = apps[apps.length - 1].step;
	const ip = first * FRAMES_PER_STEP;
	const goneAt = last + 1 < steps.length ? last + 1 : -1;
	const op = goneAt === -1 ? steps.length * FRAMES_PER_STEP : goneAt * FRAMES_PER_STEP + 14;

	const posKeys: Keyframe[] = [];
	const colKeys: Keyframe[] = [];
	const opaKeys: Keyframe[] = [];
	let prev: Appearance | null = null;
	for (const app of apps) {
		const f = app.step * FRAMES_PER_STEP;
		const p = slotPos(app.region, app.slot);
		if (!prev) {
			posKeys.push({ t: f, s: [p[0], p[1], 0] });
			colKeys.push({ t: f, s: [...regionColor(app.region), 1] });
		} else if (prev.region !== app.region || prev.slot !== app.slot) {
			const from = slotPos(prev.region, prev.slot);
			posKeys.push({ t: f, s: [from[0], from[1], 0] });
			posKeys.push({ t: f + 14, s: [p[0], p[1], 0] });
			colKeys.push({ t: f, s: [...regionColor(prev.region), 1] });
			colKeys.push({ t: f + 14, s: [...regionColor(app.region), 1] });
		}
		prev = app;
	}
	if (first > 0) {
		opaKeys.push({ t: ip, s: [0] }, { t: ip + 12, s: [100] });
	}
	if (goneAt !== -1) {
		opaKeys.push(
			{ t: goneAt * FRAMES_PER_STEP, s: [100] },
			{ t: goneAt * FRAMES_PER_STEP + 12, s: [0] }
		);
	}
	const sclKeys: Keyframe[] =
		first > 0 ? [{ t: ip, s: [55, 55] }, { t: ip + 12, s: [100, 100] }] : [{ t: ip, s: [100, 100] }];

	const opacity: Prop = opaKeys.length > 0 ? propFrom(opaKeys) : staticProp([100]);

	return blockLayer({
		ind,
		name: id,
		size: [BLOCK.w, BLOCK.h],
		fillColor: propFrom(colKeys),
		strokeColor: propFrom(colKeys),
		position: propFrom(posKeys),
		opacity,
		scale: propFrom(sclKeys),
		ip,
		op,
	});
}

function glowOpacityKeys(steps: Step[], key: ActiveRegion): Keyframe[] {
	const keys: Keyframe[] = [];
	steps.forEach((st, i) => {
		const f = i * FRAMES_PER_STEP;
		if (st.active.includes(key)) {
			keys.push({ t: f, s: [45] }, { t: f + 15, s: [85] });
		} else {
			keys.push({ t: f, s: [0] });
		}
	});
	return keys;
}

function phaseRect(i: number) {
	const pad = 8;
	const gap = 8;
	const w = (REGION.phase.w - pad * 2 - gap * 2) / 3;
	return { x: REGION.phase.x + pad + i * (w + gap), y: REGION.phase.y + 10, w, h: REGION.phase.h - 20 };
}

export function compilePreset(preset: Preset): CompiledAnimation {
	const steps = preset.trace;
	const totalFrames = steps.length * FRAMES_PER_STEP;
	const entities = collectEntities(steps);
	const layers: LottieLayer[] = [];
	let ind = 0;

	for (const [id, apps] of entities) {
		layers.push(entityLayer(++ind, id, apps, steps));
	}
	for (const g of GLOW_REGIONS) {
		layers.push(
			regionGlowLayer({
				ind: ++ind,
				name: `glow-${g.key}`,
				rect: REGION[g.key],
				color: hexToRgb01(g.color),
				opacity: propFrom(glowOpacityKeys(steps, g.key)),
				op: totalFrames,
			})
		);
	}
	PHASES.forEach((ph, i) => {
		layers.push(
			barLayer({
				ind: ++ind,
				name: `phase-${ph.key}`,
				rect: phaseRect(i),
				color: hexToRgb01(ph.color),
				fillOpacity: propFrom(
					steps.map((st, si) => ({
						t: si * FRAMES_PER_STEP,
						s: [st.phase === ph.key ? 85 : 22],
					}))
				),
				op: totalFrames,
			})
		);
	});

	const lottieJson = {
		v: '5.9.0',
		fr: FPS,
		ip: 0,
		op: totalFrames,
		w: STAGE.w,
		h: STAGE.h,
		nm: `event-loop-${preset.id}`,
		ddd: 0,
		assets: [],
		layers,
		markers: steps.map((st, i) => ({
			tm: i * FRAMES_PER_STEP,
			cm: `s${i} ${st.title.slice(0, 16)}`,
			dr: 1,
		})),
	};
	const frameMap = steps.map((_, i) => i * FRAMES_PER_STEP);
	return { lottieJson, frameMap, totalFrames };
}

export function validateCompilation(compiled: CompiledAnimation, preset: Preset): string[] {
	const errors: string[] = [];
	const steps = preset.trace;
	if (compiled.frameMap.length !== steps.length) {
		errors.push(`frameMap 长度 ${compiled.frameMap.length} ≠ 步数 ${steps.length}`);
	}
	steps.forEach((_, i) => {
		if (compiled.frameMap[i] !== i * FRAMES_PER_STEP) {
			errors.push(`frameMap[${i}] 应为 ${i * FRAMES_PER_STEP}`);
		}
	});
	if (compiled.totalFrames !== steps.length * FRAMES_PER_STEP) {
		errors.push('totalFrames 与步数不符');
	}
	const json = compiled.lottieJson as { layers?: unknown[] };
	const expected = collectEntities(steps).size + GLOW_REGIONS.length + PHASES.length;
	if (json.layers?.length !== expected) {
		errors.push(`layer 数 ${json.layers?.length} ≠ 预期 ${expected}`);
	}
	return errors;
}
```

- [ ] **Step 6.2: 跑脚本，编译断言首次生效**

Run: `node script/event-loop-trace-verify.mjs --strict`
Expected: 三行 ✅，每行带帧数（basic 720 帧 / await 900 帧 / render 810 帧），退出码 0。

- [ ] **Step 6.3: 构建验证 + Commit**

```bash
pnpm build
git add src/components/event-loop/compiler/lottieCompiler.ts
git commit -m "feat: event-loop lottie 编译器(区块飞行/发光/阶段条)"
```


### Task 7: 播放器 hook + 样式

**Files:**

- Create: `src/components/event-loop/useEventLoopPlayer.ts`
- Create: `src/components/event-loop/event-loop.module.css`

- [ ] **Step 7.1: 写 `src/components/event-loop/useEventLoopPlayer.ts`（完整文件）**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LottieRefCurrentProps } from 'lottie-react';
import { FRAMES_PER_STEP } from '../compiler/layout';
import type { CompiledAnimation, Preset } from '../types';

interface AnimationPlayerLike {
	addEventListener: (type: string, cb: (e: { frame: number }) => void) => void;
	removeEventListener: (type: string, cb: (e: { frame: number }) => void) => void;
}

export function useEventLoopPlayer(preset: Preset, compiled: CompiledAnimation) {
	const lottieRef = useRef<LottieRefCurrentProps>(null);
	const [frame, setFrame] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeedState] = useState(1);

	const { totalFrames } = compiled;
	const stepCount = preset.trace.length;
	const stepIndex = Math.max(0, Math.min(stepCount - 1, Math.floor(frame / FRAMES_PER_STEP)));

	useEffect(() => {
		const player = lottieRef.current as unknown as AnimationPlayerLike | null;
		if (!player) return;
		const onEnterFrame = (e: { frame: number }) => setFrame(e.frame);
		player.addEventListener('enterFrame', onEnterFrame);
		return () => player.removeEventListener('enterFrame', onEnterFrame);
	}, [compiled]);

	const play = useCallback(() => {
		const player = lottieRef.current;
		if (!player) return;
		if (frame >= totalFrames - 1) {
			player.goToAndStop(0, true);
			setFrame(0);
		}
		player.play();
		setPlaying(true);
	}, [frame, totalFrames]);

	const pause = useCallback(() => {
		lottieRef.current?.pause();
		setPlaying(false);
	}, []);

	const toggle = useCallback(() => {
		if (playing) pause();
		else play();
	}, [playing, play, pause]);

	const stepTo = useCallback(
		(i: number) => {
			const clamped = Math.max(0, Math.min(stepCount - 1, i));
			const target = clamped * FRAMES_PER_STEP + FRAMES_PER_STEP - 1;
			lottieRef.current?.goToAndStop(target, true);
			setFrame(target);
			setPlaying(false);
		},
		[stepCount]
	);

	const stepForward = useCallback(() => stepTo(stepIndex + 1), [stepIndex, stepTo]);
	const stepBackward = useCallback(() => stepTo(stepIndex - 1), [stepIndex, stepTo]);

	const replay = useCallback(() => {
		const player = lottieRef.current;
		if (!player) return;
		player.goToAndStop(0, true);
		setFrame(0);
		player.play();
		setPlaying(true);
	}, []);

	const setSpeed = useCallback((s: number) => {
		lottieRef.current?.setSpeed(s);
		setSpeedState(s);
	}, []);

	const seekFrame = useCallback(
		(f: number) => {
			const clamped = Math.max(0, Math.min(totalFrames - 1, f));
			lottieRef.current?.goToAndStop(clamped, true);
			setFrame(clamped);
			setPlaying(false);
		},
		[totalFrames]
	);

	return {
		lottieRef,
		frame,
		stepIndex,
		playing,
		speed,
		play,
		pause,
		toggle,
		stepTo,
		stepForward,
		stepBackward,
		replay,
		setSpeed,
		seekFrame,
		totalFrames,
	};
}

export type EventLoopPlayer = ReturnType<typeof useEventLoopPlayer>;
```

- [ ] **Step 7.2: 写 `src/components/event-loop/event-loop.module.css`（完整文件）**

```css
.page {
	min-height: 100vh;
	width: 100%;
	background: #0d1117;
	color: #e6edf3;
	padding: 24px 32px 96px;
	box-sizing: border-box;
}

.header {
	display: flex;
	align-items: center;
	gap: 16px;
	margin-bottom: 16px;
}

.backBtn {
	background: #21262d;
	color: #e6edf3;
	border: 1px solid #30363d;
	border-radius: 8px;
	padding: 6px 14px;
	font-size: 14px;
	cursor: pointer;
}

.backBtn:hover {
	background: #30363d;
}

.title {
	font-size: 20px;
	font-weight: 600;
	margin: 0;
}

.stageWrap {
	width: 100%;
	max-width: 1200px;
	aspect-ratio: 3 / 2;
	overflow: hidden;
	border: 1px solid #30363d;
	border-radius: 12px;
	background: #0d1117;
}

.stage {
	position: relative;
	transform-origin: 0 0;
}

.overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
	font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

.panel {
	position: absolute;
	border: 1px solid #30363d;
	border-radius: 12px;
	background: rgba(22, 27, 34, 0.55);
	padding: 8px 10px;
	box-sizing: border-box;
	overflow: hidden;
}

.panelTitle {
	font-size: 12px;
	color: #8b949e;
	margin: 0 0 6px;
	font-family: system-ui, sans-serif;
}

.codeList {
	list-style: none;
	margin: 0;
	padding: 0;
	font-size: 13px;
	line-height: 1.7;
}

.codeLine {
	display: flex;
	gap: 8px;
	padding: 0 6px;
	border-radius: 4px;
	white-space: pre;
	color: #c9d1d9;
}

.lineNo {
	color: #484f58;
	min-width: 20px;
	text-align: right;
	user-select: none;
}

.activeLine {
	background: rgba(63, 185, 80, 0.18);
	box-shadow: inset 0 0 0 1px rgba(63, 185, 80, 0.6);
}

.consoleLine {
	font-size: 12px;
	line-height: 1.6;
	color: #8b949e;
	white-space: pre-wrap;
}

.consoleNew {
	color: #e6edf3;
}

.phaseLabel {
	position: absolute;
	display: flex;
	justify-content: space-around;
	align-items: center;
	font-size: 13px;
	color: #8b949e;
	font-family: system-ui, sans-serif;
}

.phaseSpanActive {
	color: #e6edf3;
	font-weight: 600;
}

.narration {
	position: absolute;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 16px;
	border: 1px solid #30363d;
	border-radius: 10px;
	background: rgba(22, 27, 34, 0.7);
	box-sizing: border-box;
}

.stepCounter {
	font-size: 12px;
	color: #8b949e;
	white-space: nowrap;
}

.narrationText {
	font-size: 14px;
	color: #e6edf3;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.itemLabel {
	position: absolute;
	transform: translate(-50%, -50%);
	font-size: 12px;
	padding: 2px 8px;
	border-radius: 6px;
	background: rgba(13, 17, 23, 0.85);
	white-space: nowrap;
	transition:
		left 0.25s ease,
		top 0.25s ease;
	animation: labelIn 0.3s ease;
}

@keyframes labelIn {
	from {
		opacity: 0;
	}

	to {
		opacity: 1;
	}
}

.lblStack {
	color: #3fb950;
	border: 1px solid rgba(63, 185, 80, 0.6);
}

.lblWebapis {
	color: #d29922;
	border: 1px solid rgba(210, 153, 34, 0.6);
}

.lblMacro {
	color: #58a6ff;
	border: 1px solid rgba(88, 166, 255, 0.6);
}

.lblMicro {
	color: #bc8cff;
	border: 1px solid rgba(188, 140, 255, 0.6);
}

.controlsBar {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
	max-width: 1200px;
	margin-top: 12px;
}

.btn {
	background: #21262d;
	color: #e6edf3;
	border: 1px solid #30363d;
	border-radius: 8px;
	padding: 6px 14px;
	font-size: 14px;
	cursor: pointer;
}

.btn:hover {
	background: #30363d;
}

.btnActive {
	border-color: #58a6ff;
	color: #58a6ff;
}

.btn:disabled {
	opacity: 0.5;
	cursor: default;
}

.speeds {
	display: flex;
	gap: 6px;
}

.slider {
	flex: 1;
	min-width: 200px;
	accent-color: #58a6ff;
}

.dots {
	display: flex;
	gap: 4px;
	align-items: center;
}

.dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	border: none;
	background: #30363d;
	padding: 0;
	cursor: pointer;
}

.dotActive {
	background: #58a6ff;
}

.picker {
	min-height: 60vh;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 24px;
	padding: 32px;
}

.pickerTitle {
	font-size: 24px;
	font-weight: 700;
	margin: 0;
}

.pickerCards {
	display: flex;
	gap: 20px;
	flex-wrap: wrap;
	justify-content: center;
}

.presetCard {
	width: 300px;
	text-align: left;
	background: #161b22;
	border: 1px solid #30363d;
	border-radius: 12px;
	padding: 16px;
	cursor: pointer;
	color: #e6edf3;
	font-family: inherit;
	transition:
		border-color 0.2s,
		transform 0.2s;
}

.presetCard:hover {
	border-color: #58a6ff;
	transform: translateY(-2px);
}

.presetCardTitle {
	font-size: 16px;
	font-weight: 600;
	margin: 0 0 4px;
}

.difficulty {
	font-size: 12px;
	color: #d29922;
	margin-bottom: 10px;
}

.presetCode {
	font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	font-size: 11px;
	line-height: 1.6;
	color: #c9d1d9;
	background: #0d1117;
	border-radius: 8px;
	padding: 10px;
	white-space: pre;
	overflow: hidden;
	max-height: 190px;
}
```

- [ ] **Step 7.3: 构建验证 + Commit**

```bash
pnpm build
git add src/components/event-loop/useEventLoopPlayer.ts src/components/event-loop/event-loop.module.css
git commit -m "feat: event-loop 播放器 hook 与深色样式"
```

### Task 8: DOM 叠加面板组件

**Files:**

- Create: `src/components/event-loop/CodePanel.tsx`
- Create: `src/components/event-loop/ConsolePanel.tsx`
- Create: `src/components/event-loop/PhaseBar.tsx`
- Create: `src/components/event-loop/NarrationBar.tsx`

- [ ] **Step 8.1: 写 `CodePanel.tsx`（完整文件）**

```tsx
import { useMemo } from 'react';
import { box, REGION } from '../compiler/layout';
import type { Step } from '../types';
import styles from './event-loop.module.css';

export function CodePanel({ code, step }: { code: string; step: Step }) {
	const lines = useMemo(() => code.split('\n'), [code]);
	return (
		<section className={styles.panel} style={box(REGION.code)}>
			<h4 className={styles.panelTitle}>代码</h4>
			<ol className={styles.codeList}>
				{lines.map((line, i) => (
					<li
						key={i}
						className={
							step.codeLine === i + 1
								? `${styles.codeLine} ${styles.activeLine}`
								: styles.codeLine
						}
					>
						<span className={styles.lineNo}>{i + 1}</span>
						<code>{line}</code>
					</li>
				))}
			</ol>
		</section>
	);
}
```

- [ ] **Step 8.2: 写 `ConsolePanel.tsx`（完整文件）**

```tsx
import { box, REGION } from '../compiler/layout';
import type { Step } from '../types';
import styles from './event-loop.module.css';

export function ConsolePanel({ step }: { step: Step }) {
	return (
		<section className={styles.panel} style={box(REGION.console)}>
			<h4 className={styles.panelTitle}>Console</h4>
			{step.consoleLines.map((line, i) => (
				<div
					key={i}
					className={
						i === step.consoleLines.length - 1
							? `${styles.consoleLine} ${styles.consoleNew}`
							: styles.consoleLine
					}
				>
					{line}
				</div>
			))}
		</section>
	);
}
```

- [ ] **Step 8.3: 写 `PhaseBar.tsx`（完整文件）**

```tsx
import { box, REGION } from '../compiler/layout';
import type { Step } from '../types';
import styles from './event-loop.module.css';

const LABELS: { key: Step['phase']; text: string }[] = [
	{ key: 'task', text: '① 任务（宏任务）' },
	{ key: 'microtask', text: '② 微任务' },
	{ key: 'render', text: '③ 渲染' },
];

export function PhaseBar({ step }: { step: Step }) {
	return (
		<section className={styles.phaseLabel} style={box(REGION.phase)}>
			{LABELS.map((label) => (
				<span
					key={label.key}
					className={step.phase === label.key ? styles.phaseSpanActive : undefined}
				>
					{label.text}
				</span>
			))}
		</section>
	);
}
```

- [ ] **Step 8.4: 写 `NarrationBar.tsx`（完整文件）**

```tsx
import { box, REGION } from '../compiler/layout';
import type { Step } from '../types';
import styles from './event-loop.module.css';

export function NarrationBar({
	step,
	index,
	total,
}: {
	step: Step;
	index: number;
	total: number;
}) {
	return (
		<section className={styles.narration} style={box(REGION.narration)}>
			<span className={styles.stepCounter}>
				步骤 {index + 1}/{total}
			</span>
			<span className={styles.narrationText}>{step.title}</span>
		</section>
	);
}
```

- [ ] **Step 8.5: 构建验证 + Commit**

```bash
pnpm build
git add src/components/event-loop/CodePanel.tsx src/components/event-loop/ConsolePanel.tsx src/components/event-loop/PhaseBar.tsx src/components/event-loop/NarrationBar.tsx
git commit -m "feat: event-loop DOM 叠加面板(代码/Console/阶段条/解说)"
```


### Task 9: 舞台、控制栏、预设选择与页面组装

**Files:**

- Create: `src/components/event-loop/presets/index.ts`
- Create: `src/components/event-loop/PresetPicker.tsx`
- Create: `src/components/event-loop/PlaybackControls.tsx`
- Create: `src/components/event-loop/EventLoopStage.tsx`
- Create: `src/components/event-loop/EventLoopPage.tsx`
- Create: `src/components/event-loop/index.ts`
- Modify: `src/components/event-loop/event-loop.module.css`（追加 `.regionTitle`）

- [ ] **Step 9.1: 写 `presets/index.ts`（完整文件；应用侧入口，Node 脚本不走这里，所以省扩展名）**

```ts
import type { Preset } from '../types';
import { presetAwait } from './preset-await';
import { presetBasic } from './preset-basic';
import { presetRender } from './preset-render';

export const presets: Preset[] = [presetBasic, presetAwait, presetRender];
```

- [ ] **Step 9.2: 写 `PresetPicker.tsx`（完整文件）**

```tsx
import type { Preset } from './types';
import { presets } from './presets';
import styles from './event-loop.module.css';

export function PresetPicker({ onSelect }: { onSelect: (preset: Preset) => void }) {
	return (
		<div className={styles.picker}>
			<h2 className={styles.pickerTitle}>选择一段代码，看它如何跑过事件循环</h2>
			<div className={styles.pickerCards}>
				{presets.map((preset) => (
					<button
						type="button"
						key={preset.id}
						className={styles.presetCard}
						onClick={() => onSelect(preset)}
					>
						<div className={styles.presetCardTitle}>{preset.title}</div>
						<div className={styles.difficulty}>难度 {'★'.repeat(preset.difficulty)}</div>
						<div className={styles.presetCode}>{preset.code}</div>
					</button>
				))}
			</div>
		</div>
	);
}
```

- [ ] **Step 9.3: 写 `PlaybackControls.tsx`（完整文件）**

```tsx
import type { EventLoopPlayer } from '../useEventLoopPlayer';
import styles from './event-loop.module.css';

const SPEEDS = [0.5, 1, 2];

export function PlaybackControls({
	player,
	frameMap,
}: {
	player: EventLoopPlayer;
	frameMap: number[];
}) {
	return (
		<div className={styles.controlsBar}>
			<button type="button" className={styles.btn} onClick={player.replay}>
				⏮ 重播
			</button>
			<button type="button" className={styles.btn} onClick={player.toggle}>
				{player.playing ? '⏸ 暂停' : '▶ 播放'}
			</button>
			<button type="button" className={styles.btn} onClick={player.stepBackward}>
				↶ 上一步
			</button>
			<button type="button" className={styles.btn} onClick={player.stepForward}>
				⏭ 单步
			</button>
			<div className={styles.speeds}>
				{SPEEDS.map((s) => (
					<button
						type="button"
						key={s}
						className={player.speed === s ? `${styles.btn} ${styles.btnActive}` : styles.btn}
						onClick={() => player.setSpeed(s)}
					>
						{s}x
					</button>
				))}
			</div>
			<input
				type="range"
				className={styles.slider}
				min={0}
				max={player.totalFrames - 1}
				value={player.frame}
				onChange={(e) => player.seekFrame(Number(e.target.value))}
			/>
			<div className={styles.dots}>
				{frameMap.map((_, i) => (
					<button
						type="button"
						key={i}
						aria-label={`跳到步骤 ${i + 1}`}
						className={i === player.stepIndex ? `${styles.dot} ${styles.dotActive}` : styles.dot}
						onClick={() => player.stepTo(i)}
					/>
				))}
			</div>
		</div>
	);
}
```

- [ ] **Step 9.4: 写 `EventLoopStage.tsx`（完整文件；两层同步的核心）**

```tsx
import Lottie from 'lottie-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { compilePreset } from '../compiler/lottieCompiler';
import { apiSlot, queueSlot, REGION, stackSlot, STAGE } from '../compiler/layout';
import { useEventLoopPlayer } from '../useEventLoopPlayer';
import type { Preset, Step } from '../types';
import { CodePanel } from './CodePanel';
import { ConsolePanel } from './ConsolePanel';
import { NarrationBar } from './NarrationBar';
import { PhaseBar } from './PhaseBar';
import { PlaybackControls } from './PlaybackControls';
import styles from './event-loop.module.css';

const REGION_TITLES = [
	{ key: 'stack', text: '调用栈' },
	{ key: 'webapis', text: 'Web APIs' },
	{ key: 'macro', text: '宏任务队列' },
	{ key: 'micro', text: '微任务队列' },
] as const;

interface ItemLabel {
	id: string;
	label: string;
	x: number;
	y: number;
	cls: string;
}

/** 与 Lottie 块同 slot 函数计算标签位置（同一坐标源 → 对齐由构造保证） */
function collectLabels(step: Step): ItemLabel[] {
	const labels: ItemLabel[] = [];
	const add = (id: string, label: string, pos: [number, number], cls: string) => {
		labels.push({ id, label, x: pos[0], y: pos[1], cls });
	};
	step.stack.forEach((f, i) => add(f.id, f.label, stackSlot(i), styles.lblStack));
	step.webApis.forEach((e, i) => add(e.id, e.label, apiSlot(i), styles.lblWebapis));
	step.macroQueue.forEach((q, i) => add(q.id, q.label, queueSlot('macro', i), styles.lblMacro));
	step.microQueue.forEach((q, i) => add(q.id, q.label, queueSlot('micro', i), styles.lblMicro));
	return labels;
}

export function EventLoopStage({ preset, onBack }: { preset: Preset; onBack: () => void }) {
	const compiled = useMemo(() => compilePreset(preset), [preset]);
	const player = useEventLoopPlayer(preset, compiled);
	const step = preset.trace[player.stepIndex];
	const labels = useMemo(() => collectLabels(step), [step]);

	const wrapRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			setScale(entries[0].contentRect.width / STAGE.w);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<button type="button" className={styles.backBtn} onClick={onBack}>
					← 换个预设
				</button>
				<h2 className={styles.title}>{preset.title}</h2>
			</header>
			<div ref={wrapRef} className={styles.stageWrap}>
				<div
					className={styles.stage}
					style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}
				>
					<Lottie
						lottieRef={player.lottieRef}
						animationData={compiled.lottieJson as never}
						loop={false}
						autoplay={false}
						style={{ position: 'absolute', top: 0, left: 0, width: STAGE.w, height: STAGE.h }}
						onComplete={() => player.pause()}
					/>
					<div className={styles.overlay}>
						<PhaseBar step={step} />
						<CodePanel code={preset.code} step={step} />
						<ConsolePanel step={step} />
						<NarrationBar step={step} index={player.stepIndex} total={preset.trace.length} />
						{REGION_TITLES.map((r) => (
							<span
								key={r.key}
								className={styles.regionTitle}
								style={{ left: REGION[r.key].x + 10, top: REGION[r.key].y + 6 }}
							>
								{r.text}
							</span>
						))}
						{labels.map((it) => (
							<span
								key={it.id}
								className={`${styles.itemLabel} ${it.cls}`}
								style={{ left: it.x, top: it.y }}
							>
								{it.label}
							</span>
						))}
					</div>
				</div>
			</div>
			<PlaybackControls player={player} frameMap={compiled.frameMap} />
		</div>
	);
}
```

- [ ] **Step 9.5: 写 `EventLoopPage.tsx` 与 `index.ts`（完整文件）**

```tsx
import { useState } from 'react';
import { EventLoopStage } from './EventLoopStage';
import { PresetPicker } from './PresetPicker';
import type { Preset } from './types';
import styles from './event-loop.module.css';

export function EventLoopPage() {
	const [preset, setPreset] = useState<Preset | null>(null);

	if (!preset) {
		return (
			<div className={styles.page}>
				<PresetPicker onSelect={setPreset} />
			</div>
		);
	}
	return <EventLoopStage preset={preset} onBack={() => setPreset(null)} />;
}
```

```ts
export { EventLoopPage } from './EventLoopPage';
```

- [ ] **Step 9.6: 在 `event-loop.module.css` 末尾追加**

```css
.regionTitle {
	position: absolute;
	font-size: 12px;
	color: #8b949e;
	font-family: system-ui, sans-serif;
}
```

- [ ] **Step 9.7: 构建验证**

Run: `pnpm build`
Expected: 成功。若 `animationData as never` 报错，检查 lottie-react 版本是否 ^2.4.0。

- [ ] **Step 9.8: Commit**

```bash
git add src/components/event-loop/
git commit -m "feat: event-loop 舞台/控制栏/预设选择页面组装"
```


### Task 10: App 接入 + 全量验收

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/components/controls/AnimationControls.tsx:7-12`

- [ ] **Step 10.1: 修改 `src/App.tsx`（共 4 处）**

① 在 `import { FiberTodoPage } ...`（第 3 行）之后加一行：

```ts
import { EventLoopPage } from '@/components/event-loop';
```

② `AnimationType` 联合类型（第 10-14 行）加一个值：

```ts
type AnimationType =
	| 'menu'
	| 'scroll'
	| 'lottie'
	| 'fiber-todo'
	| 'event-loop';
```

③ switch（`case 'fiber-todo'` 之后、`default` 之前）加：

```tsx
			case 'event-loop':
				return <EventLoopPage />;
```

④ MenuPage 的 `animations` 数组（第 46-50 行）加一项，并在描述区（第 76-79 行模式）补一行：

```ts
		{ id: 'event-loop', name: 'Event Loop', icon: '🔄', color: 'from-sky-500 to-indigo-500' },
```

```tsx
					{animation.id === 'event-loop' &&
						'三预设 · Lottie 事件循环可视化 · 全链路高亮'}
```

- [ ] **Step 10.2: 修改 `src/components/controls/AnimationControls.tsx` 的 `animations` 数组（第 7-12 行）加一项**

```ts
	{ id: 'event-loop', label: '事件循环', icon: '🔄' },
```

- [ ] **Step 10.3: 校验脚本（严格模式）**

Run: `node script/event-loop-trace-verify.mjs --strict`
Expected（三条全绿 + 帧数，退出码 0）：

```text
✅ basic: 输出顺序一致(4 条), 24 步, 720 帧
✅ await: 输出顺序一致(5 条), 30 步, 900 帧
✅ render: 输出顺序一致(4 条), 27 步, 810 帧
```

- [ ] **Step 10.4: lint + 构建**

Run: `pnpm lint && pnpm build`
Expected: biome 无 error；`tsc -b` 无错误；vite build 成功。

- [ ] **Step 10.5: 浏览器手动验收（对照 spec §14 验收标准）**

Run: `pnpm dev`，打开 `http://localhost:5173`

核对清单（每条都要实际操作确认）：

1. 菜单出现「Event Loop 🔄」卡片 → 进入后看到三张预设卡片（含代码预览与难度星标）
2. 选「入门」预设 → 舞台呈现：阶段条 / 代码区 / 调用栈 / Web APIs / 宏/微任务队列 / Console / 解说条
3. 点「▶ 播放」：块按 trace 飞行（script 从宏队列飞入调用栈、then 回调入微队列、timeout 回调从 Web APIs 飞入宏队列再入栈）；活跃区发光、其余区域无发光；代码行高亮随步骤推进；Console 按预期顺序逐条输出 `1: sync → 2: sync end → 3: then → 4: timeout`
4. 暂停 → 单步前进/后退 → 倍速 0.5x/2x → 拖动进度条到任意位置 → 点进度点跳步：Lottie 画面与 DOM（代码高亮/Console/解说/标签位置）始终一致
5. 「⏮ 重播」回到第 1 步重新播放；「← 换个预设」返回选择页
6. 另两个预设同样跑一遍：await 输出 `1→2→3→4→5`；render 输出 `1→2→3→4` 且 rAF 回调在渲染阶段执行（阶段条高亮「③ 渲染」）
7. 缩放浏览器窗口：舞台等比缩放，两层不错位

已知可接受项（不是 bug，不要修）：非 1x 倍速时 DOM 标签的 0.25s CSS 过渡与 Lottie 飞行有轻微错位；Lottie 块本身无文字（文字标签在 DOM 层）。

- [ ] **Step 10.6: Commit**

```bash
git add src/App.tsx src/components/controls/AnimationControls.tsx
git commit -m "feat: event-loop 接入应用菜单与导航"
```

- [ ] **Step 10.7: Playwright 浏览器验收（9 项断言）**

Run:
```bash
python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm dev" --port 5173 \
  -- python3.11 script/event-loop-accept.py
```

Expected（9 项断言全绿，最后一行 `ALL CHECKS PASSED`）：

```text
✅ 舞台元素齐全（阶段条/代码/栈/WebAPIs/双队列/Console/解说）
✅ basic: 播放结束输出 4 条顺序正确, 步数 24/24
✅ 单步回退: 23/24
✅ 进度点跳步: 10/24
✅ 重播: 回到 1/24
✅ await: 播放结束输出 5 条顺序正确, 步数 30/30
✅ render: 播放结束输出 4 条顺序正确(rAF 最后), 步数 27/27
ALL CHECKS PASSED
```

若失败，按以下工具脚本定位：

| 脚本 | 用途 |
|---|---|
| `script/event-loop-accept.py` | 9 项端到端验收（最终 gate） |
| `script/event-loop-playback-probe.py` | 12s 轮询计数器 + 暂停按钮状态 + 末屏截图，验证动画确实在跑 |
| `script/event-loop-console-probe.py` | 抓前 12 条浏览器 console，定位 `onEnterFrame` 等事件流问题 |

- [ ] **Step 10.8: 验收脚本说明（README 沉淀）**

新增 `script/README.md`（见同目录），简述三脚本作用与运行方式。

---

## 计划自审记录（writing-plans Self-Review）

1. **Spec 覆盖**：spec §3 三预设（Task 2/3/4）/ §4 架构（Task 6/9）/ §5 类型（Task 1）/ §6 编译器（Task 5/6）/ §7 舞台与色值（Task 1 layout + Task 7 CSS）/ §8 文件结构（Task 1-9 全部对齐 spec §8 清单）/ §9 播放控制（Task 7 hook + Task 9 Controls）/ §10 校验与测试（Task 2 脚本 + Task 6 编译断言 + Task 10.3）/ §11 错误处理（DOM 层独立持有状态，Lottie 异常时单步仍可用——由架构保证）/ §12 接入（Task 10）/ §14 验收（Task 10.3-10.5 逐条映射）。无缺口。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤给出完整文件；预设 2/3 为完整数值表 + 展开示例，零决策空间。
3. **类型一致性**：`Step`/`Preset`/`CompiledAnimation`（Task 1）贯穿后续所有任务；`q(id,label,kind)` 三参签名在 Task 2 定义、Task 3/4 表格沿用；`EventLoopPlayer` 由 hook 导出、Controls 消费；`propFrom/staticProp` 在 Task 5 定义、Task 6 消费；REGION 键名与 GLOW_REGIONS/REGION_TITLES 一致。
4. **已知风险与对策**：lottie 对生成 JSON 的渲染兼容（Task 10.5 浏览器验收把关；markers 仅调试用）；`enterFrame` 监听类型断言（Task 7 已封装）；DOM 标签过渡与倍速错位（已声明为可接受项）。
