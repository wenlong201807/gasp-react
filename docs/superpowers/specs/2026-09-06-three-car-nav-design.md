# three-car-nav 设计文档（Design Spec）

- 日期：2026-09-06
- 状态：已确认（用户逐项批准）
- 分支：feat/three-car
- 分工：主 agent 负责方案设计与验证脚本设计；免费子 agent 负责文档编写、脚本把控与验收、业务代码实现

## 1. 总览

一个 Three.js 智能驾驶展示页：SU7 在程序化生成的北京朝阳城市大道上自动巡航，车顶正上方悬浮一块 3D 全息 HUD 大屏（CanvasTexture 驱动），显示时速、360° 环绕小车、车道级导航、雷达感知圈、路名指引与仪表盘杂项。追尾跟随视角为默认，控制面板可调速度/视角/日夜。

已确认决策：追尾视角（可切换 driver/side）｜程序化城市大道｜HUD 六块内容全要｜自动巡航+控制面板｜默认黄昏（dusk）｜3D 悬浮全息屏架构（CanvasTexture + WebGLRenderTarget）。

## 2. 依赖与集成

- 新增依赖：three + @types/three（唯一新增，不用 react-three-fiber）
- menu-entries.ts 的 AnimationId 增加 'three-car-nav'（图标 🚗，meta: Three.js）；App.tsx switch 增加分支
- 新目录 src/components/three-car-nav/，与现有 feature 目录平级，遵守 Biome 规范

## 3. 模块架构（engine 与 React 解耦）

目录结构与职责：

- index.ts：导出 ThreeCarNavPage
- ThreeCarNavPage.tsx：页面容器（canvas 挂载点 + 控制面板 + 加载/降级提示）
- HudControlPanel.tsx：DOM 控制面板（速度/暂停/视角/日夜）
- useThreeCarNav.ts：胶水 hook（engine 生命周期 + 状态绑定）
- types.ts：DrivingState / CameraMode / TimeOfDay 等类型契约
- engine/ThreeCarNavEngine.ts：门面（start/dispose/setSpeed/setCameraMode/setTimeOfDay/onStats）
- engine/RoadSystem.ts：路面/车道线/路灯/绿化带/路牌，路段循环回收
- engine/CitySystem.ts：InstancedMesh 楼群天际线 + 窗灯 + 地标剪影
- engine/CarSystem.ts：SU7 CDN 加载/克隆 + fallback 低模车 + 车轮滚动
- engine/TrafficSystem.ts：程序化车流（雷达目标数据源）
- engine/HudSystem.ts：离屏 canvas + CanvasTexture + RTT 360°小车 + 拖拽
- engine/CameraRig.ts：三视角状态机 + lerp 过渡
- engine/DayNightSystem.ts：dusk/day/night 三档灯光/雾/窗灯插值

各子系统对 engine 只暴露 update(dt, state) 与 dispose()。

## 4. 关键技术设计

- 世界模型 treadmill：车与 HUD 固定原点附近，路面/楼宇/车流向 +Z 滚动，出视野回收到前方；相机稳定无浮点漂移
- HUD 全息屏：离屏 canvas 2048×1024 每帧重绘 → CanvasTexture 贴圆角面板 + 发光描边；中央 360° 小车 = WebGLRenderTarget 子平面（SU7 缩小克隆 + 独立小相机，自动旋转 + 可拖拽）；雷达圈环绕中央 viewport 绘制波纹与目标点；左侧时速；右上路名+导航指引；右下车道级导航图；底部仪表盘杂项
- HUD 面板位姿随相机模式切换（chase: 车顶上方；driver: 前上方全息投影位；side: 侧向朝向相机）
- 车流与雷达联动：3-5 辆低模车，TrafficSystem 输出相对坐标 → 雷达圈目标点
- 日夜三档（默认 dusk）：单张 HDR + 灯光/雾/emissive 参数插值 1.5s
- SU7 加载：GLTFLoader + MeshoptDecoder + RGBELoader（CDN https://z2586300277.github.io/3d-file-server/），失败/15s 超时 → 程序化低模车 fallback，HUD 360° 同步用 fallback 克隆

## 5. 数据流

React 控制面板 → useThreeCarNav → engine.set*() → DrivingState（单一事实源）→ 每帧 update(dt) 驱动各子系统；onStats 节流 5Hz 回传 React。dev 模式挂 window.__threeCarNav = { getState() } 供 Playwright 断言。

## 6. 错误处理

WebGL 不可用 → 降级提示卡片；CDN 模型失败 → fallback 低模车；webglcontextlost → 暂停 + restored 恢复；卸载 → engine.dispose() 全量释放。

## 7. 性能预算

pixelRatio ≤ 2；楼群/路灯 InstancedMesh；draw call < 120；HUD 静态底图缓存仅脏区重绘；目标 60fps（低端 ≥ 30fps）。

## 8. 验证方案与验收清单

verify 脚本（scripts/verify-three-car-nav.sh）+ Playwright：
1. pnpm lint + pnpm build 通过
2. 菜单入口存在 → 点击切换 → canvas 出现且无 console error（容忍外部 CDN 网络错误）
3. 控制面板：加速 → speedKmh 上升；切视角 → cameraMode 变化；切日夜 → timeOfDay 变化（均经 __threeCarNav 断言）
4. 截图存证（dusk/day/night × chase/driver/side）+ FPS ≥ 30
5. 断网（route abort CDN）→ fallback 车仍渲染
6. acceptance 子 agent 对照本清单出 ✅/❌/⚠️ 判定表
