# 事件循环动画全屏体验设计方案

> **状态**：已确认，待编写实施计划
> **日期**：2026-09-06

## 目标

为事件循环 Lottie 动画增加沉浸式全屏体验。全屏范围仅包含动画舞台与播放控制栏，保留设计帧率与实时帧率信息，并在 Fullscreen API 不可用或被拒绝时降级为页面内沉浸模式。

## 已确认需求

- 全屏入口放在播放控制栏。
- 全屏范围为动画舞台 + 播放控制栏；标题栏和返回入口不进入全屏。
- 原有播放、暂停、单步、倍速、重播、进度拖拽、步骤跳转全部保留。
- 同时显示设计帧率和实时帧率，例如 `设计 60 FPS · 实时 59 FPS`。
- 设计帧率继续使用布局常量中的 `FPS = 60`，不改变 Lottie 动画帧配置。
- 支持按钮退出和 `Esc` 退出，状态以 `fullscreenchange` 与 `document.fullscreenElement` 为准。
- Fullscreen API 不可用或请求失败时，进入页面内沉浸模式并显示失败提示。

## 架构

`EventLoopStage` 持有全屏目标容器和模式状态；目标容器包住舞台与 `PlaybackControls`，标题栏位于其外部。原生全屏通过 `requestFullscreen()` / `exitFullscreen()` 实现，监听 `fullscreenchange` 同步真实浏览器状态。降级模式使用 CSS fixed 容器，不伪造原生全屏状态。

FPS 统计复用播放器的 `onEnterFrame` 事件：播放器继续更新动画帧和步骤，FPS 采样器记录帧事件时间戳，在约一秒滑动窗口中计算实时帧率；暂停或超过 500ms 没有新帧时显示 `实时 —`。设计帧率从 `compiler/layout.ts` 的 `FPS` 导出。

## 组件接口

`PlaybackControls` 增加以下回调和展示参数：

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

按钮文案：普通模式显示 `⛶ 全屏`；原生全屏显示 `⛶ 退出全屏`；降级模式显示 `⛶ 退出沉浸`。FPS 与错误提示位于控制栏附近。

## 全屏与降级流程

1. 点击全屏按钮，优先调用目标元素的 `requestFullscreen()`。
2. `fullscreenchange` 读取 `document.fullscreenElement`，成功后设置原生全屏状态并清理降级状态。
3. 点击退出或按 `Esc` 后，由同一监听器恢复普通模式。
4. API 缺失、抛错或 Promise reject 时设置沉浸模式和提示 `浏览器未允许进入全屏，已切换为沉浸模式`。
5. 沉浸模式使用 `position: fixed; inset: 0; z-index`，舞台填充视口，控制栏固定在底部。
6. 退出沉浸模式恢复普通布局；再次点击可重新尝试原生全屏。
7. 组件卸载时移除监听和 FPS 采样状态。

## 布局与同步

保持舞台逻辑坐标 `1200×800`、`FPS=60` 与 `FRAMES_PER_STEP=30` 不变。现有 `ResizeObserver` 继续按目标容器尺寸计算等比缩放，Lottie 层与 DOM overlay 共享坐标源，保证普通、原生全屏和沉浸模式下对齐。

## 验收标准

- 普通和全屏模式均显示设计帧率 `60 FPS`。
- 播放时实时 FPS 更新，暂停超过约 500ms 后显示 `实时 —`。
- 原生全屏只包含舞台和控制栏，标题栏不出现。
- `Esc` 和退出按钮均能恢复普通模式。
- Fullscreen API 失败时进入沉浸模式并提示，所有播放控件仍可用。
- Lottie 与 DOM overlay 在窗口变化、全屏进入和退出后保持对齐。
- 三套预设的总帧数、输出顺序和原有事件循环行为不变。
