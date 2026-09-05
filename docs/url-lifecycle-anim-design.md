# 「URL 生命周期」全链路动画技术方案

> 状态：已评审定稿，可直接实施。知识底稿：`docs/url-lifecycle.md`（第一、三、四、五、八、九、十、十一章）。
> 技术选型已定：纯 GSAP（无 Lottie），全程 `transform` / `opacity` composite 级动画。播放器与 `src/components/event-loop/` 同构，但独立实现、零跨模块 import。

---

## 1. 背景与目标

现有动画站已覆盖事件循环、Fiber、滚动、粒子等主题。「从输入 URL 到页面渲染完成，再到 F5 刷新」是前端性能知识的总纲——CDN、缓存、`defer`、`transform` 动画等每一招优化都能在这条链路上找到对应环节（底稿开篇语）。本模块把它做成可逐步播放的两幕动画：

- **幕一「首次加载」20 步**：URL 解析 → DNS 四层 → TCP/TLS → CDN/Nginx → 资源加载 → 渲染管线六阶段 → 上屏。
- **幕二「F5 刷新」14 步」**：主文档 `max-age=0` 协商 → 304；子资源强缓存命中 `from disk cache` 0 请求出网；`no-cache` 语义澄清；TLS 会话复用。

目标验收标准：

1. 每一步的技术断言与知识底稿逐句可对（§5.3 核对表）。
2. 全程无 layout / paint 级动画属性，只动 `transform` 与 `opacity`。
3. 播放器操作集与 event-loop 完全同构：Play/Pause、单步前后、0.5x/1x/2x、进度点跳步、重播。
4. 剧本数据是纯 TS 常量，可被 Node 脚本静态校验（§10）。

## 2. 总体架构

**Stage[]（链路快照数组）是单一真相源。** 每一步 Stage 描述「这一步谁活跃、哪些数据包在飞、缓存判定落在哪个分支、渲染管线亮到第几格」。GSAP timeline 只负责「从上一步快照过渡到当前步快照」，React state 只持有 `stepIndex`（由播放头时间派生），数据流严格单向：

```
stages/firstLoad.ts ──┐
                      ├─► Scenario（静态剧本常量，单一真相源）
stages/refresh.ts ────┘        │
                              ▼
                useScenarioPlayer(scenario)
          useLayoutEffect 内 gsap.context 一次性建 timeline
                              │
              ┌───────────────┴────────────────┐
              ▼ 命令式：只写 transform/opacity  ▼ 声明式：由 stepIndex 渲染
        舞台 DOM（节点/数据包/判定分支/   DetailBar 文案、步号、
        渲染泳道，全部常驻、显隐由时间轴控制） 进度点高亮、缓存徽标
              ▲                                │
              └──── 用户操作（play/pause/seek/倍速）────┘
```

三条不变量：

1. **舞台 DOM 常驻**：所有节点、数据包、泳道在挂载时一次性渲染（两幕合计约 60 个数据包元素），GSAP 用 `autoAlpha` 控制显隐。任何时刻的画面是播放头时间的**纯函数**，`seek` 前后结果一致，单步与跳步天然正确。
2. **stepIndex 只由时间派生**：`stepIndex = floor(tl.time() / STEP_SECONDS)`，React state 不参与逐帧样式，杜绝 React 渲染与 GSAP tick 竞态。
3. **剧本与表现分离**：`stages/*.ts` 不含任何坐标或动画参数；`layout.ts` 不含任何剧本语义。改文案不动动画，改布局不动剧本。

与 event-loop 模块的同构与差异（同构指交互语义，实现零共享）：

| 维度 | event-loop | url-lifecycle（本模块） |
|---|---|---|
| 播放内核 | lottie-web 帧（`FRAMES_PER_STEP=30`） | GSAP timeline（`STEP_SECONDS=1.6`） |
| stepIndex 派生 | `floor(frame / FRAMES_PER_STEP)` | `floor(tl.time() / STEP_SECONDS)` |
| 单步落点 | 步末帧 `i*30+29` | 步边界 `i*per`（步首即成，§6.1） |
| 倍速 | `lottieRef.setSpeed(s)` | `tl.timeScale(s)` |
| 舞台缩放 | ResizeObserver → `scale(w/1200)` | 同一模式复刻（各自实现） |
| 文本同步 | React overlay 按 step 渲染 | 同（DetailBar 按 stepIndex 渲染） |

## 3. 核心数据模型

`src/components/url-lifecycle/types.ts` 完整接口（成品，可直接落码；缩进遵循仓库 tab 风格）：

```ts
export const STAGE = { w: 1200, h: 800 } as const;
export const STEP_SECONDS = 1.6; // 每步时长
export const TRANSITION = 0.4;   // 步间过渡窗 D

export type NodeId =
	| 'browser'  // 浏览器（网络进程视角）
	| 'dnsCache' // DNS 第 1 层：浏览器 DNS 缓存
	| 'osCache'  // DNS 第 2 层：操作系统缓存（含 /etc/hosts）
	| 'ldns'     // DNS 第 3 层：本地 DNS 服务器（递归）
	| 'rootDns'  // DNS 第 4 层：根 → 顶级域 → 权威（迭代）
	| 'cdnEdge'  // CDN 边缘节点（GSLB 选出的那台）
	| 'nginx';   // 源站 Nginx

export type PacketKind =
	| 'request'      // HTTP 请求（出网方向）
	| 'response'     // HTTP 响应（回程方向）
	| 'dnsQuery'     // DNS 查询
	| 'dnsAnswer'    // DNS 应答
	| 'tcpSyn'       // TCP 三次握手第 1 包
	| 'tcpSynAck'    // TCP 三次握手第 2 包
	| 'tcpAck'       // TCP 三次握手第 3 包
	| 'tlsHandshake'; // TLS 握手报文（ClientHello/证书/PSK 等，label 区分）

export interface Packet {
	id: string;   // 步内唯一，建议 `${stage.id}:${序号}`，如 'f12:p1'
	from: NodeId; // 起点（决定初始锚点）
	to: NodeId;   // 终点（决定位移目标）
	kind: PacketKind;
	label: string; // 随包飞行的一行小字，如 'SYN(seq=x) 你能听到吗？'
}

export type CacheVerdict =
	| 'miss'           // 无本地副本，直接走网络（幕一第 3 步）
	| 'strongHit'      // 强缓存命中，不发请求 from disk cache（幕二第 8 步）
	| 'revalidate'     // 携条件头协商（max-age=0 / no-cache）
	| 'notModified304' // 协商命中，304 无响应体（幕二第 6 步）
	| 'fresh200';      // 全新 200 落缓存（幕一第 13 步）

export interface Stage {
	id: string;               // 'f01'..'f20' / 'r01'..'r14'，剧本内唯一
	title: string;           // 一步的短标题（DetailBar 主行、进度点 tooltip）
	detail: string;          // 成品解说文案（DetailBar 副行，§5 表内文字直接可用）
	activeNodes: readonly NodeId[]; // 本步高亮的节点，驱动 §6.2 激活动画
	packets: readonly Packet[];     // 本步在飞的数据包，驱动 §6.3 位移动画
	cacheVerdict?: CacheVerdict;    // 缺省表示本步不涉及缓存判定
	renderProgress?: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 渲染泳道已点亮的格数，单调不减
}

export type RenderLaneId =
	| 'parseHtml'
	| 'parseCss'
	| 'renderTree'
	| 'layout'
	| 'paint'
	| 'composite';

export type ScenarioId = 'first-load' | 'refresh';

export interface Scenario {
	id: ScenarioId;
	title: string;    // '首次加载' / 'F5 刷新'
	subtitle: string; // ScenarioPicker 卡片副标题
	stages: readonly Stage[];
}

export const ZONE_COLOR = {
	net: '#58a6ff',    // 网络：browser/cdnEdge/nginx、request/response 包
	dns: '#d29922',    // DNS：四层节点与 dnsQuery/dnsAnswer 包
	cache: '#bc8cff',  // 缓存：判定区、强缓存/协商/304 徽标
	render: '#3fb950', // 渲染：六格泳道与进度条
	danger: '#ff7b72', // 危险：MISS、回源、绕过缓存类警示
	text: '#e6edf3',   // 正文
	border: '#30363d', // 边框
	bg: '#0d1117',     // GitHub dark 底色
} as const;
```

## 4. 舞台布局（1200×800 逻辑坐标）

### 4.1 总图

```
(0,0) 1200×800，GitHub dark #0d1117，逻辑坐标后经 UrlLifecyclePage 等比缩放
┌────────────────────────────────────────────────────────────────┐
│ [urlBar 地址栏            40,24   1120×44                     ] │ 24–68
│ [DetailBar 解说条         40,80   1120×64                     ] │ 80–144
│                                                                │
│ ┌────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐ ┌────────────┐ │
│ │browser │ │dnsCache  │ │ cdnEdge │ │ nginx  │ │ 缓存判定区  │ │
│ │        │ ├──────────┤ │         │ │        │ │ CachePanel │ │
│ │40,190  │ │osCache   │ │470,190  │ │670,190 │ │ 870,170    │ │
│ │140×110 │ ├──────────┤ │150×110  │ │150×110 │ │ 290×254    │ │
│ └────────┘ │ldns      │ └─────────┘ └────────┘ └────────────┘ │
│            ├──────────┤ ┌─────────────────────┐                │
│            │rootDns   │ │ TLS 握手区 470,340  │                │
│            └──────────┘ │ 350×84              │                │
│             DNS 栈       └─────────────────────┘                │
│             x=230 w=190                                         │
│ ── 渲染管线泳道（区名标题 y=456）────────────────────────────── │
│ ┌───────┐┌───────┐┌───────┐┌───────┐┌───────┐┌────────┐        │
│ │Parse  ││Parse  ││Render ││Layout ││Paint  ││Composite│       │
│ │HTML   ││CSS    ││Tree   ││       ││       ││        │        │
│ │ 40,490││230,490││420,490││610,490││800,490││990,490 │        │
│ │ 170×  ││ 170×  ││ 170×  ││ 170×  ││ 170×  ││ 170×   │        │
│ │ 200   ││ 200   ││ 200   ││ 200   ││ 200   ││ 200    │        │
│ └───────┘└───────┘└───────┘└───────┘└───────┘└────────┘        │
│ [renderProgress 进度条    40,720   1120×24                    ] │ 720–744
└────────────────────────────────────────────────────────────────┘
```

### 4.2 节点坐标表（px，top-left 原点）

| 节点 / 区域 | x | y | w | h | 色相 | 说明 |
|---|---|---|---|---|---|---|
| urlBar 地址栏 | 40 | 24 | 1120 | 44 | text | 显示 `https://www.example.com/index.html`，刷新幕切换为 `⌘R/F5` 徽标 |
| DetailBar 解说条 | 40 | 80 | 1120 | 64 | text | title + detail 两行，右上角步号 `07/20` |
| browser | 40 | 190 | 140 | 110 | net | 双图标：浏览器 + 网络进程 |
| dnsCache | 230 | 170 | 190 | 56 | dns | 「浏览器 DNS 缓存」 |
| osCache | 230 | 238 | 190 | 56 | dns | 「OS 缓存 + /etc/hosts」 |
| ldns | 230 | 306 | 190 | 56 | dns | 「本地 DNS（递归）」 |
| rootDns | 230 | 374 | 190 | 56 | dns | 「根 → .com → 权威（迭代）」 |
| cdnEdge | 470 | 190 | 150 | 110 | net | 边缘节点，角标 `X-Cache: HIT/MISS` |
| nginx | 670 | 190 | 150 | 110 | net | 源站 Nginx + 应用服务器 |
| TLS 握手区 | 470 | 340 | 350 | 84 | dns→net 渐变 | 展示 ClientHello / 证书 / Finished / PSK 摘要行 |
| CachePanel 缓存判定区 | 870 | 170 | 290 | 254 | cache | 五分支迷你决策树（§6.4），右侧竖排 |
| parseHtml 泳道 | 40 | 490 | 170 | 200 | render | 「(1) Parse HTML → DOM」 |
| parseCss 泳道 | 230 | 490 | 170 | 200 | render | 「(2) Parse CSS → CSSOM」 |
| renderTree 泳道 | 420 | 490 | 170 | 200 | render | 「(3) Render Tree」 |
| layout 泳道 | 610 | 490 | 170 | 200 | render | 「(4) Layout 几何」 |
| paint 泳道 | 800 | 490 | 170 | 200 | render | 「(5) Paint 位图」 |
| composite 泳道 | 990 | 490 | 170 | 200 | render | 「(6) Composite GPU」 |
| renderProgress 进度条 | 40 | 720 | 1120 | 24 | render | 六段式填充，宽度 = renderProgress/6 |

`layout.ts` 另导出 `anchor(node: NodeId, side: 'left' | 'right' | 'top' | 'bottom')`：返回该矩形对应边中点坐标，数据包位移的起终点全部由它计算，剧本零坐标。

### 4.3 色相与徽标规则

| 元素 | 规则 |
|---|---|
| 节点边框 / 标题 | 所属分区色相：DNS 栈黄、其余网络节点蓝；未激活时边框回落 `#30363d`、文字 `#e6edf3` 60% 透明度 |
| 数据包胶囊 | 按 `kind` 取色（§6.3），胶囊内 label 一律 `#e6edf3`，字号 11px 保证 24 字内单行 |
| CachePanel 徽标 | `304` / `from disk cache` / `max-age=0` 等判定徽标用缓存紫；`MISS` / `回源` / `绕过` 类警示用危险红 |
| 渲染泳道 | 点亮态渲染绿 + 8% 透明度绿底；未点亮仅边框；`renderProgress` 进度条六段与泳道一一对应 |
| urlBar | 幕一显示完整 URL；幕二左侧追加 `⌘R/F5` 徽标（危险红描边提示「绕过强缓存」的动作语义） |

## 5. 两幕剧本（title/detail 为成品文案，可直接进代码）

### 5.1 幕一：首次加载（20 步，id `f01`–`f20`）

| # | 标题 | 活跃节点 | 数据包（kind from→to label） | 要点文案（detail） | 附加状态 |
|---|---|---|---|---|---|
| 1 | 输入 URL 并回车 | browser | — | 用户在地址栏输入 https://www.example.com/index.html 并回车；浏览器进程把导航请求交给网络进程，一切从这一刻开始。 | — |
| 2 | URL 解析与 HSTS 升级 | browser | — | 拆出协议 https、主机 www.example.com、路径 /index.html；HSTS 列表命中该域名，即使输入 http 也会被强制升级为 https。 | — |
| 3 | 浏览器 HTTP 缓存检查 | browser | — | 首次访问没有任何本地副本，判定未命中，只能走网络：先解析 IP，再建连接。 | cacheVerdict: miss |
| 4 | DNS 第 1 层：浏览器缓存 | browser, dnsCache | dnsQuery browser→dnsCache「www.example.com？」 | 进程内维护「域名 → IP」表，条目带 TTL；本例未命中，继续向外查——绝大多数请求其实走不到下一层。 | — |
| 5 | DNS 第 2 层：OS 缓存与 hosts | browser, osCache | dnsQuery browser→osCache「查 hosts / 系统缓存」 | /etc/hosts 静态映射优先级高于一切 DNS 查询，其次查系统级缓存；仍未命中，只能向本地 DNS 发真正的网络包。 | — |
| 6 | DNS 第 3 层：本地 DNS 递归 | browser, ldns | dnsQuery browser→ldns「www.example.com 的 IP？」 | 客户端只问一句，LDNS（运营商或 223.5.5.5 这类公共 DNS）承诺跑完整条解析链、拿到最终 IP 才返回；它自己也有缓存。 | — |
| 7 | DNS 第 4 层：迭代与 GSLB | ldns, rootDns | dnsQuery ldns→rootDns「问根(.)」；dnsAnswer rootDns→ldns「去问 .com」 | 根与顶级域只指路不给答案；权威 DNS 答 CNAME 指向 CDN，GSLB 按请求来源地理位置与节点负载返回最近的边缘节点 IP。 | — |
| 8 | DNS 应答回到浏览器 | ldns, browser | dnsAnswer ldns→browser「边缘节点 112.34.x.x（TTL 60s）」 | IP 沿原路返回并逐层缓存（浏览器、OS、LDNS 各自遵守 TTL）；浏览器拿到边缘节点 IP，DNS 阶段结束。 | — |
| 9 | TCP 三次握手：SYN | browser, cdnEdge | tcpSyn browser→cdnEdge「SYN(seq=x) 你能听到吗？」 | 向边缘节点 443 端口发出第一个 TCP 包；握手要三次，是因为双方都得确认「我能发你能收、你能发我能收」。 | — |
| 10 | SYN-ACK 与 ACK：连接建立 | browser, cdnEdge | tcpSynAck cdnEdge→browser「SYN-ACK(seq=y, ack=x+1)」；tcpAck browser→cdnEdge「ACK(ack=y+1)」 | 三个包走完，TCP 通道就绪。TLS 只能在这条通道上进行——先 TCP、再 TLS、最后 HTTP，顺序不能反。 | — |
| 11 | TLS 1.3 握手（1-RTT） | browser, cdnEdge | tlsHandshake browser→cdnEdge「ClientHello + key_share」；tlsHandshake cdnEdge→browser「证书 + Finished」 | 客户端首个包就带上密钥交换材料，一个来回完成协商；同时逐级校验证书链直至本地信任库里的根 CA。 | TLS 区亮「1-RTT」 |
| 12 | 发送 HTTPS 请求，边缘 MISS | browser, cdnEdge, nginx | request browser→cdnEdge「GET /index.html」；request cdnEdge→nginx「回源（MISS）」 | 边缘节点查本地缓存未命中（X-Cache: MISS），于是作为客户端向源站 Nginx 取主文档。 | cdnEdge 角标 MISS |
| 13 | Nginx 返回 200 主文档 | nginx, cdnEdge, browser | response nginx→cdnEdge「200 + gzip HTML」；response cdnEdge→browser「200」 | 源站返回压缩后的 HTML；边缘按源站响应头的 Cache-Control 决定本地缓存多久——一次配置、全网生效。 | cacheVerdict: fresh200 |
| 14 | 字节流到达，preload scanner 抢跑 | browser, cdnEdge | request browser→cdnEdge「GET app.9f8e7d.js / style.css」 | 主文档边下载边解析，独立的预加载扫描器并行扫出 CSS/JS/图片 URL 提前发请求，把「解析到才发现」的串行等待变成并行下载。 | — |
| 15 | Parse HTML → DOM | browser | — | 字节流解码成字符、切 Token、拼成 DOM 树，全程流式、收到多少解析多少；非 defer 的 script 会中断这一步。 | renderProgress: 1 |
| 16 | Parse CSS → CSSOM | browser | — | CSS 阻塞的是首次渲染而不是 DOM 解析——浏览器不敢把半成品样式画给你看；DOM 与 CSSOM 都就绪才能往下走。 | renderProgress: 2 |
| 17 | defer 脚本按序执行 | browser | — | app.9f8e7d.js 已并行下载完，在 DOMContentLoaded 之前按文档顺序执行；执行前不阻塞解析，业务脚本一律 defer。 | renderProgress: 2 |
| 18 | DOM + CSSOM → Render Tree | browser | — | 只保留可见节点：display:none 不进 Render Tree；visibility:hidden 仍在（占位但不可见）。 | renderProgress: 3 |
| 19 | Layout 与 Paint | browser | — | Layout 从根递归算出每个节点的精确位置尺寸；Paint 把各层内容绘制成位图，填充像素、画文字与阴影。 | renderProgress: 5 |
| 20 | Composite：GPU 合成上屏 | browser | — | 合成线程把各层按正确顺序合成最终画面并上屏，首屏完成；transform 与 opacity 只走这一步——这正是 GSAP 动画快的根本原因。 | renderProgress: 6 |

> 说明：第 4、5 步的 `dnsQuery` token 是「进程内 / 本机查找」的可视化，不代表网络包出网，label 已用「查缓存」措辞区分。

### 5.2 幕二：F5 刷新（14 步，id `r01`–`r14`）

| # | 标题 | 活跃节点 | 数据包（kind from→to label） | 要点文案（detail） | 附加状态 |
|---|---|---|---|---|---|
| 1 | 按下 F5：普通刷新 | browser | — | Cmd+R / F5 只对地址栏这个主文档「不讲情面」，子资源照常讲缓存规则；Ctrl+F5 才是对谁都翻脸的强制刷新。 | urlBar 亮 ⌘R 徽标 |
| 2 | 主文档绕过强缓存 | browser | — | 刷新请求头自动带 Cache-Control: max-age=0，跳过本地副本的强缓存判定、直接与服务器协商，同时保留 If-None-Match 条件头。 | cacheVerdict: revalidate |
| 3 | DNS：浏览器缓存直接命中 | browser, dnsCache | dnsAnswer dnsCache→browser「www.example.com → 边缘 IP」 | 刚访问过的域名还留在浏览器 DNS 缓存里（TTL 未过），一个包都不出网；绝大多数 DNS 查询止步于第 1、2 层。 | — |
| 4 | TLS 会话复用 | browser, cdnEdge | tlsHandshake browser→cdnEdge「PSK（上次会话票据）」 | keep-alive 连接还活着就完全免握手；若已断开，TLS 1.3 凭缓存的 PSK 跳过证书与密钥交换，1-RTT 甚至 0-RTT 重建通道——二次访问快就靠它。 | TLS 区亮「Session Resumption」 |
| 5 | 协商请求出网 | browser, cdnEdge, nginx | request browser→cdnEdge「GET /index.html + If-None-Match: "33a64df5"」；request cdnEdge→nginx「转发校验」 | 请求带着上次存下的 ETag 出网；ETag 优先于 Last-Modified——内容指纹比只有 1 秒精度的修改时间可靠。 | — |
| 6 | 服务器比对：304 | nginx, cdnEdge, browser | response nginx→cdnEdge「304 Not Modified」；response cdnEdge→browser「304（无响应体）」 | ETag 比对未变，服务器只回一个头、没有 body；304 表达的不是「没有资源」，而是「你手里那份仍然有效」。 | cacheVerdict: notModified304 |
| 7 | 主文档续期，进入解析 | browser | — | 浏览器用本地副本并更新其有效期，拿到的是与上次一模一样的 HTML，直接进入渲染管线。 | — |
| 8 | 子资源判定：强缓存未过期 | browser | — | app.9f8e7d.js 的 Cache-Control: max-age=31536000 远未过期（指纹文件名配 immutable，连刷新都不再协商），浏览器根本不向服务器发请求。 | cacheVerdict: strongHit |
| 9 | from disk cache：0 请求出网 | browser | — | DevTools 显示 200 (from disk cache)，Size 列标的是缓存来源而非传输字节；刚用过的热资源也可能 from memory cache——热的放内存、冷的放磁盘。 | 缓存区亮 disk cache 徽标 |
| 10 | no-cache 不是不缓存 | browser | — | 主文档的 no-cache 指令含义是「可以缓存副本，但每次使用前必须协商」；真正完全不缓存的是 no-store——这对名字最容易骗人。 | cacheVerdict: revalidate |
| 11 | Parse HTML → DOM | browser | — | 重新解析主文档；304 省掉的是传输体积，解析的工作量一点没少。 | renderProgress: 1 |
| 12 | Parse CSS → CSSOM | browser | — | CSS 从磁盘缓存瞬时就绪，没有网络往返；缓存优化的是「等待」，不是「工作」。 | renderProgress: 2 |
| 13 | Render Tree + Layout | browser | — | 可见节点合成渲染树并完成几何计算，与首次加载完全同构——刷新省下的全部时间都在网络与缓存侧。 | renderProgress: 4 |
| 14 | Paint + Composite：二次上屏 | browser | — | 对账：出网请求只有 1 个 304，命中强缓存的子资源 0 请求——这就是 F5 比首次访问快得多的全部秘密。 | renderProgress: 6 |

### 5.3 技术断言核对表（幕二必含项 → 底稿出处）

| 必含断言 | 剧本步骤 | 底稿章节 |
|---|---|---|
| 主文档 `Cache-Control: max-age=0` 协商 → 304 | r02、r06 | §8.1 场景 2、§8.3 |
| 子资源强缓存命中不发请求，`from disk cache` | r08、r09 | §8.1、§8.2、§8.5 |
| `no-cache` 不是不缓存（可缓存但须协商；`no-store` 才是不缓存） | r10 | §8.2 指令表 |
| TLS 会话复用（Session Ticket / PSK，1-RTT 甚至 0-RTT） | r04 | §4.5 |
| ETag / If-None-Match 优先于 Last-Modified | r05 | §8.3 |
| DNS 先查缓存后出网，多数止步第 1、2 层 | r03 | §1.2、§3.1 |
| 304 无响应体、本地副本续期 | r06、r07 | §8.3 |

## 6. GSAP 动画设计

### 6.1 时间轴结构：步首即成

核心约定：**第 i 步的全部过渡 tween 放在窗口 `[i*per − D, i*per]`（per = 1.6s，D = 0.4s；第 0 步固定在 t=0、时长 0.01s）**。即过渡发生在「上一步的末段」，播放头走到步边界 `i*per` 时，第 i 步状态恰好完全呈现——这保证 `tl.pause().seek(i*per)` 一步到位且双向正确。

```
t: 0      1.6      3.2      4.8                    n*per(总时长)
   |——步0——|——步1——|——步2——|——…——|——步 n-1————|
             ↖D=0.4 过渡窗（步内前 1.2s 保持、末 0.4s 过渡到下一步）
   seek(i*per) = 第 i 步完成态
```

构建骨架（`useScenarioPlayer` 内，`gsap.context` 中执行）：

```ts
const tl = gsap.timeline({ paused: true, onUpdate: syncStepFromTime });
tl.to({}, { duration: stages.length * per }); // 占位：锁定总时长 = 步数 × 每步秒数
stages.forEach((stage, i) => {
	const start = i === 0 ? 0 : i * per - D;
	const dur = i === 0 ? 0.01 : D;
	buildNodeTweens(tl, stage, start, dur);    // §6.2
	buildPacketTweens(tl, stage, i, start);     // §6.3
	buildCacheTweens(tl, stage, start, dur);    // §6.4
	buildLaneTweens(tl, stage, start, dur);     // §6.5
});
```

同一属性在相邻窗口各有一个 `fromTo` 时，后一个必须带 `immediateRender: false`，避免构建期把末态渲染到 DOM 上。

### 6.2 节点激活：scale + 光晕层

激活 = `scale 0.96 → 1.04`（`back.out(2)`）+ 节点内预置的 `[data-glow]` 光晕层 `opacity 0 → 1`。光晕层是半径渐变的独立元素，视觉等效 `box-shadow`，但动画属性是 opacity，保持 composite；失活由下一步的 `fromTo` 反向接管（scale 回 1、光晕归 0）。

### 6.3 数据包：x/y 插值位移

数据包是绝对定位的小胶囊元素（label 随行），常驻 DOM：

```ts
const a = anchor(p.from, sideOf(p.from, p.to)); // 起点锚点
const b = anchor(p.to, sideOf(p.to, p.from));   // 终点锚点
tl.fromTo(el, { x: a.x, y: a.y, autoAlpha: 0 },
	{ autoAlpha: 1, duration: D }, start);
tl.fromTo(el, { x: a.x, y: a.y },
	{ x: b.x, y: b.y, duration: per * 0.9, ease: 'power1.inOut', immediateRender: false }, start);
tl.to(el, { autoAlpha: 0, duration: D }, (i + 1) * per - D); // 下一步过渡窗内淡出
```

颜色按 `kind` 取 `ZONE_COLOR`（dnsQuery/dnsAnswer 黄、tcp\*/tlsHandshake 蓝、request 蓝、response 绿偏蓝）。飞行路径为直线插值——纯 transform，无 SVG path 计算。

### 6.4 缓存判定：分支高亮

CachePanel 内预渲染五条分支（miss / strongHit / revalidate / notModified304 / fresh200）迷你决策树（对应底稿 §8.4 流程图）。`stage.cacheVerdict` 命中的分支 `opacity 0.15 → 1` + 分支徽标 `scale 0.8 → 1`，未命中分支回落 0.15；无 `cacheVerdict` 的步骤面板整体降为 0.35 待机透明度。

### 6.5 渲染泳道：六阶段渐进填充

每格泳道内含一个填充层（fill）：`scaleY 0 → 1`、`transformOrigin: '50% 100%'`，自下而上点亮；`renderProgress` 决定点亮到第几格（`renderProgress: 5` = 前五格亮）。底部六段进度条按 `renderProgress/6` 做宽度分段点亮（各段独立 scaleX）。幕二复用同一套泳道，从 0 重新点亮，直观对照「缓存省的是网络、渲染照做」。

### 6.6 倍速与单步

- **倍速**：`tl.timeScale(0.5 | 1 | 2)`，不改 per，纯播放速率缩放。
- **单步**：`tl.pause(); tl.seek(clamp(i) * per)`——因「步首即成」（§6.1），落点即完成态，向前向后同样成立。
- **重播**：`tl.seek(0).play()`；**播完自动停**：`onComplete: () => setPlaying(false)`；**末步再按 Play**：`if (tl.time() >= total - 0.01) tl.seek(0)` 后 `play()`。

DetailBar 文案由 React 按 `stepIndex` 渲染；`stepIndex` 变化时补一发装饰性脉冲 `gsap.fromTo(bar, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3 })`。文案内容本身是 `stepIndex` 的纯函数，脉冲只是装饰，不影响 seek 正确性。

## 7. 组件文件清单（`src/components/url-lifecycle/`）

| 文件 | 一句话职责 |
|---|---|
| `types.ts` | §3 全部领域类型、常量（STAGE/STEP_SECONDS/TRANSITION/ZONE_COLOR） |
| `stages/firstLoad.ts` | 幕一 20 步剧本常量（纯数据，无坐标无动画） |
| `stages/refresh.ts` | 幕二 14 步剧本常量 |
| `layout.ts` | 节点坐标表、`anchor()` 锚点计算、泳道/判定区矩形 |
| `useScenarioPlayer.ts` | GSAP timeline 播放器 hook：build/play/pause/stepTo/seek/setSpeed/replay，`onUpdate` 派生 stepIndex |
| `NetworkStage.tsx` | 中部网络管线：七个节点、常驻数据包元素、TLS 握手区，接受 refs 注册回调 |
| `CachePanel.tsx` | 右侧缓存判定区：五分支决策树与徽标 |
| `RenderPipeline.tsx` | 底部六格泳道 + 六段进度条 |
| `DetailBar.tsx` | 顶部解说条：title/detail 成品文案、步号、幕名 |
| `ScenarioPicker.tsx` | 两幕选择卡片（首次加载 / F5 刷新），含各自副标题 |
| `UrlLifecyclePage.tsx` | 页面组装：Picker ↔ 舞台切换、ResizeObserver 等比缩放（复刻 EventLoopStage 的 stageWrap 模式） |
| `index.ts` | `export { UrlLifecyclePage } from './UrlLifecyclePage';` |
| `url-lifecycle.module.css` | GitHub dark 变量、分区色相、常驻元素样式（glow 层、泳道、胶囊） |

## 8. 播放器时序

- **总时长** = 步数 × `STEP_SECONDS`：幕一 `20 × 1.6 = 32s`，幕二 `14 × 1.6 = 22.4s`（由 §6.1 的占位 tween 锁定）。

```
播放头 t ──►  0     1.6     3.2     4.8                n*per
              |——步0——|——步1——|——步2——| … |——步n-1——|
stepIndex        0        1       2     …      n-1        = floor(t/per)
DetailBar     f01      f02     f03    …     f(n)         文案瞬时切换+脉冲
过渡窗 D=0.4      [──────][──────][──────]                落在每步末段
进度点状态        ●       ◐→●     ◐→●    …              past/current/future
```

一次典型交互的完整时序（用户点第 7 个进度点）：

```
click dot(7) → stepTo(7) → tl.pause() + tl.seek(7*1.6=11.2s)
  → onUpdate 触发 → setStepIndex(7) + setProgress(11.2/total)
  → React 重渲染 DetailBar(f08 文案)/步号 07/20/进度点高亮
  → GSAP 在 seek 瞬间已把全部常驻元素渲染为第 7 步完成态（纯函数，无中间帧）
```
- **stepIndex 双向绑定**：
  - 时间轴 → UI：`onUpdate` 里 `setStepIndex(clamp(floor(tl.time() / per)))`，同时 `setProgress(tl.time() / total)`；DetailBar 文案、步号、进度点高亮全部由这两个 state 派生。
  - UI → 时间轴：进度点点击 / 单步按钮调用 `stepTo(i)`，内部 `tl.pause().seek(i * per)`；seek 触发 `onUpdate`，state 与播放头重新对齐。两个入口（自然播放、用户跳步）收敛到同一条 `onUpdate` 通路，不存在回写环路。
- **进度点渲染**：`stages.length` 个圆点横排（34 步以内无需滚动），当前步实心放大（`scale 1.3`，纯 transform），已过步半透明实心，未到步空心；每点 `title` 属性取 `stage.title` 作 tooltip。进度条本体（细线）+ 圆点双层结构，与 event-loop 的 frameMap 语义对齐。
- **操作集**（与 event-loop 同构，语义一致）：`play` / `pause` / `toggle` / `stepForward` / `stepBackward` / `stepTo(i)` / `setSpeed(0.5|1|2)` / `replay` / `seek(t)`，外加派生值 `stepIndex` / `playing` / `speed` / `progress` / `total`。

## 9. 错误处理与清理

1. **gsap.context + useLayoutEffect**：timeline 在 `useLayoutEffect(() => { const ctx = gsap.context(() => { /* build */ }, stageRef); return () => ctx.revert(); }, [scenario.id])` 中创建。`revert()` 同时 kill 全部 tween 并把 DOM 恢复到构建前状态，是唯一正确的清理入口；不用 `useEffect`，避免首帧闪烁。
2. **StrictMode 双挂载**：开发模式挂载→卸载→再挂载，`ctx.revert()` 幂等，第二次构建在干净的 DOM 上进行，无叠加动画。
3. **组件卸载**：`revert()` 已含 `kill()`；再显式 `tl.kill()` 一次作防御性收尾（timeline 引用存 ref，不进依赖数组）。ResizeObserver 在同层 effect 里 `disconnect()`。
4. **Scenario 切换重建**：`<UrlLifecycleStage key={scenario.id} scenario={scenario} />`——key 强制整舞台重挂载，refs、timeline、常驻包元素全部重建，杜绝跨剧本残留；播放器 state（playing/speed）随之重置为初始值，符合「换幕即重播」的直觉。
5. **seek 越界与后台节流**：所有 seek 目标先 clamp 到 `[0, total]`；GSAP `lagSmoothing` 在后台标签页补帧跳时，画面仍是时间的纯函数，恢复前台后状态无损。
6. **剧本数据防御**：`useScenarioPlayer` 入口对 `stages` 做一次空数组与 `renderProgress` 越界断言（开发态 `console.error`），脏数据在构建期暴露而非播放期崩帧。

## 10. 验证策略

### 10.1 Node 静态校验（`scripts/validate-url-lifecycle.ts`，`npx tsx` 运行，进 `package.json scripts.check:url-lifecycle`）

1. 幕一恰 20 步、幕二恰 14 步；两幕 `Stage.id` 各自唯一且符合 `f01..f20` / `r01..r14`。
2. 所有 `activeNodes` / `Packet.from` / `Packet.to` ∈ `NodeId` 合法集合；`Packet.from !== Packet.to`。
3. 每个数据包的 `from`、`to` 均出现在同一步 `activeNodes` 中（画面上包的两端必须亮）。
4. `renderProgress` ∈ 0..6 且逐剧本单调不减；幕一末步为 6、幕二末步为 6。
5. 幕二必含 `cacheVerdict: 'notModified304'`（304）与 `cacheVerdict: 'strongHit'`（disk cache）各至少一步。
6. 幕二文案关键词齐备：`max-age=0`、`304`、`disk cache`、`no-cache`、`会话复用`。
7. 幕一必含 `tcpSyn` / `tcpSynAck` / `tcpAck` 三种包各至少一次（三次握手完整）。
8. 每步 `title` 非空 ≤ 16 字、`detail` 非空 ≤ 90 字、`Packet.label` ≤ 24 字（舞台排版约束）。
9. `Scenario` 无循环引用、可 `JSON.stringify`（纯数据校验）。

### 10.2 Playwright 验收条目（只列清单）

1. 菜单页出现 🌐 卡片，点击进入 url-lifecycle 页面。
2. ScenarioPicker 两幕可切换，切换后舞台重建、步号归 0。
3. Play 开始推进、Pause 暂停后 stepIndex 冻结。
4. 单步前后在 0 与 N−1 边界处 clamp 不越界。
5. 0.5x / 1x / 2x 切换后实际推进速率符合倍率。
6. 进度点跳到第 i 点，画面状态与连续单步到 i 完全一致（截图比对）。
7. 重播回到第 0 步并自动播放；播完自动停在第 N−1 步。
8. 幕二第 6 步出现 304 徽标、第 8/9 步出现 disk cache 徽标。
9. 切走至其他动画再切回，无报错、无残留动画元素（DOM 节点数恢复基线）。
10. 全程 Performance 面板无 Recalculate Style / Layout 尖峰（抽样录制 10s）。

## 11. 接入点

共改两个既有文件、新增一个目录：

1. `src/App.tsx`：
   - `AnimationType` 联合类型追加 `'url-lifecycle'`；
   - `renderAnimation` 的 switch 增加 `case 'url-lifecycle': return <UrlLifecyclePage />;`；
   - 底部 `MenuPage` 的 `animations` 数组追加卡片：`{ id: 'url-lifecycle', name: 'URL Lifecycle', icon: '🌐', color: 'from-cyan-500 to-blue-500' }`；
   - 顶部 `import { UrlLifecyclePage } from '@/components/url-lifecycle';`。
2. `src/components/controls/AnimationControls.tsx` 第 7–13 行 `animations` 数组追加：`{ id: 'url-lifecycle', label: 'URL生命周期', icon: '🌐' }`（与既有五项同格式，位于「事件循环」之后）。
3. 新增 `src/components/url-lifecycle/`（§7 全部 13 个文件），除 `index.ts` 对外导出 `UrlLifecyclePage` 外不暴露任何内部符号，不 import event-loop 模块。
