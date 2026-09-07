# 全屏入口收敛设计文档（Design Spec）

> **状态**：已实施（commit `feat(fullscreen): unified title-bar entry replacing per-page toggles`）
> **日期**：2026-09-07
> **分支**：feat/fullscreen（基线 feat/menu-hash `6fe925b`）

## 1. 目标与决策记录

把 event-loop 与 url-lifecycle 两页各自的全屏实现收敛为**顶部 title 栏（logo 旁）的全局全屏入口**，并删除两页旧入口。四项已拍板决策：

| 决策 | 内容 | 理由 |
| --- | --- | --- |
| 入口位置 | Layout title 栏 logo 旁，全站所有路由共用 | 单一入口天然全覆盖六个动画页，页面内不再重复造按钮；aria-label `进入全屏/退出全屏` 供测试与读屏 |
| 完全沉浸 | 全屏态隐藏 title 栏与 dock 菜单（条件渲染），留右下角半透明退出控件兜底，Esc 走浏览器原生退出 | 用户拍板；沉浸的本质是内容独占视口，title/dock 在全屏态是噪音 |
| 纯 Fullscreen API | 不做 CSS 伪全屏降级（旧实现的「沉浸模式」路径移除）；请求被拒/无手势时 UI 静默维持原状 | 伪全屏状态与 `fullscreenElement` 脱钩后无法与 Esc/系统手势互操作；`isFullscreen` 只由 `fullscreenchange` 驱动，不造假状态 |
| 收敛而非重写 | 公共逻辑抽为 `useFullscreen` hook，核心代码（fullscreenchange 同步、exit 判断、try/catch 静默）逐条来自两页旧实现 | 复用已验证的轮子，语义差异（目标元素、降级策略）显式记录于 hook 注释 |

## 2. Phase A 侦察结论（两旧实现画像）

`grep -rniE "fullscreen" src/ -l` 命中 5 个文件，恰好归属两个页面，无第三处：

### 旧实现 1：event-loop 页

- **逻辑**：`src/components/event-loop/EventLoopStage.tsx`（原 L40-95：`fullscreenTargetRef` + `isFullscreen`/`isImmersive`/`fullscreenError` 三态 + sync effect + `handleFullscreen`）
- **入口**：`PlaybackControls.tsx` 控制条文本按钮「⛶ 全屏 / ⛶ 退出全屏 / ⛶ 退出沉浸」（无 aria-label）
- **全屏目标**：页内 `.experience` 容器 div（元素级，非 documentElement）
- **vendor 前缀**：无显式处理，仅 `if (!target.requestFullscreen)` 特性检测（标准 API 已全覆盖现代浏览器）
- **降级**：API 缺失或 `requestFullscreen()` reject → `setIsImmersive(true)` 切「页面内沉浸模式」（CSS fixed 伪全屏）+ 黄色提示「浏览器未允许进入全屏，已切换为沉浸模式」
- **退出**：全屏态 `document.exitFullscreen()`；沉浸态退出沉浸；`fullscreenchange` 事件回同步状态
- **样式**：`event-loop.module.css` 原 `.experience:fullscreen,.immersive` / `.experience:fullscreen .stageWrap,.immersive .stageWrap` / `.fullscreenNotice`

### 旧实现 2：url-lifecycle 页

- **逻辑**：`src/components/url-lifecycle/UrlLifecyclePage.tsx`（原 L31-84），与实现 1 **逐字同构**（复制粘贴双胞胎），仅差异：按钮带 aria-label/title（`进入全屏/退出全屏/退出沉浸`）
- **特殊交互**：无 URL 输入联动——页内 URL 栏只是舞台展示元素，与全屏逻辑无关
- **样式**：`url-lifecycle.module.css` 原三个全屏规则块（多一条 `.controlsBar` 全屏覆盖）

## 3. 统一实现

### 3.1 `src/hooks/useFullscreen.ts`（新增）

```ts
useFullscreen(targetRef?: RefObject<Element | null>): {
  isFullscreen: boolean; supported: boolean; request: () => void; exit: () => void; toggle: () => void;
}
```

- 状态同步：`fullscreenchange` → `document.fullscreenElement === resolveTarget()`（复用旧实现的判定式）；Esc 原生退出、系统手势退出均经此恢复
- 静默降级：`requestFullscreen().catch(() => {})`——无手势/被拒不抛错、不切 UI
- **语义取舍**（注释锚点已写进 hook）：
  - 目标默认 `documentElement`：旧实现各自全屏页内 `.experience` 容器；统一入口在全局 title 栏，语义升级为「整个应用全屏」，沉浸由隐藏 title/dock 实现。可选 `targetRef` 参数保留元素级能力，未来需要无需改 hook
  - 不保留伪全屏降级：完全沉浸方案下旧「沉浸模式」路径移除
  - vendor 前缀：与旧实现一致，仅标准 API + 特性检测

### 3.2 落点

| 位置 | 职责 |
| --- | --- |
| `src/App.tsx` | `useFullscreen()` 单一状态源；全屏态不渲染 `MenuDock`（SW/toast、hash 路由逻辑零触碰） |
| `src/components/layout/Layout.tsx` | 常态：logo 旁玻璃拟态切换按钮（图标 ⤢/⤡ 随状态、aria-label 随状态、`fullscreen.supported` 为 false 时不渲染）；沉浸分支：不渲染 header/footer，渲染右下角 `fullscreenExit` 半透明退出控件（`aria-label="退出全屏"`），`main` 顶部留白归零 |
| `src/components/layout/Layout.module.css` | `.fullscreenToggle` / `.fullscreenExit` / `.layoutImmersive`（玻璃拟态沿用 `index.css` 的 `--color-*`/`--radius-*`/`--spacing-*` 变量） |

### 3.3 旧入口删除清单

| 文件 | 删除内容 | 保留内容 |
| --- | --- | --- |
| `EventLoopStage.tsx` | `fullscreenTargetRef`、`isFullscreen`/`isImmersive`/`fullscreenError` state、sync effect、`handleFullscreen`、`.experience` 的 ref 与 immersive 类 | 页头、舞台、ResizeObserver 缩放、Lottie 播放器全套 |
| `PlaybackControls.tsx` | `onFullscreen`/`isFullscreen`/`isImmersive`/`fullscreenError` props、全屏按钮、`fullscreenNotice` | 重播/播放/单步/倍速/进度/步骤跳转/FPS 信息全套 |
| `UrlLifecyclePage.tsx` | 同 EventLoopStage 的四组 + 控制条全屏按钮与 notice | 场景选择、舞台、播放控制条全套 |
| `event-loop.module.css` | `.experience:fullscreen,.immersive` 块、`.stageWrap` 全屏覆盖、`.fullscreenNotice` | `.experience { width: 100% }` 基础规则 |
| `url-lifecycle.module.css` | 同上三块 + `.controlsBar` 全屏覆盖 | `.experience` 基础规则（width/max-width） |

## 4. 验证方案（TC-15）

`script/three-car-nav/tests/tc15-fullscreen.mjs`（注册进 `run.mjs`，TC-01..15），七条通过标准与 headless 取舍详见 `cases.md` §TC-15 与测试索引。要点：

- **主路径真全屏**：本仓 headless Chrome 实测 Fullscreen API 可用（requestFullscreen resolve、`fullscreenElement=<html>`、事件触发），沉浸 DOM 断言全部走真全屏（evidence `mode: "native"`）
- **降级路径不造假**：环境受限时 stub `document.fullscreenElement` + 派发 `fullscreenchange`，只断言「事件 → 状态 → DOM」UI 链路并如实记 `mode: "stubbed"`
- **Esc 软证据**：headless 实测 Esc 不退出全屏（浏览器 UI 层快捷键缺失），`escEffective` 如实入 evidence 不作硬断言（与 TC-14 更新流同款纪律）；退出走角落退出控件断言
- **旧入口三重缺席**：`getByRole(name: '⛶ 全屏')` / `button:has-text("⛶")` / `button:has-text("全屏")` 全零 + title 栏新入口唯一 + 「⏮ 重播」控件仍在（非全屏功能一字不动的直接证据）
