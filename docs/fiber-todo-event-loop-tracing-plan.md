# Fiber Todo 事件循环诊断实施方案

## 目标

在已有 Fiber Todo CRUD、React Profiler、FLIP、MutationObserver 和帧统计之上，记录一次完整操作在浏览器事件循环中的位置：用户输入、Task/宏任务、React render/commit、微任务、真实 DOM mutation、rAF/动画帧、Long Task 以及 heap 使用变化。

本方案不读取 React 私有 Fiber 字段，也不把页面 heap 差值伪装成逐行精确内存分配。精确 allocation stack 由 Chrome DevTools Allocation instrumentation、Heap Snapshot 或 CDP HeapProfiler 完成。

## 事件模型

每个操作生成唯一 `operationId`，事件包含：

- `phase`：input、task、microtask、react-render、react-commit、dom-mutation、raf、animation、long-task、heap；
- `queue`：user-interaction、scheduler、timer、microtask、rendering、unknown；
- `startTime`、`endTime`、`duration`；
- 稳定源码标签（文件、函数、可选行列号）；
- 轻量 detail，不保留 DOM 节点、完整文本或 Error 对象。

## 一次操作的事件循环链路

```text
主线程
  Task(user-interaction): click / input
    ├─ CRUD handler（同步 JS）
    ├─ 创建 Todo 数据、setState
    └─ React 更新调度

  React scheduler
    ├─ render / reconciliation
    └─ commit
        ├─ DOM mutation
        └─ layout effect / Flip 启动

  Microtask checkpoint
    ├─ Promise / queueMicrotask
    └─ MutationObserver callback

  Rendering opportunity
    ├─ requestAnimationFrame / GSAP tick
    ├─ style recalculation / layout
    └─ paint / composite

  后续 Task
    └─ transitionend、timer 或其它用户事件
```

实际浏览器可能把 React render/commit 放在 click Task 内，也可能通过 Scheduler 放入后续 Task；诊断必须依据时间戳记录，不能预设二者必然同一 Task。

## Long Task 归因

Long Task 只证明主线程在某个 `[startTime, endTime]` 区间持续超过阈值。页面通过时间区间与 operation trace 关联，并将结果表述为 `overlap`（时间重叠），而不是唯一根因。

展示格式：

```text
Long Task #1  1000.22–1058.92 ms  duration 58.70 ms
queue: user-interaction
operation: todo:create:42

overlap:
  handler          TodoList.tsx:86       3.22 ms
  React render     TodoList.tsx:53       8.60 ms
  React commit                          2.10 ms
  animation setup  TodoItem.tsx:112      5.70 ms
  unattributed                         39.08 ms
```

未被埋点覆盖的时间必须标记为 `unattributed`，不能强行归给 TodoItem 或 GSAP。

## 内存归因

页面实时层记录：

- 操作前 `heapUsed`；
- 动画期间峰值；
- 操作后 `heapUsed`；
- `heapUsedDelta = after - before`；
- 是否支持 `performance.memory`。

`heapUsedDelta` 不是精确分配量，因为期间可能发生 GC、其它组件分配、资源加载和延迟回收。

开发定位步骤：

1. Chrome DevTools → Memory；
2. 使用 Allocation instrumentation on timeline 或 Allocation sampling；
3. 录制 `stress +100`、删除、连续新增；
4. 比较操作前、操作后和 GC 后 Heap Snapshot；
5. 查看 Constructor、Shallow Size、Retained Size、Retainers、Allocation stack；
6. 通过 source map 还原到 TodoList/TodoItem/动画 hook 的 TSX 行号。

## 源码映射策略

业务入口使用稳定源码标签和 User Timing：

```text
performance.mark(todo:<operationId>:start)
performance.mark(todo:<operationId>:state-update)
performance.mark(todo:<operationId>:animation-start)
performance.measure(todo:<operationId>:handler, ...)
```

React Profiler 提供组件级 render/commit 时序；MutationObserver 证明真实 DOM 变化；Long Task Observer 提供主线程阻塞区间；rAF/GSAP 采样提供帧耗时。source map 只能还原已采集的 JS 调用栈，不能凭空为 Long Task 生成调用栈。

## 实施顺序

1. 页面实时 trace：operationId、Task、microtask、rAF、Profiler、DOM mutation、Long Task、heap；
2. Chrome DevTools 手工验证：Performance Main/Memory/Event Log/Bottom-Up/Call Tree 与 Memory allocation；
3. 后续独立任务再考虑 CDP tracing/HeapProfiler 自动化，本阶段不混入。

## 验收

- add/remove/toggle/edit/filter/shuffle/sort/stress 均生成独立 operationId；
- 事件按时间轴展示并按队列泳道分类；
- Long Task 展示完整区间、最长时长、重叠阶段和未归因时间；
- heap 不支持时显示降级状态；
- StrictMode、快速连续操作和卸载均不会留下重复 observer、RAF 或 ticker；
- `pnpm build` 与项目 lint 通过；
- DevTools 可用 source map 和 allocation stack 将高增长对象定位回源码。
