# React Fiber Todo 动画演示页 — 设计文档

- 日期：2026-09-04
- 状态：已与需求方对齐通过
- 主题：Todo 增删改查 → Fiber diff → 真实 DOM 动画 → 全链路性能监控

## 1. 背景与目标

本项目（gasp-react）是 React 18 + Vite + TS 的动画演示站，已具备 CSS3 / GSAP / Lottie 三类动画能力与 `FPSPanel` / `WebVitalsPanel` / `usePerformanceMonitor` 性能基建，目前**没有路由系统**（页面切换为 `App.tsx` 内 `useState` + switch）。

本设计新增一个独立页面，演示：对 Todo List 做增删改查时，React Fiber 的 `render → reconcile(diff) → commit` 产生的**真实 DOM 变化**（插入/移除/移动/文本更新）以 GSAP FLIP 动画如实呈现，并对动画全过程做全链路性能监控。

核心原则：**动画不是装饰，是 Fiber commit 结果的可视化**——每个动画都能在 MutationObserver 的真实 DOM 变更统计里找到对应。

## 2. 已确认的关键决策

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| 1 | 动画形态 | 真实动画 + diff 面板 | FLIP 动画严格跟随真实 DOM 变化，侧栏展示 commit 统计；不做 Fiber 树图形化（out of scope） |
| 2 | 动画引擎 | GSAP 全权负责 | Flip 插件（随 gsap 3.12 附带）+ timeline；单引擎归因简单，与项目主题一致 |
| 3 | 监控颗粒度 | 全链路管线视图 | 触发→render→commit→DOM 变更→动画帧，整条链路耗时串联展示 |
| 4 | 路由方案 | 跟随现有 switch 模式 | 零新依赖，与现有 9 个页面一致；后续需要真 URL 再统一切 router |
| 5 | FLIP 绑定方式 | Flip 插件快照编排 | `Flip.getState`/`Flip.from` + MutationObserver 证据链；边界 case 成熟 |

## 3. 架构设计

### 3.1 入口

- `AnimationType`（`src/App.tsx`）新增 `'fiber-todo'`，switch 增加 case 渲染 `<FiberTodoPage />`
- `MenuPage` 新增卡片：🧬 "Fiber Todo"，描述"React Fiber 增删改查 · 真实 DOM 动画 · 全链路性能"
- `src/utils/gsap.ts` 补充注册：`gsap.registerPlugin(Flip)` 并导出 `Flip`

### 3.2 页面布局

```
┌────────────────────────────┬──────────────────┐
│  Todo 操作区（约 60%）      │ Fiber Diff 面板   │
│  - 输入框 + 添加按钮        │ （本次操作统计）    │
│  - 筛选输入 / 状态筛选       ├──────────────────┤
│  - 排序（正序/倒序/洗牌）    │ 渲染管线面板       │
│  - 压力测试（一键 +100）     │ （全链路耗时）     │
│  - key 模式开关 id/index    │                  │
│  - Todo 列表（Flip 动画）   │                  │
└────────────────────────────┴──────────────────┘
  全局 FPSPanel / WebVitalsPanel 悬浮（App.tsx 已有，不动）
```

窄屏（<1024px）纵向堆叠：操作区在上，两面板在下。

### 3.3 组件结构（新目录 `src/components/fiber-todo/`）

| 文件 | 职责 |
|---|---|
| `FiberTodoPage.tsx` | 页面容器：todos 状态、CRUD 操作、布局 |
| `TodoList.tsx` | Flip 编排层，内包 React `<Profiler>`；应用 key 模式 |
| `TodoItem.tsx` | 单项视图（勾选、文本、编辑、删除按钮）；动画全部由 Flip 层驱动，不自管 |
| `FiberDiffPanel.tsx` | 展示单次操作统计：MutationObserver 真实变更 vs Flip 动画数对照 |
| `RenderPipelinePanel.tsx` | 展示单次操作流水线：各阶段耗时 + 动画帧统计 |
| `useFlipList.ts` | Flip 快照/回放封装、exiting 延迟卸载状态机 |
| `useDomMutationStats.ts` | MutationObserver 按操作窗口聚合 |
| `useFrameStats.ts` | gsap.ticker 单帧耗时采样（动画窗口内） |
| `*.module.css` | 样式，跟随项目现有 CSS Module 模式 |

## 4. 数据流与核心机制

### 4.1 一次操作的闭环

```
用户操作(t0，Flip.getState 拍快照，开统计窗口)
→ setTodos → React render/reconcile（Profiler.onRender 计 actualDuration）
→ commit：真实 DOM 变化（MutationObserver 计数入窗口）
→ useLayoutEffect：Flip.from(快照) 驱动入场/位移/高亮；exiting 项离场
→ gsap.ticker 逐帧采样（动画窗口内）
→ 离场动画 onComplete → 清理 commit（真正移除 exiting 项，计入同一窗口）
→ 关窗（onComplete 后 +2 帧宽限；兜底超时 2s，覆盖离场动画 300ms + 清理 commit）
→ 汇总为一条流水线记录 → 两个面板展示
```

### 4.2 操作与动画对应关系

| 操作 | 真实 DOM 变化 | 动画 |
|---|---|---|
| add | insert 1 节点（其余节点位移） | 新项入场（透明度/缩放/y 位移）+ 其余项 FLIP 位移 |
| remove | （延迟）remove 1 节点 | exiting 项淡出+缩小 → 完成后真正删除；其余项 FLIP 补位 |
| update（勾选/改文本） | text/attr 变更 | 该项高亮闪烁（gsap timeline） |
| 查：筛选 | 多节点进出 | 隐藏项走离场坍缩；恢复项清除坍缩内联样式后展开入场（clearProps + from 动画）+ FLIP 位移 |
| 查：排序/洗牌 | 节点 reorder（id-key）或文本原地变（index-key） | FLIP 位移 或 无位移+高亮（如实反映） |

### 4.3 离场状态机

```ts
interface Todo { id: string; text: string; done: boolean; exiting?: boolean }
```

- `remove(id)`：将目标项标记 `exiting: true`（仍渲染，保持 DOM 存在）→ Flip 层对 exiting 项执行离场动画 → `onComplete` 回调里真正从 state 过滤删除 → 清理 commit 移除 DOM（MutationObserver 计入同一操作窗口）
- 动画进行中再次操作：`Flip.from` 自动 kill 上一轮动画（Flip 内建中断处理），无冲突

### 4.4 key 策略演示（教学核心）

TodoList 提供 `keyMode: 'id' | 'index'` 开关（切换本身是配置变更而非 CRUD 操作：不计统计、不播动画，key 变化导致的整列表重挂载瞬时完成；对照实验在切换后的 shuffle 中呈现）：

- **id-key**：洗牌时 Fiber 复用节点、真实 DOM 发生移动 → FLIP 平滑位移，diff 面板显示 `moved=N, textUpdates=0`
- **index-key**：洗牌时 Fiber 按位置复用、DOM 节点不移动只有文本变 → 无位移动画、内容高亮，diff 面板显示 `moved=0, textUpdates=N`

两种模式的数字对照即"虚拟 DOM 真实变化"的直接证据。

## 5. 性能指标定义

| 指标 | 采集方式 | 展示 |
|---|---|---|
| Render/Reconcile 耗时 | `<Profiler onRender>` 的 `actualDuration` | ms |
| Commit 真实 DOM 变更 | MutationObserver（childList+subtree+characterData+attributes，监听列表容器） | +added / -removed / text / attr 计数 |
| 动画帧 | gsap.ticker 帧间隔采样（动画窗口内） | min/avg/max 帧 ms + 掉帧数（>32ms 计一次） |
| 动画数（Flip 侧） | Flip.from 回调统计 | entered / exited / moved / updated |
| FPS | 现有 FPSPanel（全局，不动） | 已有 |
| Web Vitals / Long Task / 内存 | 现有 WebVitalsPanel + usePerformanceMonitor（全局，不动） | 已有；`performance.memory` 仅 Chromium，缺失时该项隐藏 |

面板保留最近 20 条操作记录，防止内存膨胀。

## 6. 边界与错误处理

- **StrictMode 双调用**：MutationObserver 统计按"操作窗口"聚合而非按 render，开发环境双渲染不会重复计数（第二次渲染无 DOM 变化时窗口内自然为 0）
- **动画中再操作**：Flip 内建中断处理，自动 kill 上一轮；统计窗口重开，旧窗口超时强制关闭并出数
- **压力测试**：一键 +100 条（随机文本），为 LongTask/掉帧监控提供极端素材；列表虚拟化不做（out of scope）
- **MutationObserver 兼容**：不支持时（极老浏览器）面板显示"不支持"，动画不受影响
- **窗口兜底**：任何操作窗口 2s 内未正常关闭则超时出数，避免统计悬挂（正常路径约 350–450ms：动画 ≤400ms + 清理 commit + 2 帧宽限）

## 7. 验收标准

1. `pnpm build`（tsc -b && vite build）通过
2. `pnpm lint`（biome check）通过
3. 浏览器验收清单（逐项核对）：
   - add：新项入场动画，diff 面板 `added +1`，moved 与实际位移一致
   - remove：离场动画，完成后 `removed +1`
   - update（勾选/编辑）：高亮闪烁，`text/attr +1`
   - 筛选：批量进出场动画，计数对得上
   - id-key 洗牌：位移动画，`moved=N, textUpdates=0`；index-key 洗牌：无位移，`moved=0, textUpdates=N`
   - 压力 +100：页面不崩，掉帧/LongTask 面板有数据
   - 动画数与真实 DOM 变更数一致（diff 面板对照标记 ✓）
4. 菜单入口正常进入/返回

## 8. 不做什么（Out of Scope）

- Fiber 树图形化可视化（节点关系图）
- 引入 react-router-dom 或自建 hash 路由
- 引入单元测试框架（项目现状零测试，验收以构建+lint+浏览器核对为准）
- 长列表虚拟化
- Socket.IO / 服务端联动
