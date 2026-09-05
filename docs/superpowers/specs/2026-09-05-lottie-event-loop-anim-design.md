# Lottie 事件循环动画演示 · 设计方案

- **日期**: 2026-09-05
- **分支**: `feat/lottie-event-loop`
- **状态**: 已与需求方逐节确认（复述 ✅ / 预设 ✅ / 播放控制 ✅ / 布局 ✅ / 风格 ✅ / 技术方案 ✅ / 设计 8 节 ✅）
- **下一步**: 按 superpowers 流程产出实施计划（`docs/superpowers/plans/`）

---

## 1. 背景与目标

在现有动画演示站（React 18 + TS + Vite + GSAP + lottie-react）中新增一个页面：用户从 **3 份预设 JS 代码**中选择一份，系统以 **Lottie 动画**演示这段代码在浏览器事件循环中的**真实执行过程**——调用栈压栈/出栈、Web APIs 承接定时器与回调、宏任务/微任务队列流转、每轮循环清空微任务、渲染帧时机，全程高亮当前步骤。

**核心诉求**（需求方原话要点）：

1. 根据所选代码片段，展示其真实执行过程
2. 动画执行时把**整个链路**在动画中高亮出来，明确执行到哪一步

## 2. 需求决策记录

| 决策点 | 结论 |
|---|---|
| 代码来源 | **不做任意输入**，3 份固定预设，用户选择后执行 |
| 预设选取 | 阶梯式：入门（宏 vs 微）/ 进阶（await 与微任务）/ 综合（渲染帧时机） |
| 播放控制 | 播放/暂停 + 单步 + 倍速（0.5x/1x/2x）+ 重播 + **进度条自由拖拽跳步** + 步骤进度点 |
| 舞台布局 | 五区常驻：代码区 / 调用栈 / Web APIs / 宏任务队列 / 微任务队列 / Console + 顶部事件循环阶段条；活跃区发光、其余降暗 |
| 视觉风格 | 深色科技风（GitHub dark 底 + 分区色相），高亮 = 色块发光 + 描边 |
| 界面语言 | 中文（沿用仓库惯例） |
| 技术方案 | **C：Lottie 主体 + DOM 文本叠加**（详见 §4/§6） |

## 3. 预设示例

### 示例 1 · 入门：宏任务 vs 微任务

```js
console.log('1: sync');
setTimeout(() => {
  console.log('4: timeout');
}, 0);
Promise.resolve().then(() => {
  console.log('3: then');
});
console.log('2: sync end');
```

- 预期输出：`1: sync → 2: sync end → 3: then → 4: timeout`
- 教学重点：同步代码先跑完；`then` 回调进**微任务**队列，在本轮任务结束后立即清空；`setTimeout(0)` 是**宏任务**，要等下一轮循环。

### 示例 2 · 进阶：await 与微任务

```js
async function a() {
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
console.log('2: sync end');
```

- 预期输出：`1: a start → 2: sync end → 3: a resumed → 4: micro → 5: timeout`
- 教学重点：`await` 挂起后剩余函数体 = 一个微任务；它在 `queueMicrotask` 注册的回调**之前**入队（FIFO），所以 `3` 先于 `4`；宏任务 `5` 永远最后。

### 示例 3 · 综合：渲染帧时机

```js
console.log('1: sync');
requestAnimationFrame(() => {
  console.log('4: raf');
});
setTimeout(() => {
  console.log('3: timeout');
}, 0);
Promise.resolve().then(() => {
  console.log('2: then');
});
```

- 预期输出：`1: sync → 2: then → 3: timeout → 4: raf`
- 教学重点：rAF 回调不属于宏/微任务队列，在**渲染步骤**中、微任务清空之后触发；通常紧随其后的 timer 宏任务先执行，rAF 在下一次渲染机会运行。

三个预设代码内嵌行号注释，供 `Step.codeLine` 高亮引用；输出前缀数字便于观众对照顺序。

## 4. 总体架构与数据流

单向管线，`Step[]` 是唯一真相源，Lottie 与 DOM 都是它的渲染器：

```
presets/ (3 个预设: 代码文本 + 手写 trace 步骤数据)
     │
     ▼
模拟器约定: preset ──纯数据──► Step[]     （手写声明式 trace，不写解释器）
     │
     ├──► lottieCompiler (纯函数): Step[] ──► { lottieJson, frameMap }
     │         │
     │         ▼
     │    lottie-react 播放（视觉主体：区块飞行 / 发光 / 队列动效）
     │         │ onEnterFrame(frame)
     │         ▼
     └──► React DOM 叠加层（文本主体：代码行高亮 / Console / 解说 / 阶段条）
              ▲
              └── stepIndex = frameMap 反查当前帧 ── 两层严格同步
```

**为什么手写 trace 而不做解释器**：3 个预设、每个约 35~45 步，手写声明式数据 + TypeScript 类型约束，教学节奏（每步停多久、何时强调）完全可控；通用 JS 解释器是为"未来任意代码"做的过度设计（YAGNI）。若未来开放任意输入，模拟器接口不变，仅替换数据来源。

**为什么 Lottie 主体 + DOM 文本叠加（方案 C）**：需求要 Lottie 承载执行过程的动画——区块在队列间飞行、清空微任务、发光高亮等视觉主体由**程序化生成的 Lottie JSON** 渲染；Lottie 公认短板（文本渲染，尤其中文与等宽代码）由 DOM 叠加层补齐。舞台固定 1200×800 逻辑坐标，两层同坐标绝对定位、等比缩放，天然对齐。

## 5. 核心数据模型

```ts
type Phase = 'task' | 'microtask' | 'render';
type ActiveRegion =
  | 'code' | 'stack' | 'webapis' | 'macro' | 'micro' | 'console' | 'render';
type StepEvent =
  | 'push' | 'pop' | 'enqueue' | 'dequeue'
  | 'callback-run' | 'render-frame';

interface QueueItem {
  id: string;          // 稳定 ID，如 'micro-0'、'macro-0' —— 跨步骤复用同一 Lottie layer
  label: string;       // 如 'then 回调'、'timer(0) 回调'
  kind: 'macro' | 'micro';
}

interface StackFrame {
  id: string;          // 如 'stack-anonymous'、'stack-log-1'
  label: string;       // 如 'a()'、'console.log'
}

interface WebApiEntry {
  id: string;          // 如 'timer-0'、'raf-0'
  label: string;       // 如 'setTimeout 0ms'、'rAF'
  type: 'timer' | 'raf';
  remainingMs: number; // 倒计时展示（教学用示意值）
}

interface Step {
  id: number;                // 0 起
  title: string;             // 一句话解说，如「微任务队列清空：then 回调入栈执行」
  phase: Phase;              // 顶部事件循环阶段条高亮
  codeLine: number | null;   // 当前执行代码行（1 起）；null = 队列间隙等无对应行
  stack: StackFrame[];       // 调用栈快照
  webApis: WebApiEntry[];    // 挂起的定时器 / rAF
  macroQueue: QueueItem[];
  microQueue: QueueItem[];
  consoleLines: string[];    // 截至本步的累计输出（快照，便于跳步直接渲染）
  active: ActiveRegion[];    // 当前活跃区域集合 → 发光/降暗依据
  event: StepEvent | null;   // 决定本步 Lottie 动效类型
}

interface Preset {
  id: 'basic' | 'await' | 'render';
  title: string;         // 「入门 · 宏任务 vs 微任务」等
  difficulty: 1 | 2 | 3;
  code: string;          // 原始代码文本（CodePanel 按行渲染）
  expectedOutput: string[];
  trace: Step[];
}
```

要点：

- 每个可视块有**稳定 ID**：同一实体跨步骤复用同一个 Lottie layer，相邻步骤的状态差异自动成为位移动画（回调从 Web APIs「飞入」宏任务队列即由此实现）
- `consoleLines` 存**累计快照**而非增量：跳步/拖拽到任意帧时 DOM 层可直接渲染，无需回放计算

## 6. Lottie 编译器

`compiler/lottieCompiler.ts`，纯函数：`(preset: Preset) => { lottieJson: LottieJson; frameMap: number[] }`

- **画布**：1200×800 设计坐标系，60fps，`FRAMES_PER_STEP = 30`（基准 0.5s/步；倍速由播放器 `setSpeed` 承担，不改帧）
- **frameMap**：`stepIndex → 起始帧` 的数组；反向查表（二分或预建帧→步数组）供 `onEnterFrame` 使用
- **元素映射**：每个可视块 = 圆角矩形 shape layer（fill 用分区色、stroke 常态描边）；相邻步骤差异 → `position / scale / opacity` 关键帧；入队 = 从源区域到队列尾的位移动画，出队执行 = 飞向调用栈后 opacity 归零
- **发光高亮**：Lottie 无原生 glow，用**双层描边模拟**——外层粗+半透明、内层细实线，配亮度脉冲（opacity 关键帧小幅往复）；非活跃区域整体降暗（opacity 0.4）
- **文本一律不进 Lottie**：代码行、Console、解说、阶段条文字全部由 DOM 叠加层渲染
- **即时编译**：选预设后 `useMemo` 内完成（纯 shape、毫秒级、JSON 体积小）；`shapeBuilders.ts` 提供块/描边/发光/关键帧的构造小函数，编译器只做编排
- **阶段条**：task → microtask → render 三段进度，用矩形 layer 的 scale/trim 关键帧推进

## 7. 舞台布局与视觉规范

```
┌─ ①事件循环阶段条: 任务 → 微任务 → 渲染 ──────────┐
├──────────┬─────────────────────────────────────┤
│          │ ②调用栈(绿)   ③Web APIs(黄)          │
│  代码区   │ ┌─────┐      ┌──────────┐           │
│ (行高亮)  │ │ a() │      │ timer 0ms │          │
│          │ └─────┘      └──────────┘           │
│          │ ④宏任务队列(蓝)  ⑤微任务队列(紫)      │
│          │ ┌──┐┌──┐        ┌──┐┌──┐           │
│          │ └──┘└──┘        └──┘└──┘           │
├──────────┴─────────────────────────────────────┤
│ ⑥Console 输出                    ⑦播放控制/进度点 │
└──────────────────────────────────────────────────┘
```

- 舞台容器固定 1200×800 逻辑坐标，`transform: scale` 等比适配窗口；Lottie 容器与 DOM 叠加层同坐标绝对定位
- 每步顶部/底部解说条（NarrationBar）显示 `Step.title`
- 色彩规范（GitHub dark 底）：

| 区域 | 颜色 |
|---|---|
| 页面背景 | `#0d1117` |
| 宏任务 | `#58a6ff`（蓝） |
| 微任务 | `#bc8cff`（紫） |
| 调用栈 | `#3fb950`（绿） |
| Web APIs | `#d29922`（黄） |
| 渲染帧 | `#ff7b72`（粉） |
| Console / 正文 | `#e6edf3`（白） |

高亮 = 活跃区发光描边 + 短暂亮度脉冲；非活跃区降暗至 0.4 透明度。

## 8. 组件划分与文件结构

```
src/components/event-loop/
├── EventLoopPage.tsx        # 页面容器：预设选择 → 演示；返回菜单
├── PresetPicker.tsx         # 三张预设卡片（代码预览 + 难度标签）
├── types.ts                 # §5 全部类型
├── presets/
│   ├── preset-basic.ts      # 示例 1
│   ├── preset-await.ts      # 示例 2
│   └── preset-render.ts     # 示例 3
├── compiler/
│   ├── lottieCompiler.ts    # Step[] → { lottieJson, frameMap }
│   └── shapeBuilders.ts     # 块 / 描边 / 发光 / 关键帧构造
├── EventLoopStage.tsx       # 舞台：Lottie 容器 + DOM 叠加层对齐缩放
├── CodePanel.tsx            # 代码区（按行渲染 + 高亮）
├── ConsolePanel.tsx         # Console 输出
├── PhaseBar.tsx             # 事件循环阶段条
├── NarrationBar.tsx         # 当前步骤解说
├── useEventLoopPlayer.ts    # 播放器 hook（状态机，见 §9）
├── PlaybackControls.tsx     # 控制栏：⏮ ▶/⏸ ⏭ 0.5x/1x/2x 进度条/进度点
├── index.ts
└── *.module.css             # CSS Modules（沿用仓库惯例）

script/event-loop-trace-verify.mjs   # 真实性校验脚本（见 §10）
```

## 9. 播放控制（useEventLoopPlayer）

- **单一驱动方向**：`onEnterFrame(frame)` → 帧反查 `stepIndex` → DOM 层更新；用户操作（单步/拖拽/跳点）→ `goToAndStop(frame)` → 同一同步链路，无回环、无双真相源
- 播放/暂停 = `play() / pause()`；单步 = `goToAndStop(目标步结束帧)`；倍速 = `setSpeed(0.5 | 1 | 2)`；拖拽 = 进度条换算帧；播完自动停末帧；重播 = `goToAndPlay(0)`
- 进度点由 `frameMap` 渲染（每步一个点，点击即跳步）；`goToAndStop` 逐帧 seek 在仓库 `src/components/lottie/LottieAnimation.tsx:73-80` 已有先例
- StrictMode 安全：编译在 `useMemo`，播放器状态集中于此 hook

## 10. 真实性保障与测试

手写 trace 有编错风险，两道校验兜底（`script/event-loop-trace-verify.mjs`，Node 脚本，遵循仓库 `script/*.mjs` 惯例，零新依赖）：

1. **输出顺序比对**：脚本真实执行三个预设代码，收集 `console.log` 输出顺序，与 `expectedOutput` / trace 最终 `consoleLines` 逐一比对，不一致即非零退出
2. **结构不变量检查**（对 trace 逐条断言）：
   - 进入新的宏任务步（`event: 'dequeue'` 且 kind=macro）之前，微任务队列必须为空
   - rAF 回调执行步的 `phase` 必须为 `'render'`
   - 每个任务步结束时调用栈为空
   - 队列项稳定 ID 在其生命周期内语义不变（同名不指代不同实体）

**诚实边界**：真实浏览器可观测的只有输出顺序；栈/队列的中间状态不可直接观测，依靠不变量检查 + 设计时人工校对。

**compiler 测试**：纯函数结构断言（生成 JSON 的 layer 数、frameMap 单调递增、总帧数 = 步数 × 30），同样以脚本形式验证。仓库无测试框架，**本设计不引入测试框架**。

## 11. 错误处理与降级

- **Lottie 失败兜底免费送**：DOM 层持有每步完整状态，Lottie 加载/播放异常时降级为静态步骤图，单步/跳步仍可用（无飞行动画）
- trace 结构断言在编译前运行：dev 抛完整错误；prod 仅轻量断言
- 生成 JSON 异常（体积/结构）视为编译 bug，开发期由校验脚本拦截

## 12. 页面接入

沿用 fiber-todo 模式：

1. `src/App.tsx`：`AnimationType` 联合类型加 `'event-loop'`，switch 加 case
2. `src/components/controls/` 菜单卡片与 `AnimationControls.tsx` 的 animations 数组各加一项
3. 无路由、无新依赖（`lottie-react` 已在 package.json）

## 13. 非目标（YAGNI 清单）

- ❌ 任意用户代码输入 / 代码编辑器 / JS 解释器
- ❌ 多窗口 rAF 原理、Worker、`MessageChannel`、`MutationObserver` 等扩展 API
- ❌ Lottie 文本层（所有文本走 DOM）
- ❌ 引入测试框架 / 代码编辑器依赖（如 Monaco）
- ❌ 移动端深度适配（等比缩放可用即可）

## 14. 验收标准

1. 菜单出现「事件循环演示」卡片，进入后可选三个预设并开始演示
2. 任一预设播放全程：代码行高亮、五区状态、阶段条、解说、Console 输出与 §3 预期输出**逐条一致**
3. 单步/暂停/倍速/重播/进度条拖拽/进度点跳步全部可用，拖到任意位置两层（Lottie 与 DOM）状态一致
4. 活跃区域发光、其余降暗，肉眼可辨"现在执行到链路哪一步"
5. `node script/event-loop-trace-verify.mjs` 全绿（输出比对 + 不变量）
6. `pnpm build` 通过；生成 Lottie JSON 为纯 shape、体积 < 500KB/预设
