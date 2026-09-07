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

---

## 附：洞的透明性对自动化判定的影响（取舍记录）

`HudSystem` 的中央洞由 RTT 子平面（alpha 0 清屏）叠加在半透明面板上，
**主场景（道路/建筑/路牌）会透过洞显示**，且 treadmill 使背景持续滚动。实测影响：

- 洞区域的裸亮度差分：基线（无操作）即达 0.053，与拖拽量级相同 → 不能用作「拖拽生效」判定；
- 「释放后自动旋转冻结」判定：被背景污染（冻结期宽度摆动 189→158→189）→ 降级为视觉核对项；
- 亮度类侧视指标：被透出的街景污染（~2.5s 周期的噪声峰），改用「车身色（b−r≥35 且不亮）最大连通宽度」后
  得到干净的 8.97s 周期信号（历轮实测峰值序列 189/189/189，间隔 ≈8.8s）。

这套取舍是本套件与「拿截图人眼看看」的区别所在：每条判定都标注了它抗什么干扰、阈值来自哪次实测。
