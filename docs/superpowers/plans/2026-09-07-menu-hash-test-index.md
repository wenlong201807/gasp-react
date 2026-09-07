# three-car-nav 测试用例索引（TC-01..14）

- 日期：2026-09-07
- 分支：feat/menu-hash
- 设计文档：`docs/superpowers/specs/2026-09-07-menu-hash-router-pwa-design.md`（本分支新增能力）
- 用例全集（前置/步骤/通过标准/产物，逐条完整版）：[`script/three-car-nav/cases.md`](../../../script/three-car-nav/cases.md)
- 执行入口：`node script/three-car-nav/run.mjs`（自管 server 起停，产物落 `artifacts/three-car-nav/suite-<stamp>/`）
- 最近全量实测：2026-09-07（suite-20260907125448），14/14 PASS

## 用例总表

| 编号 | 名称 | 验证什么 | 落点文件 |
| --- | --- | --- | --- |
| TC-01 | 加载 | CDN 可达时模型 ready（≤20s）、canvas 唯一、零非网络 error | `cases.md` §TC-01 · `tests/tc01-load.mjs` |
| TC-02 | 车流 | trafficTargets 非空且持续滚动、目标均在雷达量程内 | `cases.md` §TC-02 · `tests/tc02-traffic.mjs` |
| TC-03 | CDN 降级 | abort CDN 后 15s 超时落 fallback 低模车、treadmill 仍渲染 | `cases.md` §TC-03 · `tests/tc03-cdn-fallback.mjs` |
| TC-04 | 轮位/辐条 | 轮不飞出轮拱（三轮修复史回归）、辐条自转可见、两个对侧侧视 | `cases.md` §TC-04 · `tests/tc04-wheels.mjs` |
| TC-05 | 漆面存证 | 四区域裁剪出图 + 平均色记录（视觉判定项，人核） | `cases.md` §TC-05 · `tests/tc05-paint.mjs` |
| TC-06 | HUD 六块 | 时速/360°/导航/车道图/footer（4291273 回归）/雷达 六判定带 | `cases.md` §TC-06 · `tests/tc06-hud.mjs` |
| TC-07 | 变道/POI | 导航里程递减且与 POI 公式吻合、hint 4s 消失、laneIndex 落位 | `cases.md` §TC-07 · `tests/tc07-lane-poi.mjs` |
| TC-08 | 拖拽 | 360° 洞拖拽 yaw 生效（连通宽度变化）、释放自转恢复（人核） | `cases.md` §TC-08 · `tests/tc08-drag.mjs` |
| TC-09 | 静态检查 | `pnpm lint` + `pnpm build` exit 0 且无 error 行 | `cases.md` §TC-09 · `tests/tc09-static.mjs` |
| TC-10 | 控制面板 | 13 项交互断言（slider/快捷键/P-D 冻结推进/视角×3/日夜×3） | `cases.md` §TC-10 · `tests/tc10-panel.mjs` |
| TC-11 | 鲁棒性 | 卸载重挂 ×2、webglcontextlost 冻结、restored 恢复推进 | `cases.md` §TC-11 · `tests/tc11-robustness.mjs` |
| TC-12 | 性能 | draw calls < 120、fps 30s 均值 ≥ 30、staticRedraws 活性、pixelRatio ≤ 2 | `cases.md` §TC-12 · `tests/tc12-performance.mjs` |
| TC-13 | hash 路由 | 直链 / dock 点击 / 未知 id 归一 / back 四路径同构，dev 无 SW | `cases.md` §TC-13 · `tests/tc13-hash-route.mjs` |
| TC-14 | SW 冒烟 | 生产 preview：SW 注册、app-shell-\<version\> 预缓存、toast 首装隐藏 | `cases.md` §TC-14 · `tests/tc14-sw.mjs` |

TC-01..12 为 three-car-nav 既有能力回归（feat/three-car 分支起累积）；TC-13/14 为 feat/menu-hash 分支新增能力，细节如下。

## TC-13 hash 路由（细节）

四步导航序列 + 一项 SW 侧带断言，五条通过标准：① 直链 `#/three-car-nav` 不点菜单即智驾页；② dock 点「Scroll Animation」→ `#/scroll` 且 scroll 页可见、canvas 归零（与直链共用同一 hashchange 管道）；③ 同文档 goto `#/unknown-id` → 归一回 `#/three-car-nav`（replaceState、不追加历史）；④ `goBack()` → `#/scroll` 页面随路由回切；⑤ dev 模式 `navigator.serviceWorker.controller === null`（SW 仅 PROD 注册）。

实现锚点：`src/hooks/useHashRoute.ts`（解析/归一/navigate/hashchange 汇聚）；`src/App.tsx`（路由替代内部 state，MenuDock active 读路由）。

## TC-14 SW 冒烟（细节）

生产产物 + `vite preview --port 4173`（用例自管起停）上验证：注册成功且 `controller.scriptURL` 以 `/sw.js` 结尾；`caches` 含 `app-shell-<version>` 且 version 与 `/sw-manifest.json` 一致；缓存条目含 `'/'` 与 ≥1 条 `/assets/*`；`[data-update-toast]` 首装不出现；`cdn-models-v1` 记录为证据不作硬断言（依赖外网）。

实现锚点：`public/sw.js`（install 预缓存 / activate 清旧 / fetch 四档 / SKIP_WAITING）；`vite.config.ts` swManifest 插件（version 注入 sw.js 是更新提示能触发的命门）；`src/sw.ts`（PROD-only 注册 + 5min/visibilitychange 轮询）；`src/components/UpdateToast.tsx`。

### TC-14 手工更新流（5 步，不自动化）

1. `pnpm build`（记下 `dist/sw-manifest.json` 的 version）；
2. 改动任意源码后再次构建 → version 与 `dist/sw.js` 字节均变化；
3. preview 起服务，打开已被旧 SW 控制的页面；
4. DevTools → Application → Service Workers → Update（或等 5 分钟轮询 / 切回标签页 visibilitychange 触发检查）;
5. 右下角出现「发现新版本」toast → 点「立即更新」→ 新 SW 接管（controllerchange）→ 页面自动刷新一次，刷新后 toast 消失。

不做自动化的原因：更新链路依赖真实的新旧 SW 交接与用户点击，Playwright 上下文里伪造 waiting/controllerchange 的注入式断言不可信，不造假。
