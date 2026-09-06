# 事件循环动画全屏体验实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为事件循环 Lottie 动画增加“舞台 + 播放控制栏”全屏体验，同时保留设计帧率 60 FPS、显示实时 FPS，并在原生全屏失败时降级为页面内沉浸模式。

**Architecture:** `EventLoopStage` 持有一个只包裹舞台和控制栏的全屏目标元素，使用 `fullscreenchange` 将浏览器真实状态同步到 React；标题栏和返回按钮置于目标元素外。播放器继续通过 `onEnterFrame` 驱动步骤，同时将帧事件交给独立的实时 FPS 采样 hook；Fullscreen API 失败时由同一容器切换 fixed 沉浸样式，不伪造原生全屏状态。

**Tech Stack:** React 18, TypeScript 5.5, Vite 5, lottie-react 2.4, CSS Modules, 浏览器 Fullscreen API, Playwright Python, Biome。

---

## 文件结构与职责

- Create: `src/components/event-loop/useRealtimeFps.ts` — 基于帧事件时间戳计算实时 FPS，处理暂停超时。
- Modify: `src/components/event-loop/useEventLoopPlayer.ts` — 暴露帧事件时间戳/采样入口，同时保持现有帧和步骤行为不变。
- Modify: `src/components/event-loop/PlaybackControls.tsx` — 增加全屏按钮、FPS 展示和降级提示的展示接口。
- Modify: `src/components/event-loop/EventLoopStage.tsx` — 管理全屏目标、原生全屏同步、沉浸降级、FPS 采样和目标容器布局。
- Modify: `src/components/event-loop/event-loop.module.css` — 增加全屏目标、沉浸模式、FPS 信息和提示样式。
- Modify: `script/event-loop-accept.py` — 将全屏/退出/沉浸模式纳入端到端验收；脚本保持可在服务器管理器下执行。
- Modify: `script/README.md` — 补充全屏验收覆盖范围与浏览器限制说明。

---

### Task 1: 实时 FPS 采样 hook

**Files:**
- Create: `src/components/event-loop/useRealtimeFps.ts`
- Modify: `src/components/event-loop/useEventLoopPlayer.ts`
- Test: `script/event-loop-fps-probe.mjs`

- [ ] **Step 1: 定义采样接口和行为**

创建 `useRealtimeFps`，接口固定为：

```ts
interface RealtimeFps {
  fps: number | null;
  sample: (timestamp?: number) => void;
  reset: () => void;
}

export function useRealtimeFps(): RealtimeFps;
```

实现约束：保留最近 1000ms 的时间戳；少于 2 个时间戳返回 `null`；每次采样清理窗口外数据；如果当前时间距最近帧超过 500ms，返回 `null`；FPS 取窗口内帧数除以首尾时间跨度（跨度为 0 时返回 `null`），结果四舍五入且不小于 0。

- [ ] **Step 2: 让播放器转发帧事件时间戳**

在 `useEventLoopPlayer` 的 `handleEnterFrame` 中保留 `currentTime` 更新逻辑，并新增可选的帧回调参数：

```ts
export function useEventLoopPlayer(
  preset: Preset,
  compiled: CompiledAnimation,
  onFrame?: (timestamp: number) => void,
) {
  // ...
  const handleEnterFrame = useCallback((e: unknown) => {
    const currentTime = (e as { currentTime?: number } | null | undefined)?.currentTime;
    if (typeof currentTime === 'number') {
      setFrame(currentTime);
      onFrame?.(performance.now());
    }
  }, [onFrame]);
}
```

若为避免回调依赖导致事件处理器重建，使用 `useRef` 保存最新回调，但必须保持上述外部行为和 `EventLoopPlayer` 返回类型兼容。

- [ ] **Step 3: 编写 Node 行为探针**

创建 `script/event-loop-fps-probe.mjs`，用固定时间戳调用等价采样逻辑，覆盖：1 秒约 60 帧返回接近 60；单帧返回 `null`；超过 500ms 无帧返回 `null`；时间窗口只保留最近 1 秒。该脚本输出每项结果并以非零退出码表示失败。

- [ ] **Step 4: 运行 FPS 探针并提交**

Run: `node script/event-loop-fps-probe.mjs`
Expected: 所有项目输出 `✅`，退出码 0。

```bash
git add src/components/event-loop/useRealtimeFps.ts src/components/event-loop/useEventLoopPlayer.ts script/event-loop-fps-probe.mjs
git commit -m "feat: 增加事件循环实时 FPS 采样"
```

---

### Task 2: 播放控制栏增加 FPS 与全屏入口

**Files:**
- Modify: `src/components/event-loop/PlaybackControls.tsx`
- Modify: `src/components/event-loop/event-loop.module.css`

- [ ] **Step 1: 扩展 Props**

将控制栏 props 扩展为：

```ts
interface PlaybackControlsProps {
  player: EventLoopPlayer;
  frameMap: number[];
  onFullscreen: () => void;
  isFullscreen: boolean;
  isImmersive: boolean;
  designFps: number;
  realtimeFps: number | null;
  fullscreenError: string | null;
}
```

- [ ] **Step 2: 添加按钮和状态文案**

保留全部既有按钮，并在控制栏末尾增加：

```tsx
<button type="button" className={styles.btn} onClick={onFullscreen}>
  {isFullscreen ? '⛶ 退出全屏' : isImmersive ? '⛶ 退出沉浸' : '⛶ 全屏'}
</button>
<div className={styles.fpsInfo} aria-label="帧率信息">
  设计 {designFps} FPS · 实时 {realtimeFps === null ? '—' : `${realtimeFps} FPS`}
</div>
{fullscreenError && <div className={styles.fullscreenNotice} role="status">{fullscreenError}</div>}
```

当 `isImmersive` 为 true 时按钮退出沉浸模式；当原生全屏为 true 时按钮请求退出原生全屏。

- [ ] **Step 3: 增加可见样式**

在 CSS Module 中加入 `.fpsInfo`、`.fullscreenNotice` 样式；控制栏在全屏目标中应能换行，FPS 信息不得被 slider 挤出视口；提示使用低干扰但清晰的颜色。

- [ ] **Step 4: 类型与静态检查**

Run: `pnpm exec tsc -b`
Expected: 无 TypeScript 错误；此时 `EventLoopStage` 尚未传入新 props 可能暂时需要在同一任务末尾完成调用方适配，不允许留下未编译状态。

```bash
git add src/components/event-loop/PlaybackControls.tsx src/components/event-loop/event-loop.module.css
git commit -m "feat: 控制栏展示 FPS 与全屏入口"
```

---

### Task 3: 原生全屏同步与沉浸降级

**Files:**
- Modify: `src/components/event-loop/EventLoopStage.tsx`
- Modify: `src/components/event-loop/event-loop.module.css`

- [ ] **Step 1: 建立全屏目标 DOM 边界**

把现有舞台和 `PlaybackControls` 放入同一个 `fullscreenTargetRef` 容器；标题栏保持在容器外：

```tsx
<div className={styles.page}>
  <header className={styles.header}>...</header>
  <div
    ref={fullscreenTargetRef}
    className={`${styles.experience} ${isImmersive ? styles.immersive : ''}`}
  >
    <div ref={wrapRef} className={styles.stageWrap}>...</div>
    <PlaybackControls ... />
  </div>
</div>
```

- [ ] **Step 2: 实现真实全屏状态同步**

在 `EventLoopStage` 中维护 `isFullscreen`、`isImmersive`、`fullscreenError`。挂载时监听 `document.fullscreenchange`，以 `document.fullscreenElement === fullscreenTargetRef.current` 更新原生全屏状态；若原生全屏成立，清除沉浸状态和错误提示。卸载时移除监听。

- [ ] **Step 3: 实现进入、退出和 Esc 行为**

实现 `handleFullscreen`：

```ts
const handleFullscreen = async () => {
  const target = fullscreenTargetRef.current;
  if (!target) return;
  if (isImmersive) {
    setIsImmersive(false);
    setFullscreenError(null);
    return;
  }
  if (document.fullscreenElement === target) {
    await document.exitFullscreen();
    return;
  }
  if (!target.requestFullscreen) {
    setIsImmersive(true);
    setFullscreenError('浏览器未允许进入全屏，已切换为沉浸模式');
    return;
  }
  try {
    await target.requestFullscreen();
  } catch {
    setIsImmersive(true);
    setFullscreenError('浏览器未允许进入全屏，已切换为沉浸模式');
  }
};
```

处理 `fullscreenchange` 时，如果浏览器退出全屏且此前不是沉浸模式，恢复普通模式；不要在 `Esc` 退出后误进入沉浸模式。

- [ ] **Step 4: 实现全屏/沉浸 CSS**

新增 `.experience`、`.experience:fullscreen`、`.immersive` 及相关舞台布局规则：原生全屏和沉浸模式使用页面背景、填满视口、控制栏位于底部；`stageWrap` 在可用空间内继续保持 `3 / 2` 比例；Lottie 与 overlay 仍共用 `STAGE` 缩放逻辑。使用 `:fullscreen` 而非只依赖 React class，确保浏览器原生状态样式正确。

- [ ] **Step 5: 接入 FPS 采样和设计帧率**

从 `./compiler/layout` 导入 `FPS`；创建 `useRealtimeFps` 实例；播放器初始化时将 `fps.sample` 作为帧事件回调，向 `PlaybackControls` 传入 `designFps={FPS}` 与 `realtimeFps={fps.fps}`。切换 preset 或组件卸载时执行 `fps.reset()`，避免旧动画帧污染新预设。

- [ ] **Step 6: 构建验证并提交**

Run:

```bash
pnpm lint && pnpm build
```

Expected: Biome 无 error；TypeScript 和 Vite build 成功。

```bash
git add src/components/event-loop/EventLoopStage.tsx src/components/event-loop/event-loop.module.css
git commit -m "feat: 增加事件循环舞台全屏与沉浸降级"
```

---

### Task 4: 浏览器验收与脚本文档

**Files:**
- Modify: `script/event-loop-accept.py`
- Modify: `script/README.md`

- [ ] **Step 1: 扩展 Playwright 验收**

在进入 basic 预设后增加以下断言：

```python
assert '设计 60 FPS' in page.locator('body').inner_text()
assert '实时' in page.locator('body').inner_text()

fullscreen_button = page.locator('button', has_text='⛶ 全屏').first
assert fullscreen_button.count() == 1
fullscreen_button.click()
page.wait_for_timeout(300)
assert page.locator('button', has_text='⛶ 退出全屏').count() == 1 or \
       page.locator('button', has_text='⛶ 退出沉浸').count() == 1
assert page.locator('text=调用栈').count() >= 1
assert page.locator('text=设计 60 FPS').count() >= 1
```

优先在 Chromium 中验证原生全屏；headless 环境若拒绝权限，允许断言进入 `⛶ 退出沉浸`，但必须保持舞台、控制栏和 FPS 可见。点击当前状态按钮后断言回到 `⛶ 全屏`，再继续原有三预设验收。不要依赖系统权限或固定 `document.fullscreenElement`，以可观察 UI 状态作为跨环境断言。

- [ ] **Step 2: 增加 Esc 退出验收（支持时）**

若页面进入原生全屏，调用 `page.keyboard.press('Escape')`，轮询按钮恢复 `⛶ 全屏`；若浏览器进入沉浸降级，则点击 `⛶ 退出沉浸`，同样轮询恢复 `⛶ 全屏`。原有 9 项验收保持不变。

- [ ] **Step 3: 更新脚本说明**

在 `script/README.md` 的事件循环表格中注明 `event-loop-accept.py` 同时覆盖全屏按钮、FPS 信息、原生全屏退出和沉浸降级；注明 `event-loop-fps-probe.mjs` 的采样行为。

- [ ] **Step 4: 运行最终验收**

Run:

```bash
node script/event-loop-trace-verify.mjs --strict
python3 /Users/zhuwenlong/.claude/skills/webapp-testing/scripts/with_server.py \
  --server "pnpm dev" --port 5173 \
  -- python3.11 script/event-loop-accept.py
pnpm lint && pnpm build
```

Expected：Node 三预设全绿；Playwright 原有 9 项与全屏/FPS 新断言全绿；lint 与 build 成功。

- [ ] **Step 5: 提交验收资产**

```bash
git add script/event-loop-accept.py script/event-loop-fps-probe.mjs script/README.md
git commit -m "test: 验收事件循环全屏与 FPS 体验"
```

---

## 计划自审记录

1. **Spec 覆盖**：全屏入口/范围由 Task 2-3 覆盖；FPS 设计值与实时值由 Task 1-3 覆盖；`fullscreenchange`、按钮退出、Esc 由 Task 3-4 覆盖；API 失败与 fixed 沉浸降级由 Task 3-4 覆盖；窗口缩放和 Lottie/DOM 对齐由 Task 3 覆盖；脚本说明由 Task 4 覆盖。
2. **占位符扫描**：无 TBD/TODO 或未定义的实现目标；每个任务均列出具体文件、接口、命令和预期结果。
3. **类型一致性**：`useRealtimeFps` 的 `fps/sample/reset` 接口与 Task 3 的调用一致；`PlaybackControls` 新 props 与 Task 3 传入字段一致；`FPS` 从 `compiler/layout.ts` 导入，避免重复常量。
4. **边界说明**：原生全屏状态始终由 `document.fullscreenElement` 判断；headless 浏览器拒绝全屏时以沉浸 UI 作为可观察替代；实时 FPS 不参与动画帧推进，不改变 60 FPS 配置和现有 trace。
