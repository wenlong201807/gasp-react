# three-car-nav 用例集（cases）

每条用例：前置 → 步骤 → 通过标准 → 关联产物。
所有用例共用前置 `P0`；阈值常量集中在 `lib/config.mjs`，来源为历轮验收实测值。

**公共前置 P0**

- dev server 已在 `http://localhost:5173`（由 `run.mjs` 起，先做端口预检：同仓库 vite 残留进程清掉，非 vite 占用则中止）
- Chrome（headless，`channel:'chrome'`）+ 视口 2400×1500，`devicePixelRatio=1`
- 菜单点入路径：首页 → `button[aria-label="展开菜单"]` → `button:has-text("Three Car Nav")` → 等 `<canvas>`
- 页内钩子：`window.__threeCarNav.getState()`（仅 DEV 生效）；`window.__tcn`（套件注入的像素采样工具）
- 所有网络类 console error（`Failed to load resource` / `net::ERR*`）单独归类；**非网络类 error 在任何用例都不容忍**

---

## TC-01 加载

- **前置**：P0，CDN 可达（未拦截）。
- **步骤**：P0 点入 → 计数 `canvas` → 轮询 `getState().modelStatus`（预算 20s，`CarSystem.LOAD_TIMEOUT_MS=15s` 超时降级）→ 收集 console / pageerror / 失败请求 → 全页截图。
- **通过标准**：`canvas === 1`；`modelStatus === 'ready'` 且耗时 ≤ 20s；非网络类 console error = 0；pageerror = 0。
- **产物**：`TC-01-load.png`、`TC-01-evidence.json`（含 modelStatus 历史、console 分类）。

## TC-02 车流

- **前置**：P0（TC-01 通过后语义最完整，本套件独立开新 context 自行点入）。
- **步骤**：等 `modelStatus` 就绪 → 采样 `trafficTargets`（#1）→ 等 1.5s（≥1s）→ 采样（#2）→ 截图。
- **通过标准**：两次采样均非空；`JSON.stringify` 结果不同（车流在滚动）；每个目标 `|relX| ≤ 25.001`、`|relZ| ≤ 60.001`（`HudSystem` 雷达量程 x±25 / z±60）。
- **产物**：`TC-02-traffic.png`、`TC-02-evidence.json`（含两次采样原文）。

## TC-03 CDN 降级

- **前置**：P0 + `context.route('**/z2586300277.github.io/**', abort)`（`CarSystem.CDN_BASE` 的 host：HDR `files/hdr/1k.hdr` 与模型 `models/su7/sm_car.gltf` 同域）。
- **步骤**：P0 点入 → 轮询 `modelStatus` 至 `fallback`（预算 25s：15s 加载超时 + 余量）→ 等 2s 让场景稳定 → 计数 `canvas`、检查「模型加载中…」提示消失 → 采 2 帧（间隔 700ms）做路面区差分 → 截图。
- **通过标准**：拦截请求数 > 0；`modelStatus === 'fallback'`；`canvas ≥ 1`；加载提示消失；路面区平均亮度落在非空白区间（0.02 < lum < 0.95）且两帧差分 > 0（treadmill 车道线仍在滚动）；非网络类 console error = 0（网络类 error 是降级路径的必然产物，容忍）。
- **产物**：`TC-03-cdn-abort-fallback.png`（fallback 低模车 + HUD 完整）、`TC-03-evidence.json`（拦截数、status 历史、失败请求清单、渲染差分）。

## TC-04 轮位 / 辐条（三轮修复史回归项）

背景：SU7 资产的轮 mesh 是「同侧前后两轮合并体」，历史上绕合并质心旋转导致轮子飞出轮拱；
修复为按簇质心重装程序化轮（`buildSu7Wheel`），随后 2d64a41 给程序化轮加 5 根辐条使自转可见。

- **前置**：P0 且 `modelStatus === 'ready'`（fallback 车无轮位修复史，断言无意义）。
- **步骤**：
  1. 在两个轮搜索窗（`CAR.wheelSearch.rear/front`，chase 视图内两处可见轮拱）内用暗色轮胎谓词定位轮 Blob（质心 + bbox），以其为中心取 ±34px 紧凑轮区；
  2. 三帧连拍（间隔 0.8s），逐帧计算：轮区暗色占比、Blob 质心、轮区亮色（轮辋）占比、帧间差分；同时计算车身控制区差分与整车包络（`CAR.envelope`）内暗色/车漆像素数；
  3. 360° 视口：采 30 帧（间隔 0.8s，≈2.7 个半圈），以「车身连通宽度」（`carBody` 谓词最大连通域）为取向指标做侧视配对（`lib/analyze.mjs`，半圈周期 8.97s 相位匹配），归档两侧视裁剪。
- **通过标准**：
  - **轮拱有轮**：两个轮区暗色占比 ≥ 0.15 且 Blob 质心偏离区中心 ≤ 20px；
  - **无漂浮部件**：三轮拍中轮 Blob 质心漂移 < 5px，且整车包络内暗色/车漆像素数波动 ≤ 3%；
  - **辐条旋转可见**：两轮中较优者的帧间变化占比 ≥ 0.04 且 ≥ 车身控制区的 3 倍，或轮辋亮色占比峰谷摆动 ≥ 0.03（辐条扫过 → 轮辋亮暗交替）；
  - **两个对侧侧视**：配对成功（车身连通宽度均 ≥ 条带宽度 × 0.88）。
- **产物**：`TC-04-wheel-rear.png`、`TC-04-wheel-front.png`、`TC-04-wheels.png`、`TC-04-hud360-sideA.png`、`TC-04-hud360-sideB.png`、`TC-04-evidence.json`（逐帧质心/占比/差分/侧视序列）。
- **边界说明（4 轮清点）**：chase 视图只露出一侧 2 个轮拱（车身侧对相机），另外 2 个被车身遮挡，
  这是资产朝向决定的呈现，不是缺陷；360° 视口的两个对侧侧视（相隔 ≈ 半圈）合计覆盖 4 个轮拱，
  **4 轮逐个清点为归档裁剪上的视觉核对项**（脚本断言「两侧视均出现且车身占满条带」）。原因见下方「洞的透明性」。

## TC-05 漆面存证（视觉判定项）

- **前置**：P0 且 `modelStatus === 'ready'`。
- **步骤**：等 1.5s 让 HDR 环境反射稳定 → 抓 1 帧 → 对 `PAINT_CROPS` 四区域（车头/引擎盖、车侧门板、车顶/玻璃House、前轮拱/轮毂）逐个：记录平均色 + 裁剪归档 → 全页截图。
- **通过标准**：四张裁剪全部生成成功且尺寸与区域定义一致（视觉判定项：脚本只负责出图 + 记录平均色，漆面质感/反射由人核对比图）。
- **产物**：`TC-05-paint-*.png` ×4、`TC-05-paint-full.png`、`TC-05-evidence.json`（各区域平均色，历轮实测参考：门板 ≈ rgb(49,160,178)）。

## TC-06 HUD 六块

- **前置**：P0 且 `modelStatus === 'ready'`。
- **坐标约定**：判定带按 `HudSystem` 的 2048×1024 纹理坐标定义（与源码锁定布局一一对应），
  经 `bandToScreen()` 换算到屏幕并四边外扩 10px（面板随车速浮动 ±0.05m ≈ ±8px）。
- **步骤**：
  1. 采 2 帧（间隔 0.4s）→ 六个判定带亮度占比、导航行差分、车道图 accent 质心、雷达环拟合、目标点峰值（含 90/180/270° 对照组）、洞区域差分；
  2. 采 30 帧（间隔 0.8s）做 360° 侧视配对（同 TC-04 第 3 步）；
  3. 归档六块裁剪 + 全页截图。
- **通过标准**：
  | 块 | 标准 |
  | --- | --- |
  | ① 时速 | 数字区字形占比 ≥ 0.02 且两帧稳定（±0.1）；数字值 = `Math.round(state.speedKmh)`，OCR 不在套件范围，数值靠归档裁剪核对 |
  | ② 360° 小车 | 两个对侧侧视配对成功（整车绕环一周）；裁剪归档 |
  | ③ 路名 + 导航行 | 两带字形占比 ≥ 0.02；导航行区域差分 > 0（随 `distanceM` 递减每帧重绘） |
  | ④ 车道图 | accent 高亮像素 ≥ 100 且质心落在 `state.laneIndex` 对应道内（±梯形宽 18%） |
  | ⑤ footer（4291273 回归项） | `FOOT_CENTER_Y = y + h/2 = 930`：左右两个 footer 带字形占比 ≥ 0.02；**中部回归带（纹理 y460..520，即误写 `(y+h)/2=490` 的落点）字形占比 ≤ 0.03，且 footerRight ≥ 3 × 中部** |
  | ⑥ 雷达 | 环拟合像素 ≥ 40（同心环）；≥1 个 `trafficTargets` 目标在预测位置命中（峰值亮度 ≥ 0.5 且高于全部对照组 0.15）；洞区域差分 > 0（扫描扇形/目标点/车体在动） |
- **产物**：`TC-06-hud-speed.png`、`TC-06-hud-nav.png`、`TC-06-hud-lane.png`、`TC-06-hud-footer.png`、`TC-06-hud-radar.png`、`TC-06-hud360-sideA/B.png`、`TC-06-hud-full.png`、`TC-06-evidence.json`。
- **历轮实测参考值**：footerLeft ≈ 0.07–0.12、footerRight ≈ 0.10–0.21、中部回归带 ≈ 0–0.015、雷达目标点峰值 ≈ 0.66（对照 0.38）。

## TC-07 变道 / POI（慢用例，~55s）

- **前置**：P0 且 `modelStatus === 'ready'`；无任何交互（hint 由 `HudSystem` 每 45s 触发一次）。
- **步骤**：900ms 轮询 `getState()` 至多 100s，期间：
  - 首次采样记录 `distanceM` + 由里程反推的当前 POI（`poiFor()`：与 `updateScripts` 的 50m 切换/2400m 循环规则同源）并归档导航行裁剪；里程推进 > 60m 后再次采样归档；
  - 记录 `laneChangeHint` 的出现沿 / 消失沿（出现沿归档车道图裁剪）；
  - 消失沿后继续轮询 `laneIndex` 直到变化（归档变道后裁剪）。
- **通过标准**：
  - 导航剩余距离两采样递减，且 `remain ≈ POI.arriveM + offset − distanceM`（±1m），两次采样属同一 POI；
  - 导航行像素随里程刷新（区域差分 > 0）；
  - `laneChangeHint` 非 null 持续 3.2–5.2s（锁定 4s）后归零；
  - hint 消失沿后 `laneIndex` 变化（lerp ~2.8s 收敛 97%，预算 8s）。
- **产物**：`TC-07-nav-line-t0/t1.png`、`TC-07-lane-hint.png`、`TC-07-lane-after.png`、`TC-07-lane-poi-final.png`、`TC-07-evidence.json`（全量采样序列）。
- **历轮实测参考**：hint 出现于引擎启动后 ~45s，持续 ~3.7–4.0s，消失后 ~3s 落位（lane 1→2）。

## TC-08 拖拽

- **前置**：P0 且 `modelStatus === 'ready'`。
- **步骤**：
  1. 拖拽前采 3 帧记录「车身连通宽度」并归档洞裁剪；
  2. `mouse.move(洞心) → down → 12 步横移 260px（每步 20ms）→ up`（yaw 变化 ≈ 0.01 × 260 = 2.6rad）；
  3. 拖拽后采 1 帧记录宽度并归档裁剪；宽度变化 < 25px（取向恰好对称）时追加拖拽，最多 3 次；
  4. 释放 3.2s 后再归档一张（自转恢复存证）。
- **通过标准**：拖拽前后车身连通宽度变化 ≥ 25px。
- **产物**：`TC-08-drag-before.png`、`TC-08-drag-after.png`、`TC-08-drag-resume.png`、`TC-08-drag-final.png`、`TC-08-evidence.json`（每次尝试的前后宽度）。
- **视觉核对项**：「释放后自动旋转暂停 3s 再恢复」。自动化尝试过「释放后洞区域差分 ≈ 0」，
  但洞是半透明、背后街景持续滚动，差分被背景污染（实测基线差分 0.053 vs 释放后 0.071），无法与自转区分，
  故降级为归档裁剪上的视觉核对项。
- **历轮实测参考**：宽度 118→177px（一次拖拽即命中）。

## TC-09 静态检查

- **前置**：P0（仓库依赖已安装）。
- **步骤**：在仓库根依次执行 `pnpm lint`、`pnpm build`（`tsc -b && vite build`），捕获 exit code 与完整输出。
- **通过标准**：两个命令 exit 0，且输出中无 `error` 行（biome 的 DEPRECATED info、vite 的 chunk 体积 warning 不算 error）。
- **产物**：`TC-09-evidence.json`（每个命令的耗时、error 行、输出尾部 3500 字符）。

## TC-10 控制面板

- **前置**：P0（`modelStatus` ready/fallback 皆可——面板交互与模型无关，等待只为避开加载期抖动）。
- **步骤**：
  1. slider `fill('90')`（设 value + 派发 input → React onChange → `setTargetSpeed`）→ `getState().speedKmh === 90`；
  2. 快捷键点 `30` → 30、点 `90` → 90（与 slider 两条路径分别断言，90 为锁定断言值）；
  3. 点「暂停 (P)」→ `gear==='P'`；DOM 断言（页内探针 `PANEL.disabledProbe`）：slider + 3 个快捷键全部 `disabled`（面板由 5Hz stats 驱动，轮询预算 2.5s）；间隔 0.9s 两次采样 `distanceM` 相等（P 档 `HudSystem.updateScripts` 冻结里程 = RoadSystem 停滚同链路）；归档 P 档截图；
  4. 点「恢复 (D)」→ `gear==='D'`；速度控件恢复可用；再次采样 `distanceM` 推进 > 5m（90km/h ≈ 22.5m/0.9s）；
  5. 视角三选逐个点击（驾驶位→`driver`、侧方→`side`、追尾→`chase`）逐一断言；日夜三选逐个点击（白天→`day`、夜晚→`night`、黄昏→`dusk`）逐一断言。
- **通过标准**：上述 13 项检查全过（slider/快捷键两路径、P/D 两态 DOM + 里程冻结/推进、视角×3、日夜×3、非网络 console error=0、pageerror=0）。
- **产物**：`TC-10-panel-paused.png`（P 档 disabled 态）、`TC-10-panel.png`、`TC-10-evidence.json`（逐步 trace：每步 expect/got + distanceM 采样对）。
- **实现锚点**：`HudControlPanel.tsx`（`aria-label` 与按钮文本即选择器，集中在 `lib/config.mjs#PANEL`）；`getState()` 直读 engine state 无节流，点击后可即时断言；DOM disabled 态经 5Hz stats → React 重渲染，故用轮询。

## TC-11 鲁棒性

- **前置**：P0（modelStatus ready/fallback 皆可）。
- **步骤**：
  1. 切走→切回 ×2：展开菜单 → 点「Scroll Animation」（three-car-nav 卸载，期望 `canvas === 0`）→ 展开菜单 → 点「Three Car Nav」→ 期望 `canvas === 1` 且 `modelStatus` 在 20s 内恢复 ready/fallback；第二轮重复；
  2. 上下文丢失：`page.evaluate` 在 canvas 上派发合成 `webglcontextlost`（cancelable）→ 等 1.3s + 0.6s 两次采样，`distanceM` 与 `fps` 均与派发前完全一致（RAF 停摆 → 5Hz stats 冻结；引擎 `onContextLost` 暂停 `setAnimationLoop`，three r185 内部同步置 `_isContextLost` 使 render no-op）且 canvas 仍为 1；
  3. 上下文恢复：派发合成 `webglcontextrestored` → 等 1.6s → `distanceM` 推进 > 3m（60km/h ≈ 16.7m/s）且 `modelStatus` 不变。
- **通过标准**：上述 7 项检查全过（两轮切换 canvas 恒 1 + status 可恢复、lost 冻结、lost 后 canvas 仍在、restored 恢复推进、非网络 console error=0、pageerror=0）。
- **产物**：`TC-11-robust-restored.png`、`TC-11-evidence.json`（两轮切换记录 + lost/restored 采样对）。
- **③WebGL 不可用降级（代码走查项，不做自动化断言）**：headless Chrome 无法真实禁用 WebGL（`--disable-webgl` 会连同 headless 的 SwiftShader 一并破坏页面其他前置），本套件不伪造该场景。落点走查：`useThreeCarNav.ts` 以 try/catch 捕获 `new ThreeCarNavEngine()` 失败 → `webglUnsupported=true` 且**不挂 canvas**；`ThreeCarNavPage.tsx` 渲染玻璃拟态降级卡片（文案「当前环境不支持 WebGL」，复用 `hud-control-panel.module.css`）；引擎构造在 `appendChild` 之前抛出，故失败路径无 canvas 残留、无监听器泄漏。
- **实现锚点**：`ThreeCarNavEngine.ts` `onContextLost`/`onContextRestored`（监听挂 `renderer.domElement`，`dispose` 移除；restored 后 `renderer.resetState()` + 时钟 dt 丢弃 + 重启 RAF）。

## TC-12 性能

- **前置**：P0 且 `modelStatus` ready/fallback 皆可（等待只为避开加载期抖动）。
- **步骤**：
  1. `getRenderInfo()` 8 次采样（间隔 400ms，覆盖视锥内车流/路段变化）；
  2. `getState().fps` 31 次采样（间隔 1s，≈30s 窗口）取均值；
  3. `getRenderInfo().staticRedraws` 间隔 3s 两次采样（timeOfDay 保持 dusk 不动）；随后点「白天」再采样（活性对照：必须 +1，证明计数器真实反映 `HudSystem.redrawStaticLayer` 而非恒定值）；点「黄昏」还原；
  4. `getRenderInfo().pixelRatio` 与页内 `Math.min(devicePixelRatio, 2)` 比对。
- **通过标准**：每次采样 `calls < 120`（计划锁定阈值；实测 99–108，见 evidence）；fps 30s 均值 ≥ 30（实测 60，vsync 封顶）；timeOfDay 不变窗口 `staticRedraws` 不增且初值 ≥ 1；切档后 `staticRedraws` 增加（活性）；`pixelRatio === min(dpr,2)` 且 ≤ 2；非网络 console error=0；pageerror=0。
- **产物**：`TC-12-perf.png`、`TC-12-evidence.json`（calls 序列 / fps 序列与均值 / staticRedraws 采样对与对照 / pixelRatio 比对 / 最终 renderInfo）。
- **实现锚点**：`ThreeCarNavEngine.ts#getRenderInfo()`（`renderer.info.render.calls`，主场景 render 为每帧最后一次 render，读数即主场景 draw calls；`staticRedraws` 取自 `HudSystem.staticRedrawCount`，仅 `redrawStaticLayer` 自增——构造首绘 1 次，timeOfDay 变化各 +1）；`renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))`。draw calls 达标手段：RoadSystem 段内静态内容按顶点色合并为单 mesh（8 段 ~118 → ~18 calls）、TrafficSystem 车身/灯带合并 + 20 轮共用 1 个 InstancedMesh（55 → 21 calls），视觉逐项等价（颜色/位姿/种子随机同序）。

## TC-13 hash 路由

- **前置**：P0。
- **步骤**：
  1. 直链 `goto(APP_URL + '#/three-car-nav')`（不点菜单）→ 等 `<canvas>`；
  2. 展开菜单 → 点「Scroll Animation」→ 等 600ms 读 `location.hash` 与页面标记；
  3. `goto(APP_URL + '#/unknown-id')`（同文档 hashchange）→ 等 `<canvas>` → 读 hash；
  4. `page.goBack()` → 等 600ms 读 hash 与页面标记；
  5. 读 `navigator.serviceWorker.controller`。
- **通过标准**：
  - ① hash === `#/three-car-nav` 且 canvas === 1（直链即智驾页，无需菜单点入）；
  - ② hash === `#/scroll` 且 scroll 页 h1（GSAP React）可见、canvas === 0（dock 点击 → navigate → hashchange → 页面切换，与直链共用同一条解析路径）；
  - ③ hash === `#/three-car-nav` 且 canvas === 1（未知 id 落回智驾页，URL 经 replaceState 归一、不追加历史）；
  - ④ hash === `#/scroll` 且 scroll 页可见（back 触发 hashchange，页面随路由回切）；
  - ⑤ dev 模式 `controller === null`（SW 仅 PROD 注册）；非网络类 console error = 0；pageerror = 0。
- **产物**：`TC-13-hash-route-final.png`、`TC-13-evidence.json`（四步 hash 序列 + 各步标记采样）。
- **实现锚点**：`src/hooks/useHashRoute.ts`（解析/归一/hashchange 汇聚，dock 点击、前进后退、直链三入口同构）；`App.tsx` 以路由替代内部 state，`MenuDock` active 高亮读路由。

## TC-14 SW 冒烟

- **前置**：生产产物 + preview 生产服（`vite preview --port 4173 --strictPort`，用例自管起停）。
  **注意（存量地雷）**：仓库 `.env` 钉了 `NODE_ENV=development` 且 vite 构建会读取——默认 `pnpm build` 产出 dev 模式 bundle（`import.meta.env.PROD=false`，SW 注册代码被 DCE，React 为 jsxDEV 运行时）。本用例在产物缺失或含 jsxDEV 时自动以 `NODE_ENV=production` 重建（故全量套件中 TC-09 的默认构建产物会被本用例重建一次）。
- **步骤**：
  1. 确保生产产物 → 起 preview（4173）→ `goto(PREVIEW_URL/#/three-car-nav)`；
  2. 等 `getRegistration()` 非空（页面 load 后 register）→ `reload` → 等 `controller !== null`；
  3. 读 `caches.keys()`、shell 缓存条目、`fetch('/sw-manifest.json')` 的 version；
  4. 等 `<canvas>` → 读 `[data-update-toast]` 计数；
  5. 停 preview 并确认 4173 释放。
- **通过标准**：注册成功且 `controller.scriptURL` 以 `/sw.js` 结尾；`caches` 含 `app-shell-<version>` 且缓存名与 manifest 的 version 一致；缓存条目含 `'/'` 与 ≥1 条 `/assets/*`；toast 初始隐藏（首次安装不提示）；非网络 console error = 0；pageerror = 0；preview 端口释放。`cdn-models-v1`（CDN 模型经 SW 缓存）记录为证据，不作硬断言（依赖外网可达）。
- **更新流（手工验证项，不自动化）**：
  1. `NODE_ENV=production pnpm build`（记下 `dist/sw-manifest.json` 的 version）；
  2. 改动任意源码后再次同命令构建 → version 与 `dist/sw.js` 字节均变化；
  3. preview 起服务，打开已被旧 SW 控制的页面；
  4. DevTools → Application → Service Workers → Update（或等 5 分钟轮询 / 切回标签页触发 visibilitychange 检查）；
  5. 右下角出现「发现新版本」toast → 点「立即更新」→ 新 SW 接管（controllerchange）→ 页面自动刷新一次，刷新后 toast 消失。
  不做自动化的原因：更新链路依赖真实的新旧 SW 交接与用户点击，在 Playwright 上下文里伪造 waiting/controllerchange 的注入式断言不可信，不造假。
- **产物**：`TC-14-sw-preview.png`、`TC-14-evidence.json`（注册/缓存原文 + 手工步骤清单）、`TC-14-preview.log`。
- **实现锚点**：`public/sw.js`（install 按 manifest 预缓存、activate 按缓存名清旧、fetch 三策略、SKIP_WAITING 消息）；`vite.config.ts` swManifest 插件（writeBundle 产出 sw-manifest.json 并把 version 注入 dist/sw.js 占位符——registration.update() 只按 sw.js 字节比对，不注入则更新提示永不触发）；`src/sw.ts`（PROD 注册 + 5 分钟/visibilitychange 轮询 + waiting 通知 + controllerchange 防循环 reload）；`src/components/UpdateToast.tsx`。

---

## TC-15 全屏入口

- **前置**：P0（dev server，任一路由皆有 title 栏）。
- **背景**：feat/fullscreen 分支将 event-loop / url-lifecycle 两页各自的全屏入口收敛为全局 title 栏（logo 旁）唯一入口，全屏目标从各页 `.experience` 容器改为 `document.documentElement`，完全沉浸（全屏态隐藏 title 栏与 dock，留角落半透明退出控件，Esc 原生退出）。两页旧按钮/handler/样式全部删除。
- **步骤**：
  1. 首页断言 title 栏按钮存在且 aria-label 正确（`getByRole('button', { name: '进入全屏' })` 全页唯一、位于 `header` 内）；
  2. 点击进入全屏 → 等 600ms 读 `document.fullscreenElement` → 沉浸 DOM 断言：title 栏 logo（`GSAP-React`，exact）不可见、dock handle（`button[aria-label="展开菜单"]`）不在 DOM、角落退出控件（name `退出全屏`）出现；截图存证；
  3. 退出恢复：真全屏路径先采 Esc 软证据（见下取舍），再进入一次走角落退出控件；stub 路径直接走控件 + 恢复原生 getter 派发 `fullscreenchange`。断言 `fullscreenElement` 归空、logo/dock 回来、退出控件消失；
  4. 旧入口缺席（event-loop）：直链 `#/event-loop` → 点第一个 preset 卡片 → 三重缺席断言（`getByRole(name: '⛶ 全屏')`=0、`button:has-text("⛶")`=0、`button:has-text("全屏")`=0）+ title 栏新入口仍唯一在 header + 控制条「⏮ 重播」仍在（非全屏功能一字不动）；
  5. 旧入口缺席（url-lifecycle）：直链 `#/url-lifecycle` → 点第一幕 → 同上断言组。
- **通过标准**：上述 7 项检查全过（title 入口唯一、沉浸 DOM、退出恢复、两页旧入口缺席、非网络 console error=0、pageerror=0）。
- **headless 取舍（不造假声明）**：
  - **Fullscreen API 主路径**：本仓 headless Chrome（`chromium.launch({ channel: 'chrome' })`）实测 `requestFullscreen()` resolve、`fullscreenElement=documentElement`、`fullscreenchange` 触发——TC-15 主路径即真全屏断言（evidence `mode: "native"`）。若未来环境受限（点击后 `fullscreenElement` 仍 null），用例如实降级：stub `document.fullscreenElement` getter + 派发 `fullscreenchange`，断言「事件 → 状态 → DOM」UI 链路，evidence 记 `mode: "stubbed"`，不伪造真全屏。
  - **Esc 原生退出**：headless 实测按 Esc **不退出**全屏（浏览器 UI 层快捷键在 headless 缺失，探针 `fsAfterEsc: true`）——产品代码层面 Esc 退出是浏览器对 Fullscreen API 的内置行为，无法在 headless 自动化验证。处理与 TC-14 更新流同款：采软证据（`escEffective` 如实入 evidence，不作硬断言），未生效时 `evaluate(exitFullscreen)` 自愈恢复常态后继续控件退出路径。真浏览器 Esc 行为属手工验证项。
- **产物**：`TC-15-fullscreen-immersive.png`（沉浸态截图）、`TC-15-fullscreen-legacy-absent.png`、`TC-15-evidence.json`（六步 trace：每步 ok + 实测值 + mode + escEffective + console 分类）。
- **实现锚点**：`src/hooks/useFullscreen.ts`（request/exit/toggle + `fullscreenchange` 同步 + 拒绝静默降级；默认 `documentElement`，可选 targetRef 保留元素级能力）；`src/components/layout/Layout.tsx`（title 旁 `fullscreenToggle` 按钮 + 沉浸分支渲染 `fullscreenExit` 角落控件）；`src/App.tsx`（`useFullscreen` 单一状态源 + 全屏态不渲染 `MenuDock`）；设计文档 `docs/superpowers/specs/2026-09-07-fullscreen-entry-design.md`。

---

## 附：洞的透明性对自动化判定的影响（取舍记录）

`HudSystem` 的中央洞由 RTT 子平面（alpha 0 清屏）叠加在半透明面板上，
**主场景（道路/建筑/路牌）会透过洞显示**，且 treadmill 使背景持续滚动。实测影响：

- 洞区域的裸亮度差分：基线（无操作）即达 0.053，与拖拽量级相同 → 不能用作「拖拽生效」判定；
- 「释放后自动旋转冻结」判定：被背景污染（冻结期宽度摆动 189→158→189）→ 降级为视觉核对项；
- 亮度类侧视指标：被透出的街景污染（~2.5s 周期的噪声峰），改用「车身色（b−r≥35 且不亮）最大连通宽度」后
  得到干净的 8.97s 周期信号（历轮实测峰值序列 189/189/189，间隔 ≈8.8s）。

这套取舍是本套件与「拿截图人眼看看」的区别所在：每条判定都标注了它抗什么干扰、阈值来自哪次实测。
