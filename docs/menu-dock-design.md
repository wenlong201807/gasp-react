# 主菜单右侧停靠（Menu Dock）设计方案

> 状态：待评审（§2 冲突解法与 §9 开放问题需用户拍板后方可进入实施）
> 日期：2026-09-06 · 分支：feat/men-ui
> 范围：仅设计，不含实现代码；所有行号锚点以当前 main/feat 分支代码为准

---

## 1. 现状与目标

### 1.1 现状

菜单目前是**全屏页面**，而仓库里**已存在一个右侧停靠 dock**，两者职能高度重叠：

```
App.tsx:22-51
└─ Layout（常驻）
   ├─ FPSPanel           fixed top:16 right:16  z-index 9999   src/components/fps/FPSPanel.module.css:2-4
   ├─ WebVitalsPanel     fixed top:80 right:16  z-index 9998   src/components/performance/WebVitalsPanel.module.css:2-4
   ├─ <currentAnimation> ── default ⇒ MenuPage（全屏主菜单）   src/components/menu/MenuPage.tsx:59-98
   └─ AnimationControls  fixed top:50% right:0  z-index 200    src/components/controls/AnimationControls.tsx:20-82
      ├─ handle（14px 竖把手，hover 微加宽到 18px）
      └─ panel（168px，onMouseEnter/Leave + gsap.fromTo opacity+x 淡入淡出）
         └─ 6 项：主菜单 🏠 / scroll / lottie / fiber-todo / event-loop / url-lifecycle
```

关键事实：

- MenuPage（src/components/menu/MenuPage.tsx:59-98）是纯静态卡片网格 + CSS hover transition（menu.module.css:66-76），零 GSAP。
- AnimationControls（src/components/controls/AnimationControls.tsx:32-45）已实现「hover 展开 / 离开收起」dock 雏形，但动画只是 8px 位移 + 淡入（非滑出），且把手仅 14px。
- AnimationControls 还背着与本交互无关的职责：`usePerformanceMonitor` 的 recordLCP/FID/CLS 埋点（AnimationControls.tsx:24-30）。
- 视图状态：`useState<AnimationType>('menu')`（App.tsx:22），`'menu'` 即全屏 MenuPage（App.tsx:37）。
- GSAP 统一入口 src/utils/gsap.ts:1-7（已注册 ScrollTrigger/Flip），封装 hook src/hooks/useGSAP.ts:7-34（gsap.context + contextSafe）。

### 1.2 目标

把主菜单改造成右侧停靠导航组件（下称 **MenuDock**）：

| 项 | 目标 |
|---|---|
| 默认态 | 贴页面右缘收起，仅露出一个竖向把手，宽约 32px |
| hover | 平滑滑出（translateX），完整展示面板，power3 缓动，约 0.35-0.5s |
| 移开 | 动画收回，重新贴住右缘 |
| 动画约束 | 仅 transform / opacity（合成器友好），可中断（gsap overwrite） |
| 输入 | 鼠标 hover + 键盘 focus + 触屏点击三通道全覆盖 |

### 1.3 前后对比

```
改造前                                改造后（方案 A，见 §2）
┌───────────────────────┐            ┌───────────────────────┐
│ FPS ▓▓ / Vitals ▓▓(右上)│            │ FPS ▓▓ / Vitals ▓▓(右上)│
│                       │            │              ┌──────┬┐│
│   MenuPage 全屏       │   ──►      │  当前动画视图 │条目...│☰││
│   (5 张大卡片)         │            │  (常驻)      │条目...│☰││
│                       │            │              └──────┬┘│
│              [☰dock]  │            │              32px 把手│
└───────────────────────┘            └───────────────────────┘
菜单是「一个视图」                       菜单是「常驻边缘组件」
导航入口 ×2（MenuPage + dock）          导航入口 ×1（MenuDock）
```

---

## 2. 与 AnimationControls 的冲突解法（核心决策，需拍板）

两者都挂在页面右缘、都做 AnimationType 切换、数据项 100% 同构（MENU_ENTRIES 5 项 = AnimationControls 后 5 项，外加一个「主菜单」返回项）。改造后必有正面冲突，三选一：

### 方案 A（推荐）：MenuDock 吸收 AnimationControls，右缘只留一个 dock

- 做法：以 AnimationControls 的 dock 骨架（fixed right / 竖把手 / hover 展开 / `pointer-events` 穿透模式，AnimationControls.module.css:3-12）为交互容器，面板内容升级为 MENU_ENTRIES 的富条目（icon + 名称 + desc + meta 紧凑行，视觉沿用 menu.module.css 的 GitHub dark 体系）；把手加宽到 32px；滑出动画重写为本设计 §4 时序。**删除 AnimationControls.tsx**，其性能埋点（AnimationControls.tsx:24-30）迁往 Layout.tsx（常驻、与 UI 无关，本就是更合理的宿主）。
- 理由：
  1. 职能完全重叠——同一状态 `currentAnimation` 的两个写入口，纯冗余；
  2. 右缘同时挂两个 32px 把手，hover 命中区互相挤压、穿行误触，且视觉噪音大；
  3. 只维护一套 intent/动画/可达性逻辑；z-index 200 的「边缘 dock 层」语义唯一；
  4. 用户心智简单：想切视图，只有一个地方可去。
- 代价：AnimationControls 的紧凑 168px 列表被 ~300px 富面板替代，展开时遮挡更多内容（§4.4 有 max-height + 滚动兜底）；埋点迁移触碰 Layout.tsx；`controls/` 目录组件需清理导出。

### 方案 B：双 dock 上下错位（MenuDock 上移到 top:15% 一带，AnimationControls 维持 top:50%）

- 理由：两组件各自独立演化，改动最小。
- 缺点：右缘两个把手、两套 hover 展开、去往同一批视图的重复语义；hover 穿行易误触发另一个 dock；后续每加一个视图要同步改两处。**仅当用户明确想让 AnimationControls 作为独立「调试坞」演化时才选。**

### 方案 C：抽通用 EdgeDock 原语（把手+滑出+intent 全部下沉），MenuDock 与调试坞都作为其消费者

- 理由：最工程化，未来可停靠 DevTools 类面板。
- 缺点：当前只有一个真实消费者，抽象超前，多一个实施步骤。**建议作为方案 A 落地后的非阻塞重构方向，不进本次工期。**

> **取舍结论：推荐 A。** 待用户确认（见 §9 Q1）。

---

## 3. 组件结构

### 3.1 文件与 DOM

新增 `src/components/menu/MenuDock.tsx` + `src/components/menu/menu-dock.module.css`；`MENU_ENTRIES` 先抽到 `src/components/menu/menu-entries.ts`（原 MenuPage.tsx:3-53 平移），供 dock（及可能保留的欢迎屏）共用。

DOM 示意（结构，非实现）：

```tsx
<nav className={dock}                    // fixed right:0 top:50% translateY(-50%) z-index 200
     onPointerEnter onPointerLeave       //   pointer-events:none（沿用 AnimationControls.module.css:11 的穿透技巧）
     onFocusCapture onBlurCapture>
  <div ref={panelRef} id="menu-dock-panel"
       className={panel}                 // position:absolute; right:100%（贴把手左侧）
       aria-hidden={!open}>              // collapsed 态 visibility:hidden（autoAlpha）
    <header>  标题 + 副标题               //   width 300px（<720px 视口 260px）
    <ul>
      {MENU_ENTRIES.map(e =>
        <li><button> icon | name+desc | meta </button></li>)}
    <footer>  监控徽标行（可裁剪）
  </div>
  <button ref={handleRef}
          className={handle}             // width 32px; align-self:stretch; 常态可见
          aria-expanded={open}           // 竖排 glyph：'菜单 ☰' ↔ '收起 ✕'
          aria-controls="menu-dock-panel"
          onClick={toggleForTouch} />
</nav>
```

要点：

- **root 宽度恒等于把手宽（32px）**，panel 绝对定位在 `right:100%`（把手左侧）。这样滑出动画只需驱动 panel 一个元素（`xPercent: 100 → 0`），把手永远钉在右缘不动——不会出现「整体平移导致把手也滑出屏幕」的错误结构。
- 面板收起态用 gsap `autoAlpha`（opacity + visibility）隐藏，收起时条目不可 Tab、不可点击，解决 aria-hidden 与焦点残留。
- 语义用 `<nav>` 而非现状的 `role="menu"`（AnimationControls.tsx:63）：这是页面级导航，`menu` 角色按 WAI-ARIA 需强制方向键管理，属过度承诺。小改进，随本次一并修正。

### 3.2 状态机

```
collapsed ──pointerEnter + 180ms intent──▶ expanding ──tween 0.45s onComplete──▶ expanded
expanded  ──pointerLeave + 240ms grace ──▶ collapsing ──tween 0.35s onComplete─▶ collapsed
     ▲                                     │
     └────── 任意中间态反向触发：killTweensOf(panel) + overwrite: true，从当前值补间到新目标 ──┘

旁路输入：
- 键盘 focusin(root) → 跳过 intent 直接 expanding
- Esc（面板内）    → collapsing，焦点归还 handle
- 触屏 (hover:none) → pointerEnter 不生效，仅 handle click 切换；面板外 pointerdown → collapsing
```

hover intent 参数（需求给定 150-300ms 区间）：

| 定时器 | 延迟 | 目的 |
|---|---|---|
| openTimer | 180ms | 鼠标去滚动条/路过右缘时不误展开 |
| closeTimer | 240ms | 从把手挪到面板、或意外划出时给予宽容期（收起容错 > 展开门槛，不对称是刻意的） |

所有 timer 存 ref，进入对方状态前互相 `clearTimeout`；展开/收起函数经 `useGSAP` 的 `contextSafe` 包裹（src/hooks/useGSAP.ts:10-17），卸载时随 `gsap.context.revert()` 一起清理。

### 3.3 动画可中断（伪代码）

```
expand():   gsap.killTweensOf(panel)
            gsap.to(panel, { xPercent: 0, autoAlpha: 1, duration: .45, ease: 'power3.out',
                             overwrite: true, onComplete: () => setPhase('expanded') })
collapse(): gsap.killTweensOf(panel)
            gsap.to(panel, { xPercent: 100, autoAlpha: 0, duration: .35, ease: 'power3.in',
                             overwrite: true, onComplete: () => setPhase('collapsed') })
```

- `xPercent`（百分比位移）而非 `x` 像素：与面板宽度解耦，改宽度不用改动画。
- `overwrite: true` + `killTweensOf` 双保险，快速 hover/leave 交替时从当前实际位置补间，无跳变、无半开卡死（同类问题的先例见 fiber-todo 验收记录中「连续打断」项与 `9c9f84a` 的 tween 打架教训，docs/superpowers/plans/2026-09-04-react-fiber-todo-anim.md:1614,1619）。
- phase 用 React state 驱动 aria 属性与样式钩子；transform 只由 GSAP 写，CSS 不碰 transform（避免双引擎打架）。

---

## 4. 动画时序表

### 4.1 主时序

| # | 元素 | 属性 | from → to | easing | 时长 | 触发 |
|---|---|---|---|---|---|---|
| 1 | panel | transform: xPercent | 100 → 0 | power3.out | 0.45s | expand（hover 180ms 后） |
| 2 | panel | autoAlpha（opacity+visibility） | 0 → 1 | power3.out（与 #1 同 tween） | 0.45s | 同上 |
| 3 | panel | transform: xPercent | 0 → 100 | power3.in | 0.35s | collapse（leave 240ms 后） |
| 4 | panel | autoAlpha | 1 → 0 | power3.in（与 #3 同 tween） | 0.35s | 同上 |
| 5 | 面板条目（可选增强） | y: 12→0 + autoAlpha | 隐藏 → 显示 | power2.out | 0.3s，stagger 0.04s | 每次进入 expanding 时重放 |
| 6 | handle glyph / 配色 | color / 字形切换 | — | CSS transition 0.2s ease（沿用现状 AnimationControls.module.css:27-30） | — | open 态切换 |

- #1-#4 与 #5 都**只写 transform / opacity**，不触碰布局属性，满足需求约束。
- #5 为可选项，5 条 × 0.04s stagger 总增量约 0.16s，在 0.45s 主位移内收敛，不会拖尾；如嫌闹可砍，见 §9 Q7。

### 4.2 will-change 与合成层策略

- panel 常驻 `will-change: transform, opacity`（单元素、常驻边缘，成本可忽略，且与现状 AnimationControls.module.css:63 一致）。
- GSAP 默认 `force3D` 会给 transform 加 translate3d 提升合成层，动画期间不重排不重绘。
- 备选严格策略（tween `onStart` 挂、`onComplete` 摘）仅在看门狗数据异常时再启用，默认不做。

### 4.3 Reduced Motion

`gsap.matchMedia()` 或 CSS `@media (prefers-reduced-motion: reduce)` 双轨：JS 侧 duration 置 0.01（保留状态机与可见性切换），CSS 侧砍掉 handle 的 transition。瞬时显示/隐藏，功能不残废。

### 4.4 空间与避让

- 面板宽 300px（<720px 视口 260px），`max-height: calc(100vh - 64px)` + 内部 `overflow-y: auto`。
- 右上监控面板（FPSPanel z 9999 / WebVitalsPanel z 9998）**层级保持在 dock（z 200）之上**：它们是调试 HUD，短视口下 dock 面板从其下方滑过可接受；dock 主动让位（max-height 收窄）只在视口 < ~700px 高时通过媒体查询降为 `max-height: 56vh`。若用户希望 dock 盖住监控，见 §9 Q5。

---

## 5. App.tsx 视图逻辑调整（按方案 A + Q2a 展开）

现状：`'menu'` 是六视图之一、初始值、MenuPage 全屏渲染（App.tsx:22-51）。菜单停靠后不再是一个「视图」，调整：

1. `AnimationType` 删除 `'menu'` 成员（App.tsx:13-19），初始值改 `'scroll'`（是否记忆上次视图见 §9 Q2）。
2. `renderAnimation()` 的 `default` 分支改为兜底渲染 `<ScrollAnimation />` 或保留 MenuPage 视 Q2 结论。
3. `<AnimationControls />`（App.tsx:46-49）替换为 `<MenuDock onSelect={setCurrentAnimation} currentAnimation={...} />`，仍在 Layout 内常驻。
4. MenuDock 的条目点击 → 切视图 + 立即 collapse() + 当前项高亮（沿用 btnActive 思路，AnimationControls.tsx:71）。
5. recordLCP/FID/CLS 埋点从 AnimationControls.tsx:24-30 迁至 Layout.tsx（首屏语义归属常驻层，一次到位）。
6. 清理：删除 `src/components/controls/`（含 index.ts 导出）；`MenuPage.tsx` 视 Q2 去留，`MENU_ENTRIES` 已抽独立文件不受影响。

---

## 6. 可达性与触屏

| 场景 | 行为 |
|---|---|
| Tab 聚焦 handle 或面板条目 | focusin → 立即展开（跳过 180ms intent） |
| 焦点在 dock 内移动 | 保持展开（focusout 时检查 relatedTarget 是否仍在 dock 内，出界才收） |
| Esc | 收回面板，焦点归还 handle（`handleRef.focus()`） |
| 收起态 | 面板 autoAlpha 隐藏 ⇒ visibility:hidden，条目自动脱离 Tab 序，无焦点陷阱 |
| 触屏 / `(hover: none)` | pointerEnter/Leave 逻辑整体禁用；点 handle 切换展开/收起；点面板外任意处收起（document pointerdown + contains 判定） |
| 混合输入（触屏笔电） | click toggle 与 hover 逻辑并存互不冲突（现状 AnimationControls.tsx:51-59 已验证此组合可行） |
| 屏幕阅读器 | handle：`aria-expanded` + `aria-controls` + 动态 `aria-label`（「展开菜单/收起菜单」）；面板：`aria-hidden` 随 phase；`<nav aria-label="动画视图切换">` |
| Reduced motion | §4.3，瞬时切换 |

---

## 7. 实施步骤拆分（每步可独立交给 coder）

> 约定沿用仓库现状：无测试框架，每步验证 = `pnpm exec tsc -b` + `pnpm exec biome check <files>`；最后统一 `pnpm build` + 浏览器验收。

| 步 | 内容 | 涉及文件 | 验收标准 |
|---|---|---|---|
| S1 | 数据抽离：`MENU_ENTRIES`/`MenuEntry` 平移到 `menu-entries.ts`，MenuPage 改 import | menu/MenuPage.tsx、新建 menu/menu-entries.ts | tsc/biome 过；dev 页面行为与现状完全一致 |
| S2 | MenuDock 骨架：§3.1 DOM + CSS，**静态常展开**渲染（临时并排挂 App，不动 AnimationControls），样式对齐 GitHub dark 体系 | 新建 MenuDock.tsx、menu-dock.module.css | dev 可见常展开面板 + 32px 把手；条目信息完整（icon/name/desc/meta）；当前项高亮 |
| S3 | 状态机 + 动画：§3.2 四态 + intent timers + §4.1 #1-#4（useGSAP contextSafe、killTweensOf、overwrite、autoAlpha） | MenuDock.tsx | hover 180ms 滑出 0.45s / leave 240ms 收回 0.35s；快速交替 3 次无跳变无卡死；收起态面板不可聚焦 |
| S4 | 输入旁路：键盘（focusin/Esc/焦点归还）、触屏（hover:none 分支、click toggle、外点收起）、reduced-motion | MenuDock.tsx、menu-dock.module.css | §8 清单 6-9 项手动可过 |
| S5 | 接线替换（依赖 §2 拍板=A）：App.tsx 按 §5 改造；埋点迁 Layout.tsx；删除 controls/ 目录与导出 | App.tsx、Layout.tsx、删 src/components/controls/** | tsc -b / biome check / pnpm build 全绿；无死引用；全视图切换正常 |
| S6 | 浏览器验收 + 验收记录回填本文档 §8 | — | 清单全勾或记录缺陷与根因 |

依赖关系：S1→S2→S3→S4 串行；S5 依赖 §2 拍板且在 S4 后执行；S6 收尾。S2-S4 期间不破坏现有页面（MenuDock 并排临时挂载），随时可回退。

---

## 8. 浏览器验收清单（pnpm dev → http://localhost:5173/）

颗粒度对齐 fiber-todo 验收记录（docs/superpowers/plans/2026-09-04-react-fiber-todo-anim.md:1600-1619）：

- [ ] 默认态：右缘仅 32px 把手，面板不可见、不可点击，Tab 序中无面板条目
- [ ] hover 把手约 180ms 后面板滑出，位移顺畅、power3.out 手感，总时长 ≈0.45s，末端无回弹/跳变
- [ ] 展开后移开约 240ms 面板收回（0.35s），最终 re-仅剩把手、面板 visibility:hidden
- [ ] hover→移开→hover 快速交替 ≥3 次：无半开卡死、无位移跳变（overwrite 生效）
- [ ] 鼠标从把手滑入面板内再滑出 dock：不误收（240ms grace 生效）；滑向右缘外侧立即收回
- [ ] Tab 聚焦把手 → 面板立即展开（无 180ms 等待）；Tab 在条目间移动面板保持展开
- [ ] 按 Esc → 面板收回且焦点回到把手
- [ ] 触屏模拟（DevTools coarse pointer）：点把手展开、再点收起；点面板外空白处收起
- [ ] 模拟 prefers-reduced-motion：无位移动画，面板瞬时显示/隐藏
- [ ] 点击条目 → 视图切换成功、dock 自动收回、该条目呈当前态高亮
- [ ] FPS/Vitals 面板（z 9998/9999）始终在 dock 面板之上；600px 高小视口下 dock 面板内部可滚动、不溢出视口
- [ ] 首屏加载后 recordLCP/FID/CLS 仍有打点（埋点迁移未丢，Web Vitals 面板有数）
- [ ] 全视图（scroll/lottie/fiber-todo/event-loop/url-lifecycle）逐一切换 + 返回，控制台 0 error/0 warning
- [ ] 动画进行中 FPS 面板读数 ≥55（合成层验证）
- [ ] `pnpm exec tsc -b`、`pnpm exec biome check src`、`pnpm build` 全部通过
- [ ] <720px 窄视口：面板宽 260px、把手仍 32px、无横向滚动条副作用

---

## 9. 开放问题（待用户拍板，本文档不擅自决定）

| # | 问题 | 选项与倾向 |
|---|---|---|
| Q1 | **冲突解法**（§2） | A 吸收合并（本文推荐）/ B 上下错位双 dock / C 通用 EdgeDock 原语。影响 S5 是否删 controls/。 |
| Q2 | **全屏 MenuPage 去留与初始视图** | a) 删除 MenuPage，启动直达 `'scroll'`（倾向，贴合「菜单不再全屏」）；b) 保留 MenuPage 作欢迎屏 + dock 首项「回到首页」，初始视图仍 `'menu'`；c) b + localStorage 记忆上次视图。 |
| Q3 | **面板条目形态** | 紧凑列表（同现 AnimationControls，高度小不滚动）vs 迷你卡片行（保留 desc/meta，需 max-height+滚动，倾向——信息量是 MenuPage 改造的初衷）。 |
| Q4 | **把手形态** | 全高 32px 竖条（命中区大，倾向）vs 居中 ~160px 短竖条 + 竖排「菜单」字样；是否要 hover 时 32→36px 微加宽（现状有 14→18px 先例）。 |
| Q5 | **与右上监控面板的层级** | 维持监控在上、dock 从其下滑过（倾向，调试 HUD 优先）vs dock 提到 z>9999 盖住监控。 |
| Q6 | **「主菜单 🏠」返回项**（仅 Q1=A 时相关） | Q2 选 a 则删除；选 b/c 则保留改造成「回到首页」。 |
| Q7 | **条目 stagger 入场**（§4.1 #5） | 要（更有 GSAP 味，倾向）/ 不要（更克制）。 |
