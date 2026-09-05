# Fiber Todo DevTools 内存与 User Timing 深度诊断方案

## 目标与边界

现有 Fiber Todo 页面已经具备 operationId、事件循环事件、heap before/after/delta，并已通过 Chromium/CDP 基础验收。本阶段计划补齐可重复的 DevTools/CDP 深度诊断闭环与完整 User Timing measure。

页面 `performance.memory` 的 `heapUsedDelta` 只表示一个时间窗口内的 heap 使用变化，不能等同于精确对象分配。精确的 shallow size、retained size、retainers 和 allocation stack 必须来自 Chrome DevTools 或 CDP HeapProfiler。source map 只能还原实际存在的 JS 调用栈/采样节点，不能为 Long Task 凭空生成调用栈；不读取 React 私有 Fiber，也不在页面伪造逐行内存栈。

## 分层诊断模型

1. **页面实时层**：operationId、Task/microtask/rAF、Profiler、MutationObserver、Long Task overlap、heapUsedDelta。
2. **User Timing 层**：带 operationId 的 mark/measure，供 Performance 面板 Event Log 与时间线关联。
3. **DevTools/CDP 层**：Tracing、Allocation sampling、Heap Snapshot、Allocation instrumentation，提供对象图和分配调用栈。

三层使用同一个 operationId 和时间窗口，但不把不同层级的证据互相冒充。

## User Timing 约定

命名格式：

```text
mark:    todo:<operationId>:<phase>:start
mark:    todo:<operationId>:<phase>:end
measure: todo:<operationId>:<phase>
```

phase 至少覆盖：`handler`、`state-update`、`react-render`、`react-commit`、`dom-mutation`、`microtask`、`raf`、`animation`、`operation`。

每个 phase 必须：

- 使用同一 operationId；
- 记录 start/end 时间；
- 在 API 不存在、重复名称、操作被截断或回调迟到时安全降级；
- finish/截断/卸载时结束或清理当前操作，避免全局 User Timing 无限增长；
- 与页面事件记录保持同一时间语义。

## CDP 采集顺序

### 1. Performance 与 Tracing

启用 `Performance`，记录：

- `TaskDuration`
- `JSHeapUsedSize`
- `LayoutCount`
- `RecalcStyleCount`

启用 `Tracing.start`，类别包含 `devtools.timeline`、`blink.user_timing`、`v8.execute` 等；执行一次操作后 `Tracing.end`，保存 JSON。验证完整 phase measure 是否出现在 trace，并与页面事件时间戳重叠。

### 2. Allocation sampling

使用：

```text
HeapProfiler.enable
HeapProfiler.startSampling
执行 stress +100 / 连续新增 / 删除
HeapProfiler.stopSampling
```

记录 top nodes、脚本 URL、函数名、line/column、采样权重和 source-map 映射状态。采样结果是统计估计，不能替代完整快照。

### 3. Heap Snapshot

在稳定基线、操作后、允许时 GC 后分别执行 `HeapProfiler.takeHeapSnapshot`。保存快照并比较：

- Constructor / object count；
- Shallow Size：对象自身占用；
- Retained Size：对象被回收后可释放的保留对象图规模；
- Retainers：保持对象存活的引用路径；
- GC 前后差异。

需排除浏览器后台活动、第三方库、DevTools 自身和尚未完成动画造成的短暂引用。

### 4. Allocation instrumentation on timeline

使用 `HeapProfiler.startTrackingHeapObjects` / `stopTrackingHeapObjects` 作为 CDP 对应能力，按操作时间窗口记录新增对象和分配栈。若当前 Chromium/CDP 不支持该能力，输出明确的 unsupported 证据，不伪造成功。

## Source map 映射

分别在 Vite 开发模式和生产预览模式检查 source map。必要时仅为诊断构建启用可选 `build.sourcemap`，不改变默认生产安全策略。

优先验证：

- `src/components/fiber-todo/FiberTodoPage.tsx`
- `src/components/fiber-todo/TodoList.tsx`
- `src/components/fiber-todo/TodoItem.tsx`
- `src/components/fiber-todo/useEventLoopTrace.ts`

DevTools 中同时记录原始 bundle URL/函数名/line/column 和 source map 还原结果；对第三方、匿名或无 sourcemap 节点明确标注无法映射。

## 实施文件

- `src/components/fiber-todo/useEventLoopTrace.ts`：封装 mark/measure 生命周期。
- `src/components/fiber-todo/FiberTodoPage.tsx`：接入 handler、state、Profiler、动画和 finalize phase。
- `src/components/fiber-todo/TodoList.tsx`：透传公开 Profiler 字段。
- `src/components/fiber-todo/useDomMutationStats.ts`：标记 DOM mutation 时间区间。
- `src/components/fiber-todo/useFrameStats.ts`：标记 rAF/animation 时间区间。
- `src/components/fiber-todo/EventLoopTracePanel.tsx`：展示 measure 覆盖状态和边界说明。
- `src/components/fiber-todo/types.ts`：如需新增 User Timing 或诊断结果类型。
- `script/fiber-todo-cdp-diagnostics.*`：仅开发验收使用的 CDP 采集脚本，统一放在项目根目录 `script/`。
- `vite.config.ts`、`package.json`：仅在 source map 或脚本入口确有需要时调整。

## 操作验收矩阵

覆盖 `add`、`remove`、`toggle`、`edit`、`filter`、`shuffle`、`sort`、`stress +100` 和快速连续操作。每个场景验证：

- operationId 唯一且不串线；
- 页面事件与 User Timing measure 时间合理；
- 截断窗口不会遗留 observer、RAF、ticker 或开放 measure；
- Long Task 只显示 overlap 和 unattributed，不声明唯一根因；
- heapUsedDelta 与快照/采样结果分开解释；
- 至少一个业务 TSX 节点可以通过 source map 映射。

## 验证命令与产物

实现后运行：

```bash
pnpm lint
pnpm build
git diff --check
```

CDP 脚本输出：

- `trace-<timestamp>.json`
- `allocation-sampling-<timestamp>.json`
- `heap-before-<timestamp>.heapsnapshot`
- `heap-after-<timestamp>.heapsnapshot`
- `heap-after-gc-<timestamp>.heapsnapshot`（能力允许时）
- `allocation-instrumentation-<timestamp>.json` 或 unsupported 报告
- 一份汇总 Markdown/JSON，记录 Chromium 版本、CDP 方法、operationId、时间窗口、指标、映射结果和限制。

所有采集必须设置超时、输出上限和 finally cleanup，避免遗留浏览器或 WebSocket 会话。

## 明确不做

- 不依赖 React 私有 Fiber；
- 不把页面 heapUsedDelta 当作精确 allocation；
- 不在页面内伪造 shallow/retained/allocation stack；
- 不把 Long Task overlap 当作唯一根因；
- 不默认开启生产 source map；
- 不在未确认方案前修改业务代码或执行长时间内存采样。


## 实现状态

CDP 诊断脚本现在解析 Heap Snapshot meta，输出 object/constructor count 与 shallow size；retained size 明确为 unsupported，避免无依据推导。Allocation sampling 递归汇总完整调用树并保留原始 URL、函数名、行列号及 source-map 状态。Allocation instrumentation 记录 CDP 事件、结构化 supported/status/reason，并在 finally 中停止 sampling、tracking、Tracing 与移除监听器。页面面板继续展示实时 `performance.memory`，同时明确 CDP 结果需通过脚本 artifact 导入，实时 heap 不等同于 retained/allocation。
