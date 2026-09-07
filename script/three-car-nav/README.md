# three-car-nav · Playwright 验收集（仓库常驻）

把 three-car-nav（`src/components/three-car-nav/`）历轮验收逻辑固化成的常驻 Playwright 测试集。
主入口 `run.mjs`：起 dev server（用完必杀）→ 顺序执行 TC-01..TC-09 → 汇总判定表 → 全绿 `exit 0`。

## 运行方式

```bash
# 全量（推荐）
node script/three-car-nav/run.mjs

# 只跑指定用例
node script/three-car-nav/run.mjs --only=TC01,TC04,TC06
node script/three-car-nav/run.mjs --only=TC-07        # 连字符可省

# 有头 Chrome（默认 headless）
TCN_HEADED=1 node script/three-car-nav/run.mjs

# 复用已在跑的 dev server（不负责关闭）
TCN_KEEP_SERVER=1 node script/three-car-nav/run.mjs
```

运行结束打印判定表 + 证据路径，全部通过 `exit 0`，任何 ❌ `exit 1`。
单次全量耗时约 3.5–4.5 分钟（其中 TC-07 变道/POI 为慢用例，~55s）。

> 提示：不要把全量输出 pipe 给 `head` 之类的命令——管道提前关闭会 SIGPIPE 掉主进程，
> 导致 dev server 清理（TEARDOWN）不执行。需要截取输出请先落盘再过滤。

## 环境依赖

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| node | ≥ 20.11（仓库 `.nvmrc`） | 本机验证用 v24.13.1 |
| pnpm | ≥ 8 | 起 dev server（`pnpm dev`）、TC-09 的 lint/build |
| playwright-cli | 任意近期版本 | **只作为 playwright-core 的载体，不新增 devDependency** |
| Chrome | 系统已安装 | `chromium.launch({ channel: 'chrome' })` |

**为什么这样引 Playwright**：`package.json` 不新增依赖。套件运行时在
`playwright-cli`（全局安装）自带的 `node_modules` 里解析 `playwright-core`
（`which playwright-cli` → realpath → `../lib/node_modules/@playwright/cli/node_modules/playwright-core`），
复用同一套浏览器驱动栈；也可用 `TCN_PLAYWRIGHT_CORE=/path/to/playwright-core` 显式指定。
三者都找不到时启动即报错，并提示 `npm install -g @playwright/cli@latest`。

其余依赖（three / react 等）走仓库自身的 `node_modules`，dev server 复用 `pnpm dev`（vite，端口 5173）。

## 用例总表

| TC | 文件 | 判定对象 | 通过标准（判定逻辑） |
| --- | --- | --- | --- |
| TC-01 | `tests/tc01-load.mjs` | 加载链路 | 菜单点入 → `canvas===1`、`modelStatus==='ready'` 且 ≤20s、console 零非网络 error、零 pageerror |
| TC-02 | `tests/tc02-traffic.mjs` | 车流 | 间隔 ≥1s 两次采样 `trafficTargets` 均非空、内容不同、且全部落在雷达量程 x±25 / z±60 |
| TC-03 | `tests/tc03-cdn-fallback.mjs` | CDN 降级 | route-abort `**/z2586300277.github.io/**` → 拦截数>0、`modelStatus==='fallback'`（25s 内）、canvas 仍在滚动渲染、仅容忍网络类 error、加载提示消失 |
| TC-04 | `tests/tc04-wheels.mjs` | 轮位 / 辐条 | 可见轮拱有轮（轮胎 Blob 占比与偏心）、三帧连拍（0.8s）轮 Blob 质心漂移 <5px 且整车包络像素数稳定（无漂浮部件）、轮区帧间差分 ≫ 车身控制区（辐条旋转可见）、360° 视口捕捉到两个对侧侧视（相隔 ≈8.97s 半圈） |
| TC-05 | `tests/tc05-paint.mjs` | 漆面存证 | 四区域裁剪全部生成成功（尺寸正确）并记录平均色；视觉判定项，脚本只负责出图 + 记录 |
| TC-06 | `tests/tc06-hud.mjs` | HUD 六块 | ①时速字形稳定渲染 ②360° 小车两个对侧侧视（整车绕环一周）③路名 + 导航行随里程刷新 ④车道图 accent 高亮质心落在 `state.laneIndex` 对应道内 ⑤footer 带有内容且中部回归带无 footer 文本（4291273 回归项）⑥雷达环拟合 + 目标点命中 + 区域活性 |
| TC-07 | `tests/tc07-lane-poi.mjs` | 变道 / POI（慢 ~55s） | 导航剩余距离两采样递减且 ≈ POI 到达里程 − `distanceM`；`laneChangeHint` 非 null 持续 3.2–5.2s 后归零；hint 消失沿后 `laneIndex` 在 lerp 中变化 |
| TC-08 | `tests/tc08-drag.mjs` | 拖拽 | 中央小车横拖 260px → 车身取向（连通宽度）变化 ≥25px（前后裁剪归档）；相位不巧时最多重试 3 次 |
| TC-09 | `tests/tc09-static.mjs` | 静态检查 | `pnpm lint` 与 `pnpm build` exit 0 且输出零 `error` 行 |

逐条的前置 / 步骤 / 通过标准 / 关联产物见 [`cases.md`](./cases.md)。

## 证据归档

每次运行落盘 `artifacts/three-car-nav/suite-<时间戳>/`：

```
suite-20260907xxxxxx/
├── dev-server.log          # dev server 输出
├── summary.json            # 判定汇总（allPass + 每用例 note/evidence）
├── TC-01-load.png          # 每用例截图 / 裁剪 / 证据 JSON
├── TC-04-evidence.json
├── TC-04-hud360-sideA.png
└── ...
```

截图与 JSON 都不进 git（`artifacts/` 本就未跟踪，提交时只 add `script/three-car-nav/`）。

## 目录结构

```
script/three-car-nav/
├── README.md        # 本文件
├── cases.md         # 用例集文档（前置/步骤/通过标准/关联产物）
├── run.mjs          # 主入口
├── lib/
│   ├── config.mjs   # 常量：视口 / HUD 纹理↔屏幕映射 / 各判定阈值
│   ├── runtime.mjs  # playwright-core 解析 + Chrome 启动 + dev server 生命周期
│   ├── context.mjs  # 用例上下文：菜单点入、getState、console 分类、截图归档
│   ├── inpage.mjs   # 页内像素采样工具（RAF 钩子读 WebGL 帧 + 区域分析原语）
│   ├── analyze.mjs  # 360° 侧视配对（半圈周期相位匹配）
│   └── report.mjs   # 判定表输出
└── tests/           # 每用例一文件，export async function run(ctx) => { pass, evidence }
```

## 关键实现约定

- **坐标**：视口固定 2400×1500（devicePixelRatio=1），canvas 像素与截图一一对应。
  HUD 判定带以 `HudSystem` 的 2048×1024 纹理坐标定义（与源码锁定布局一一对应），
  经 `lib/config.mjs#bandToScreen()` 换算到屏幕（≈0.3589 px/px，并外扩 10px 吃掉面板 ±8px 浮动）。
- **读 WebGL 帧**：`WebGLRenderer` 默认 `preserveDrawingBuffer=false`，绘制缓冲合成后即清空，
  所以页内工具用 `requestAnimationFrame` 钩子——引擎的 `setAnimationLoop` 先注册、先执行，
  本工具的回调每帧排在其后，同一帧内 `drawImage` 拿到的就是当帧画面。
- **像素断言的边界**：HUD 洞是半透明的，背后街景持续滚动；所有涉及洞区域的判定
  （雷达目标点、360° 车身取向）都用「车身色/环拟合/对照点」等抗背景手段，
  不用裸亮度差分。逐项取舍见 `cases.md`。
