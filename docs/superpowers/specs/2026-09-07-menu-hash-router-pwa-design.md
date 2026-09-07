# menu-hash 路由与 PWA（SW）设计文档（Design Spec）

- 日期：2026-09-07
- 状态：已确认（用户逐项批准）并已实现（套件 14/14 通过）
- 分支：feat/menu-hash
- 分工：主 agent 负责方案设计与验证脚本设计；免费子 agent 负责文档编写、脚本把控与验收、业务代码实现

## 1. 总览

两层能力叠加在既有多动画菜单应用上：**全菜单 Hash 路由化**（页面切换由 URL `#/<animationId>` 驱动，可直链、可分享、前进后退语义完整）与**自研轻量 Service Worker PWA 化**（应用壳预缓存 + 静态资源缓存 + CDN 模型缓存 + 版本检测 + toast 手动刷新更新流）。

已确认决策：全菜单路由化（不只智驾页）｜自研 SW（零第三方依赖，不用 Workbox）｜CDN 模型纳入 SW 缓存（LRU 限容）｜更新提示用 toast + 用户手动「立即更新」（不静默 auto-reload）。

## 2. Hash 路由设计

落点：`src/hooks/useHashRoute.ts`（约 50 行，全部逻辑集中于此）；`src/App.tsx` 以路由结果替代原内部 state 切页，`MenuDock` active 高亮改读路由。

- **解析** `parseHashRoute(hash)`：剥掉 `#` 与可选 `/` 前缀后，在 `KNOWN_IDS`（= `MENU_ENTRIES` 注册项 id 集合，单一事实源——菜单注册即路由可达）中查表；空或未知 id → `DEFAULT_ROUTE = 'three-car-nav'`。
- **归一** `normalizeHash()`：URL 中的 raw hash 不在 `KNOWN_IDS` 时，以 `history.replaceState` 改写为 `#/<DEFAULT_ROUTE>`——**replaceState 不追加历史记录**，保证 back 语义干净（back 回到真实上一页，而不是「未知的 #/unknown-id」）。
- **切换** `navigate(id)`：写 `window.location.hash`。同值赋值浏览器不触发 hashchange、不产生历史记录，天然幂等。
- **三入口同构**：dock 点击（`navigate` 写 hash → hashchange）/ 前进后退（浏览器触发 hashchange）/ 直链刷新（`useState` 惰性初始化即解析 + 首次挂载归一）三条路径**全部汇聚到同一个 hashchange → `normalizeHash` + `parseHashRoute` 管道**，行为一致由构造保证，不靠测试对齐。
- 页面渲染：`App.tsx` switch on route，`default` 分支兜底 `ScrollAnimation`（类型系统外的最后防线）。

## 3. Service Worker 设计

零第三方依赖。三个协作件：构建期插件（`vite.config.ts` 的 `swManifestPlugin`）、SW 本体（`public/sw.js`）、页面侧注册与更新流（`src/sw.ts`）。

### 3.1 sw-manifest 生成机制（构建期）

`swManifestPlugin` 挂 `writeBundle` 钩子（`generateBundle` 早于 vite 核心 html 产出，此时产物才完整）：

1. 汇总 `dist` bundle 键 + 递归收集的 `public/` 文件，剔除 `sw-manifest.json` / `sw.js` 自身，`indexOf` 去重 + 排序；
2. `version = sha256(全部文件名拼接).slice(0, 12)`——产物名带内容 hash，**内容变 → 名变 → version 变**；
3. 写 `dist/sw-manifest.json` `{ version, assets }`；
4. 把 `version` 注入 `dist/sw.js` 的 `__SW_VERSION__` 占位符（`split/join` 全量替换，绕开仓库 tsconfig lib 限制）。**这一步是更新流的命门**：`registration.update()` 只按 `sw.js` 字节比对，不注入版本号则更新提示永不触发。

### 3.2 缓存池命名与生命周期

| 缓存池 | 命名 | 语义 |
| --- | --- | --- |
| 应用壳 | `app-shell-<version>` | 版本化命名，activate 时按「不在保留集内即删」清旧版本 |
| CDN 模型 | `cdn-models-v1` | 固定名（模型内容不随构建变），跨版本复用，LRU 限 30 条（单分块 ~300KB → 上限 ≈ 10MB） |

install：`fetch('/sw-manifest.json', no-store)` 取清单，`['/', ...assets]` 逐条 `put`（`Promise.allSettled`，单个资源失败不拖垮整个 install）；**不自动 skipWaiting**，等页面指令。activate：删除保留集（两池）之外的缓存 → `clients.claim()`。

### 3.3 fetch 分发四档（仅 GET）

| 档 | 匹配 | 策略 | 理由 |
| --- | --- | --- | --- |
| ① | 同源 `/assets/*` | cache-first，miss 回源并回填 | 产物名带内容 hash，内容不可变，缓存永不过期 |
| ② | CDN 模型域（`z2586300277.github.io`） | cache-first + LRU | 模型大且不常变；`response.ok` 或 opaque（no-cors）响应均可入缓存；内存 Map 记录 lastUsed，超 30 条逐出最旧 |
| ③ | 导航请求（`mode === 'navigate'`） | network-first，断网/异常回退 `caches.match('/')` | 保证部署新版本后用户先拿到最新 index.html，离线时回落壳 |
| ④ | 其余（含 `/sw-manifest.json` 自身） | 放行直连 | 版本检测必须读到最新清单，任何缓存都会糊掉 update 判定 |

### 3.4 更新流（SKIP_WAITING，页面驱动）

页面侧（`src/sw.ts`）在 `load` 后 `register('/sw.js')`，随后双触发轮询 `registration.update()`：每 5 分钟 `setInterval` + `visibilitychange` 回到可见时。发现 waiting worker 的两条路径：打开页面时已有 waiting（上次检查发现、用户未处理）→ 直接通知；`updatefound` → `installing` 进入 `installed` 且页面已有 controller（首次安装不提示）→ 通知。用户点「立即更新」→ `postMessage({ type: 'SKIP_WAITING' })` → SW `skipWaiting()` → `controllerchange` → 带 `reloading` 守卫地 `reload()` 一次（防刷新循环）。

### 3.5 dev 不注册

`registerServiceWorker()` 首行 `if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;`——dev 模式完全无 SW（无缓存干扰、热更新不受劫持），`import.meta.env.PROD=false` 时注册代码被 DCE 消除。SW 冒烟验证走 `vite preview` 生产服（TC-14）。

## 4. 更新 toast 交互流

`src/components/UpdateToast.tsx`：右下角玻璃拟态 toast（样式语言对齐 hud-control-panel），`data-update-toast` + `role="status"` + `aria-live="polite"`。流：`App.tsx` 订阅 `subscribeWaitingSW` → `waitingSW` 非空才挂载 toast（首装无提示的 UI 侧保障）→ 点「立即更新」（`onApply = applyUpdate`）→ 3.4 节接管链 → 刷新后 toast 随新页面消失。

## 5. 验证方案

- 用例全集与判定细节见 `script/three-car-nav/cases.md`（TC-01..14，每条：前置 → 步骤 → 通过标准 → 产物）；
- 用例索引总表（一行一用例 + TC-13/14 细节 + 手工更新流）见 `docs/superpowers/plans/2026-09-07-menu-hash-test-index.md`；
- 执行入口：`node script/three-car-nav/run.mjs`（自管 dev/preview server 起停，产物落 `artifacts/three-car-nav/suite-<stamp>/`）；2026-09-07 全量实测 14/14 PASS。

## 6. 已知边界

- **更新流为手工验证项**：新旧 SW 交接依赖真实 `registration.update()` 与用户点击，Playwright 上下文里伪造 waiting/controllerchange 的注入式断言不可信，不做假自动化。5 步手工流程沉淀在 cases.md TC-14 与测试索引文档。
- **.env 地雷（已修复，记录在案）**：仓库 `.env` / `.env.example` 曾钉死 `NODE_ENV=development`，vite 构建读取该值导致本地 `pnpm build` 产出 dev 模式 bundle（`import.meta.env.PROD=false`、SW 注册代码被 DCE、React jsxDEV 运行时）。修复：删除两文件中的钉死行（commit `7f03cf7`），修复后全 bundle jsxDEV=0、SW 恢复注册。TC-14 为此加的「产物含 jsxDEV 时以 `NODE_ENV=production` 强制重建」workaround 成为冗余但无害，保留不动。
