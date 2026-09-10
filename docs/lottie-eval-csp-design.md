# Lottie 去 eval（CSP 兼容）设计方案

> 状态：待评审（§4 选型与 §8 开放问题需拍板后，另行开实施分支执行，本分支不含实现代码）
> 日期：2026-09-10 · 分支：docs/lottie-eval-csp-design
> 范围：仅设计；行号锚点以 lottie-web@5.13.0 / lottie-react@2.4.0 / 当前 main 代码为准

---

## 1. 背景与问题

### 1.1 现象

- Lighthouse 报告：`Content Security Policy of your site blocks the use of 'eval' in JavaScript`（DevTools Issue 形态，`script-src blocked`，相关节点为菜单按钮之外的 lottie 相关页面会话）。
- `vite build` 日志持续警告：

```
node_modules/.pnpm/lottie-web@5.13.0/.../build/player/lottie.js (14422:32):
Use of eval in "lottie.js" is strongly discouraged as it poses security risks and may cause issues with minification.
```

### 1.2 根因（取证结论）

- 产物 `dist/assets/lottie-vendor-BA3_MfSC.js:17` 中的调用点原文（grep 实证）：

```js
expression_function = eval("[function _expression_function(){" + val + ";scoped_bm_rt=$bm_rt}]")[0]
```

- 这是 lottie-web **完整版内置的 AE 表达式引擎**：运行时把动画 JSON 里的表达式字符串 `eval` 成 JS 函数。
- `lottie-react@2.4.0`（package.json:30）默认解析到完整版（lottie-web `package.json` 的 `main → build/player/lottie.js`）。

### 1.3 与 CSP 的冲突原理

- CSP `script-src` 不含 `unsafe-eval` 时，浏览器拒绝一切字符串求值 → 表达式动画失效，且 Lighthouse/DevTools 记录违规。
- **悬案记录**：当前线上（`gsap.wetogether.best`，Cloudflare → 宿主 nginx 反代 → docker）`curl -sI` 实测响应头**无 CSP**；仓库源码 / 产物 / nginx 配置全量 grep 亦无 CSP 定义。该次 Lighthouse 会话的 CSP 来源未定位（存疑方向：浏览器扩展注入 header、或其他测试环境）。
- 本方案使产物**零 eval**，无论哪一层将来出现何种 CSP 都不再触发该违规——悬案与生产正交，无需先解悬案。

## 2. 现状事实（取证快照 2026-09-10）

| # | 事实 | 锚点 / 证据 |
|---|---|---|
| 1 | 渲染器为 svg（未覆写） | `src/components/lottie/LottieAnimation.tsx`（仅 `lottie-react` 默认配置） |
| 2 | 唯一静态动画资产 `loading.json` | `src/assets/loading.json` |
| 3 | 该 JSON 的 `"x"` 字段是**数值数组**（拆分维度坐标），非表达式 | 实测值：`"x": [0.833], "y": [0.833]`、`"x": [0.167]` |
| 4 | 该 JSON 的 `"ef"`（特效）字段 0 命中 | `grep -c '"ef"'` = 0 |
| 5 | event-loop 动画由代码生成，不产出表达式 | `src/components/event-loop/compiler/lottieCompiler.ts`、`shapeBuilders.ts`（全 src 无 expression 痕迹） |
| 6 | 全仓对 lottie-web 的直接引用仅经 lottie-react | `LottieAnimation.tsx:1` 起的 import 链 |
| 7 | light ESM 构建可用 | `lottie-web/build/player/esm/lottie_light.min.js`（同目录含 light_canvas / light_html 变体） |
| 8 | 基线产物体积 | `dist/assets/lottie-vendor-BA3_MfSC.js` = 329.61 kB（gzip 85.48 kB） |

## 3. 目标与非目标

**目标**

- G1 产物零 `eval` / `new Function`（任意 CSP 环境可运行）
- G2 现有动画（loading.json、event-loop 生成动画）视觉零回归
- G3 未来新增 lottie JSON 有明确准入路径与守门（可扩展性：表达式先"编译/烘焙"再入库）
- G4 lottie chunk 体积下降（表达式引擎占完整版不小份额）

**非目标**

- N1 不在本方案内给站点补全 CSP（另行任务）
- N2 不实现表达式引擎的运行时替代品

## 4. 方案选型

```
┌────┬──────────────────────────────────────┬─────────────────────────────────────┐
│方案 │ 改法                                   │ 代价 / 收益                          │
├────┼──────────────────────────────────────┼─────────────────────────────────────┤
│ A+ │ vite alias 切 light 版 + 资产烘焙准入   │ eval 根除 + 体积下降 + 静默失效变为   │
│推荐 │ 规范 + 构建期守门脚本                   │ 显性报错；未来 JSON 走"先烘焙再入库"  │
│ A  │ 仅 vite alias 切 light 版               │ eval 根除，但误引表达式 JSON 会静默   │
│    │                                        │ 失效（无守门）                        │
│ B  │ CSP script-src 加 'unsafe-eval'        │ 安全倒退 + Lighthouse csp-xss 扣分， │
│    │                                        │ 治标                                 │
│ C  │ 不动（线上当前无 CSP，实际不拦）          │ Rollup 警告常在，未来一上 CSP 即爆雷  │
└────┴──────────────────────────────────────┴─────────────────────────────────────┘
```

## 5. 详细设计（A+）

### 5.1 运行时切换：vite alias

```ts
// vite.config.ts
resolve: {
  alias: {
    'lottie-web': 'lottie-web/build/player/esm/lottie_light.min.js',
  },
},
```

- 作用面：别名发生在模块解析层，`lottie-react` 内部的 `import 'lottie-web'` 一并被改写，无需改动业务代码。
- TypeScript 类型不受影响（类型仍走包内 `*.d.ts`，light 与完整版对外 API 同面）。
- light 版限制：仅 svg 渲染器、无表达式引擎、无特效支持——与 §2 现状事实 1/3/4/5 全部兼容。

### 5.2 资产准入规范（"编译后再用"）

表达式的本质是用 JS 公式描述运动（`loopOut()`、`wiggle()` 等），可以在**导出期**求值并固化为逐帧 keyframes（烘焙），运行时只吃纯数据：

1. **AE 导出时烘焙**（首选）：Bodymovin / LottieFiles 插件导出设置勾选 convert/bake expressions；
2. **在线工具**：LottieFiles 上传 → Smart Bake / Flatten → 下载烘焙版；
3. **批量脚本**（按需再建，不过度设计）：Node 脚本批量烘焙入库。

**准入判定**（与守门脚本共用）：JSON 中不得出现——

- 字符串值的 `"x"` 键（表达式特征；数值数组是拆分维度坐标，放行）
- 非空 `"ef"` 数组（特效，light 版不支持）

### 5.3 构建期守门（防静默失效）

新增 `script/check-lottie-assets.mjs`（设计要点）：

- 扫描范围：`src/assets/**/*.json`；event-loop 编译器产出的模板同步纳入
- 规则 1：递归查找键 `"x"` 且值为字符串 → 违规
- 规则 2：键 `"ef"` 且为非空数组 → 违规
- 白名单：文件级 allowlist（脚本头部常量），应对误报
- 输出：违规 `文件路径 + 字段位置 + 烘焙指引`（指向 §5.2），exit 1
- 接入点：`package.json` 的 `build` 链（`tsc -b && node script/check-lottie-assets.mjs && vite build`）+ pre-commit 快扫
- 反向测试：构造带 `"x": "wiggle(2, 10)"` 的 fixture，守门必须 fail

### 5.4 兜底双通道（仅设计位，暂不实现）

- 触发条件：出现确实无法烘焙的表达式动画
- 形态：该动画组件 `import()` 动态加载完整版 lottie-web，`manualChunks` 隔离为独立按需 chunk
- 代价声明：eval 回到该按需 chunk，所在环境需 CSP 放行 `unsafe-eval`——**默认禁用，启用需显式评审**

### 5.5 风险与缓解

| 风险 | 缓解 |
|---|---|
| R1 未来误引入带表达式 JSON | §5.3 守门拦截，静默失效 → 显性报错 |
| R2 light 版 API 面（现用 `play/pause/stop/setSpeed/goToAndStop/getDuration`） | 均为基础 API，light 支持；实施时回归验证 |
| R3 alias 影响面外溢 | §2 事实 6：全仓仅 lottie-react 触达 lottie-web，无其它直接引用 |

## 6. 验收标准

1. `vite build` 日志中 `Use of eval` 警告消失；
2. `grep -oE "eval\(|new Function\(" dist/assets/lottie-vendor-*.js` → 0 命中；
3. lottie-vendor chunk 体积对比（基线 329.61 kB / gzip 85.48 kB，实施后回填）：`____ kB / gzip ____`；
4. 守门脚本对现有资产放行（loading.json 应通过）；
5. 反向测试：表达式 fixture 被拦截（exit 1）；
6. 视觉回归：lottie 页 + event-loop 页动画与现状一致。

## 7. 实施任务拆分（拍板后执行，预期独立实施分支）

1. vite alias → build → 验收 2/3（回填体积数据）
2. 守门脚本 + fixture 反向测试 + 接入 build / pre-commit
3. 准入规范说明（烘焙指引）补入本文件或 README
4. 视觉回归 checklist 走查

## 8. 开放问题（需拍板）

- Q1：兜底双通道（§5.4）是否保留设计位？**推荐：保留文档、不写代码**
- Q2：守门挂载点？**推荐：build + pre-commit 双挂**（脚本本地毫秒级）
- Q3：现有 `loading.json` 是否做一次烘焙验证？**推荐：保持不动**（§2 事实 3/4 已验证无表达式/特效）
