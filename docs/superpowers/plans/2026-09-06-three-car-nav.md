# three-car-nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 three-car-nav 页面——SU7 在程序化北京朝阳大道上智驾巡航，车顶悬浮 3D 全息 HUD（时速/360°小车/车道导航/雷达圈/路名指引/仪表盘）。

**Architecture:** 原生 three.js（无 r3f）。treadmill 世界滚动（车与 HUD 固定原点，环境向 +Z 滚动回收）；engine/ 为纯 TS 类子系统，仅暴露 update(dt, state)/dispose()；React 层只做容器/控制面板/胶水。HUD = 离屏 2D canvas(2048×1024) → CanvasTexture 面板 + WebGLRenderTarget 子平面渲染 360° 小车。

**Tech Stack:** React 18 + TypeScript + Vite 5 + three（新增，含 @types/three）+ Biome。模型/HDR 来自 CDN https://z2586300277.github.io/3d-file-server/（su7/sm_car.gltf + /files/hdr/1k.hdr）。

**执行约定（每个任务的执行 agent 必须遵守）：**
- 分支 feat/three-car；开工前 `git branch --show-current` + `git log --oneline -1` 确认基线，异常即停并报告
- 只改本任务 Files 列出的文件；每步验证命令必须实际执行并把输出贴进报告
- commit 用 Conventional Commits，footer 加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；husky pre-commit 会跑 biome，commit 前先 `pnpm lint` 自检
- 通用验证基线：`pnpm lint && pnpm build` 必须零错误
- 本计划锁定契约/常量/算法/验收标准；实现代码风格由执行者按 Biome 与现有代码习惯落地

**世界坐标约定：** 车头朝 -Z；主车静止于原点（变道时 x 向车道中心 lerp）；chase 相机在 +Z 后方；环境物向 +Z 滚动。本向 3 车道中心 x = {-3.5, 0, +3.5}（lane 0/1/2），中央隔离绿化带 x∈[5.25, 8.75]，对向车道中心 x = {+10.5, +14, +17.5}（朝 +Z 行驶，rotation.y = π）。默认巡航 60km/h，scrollSpeed = kmh/3.6 (m/s)。

---

### Task 1: 依赖 + 类型契约 + 菜单注册 + 页面骨架

**Files:**
- Modify: package.json（pnpm add three @types/three --save / devDep types）
- Modify: src/components/menu/menu-entries.ts、src/App.tsx
- Create: src/components/three-car-nav/{index.ts,types.ts,ThreeCarNavPage.tsx,useThreeCarNav.ts,engine/ThreeCarNavEngine.ts}

- [x] Step 1: `pnpm add three && pnpm add -D @types/three`，确认 package.json 变更
- [x] Step 2: 写 types.ts（契约，全文如下，后续任务不得改名）:

```ts
export type CameraMode = 'chase' | 'driver' | 'side';
export type TimeOfDay = 'dusk' | 'day' | 'night';
export type Gear = 'D' | 'P';

export interface TrafficTarget {
  /** 相对主车，米；x 右正 z 后正 */
  relX: number;
  relZ: number;
}

export interface DrivingState {
  speedKmh: number;
  gear: Gear;
  cameraMode: CameraMode;
  timeOfDay: TimeOfDay;
  /** 累计里程，米 */
  distanceM: number;
  laneIndex: 0 | 1 | 2;
  laneChangeHint: 'left' | 'right' | null;
  trafficTargets: TrafficTarget[];
}

export interface EngineStats {
  fps: number;
  /** su7: loading → ready | fallback */
  modelStatus: 'loading' | 'ready' | 'fallback';
}

export interface EngineControls {
  setTargetSpeed(kmh: number): void;
  togglePause(): void;
  setCameraMode(mode: CameraMode): void;
  setTimeOfDay(t: TimeOfDay): void;
}
```

- [x] Step 3: menu-entries.ts：AnimationId 联合类型加 'three-car-nav'；MENU_ENTRIES 追加 `{ id: 'three-car-nav', name: 'Three Car Nav', icon: '🚗', desc: '智驾巡航 · SU7 · 3D 全息 HUD 导航', meta: 'Three.js' }`；App.tsx switch 加分支渲染 ThreeCarNavPage
- [x] Step 4: ThreeCarNavEngine.ts 骨架：constructor(container: HTMLElement) 创建 Scene/PerspectiveCamera(fov 60)/WebGLRenderer(antialias, alpha:false)、挂 canvas、start() 启动 RAF 主循环（当前只 render）、dispose() 取消 RAF + renderer.dispose() + 移除 canvas + 释放几何/材质；实现 EngineControls 四个方法（先只改内部 DrivingState 字段）；内部持有 state: DrivingState（speedKmh 60、gear 'D'、cameraMode 'chase'、timeOfDay 'dusk'、distanceM 0、laneIndex 1、laneChangeHint null、trafficTargets []）
- [x] Step 5: useThreeCarNav.ts：useRef 持 engine，useEffect 挂载 container → new + start，cleanup 调 dispose；返回 controls（透传四个方法）+ stats state（engine.onStats 节流 5Hz 回调 setState，本任务可先只有 fps 占位 0/modelStatus 'loading'）；ThreeCarNavPage.tsx：全尺寸容器 div + ref + 底部加载提示（modelStatus==='loading' 时显示「模型加载中…」）；index.ts 导出 ThreeCarNavPage
- [x] Step 6: 验证：`pnpm lint && pnpm build` 零错误；Playwright（webapp-testing）：dev server 打开 → dock 出现「Three Car Nav」→ 点击 → 页面出现 canvas 且 console 无 error → 切走再切回，无重复 canvas（dispose 生效）
- [x] Step 7: `git add -A && git commit -m "feat(three-car-nav): scaffold page, types contract, menu registration"`

### Task 2: RoadSystem 程序化道路

**Files:**
- Create: src/components/three-car-nav/engine/RoadSystem.ts
- Modify: src/components/three-car-nav/engine/ThreeCarNavEngine.ts（实例化并接入 update）

- [ ] Step 1: 常量（锁定）：LANE_W=3.5；SEG_LEN=60；SEG_COUNT=8（覆盖 z∈[-360, +120]）；RECYCLE_Z=+90（group.position.z 超过则 z -= SEG_LEN*SEG_COUNT）；路灯间距 30m 双侧交错；路牌每 240m
- [ ] Step 2: 每段 Group 含：沥青路面（深灰 #2b2d31，本向+对向整幅含隔离带宽度， PlaneGeometry 段）；车道线——本向车道间白虚线（宽 0.15m，3m 段/6m 空）、两侧边线白色实线、中央双黄实线；隔离绿化带（抬升 curb + 灌木 InstancedMesh，暗绿）；对向车道线对称
- [ ] Step 3: 路灯 InstancedMesh（杆+悬臂+自发光灯头，dusk/night 发光）双侧交错；悬臂路牌：CanvasTexture 绘制绿底白字「⇦ 朝阳北路 | 凯恒中心」样式牌面
- [ ] Step 4: update(dt, state)：按 scrollSpeed=state.speedKmh/3.6（gear==='P' 时 0）整体 +Z 平移并回收；dispose() 释放全部几何/材质/纹理
- [ ] Step 5: 验证：lint+build；Playwright 截图（应见向前延伸的多车道大马路、车道线、路灯、路牌），console 无 error
- [ ] Step 6: commit `feat(three-car-nav): procedural road system with lane markings, lamps, signs`

### Task 3: CitySystem 城市天际线

**Files:**
- Create: src/components/three-car-nav/engine/CitySystem.ts
- Modify: ThreeCarNavEngine.ts（接入）

- [ ] Step 1: 楼群 InstancedMesh（BoxGeometry 共享）：两侧各 3 排，高度 15–80m、宽 14–24m 用种子随机（mulberry32 或等价，种子写死保证可复现）；窗灯 = 共享 emissive 贴图（CanvasTexture 生成窗户网格），暴露 setWindowGlow(k: 0..1)
- [ ] Step 2: 地标剪影（固定远处不回收，材质接近背景色略深）：国贸三期（收分塔身简化堆叠 box）、CCTV 环（两个倾斜 box + 连接体），位于 -Z 远端两侧
- [ ] Step 3: 楼群 treadmill 回收（周期可与路面不同，逻辑同 RECYCLE 模式）；update(dt, state)、dispose()
- [ ] Step 4: 验证：lint+build；截图（道路两侧楼群天际线 + 远处地标剪影可见）
- [ ] Step 5: commit `feat(three-car-nav): instanced city skyline with window glow and landmarks`

### Task 4: CameraRig + DayNightSystem

**Files:**
- Create: engine/CameraRig.ts、engine/DayNightSystem.ts
- Modify: ThreeCarNavEngine.ts（接入；engine 持有唯一 state 并把 set* 方法接到 rig/daynight）

- [ ] Step 1: CameraRig 位姿（锁定，lerp 系数 1-exp(-4dt)）：chase pos(0,3.2,8.5)→lookAt(0,1.2,-6)；driver pos(-0.35,1.25,-0.3)→lookAt(-0.35,1.15,-10)；side pos(7.5,1.6,1.5)→lookAt(0,0.9,-1)。update(dt, state.cameraMode) 每帧插值 position + 用四元数/lookAt 目标点插值过渡
- [ ] Step 2: DayNightSystem 三档参数（锁定）：
  - dusk: bg/fog #2a2340（fog 60→420）、hemi 0.55(#ffd9a0/#3a3550)、dir 1.1 #ff9a5c pos(-40,50,20)、窗灯 0.55、路灯/车灯开
  - day: bg/fog #aac7e8、hemi 0.9(#ffffff/#8fa3bf)、dir 1.5 #fff4e0、窗灯 0、路灯/车灯关
  - night: bg/fog #0b1026（fog 40→300）、hemi 0.25(#4a5a8a/#111322)、dir 0.3 #8aa2ff、窗灯 1、路灯/车灯开
  - 切换 1.5s 全参数 lerp；联动 CitySystem.setWindowGlow 与 Task 5 车灯接口（先留接口调用，车灯在 Task 5 实现）
- [ ] Step 3: 验证：lint+build；Playwright 经 __threeCarNav.getState() 断言 setCameraMode/setTimeOfDay 生效；三档 × 三视角关键截图
- [ ] Step 4: commit `feat(three-car-nav): camera rig with 3 modes and day-night interpolation`

### Task 5: CarSystem（SU7 + fallback + 车轮 + 微动）

**Files:**
- Create: engine/CarSystem.ts、engine/fallbackCar.ts（buildFallbackCar(): THREE.Group，供主车/车流/HUD 复用）
- Modify: ThreeCarNavEngine.ts（接入 + modelStatus 上报 onStats）

- [ ] Step 1: buildFallbackCar()：低模车 Group（圆润车身 + 4 圆柱轮 + 前后发光灯带，参数化车身颜色），返回 { group, wheels: Mesh[] }
- [ ] Step 2: CarSystem：按参考方案加载——RGBELoader(CDN_BASE + 'files/hdr/1k.hdr') + PMREMGenerator 设 scene.environment；GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(CDN_BASE + 'models/su7/sm_car.gltf')；CDN_BASE='https://z2586300277.github.io/3d-file-server/'；onError 或 15s 超时 → buildFallbackCar() 替换并 modelStatus='fallback'；成功 → 包围盒归一化到车高 1.4m 落地 y=0、modelStatus='ready'；traverse 设 envMap 反射（参考用户提供的做法）
- [ ] Step 3: 提供 getHudClone()：主模型 ready 时 SkeletonUtils/clone 共享材质缩至 ~0.9 尺度，否则 fallback 克隆（供 Task 7b 使用）
- [ ] Step 4: 车轮滚动：traverse 名字匹配 /wheel|tyre|tire/i 的 Object3D 绕自身 x 轴按 -speed/wheelRadius*dt 旋转；车道保持微动：yaw sin(t*0.8)*0.007rad、横向 x 加 sin(t*0.5)*0.02m（叠加在车道中心上）；车灯（头灯光锥 SpotLight×2 或发光贴片 + 尾灯 emissive）暴露 setLights(on:boolean) 供 DayNight 联动
- [ ] Step 5: 验证：lint+build；截图（SU7 漆面有 HDR 反射）；Playwright route abort CDN 域名 → modelStatus==='fallback' 且场景仍渲染、console 仅容忍的网络错误
- [ ] Step 6: commit `feat(three-car-nav): SU7 loader with fallback car, wheels, subtle sway`

### Task 6: TrafficSystem 车流

**Files:**
- Create: engine/TrafficSystem.ts
- Modify: ThreeCarNavEngine.ts（接入，把 targets 写入 state.trafficTargets）

- [ ] Step 1: 5 辆车（buildFallbackCar 克隆 + 随机深色系）：同向 3 辆（lane 0/1/2，速度 40–70km/h）、对向 2 辆（速度 50–80km/h，朝 +Z）；同车道最小间距 25m 生成
- [ ] Step 2: 运动（锁定公式）：treadmill 下世界 z 每帧增量 = (scroll - 自身速度_m/s)*dt（同向；对向为 (scroll + 自身速度)*dt）；|z|>150m 时重新安置到 -140m 外随机合法车位；同车道前车 20m 内减速至前车速度
- [ ] Step 3: 每帧输出 state.trafficTargets = [{relX, relZ}]（雷达量程 x±25m、z±60m 内的目标）
- [ ] Step 4: 验证：lint+build；截图（路面上有车流、对向有车灯）；断言 __threeCarNav.getState().trafficTargets 数组非空且随时间变化
- [ ] Step 5: commit `feat(three-car-nav): traffic flow feeding radar targets`

### Task 7: HudSystem 全息 HUD（分 3 个子提交）

**Files:**
- Create: engine/HudSystem.ts（可拆 hud/ 子文件，但对外只导出 HudSystem）
- Modify: ThreeCarNavEngine.ts（接入；传 CarSystem.getHudClone()）

- [ ] Step 1 (7a 面板+底图+时速+杂项)：面板 PlaneGeometry(4.6, 2.3)，MeshBasicMaterial({map: CanvasTexture, transparent, toneMapped:false})；发光边框（更大背板 additive 渐变描边纹理）；离屏 canvas 2048×1024，静态层（底渐变/分区框/标签）仅在 timeOfDay 变化时重绘，动态层每帧；布局（锁定，px）：时速区 x60..560（数字 bold 220px 居中(310,560)，<60 青 / 60-100 浅蓝 / >100 琥珀，'km/h' 60px 其下，档位 pill）；中央 360° 洞：圆心(1024,540) r330（canvas 画雷达环，洞由 RTT 子平面覆盖）；右列 x1400..1988：路名「朝阳北路」64px + 导航行「前方 320 m · 凯恒中心」52px；右下车道图 460×260 透视梯形（当前道青色 35% 高亮，hint 箭头 1.2s 闪烁）；底部 y880..980：续航 512km · 时间 HH:MM（:SS 闪烁）· 三信号点 + 「NOC · 智驾已开启」
- [ ] Step 2 (7a 续)：面板位姿随 cameraMode lerp（锁定）：chase→车相对 (0,3.9,+0.2) rotX -0.18；driver→(0,2.1,-7.5) rotX -0.35；side→(0,3.6,+1.8) yaw +0.35 rotX -0.2；随车速 sin 浮动 ±0.05m
- [ ] Step 3 (7b RTT 360°小车)：WebGLRenderTarget(512,512)；mini Scene（复用 env 或 hemi+dir 简灯）+ PerspectiveCamera fov 32 半径 4.5m 环绕；每帧 setRenderTarget(rt) 渲染后复位；子平面（局部坐标按洞映射：(px-1024)/2048*4.6）材质 map=rt.texture，renderOrder 在面板后；自动旋转 yaw 0.35rad/s；pointerdown raycast 命中子平面进入拖拽（move 时 yaw -= dx*0.01、pitch clamp ±0.5rad，up 释放，拖拽后暂停自动旋转 3s）；注意 pointer 事件挂 engine 容器并随 dispose 移除
- [ ] Step 4 (7c 数据脚本+雷达)：POI 序列循环 [凯恒中心 800m → 朝阳公园 1600m → 蓝色港湾 2400m]，distanceM 递减导航行文案，<50m 切换下一 POI（循环累加偏移）；每 ~45s 触发一次 laneChangeHint（4s 箭头提示）→ 主车 x 向目标车道中心 lerp（真实缓缓变道）→ laneIndex 更新；雷达：同心环 r90/180/270/320px 透明度衰减 + 1.2rad/s 扫描扇形 + trafficTargets 映射 (relX/25*r_max, relZ/60*r_max) 目标点（接近时脉冲放大）
- [ ] Step 5: 验证：lint+build；Playwright：截图 HUD 特写（放大裁剪）核对六块内容齐全；断言 laneChangeHint 周期出现/消失、trafficTargets 与雷达目标数一致、speedKmh 数字与 state 同步（视觉核对）
- [ ] Step 6: 分三个 commit：`feat(three-car-nav): hud panel base with speed and gauges` / `feat(three-car-nav): hud 360 car viewport with drag` / `feat(three-car-nav): hud radar, lane nav and poi script`

### Task 8: 控制面板 + 调试钩子

**Files:**
- Create: src/components/three-car-nav/HudControlPanel.tsx
- Modify: useThreeCarNav.ts、ThreeCarNavEngine.ts（补 onStats 完整字段）

- [ ] Step 1: HudControlPanel：右下角玻璃拟态面板：速度 slider 0–120 + 快捷键 30/60/90；暂停/恢复（gear P/D）；视角三选（追尾/驾驶位/侧方）；日夜三选（黄昏/白天/夜晚）；gear==='P' 时禁用速度控件；样式遵守项目现有 CSS 习惯（查 Layout/MenuDock 的写法后跟进）
- [ ] Step 2: useThreeCarNav 绑定 controls ↔ panel；engine dev 钩子：if (import.meta.env.DEV) window.__threeCarNav = { getState: () => engine.state }（TS 用 declare global 或 as 断言，过 Biome）
- [ ] Step 3: 验证：lint+build；Playwright：逐控件点击/拖动 → __threeCarNav.getState() 对应字段断言（speedKmh、gear、cameraMode、timeOfDay）；暂停时 RoadSystem 停滚（截图对比或 state 断言）
- [ ] Step 4: commit `feat(three-car-nav): dom control panel and debug hook`

### Task 9: 鲁棒性 + 性能 + 终验

**Files:**
- Modify: ThreeCarNavPage.tsx、engine/*（按需小改）
- Create: scripts/verify-three-car-nav.sh（由 test-engineer 按设计落盘并执行）

- [ ] Step 1: 鲁棒性：WebGL 不可用（创建 renderer try/catch）→ 降级提示卡片；webglcontextlost → 暂停 RAF，restored → 恢复；dispose 审计（几何/材质/纹理/RT/renderer/事件监听全释放，React 18 StrictMode 双挂载下无泄漏无重复 canvas）
- [ ] Step 2: 性能：pixelRatio min(dpr,2)；renderer.info.render.calls < 120（Playwright 读取断言）；HUD 静态层缓存确认；FPS 采样 30s ≥ 30
- [ ] Step 3: test-engineer 落盘并跑 scripts/verify-three-car-nav.sh（lint → build → Playwright 全套 → 截图归档 artifacts/three-car-nav/ → FPS 报告），输出证据
- [ ] Step 4: acceptance 子 agent 对照 spec 第 8 节验收清单逐条核对，出 ✅/❌/⚠️ 判定表
- [ ] Step 5: commit `chore(three-car-nav): robustness, perf clamps, verify script`

## 派工与验收流程（主 agent 执行）

1. 每个任务派一个全新免费子 agent（backup-general 为主），prompt 指向本文件对应 Task + 执行约定
2. 每任务完结：test-engineer 跑该任务验证命令回传证据；主 agent 审证据 + 关键 diff 抽查后才放行下一任务
3. Task 9 后 acceptance 终验；不通过项回到对应 Task 的执行 agent 修复重验
4. 派工前主 agent 每次核对分支与基线 commit
