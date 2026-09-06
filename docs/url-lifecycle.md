# 从输入 URL 到页面渲染完成：完整链路与刷新差异

> **文档定位**：本文是 GSAP + Lottie 动画演示的知识底稿。动画性能优化的每一招（CDN、强缓存、`defer`、`transform` 动画）都能在这条链路上找到对应的环节。
>
> **读者**：前端工程师。阅读顺序由浅入深，每一步讲清「谁、做什么、为什么」。

---

## 一、总览

### 1.1 全景时序图

```
  用户输入 URL 并回车
        |
        v
  [浏览器] URL 解析 / HSTS 升级 / 重定向
        |
        v
  (0) 浏览器缓存检查 --命中--> 直接用本地副本(仍走渲染管线)
        | 未命中
        v
  (1) DNS 解析: 浏览器缓存 -> OS 缓存(/etc/hosts)
        |      -> 本地 DNS(LDNS, 递归查询)
        |      -> 根 -> 顶级域 -> 权威 DNS(迭代查询)
        v
  (2) CDN 调度: CNAME -> GSLB 返回最近边缘节点 IP
        |
        v
  (3) TCP 三次握手 (SYN -> SYN-ACK -> ACK)
        |
        v
  (4) TLS 握手 (1.2: 2-RTT / 1.3: 1-RTT)
        |
        v
  (5) CDN 边缘节点 --HIT--> 直接返回
        |                  (MISS/EXPIRED -> 回源 Nginx)
        v
  (6) HTTP 请求/响应 (状态码 / 缓存头 / 压缩)
        |
        v
  (7) 资源加载: HTML 为主文档,
        |      CSS/JS/图片由 preload scanner 提前发现
        v
  (8) 渲染管线: DOM + CSSOM -> Render Tree
        |      -> Layout -> Paint -> Composite
        v
  屏幕展示 (rAF 回调在 Style/Layout 之前执行)
```

### 1.2 三个最容易搞错的顺序问题

| 疑问 | 正确答案 |
|---|---|
| DNS 解析是先发网络包吗？ | **不是**。顺序永远是「先查缓存（浏览器 → 操作系统），都没有了才向本地 DNS 发网络包」。绝大多数请求在第 1、2 层就结束了。 |
| TLS 握手发生在什么之前？ | **TCP 之后、HTTP 请求之前**。先建 TCP 通道，再在通道上协商加密，最后才能发送明文之外的 HTTP 报文。DNS 只负责给 IP，不参与握手。 |
| DNS over HTTPS (DoH) 是什么？ | 一句话：把「浏览器 → 本地 DNS」这段明文 UDP 查询改成加密的 HTTPS 请求，防止运营商劫持/窥探，后续解析链路不变。 |

---

## 二、URL 解析与重定向（浏览器内部）

### 2.1 URL 结构拆解

```
https://example.com:443/path/page?id=42#top
  |         |        |      |       |      |
scheme    host     port   path   query  fragment
```

| 组成部分 | 本例取值 | 作用 | 谁消费它 |
|---|---|---|---|
| scheme | `https` | 协议，决定端口与加密方式 | 浏览器、服务器 |
| host | `example.com` | 域名，DNS 解析的输入 | DNS 系统 |
| port | `443` | 端口，https 默认 443 可省略 | TCP 层 |
| path | `/path/page` | 资源路径，交给源站路由 | Nginx / 应用 |
| query | `?id=42` | 参数，一般**参与缓存键**（query 变了缓存就失效） | 应用、缓存层 |
| fragment | `#top` | 纯浏览器端锚点，**不会发给服务器** | 浏览器 |

### 2.2 HSTS 检查（http → https 强制升级）

- **谁**：浏览器自身的 HSTS 列表（来源：站点此前返回过 `Strict-Transport-Security` 响应头，或浏览器内置预加载列表）。
- **做什么**：当用户输入 `http://example.com`，且该域名在 HSTS 列表中时，浏览器在**发起任何网络请求之前**就把它改写成 `https://example.com`。
- **为什么**：防止降级劫持（中间人把 https 压成 http）。
- **表象**：DevTools Network 面板里那条 `307 Internal Redirect` **不是服务器返回的**，它是浏览器内部重定向的记录，没有产生真实网络请求。

### 2.3 自动补全与 preload scanner

- 地址栏自动补全/搜索建议发生在回车**之前**，属于 UI 层，不影响请求链路。
- preload scanner（预加载扫描器）：HTML 主文档字节流一到，一个轻量级扫描器就**并行**扫出其中的 CSS/JS/图片 URL 提前发起请求，不必等解析器逐行遇到。细节见第九章。

---

## 三、DNS 解析（完整顺序）

DNS 的任务只有一个：把 `example.com` 变成 IP 地址。真实查询按下面 4 层**由近及远**依次进行，任何一层命中就停止。

### 3.1 第 1 层：浏览器 DNS 缓存

- **谁**：浏览器网络进程（Chrome 可在 `chrome://net-internals/#dns` 查看）。
- **做什么**：维护一张「域名 → IP」表，条目带 TTL（Chrome 通常上限约 1000 条，TTL 以 DNS 应答为准）。
- **为什么**：同一页面往往要解析同一批域名多次（主文档、CDN、统计脚本……），进程内缓存零成本。

### 3.2 第 2 层：操作系统缓存（含 /etc/hosts）

- **谁**：操作系统（macOS/Linux 走系统解析器，Windows 有 DNS Client 服务）。
- **做什么**：
  1. 先查 `/etc/hosts`（Windows 是 `C:\Windows\System32\drivers\etc\hosts`）的静态映射，**hosts 优先级高于一切 DNS 查询**；
  2. 再查系统级 DNS 缓存（macOS 可用 `sudo killall -INFO mDNSResponder` 打日志观察）。
- **为什么**：hosts 是最古老、最粗暴的本地覆盖手段，前端本地调试「把线上域名指到 127.0.0.1」就靠它。

### 3.3 第 3 层：本地 DNS 服务器（递归查询）

- **谁**：运营商 LDNS（如电信/联通自动分配的 DNS），或手动配置的公共 DNS（114.114.114.114、223.5.5.5、8.8.8.8、1.1.1.1）。
- **做什么**：**递归查询（Recursive Query）**——客户端只问一句「example.com 的 IP 是多少」，LDNS 必须负责跑完整条链路、拿到最终 IP 才返回。它自己有缓存，命中则直接应答（这也是全国大部分 DNS 查询的终点）。
- **为什么**：把「到处问」的复杂度集中到一台对网络拓扑更敏感的机器上，同时靠它的共享缓存摊薄解析成本。

### 3.4 第 4 层：根 → 顶级域 → 权威（迭代查询）

LDNS 缓存未命中时，它替客户端做**迭代查询（Iterative Query）**——每一级只告诉它「下一步去问谁」：

```
LDNS -> 根域名服务器(.)      : "去问 .com 顶级域服务器"
LDNS -> .com 顶级域服务器    : "去问 example.com 的权威 DNS"
LDNS -> 权威 DNS 服务器      : "A 记录 = 93.184.216.34" (含 TTL)
LDNS -> 缓存结果, 返回给浏览器
```

- **为什么分两种查询**：递归是「你给我最终答案」，迭代是「你告诉我下一个该问谁」。根服务器承受不起全球递归流量，所以只做指路。
- 全球 13 组根服务器（靠 anycast 在全球复制成上千个节点），`.com` 顶级域由 Verisign 运营，权威 DNS 通常由云厂商（阿里云解析、Route 53、Cloudflare DNS）提供。

### 3.5 记录类型、GSLB 与 CDN 调度

| 记录 | 含义 |
|---|---|
| A | 域名 → IPv4 地址 |
| AAAA | 域名 → IPv6 地址 |
| CNAME | 域名 → 另一个域名（别名），**是 CDN 调度的关键** |

CDN 场景下的典型解析链：

```
浏览器问: www.example.com
权威 DNS 答: CNAME -> www.example.com.cdn.dnsv1.com
CDN 的 GSLB 权威 DNS 答:
   根据请求来源 LDNS 的地理位置 + 节点负载,
   返回距离最近的边缘节点 IP (如 112.34.x.x)
```

- **GSLB（全局负载均衡）**：本质是「会看地理位置的 DNS」。它把 DNS 应答当成调度手段——北京用户解析到北京边缘节点，深圳用户解析到深圳边缘节点。
- **为什么用 CNAME 中转**：源站只需把自己的域名 CNAME 给 CDN 厂商，后续调度完全由厂商 GSLB 动态控制，源站不用关心节点增减。

### 3.6 DNS 缓存 TTL

- TTL 由**权威 DNS 的应答**携带，逐层缓存（浏览器、OS、LDNS 各自遵守）。
- 短 TTL（如 60s）：故障切换快、调度灵活，但解析频繁、延迟感知明显。
- 长 TTL（如 86400s）：解析快、压力小，但换 IP 后全网生效慢。
- 面试常考的「DNS 预解析」正建立在此之上：`<link rel="dns-prefetch" href="//cdn.example.com">` 提前把第三方域名解析好。

---

## 四、TCP 与 SSL/TLS

### 4.1 TCP 三次握手

```
客户端                          服务器
  | --- SYN (seq=x) -----------> |   你能听到吗?
  | <-- SYN-ACK (seq=y,ack=x+1)- |   能,你能听到我吗?
  | --- ACK (ack=y+1) ---------> |   能,开聊
```

- **为什么是三次**：双方都要确认「我能发你能收」且「你能发我能收」，两次无法确认后半个链路，三次是保证可靠的最小次数。
- 握手完成后才有连接，TLS 在这条连接上进行。
- **QUIC / HTTP3 一句话**：基于 UDP，把传输握手和 TLS 1.3 握手合并在一起（1-RTT 建连，重连 0-RTT），没有独立的「三次握手」过程，彻底消除了 TCP 队头阻塞。

### 4.2 TLS 1.2 握手（2-RTT）

```
RTT1:  ClientHello --------------------------------->
       (支持的套件/随机数)
       <----- ServerHello + Certificate +
              ServerKeyExchange + ServerHelloDone
RTT2:  ClientKeyExchange + ChangeCipherSpec + Finished
       <----- ChangeCipherSpec + Finished
之后开始发送加密的 HTTP 报文
```

- 证书在第一个 RTT 就下发，客户端开始验证；密钥交换（通常是 ECDHE）协商出对称会话密钥。
- 每次全新连接都要 2 个 RTT 才能发请求，这是 HTTPS 页面「首字节慢」的历史主因。

### 4.3 TLS 1.3 握手（1-RTT，支持 0-RTT 恢复）

```
RTT1:  ClientHello + key_share ------>
       <----- ServerHello + {证书, Finished}(已加密)
       client Finished ------>
之后立即发送加密的 HTTP 报文
```

- 关键改进：客户端在 ClientHello 里就带上密钥交换材料（key_share），服务端一个来回即可完成密钥协商——**TLS 1.3 建连是 1-RTT**（指从 ClientHello 到能发出首个应用数据需 1 个往返；严格计数握手报文本身常被描述为「1 个飞行往返 + 客户端 Finished 收尾」）。
- **0-RTT（early data）**：对最近访问过的站点，客户端凭缓存的 PSK 在第一个飞行包里就直接捎带 HTTP 请求，建连零等待；代价是 0-RTT 数据有重放风险，只允许用于幂等请求（GET）。

### 4.4 证书链校验与吊销检查

```
根 CA 证书 (预置于 OS/浏览器信任库, 自签名)
   └─ 签发 -> 中间 CA 证书 (服务器下发)
                └─ 签发 -> 站点证书 (example.com)
```

- 服务器通常下发「站点证书 + 中间 CA」，客户端逐级验签直到命中本地信任库里的根 CA；同时校验域名匹配、有效期、密钥用途。
- **吊销检查**：证书泄露后需要作废。两条途径——
  - CRL：下载整份吊销列表（笨重，已少用）；
  - OCSP：实时查询吊销状态（慢且隐私差），实践中主流是 **OCSP Stapling**——服务器定期把 OCSP 应答「钉」在握手时一并下发，客户端免二次查询。

### 4.5 会话复用与 SNI

- **Session Resumption（会话复用）**：TLS 1.2 用 Session ID / Session Ticket，TLS 1.3 用 PSK，跳过证书与密钥交换，把握手压缩到 1-RTT 甚至 0-RTT。二次访问站点快就靠它。
- **SNI（Server Name Indication）**：ClientHello 中明文携带目标域名，让同一 IP:443 上托管多个 HTTPS 站点的服务器知道该返回哪张证书。（扩展 ECH 正在把这段也加密。）

---

## 五、CDN 工作机制

### 5.1 边缘节点命中：直接返回

- **谁**：CDN 边缘节点（GSLB 在 DNS 阶段选出来的那台）。
- **做什么**：收到 HTTP 请求后先查本地缓存。命中则直接应答，报文头常带 `X-Cache: HIT`。
- **为什么**：静态资源（JS/CSS/图片/字体/Lottie JSON）的内容离用户越近，RTT 越小，首屏越快。

缓存状态三种典型值：

| 状态 | 含义 | 后续动作 |
|---|---|---|
| HIT | 缓存有效，直接返回 | 不回源 |
| MISS | 节点没有这份缓存 | 回源站取，取回后缓存一份 |
| EXPIRED | 缓存存在但已过有效期 | 回源校验/重新拉取 |

### 5.2 回源：MISS 时找源站（Nginx）

- **做什么**：边缘节点作为「客户端」向源站（通常是 Nginx）发起请求，取回资源后**按源站响应头里的 `Cache-Control` 决定本地缓存多久**。
- **为什么**：CDN 缓存策略默认尊重源站，源站的缓存头等于「一次配置、全网生效」。
- 源站还可以配置多层回源（边缘 → 区域节点 → 源站），减少源站压力。

### 5.3 动静态分离

| 流量类型 | 典型内容 | 路径 |
|---|---|---|
| 静态资源 | `*.js`、`*.css`、图片、Lottie JSON | 域名 CNAME 到 CDN，边缘就近返回 |
| 动态请求 | `/api/*`、登录、支付 | 域名直连源站（或走动态加速链路），**不缓存** |

- **为什么**：静态资源可缓存、QPS 高，放 CDN 性价比最高；API 带状态、要求强一致，回源处理。
- 实践上通常拆成两个域名（如 `static.example.com` 走 CDN、`api.example.com` 直连源站），同时天然分散了浏览器对单域名 6 条 TCP 连接的限制。

---

## 六、Nginx 与源站

### 6.1 Nginx 的两个角色

**角色一：静态资源服务器**——直接读磁盘上的文件返回。

```nginx
location /assets/ {
    root /var/www/dist;
    expires 1y;                      # 强缓存一年
    add_header Cache-Control "public, immutable";
    gzip on;
    gzip_types text/css application/javascript;
}
```

**角色二：反向代理 / 负载均衡**——把请求转发给后面的应用服务器。

```nginx
upstream app {
    server 10.0.0.1:3000;            # Node/Java 应用实例
    server 10.0.0.2:3000;
}
location / {
    proxy_pass http://app;           # 转发并做负载均衡
    proxy_set_header Host $host;
}
```

- **为什么需要反向代理**：应用实例可以水平扩缩容，Nginx 统一对外；顺带集中做 TLS 卸载、压缩、限流、灰度路由。

### 6.2 传输优化三件套

| 手段 | 做什么 | 为什么有效 |
|---|---|---|
| gzip / brotli 压缩 | 文本类资源（JS/CSS/HTML/JSON）压缩后传输，brotli 压缩率比 gzip 高约 15-20% | 文本重复率高，压缩比常达 3-5 倍；图片/视频已压缩，不再 gzip |
| HTTP/2 多路复用 | 同一条 TCP 连接上并发多个流，二进制分帧 | 消除 HTTP/1.1 的 6 连接限制与队头排队，域名分片技巧随之作废 |
| keep-alive | 连接复用 | 免去每个请求重复 TCP+TLS 握手 |

---

## 七、HTTP 请求与响应

### 7.1 请求报文结构

```http
GET /index.html HTTP/1.1            <- 请求行: 方法 路径 协议版本
Host: example.com                   <- 必备, 虚拟主机路由依据
Accept: text/html,...               <- 能接受的内容类型
Accept-Encoding: gzip, deflate, br  <- 能接受的压缩算法
User-Agent: Mozilla/5.0 ...         <- 客户端标识(服务端据此做 UA 嗅探)
Cookie: session=abc123              <- 状态凭证, 每次同域请求自动携带
If-None-Match: "abc"                <- 协商缓存条件头(见第八章)
```

### 7.2 状态码重点

| 状态码 | 含义 | 前端关注点 |
|---|---|---|
| 200 | 成功 | 配合 DevTools 的 `(from disk cache)` 出现时，**请求其实没出网**（强缓存命中时 DevTools 仍显示 200） |
| 301 | 永久重定向 | 浏览器/搜索引擎会缓存，改起来难，慎用于可能反复的场景 |
| 302 | 临时重定向 | 每次都再问服务器，登录回跳常用 |
| 304 | Not Modified | 协商缓存命中，**没有响应体**，客户端用本地副本 |
| 404 | 资源不存在 | 前端部署后最常见的「白屏 + 404」多半是路径/publicPath 配错 |

### 7.3 响应头重点

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8   <- 决定解析方式(MIME),错了可能当文本下载
Content-Encoding: gzip                   <- 实际使用的压缩算法
Cache-Control: max-age=31536000          <- 强缓存时长(秒), 优先级最高
Expires: Wed, 01 Jan 2028 00:00:00 GMT   <- 绝对过期时间,被 Cache-Control 覆盖
ETag: "33a64df5"                         <- 资源指纹,协商缓存第一优先
Last-Modified: Tue, 15 May 2026 08:00:00 GMT  <- 修改时间,协商缓存兜底
Strict-Transport-Security: max-age=31536000   <- HSTS,让浏览器记住只用 https
```

- **为什么 `Content-Type` 重要**：浏览器按 MIME 决定「渲染成页面还是下载」，`X-Content-Type-Options: nosniff` 会强制它严格信任该头。
- **缓存三巨头 `Cache-Control` / `ETag` / `Last-Modified`** 的完整分工在下一章展开。

---

## 八、浏览器缓存（核心）

### 8.1 三种访问场景对照表

| 场景 | 主文档（HTML） | 子资源（JS/CSS/图片） | 网络表现 |
|---|---|---|---|
| 1. 首次访问 | 无任何缓存 | 无任何缓存 | 全部请求出网，全部 200 全量下载，无 304 |
| 2. 普通刷新（F5） | **绕过强缓存**：请求头带 `Cache-Control: max-age=0` 强制与服务器协商 → 有 `ETag`/`Last-Modified` 则可 304 | 按正常规则：强缓存未过期则**不发请求**（DevTools 显示 `200 from disk cache`）；已过期则协商，可能 304 | 出网请求大幅减少，主文档常见 1 个 304，命中强缓存的子资源 0 请求 |
| 3. 强制刷新（Ctrl+F5 / Cmd+Shift+R） | **全部绕过**：请求头带 `Cache-Control: no-cache` 且**不带**条件头，服务器只能回 200 全量 | 同样绕过，全部 200 全量重新下载 | 出网请求最多，0 个 304 |

> 勘误（领域专家审校）：强刷请求头常见为 `Cache-Control: no-cache`（部分实现亦带 `Pragma: no-cache`）；「绕过」指的是**跳过本地缓存判定并禁止条件请求**，并非清空磁盘缓存文件。

**记忆锚点**：F5 只对「当前地址栏这个文档」不讲情面，对子资源照常讲缓存规则；Ctrl+F5 对谁都翻脸。

### 8.2 强缓存（不发请求的那一档）

- **谁**：浏览器 HTTP 缓存（disk cache / memory cache）。
- **做什么**：`Cache-Control: max-age=N` 未过期期间，浏览器**根本不向服务器发请求**，直接用本地副本。Chrome DevTools 里表现为 `200 (from disk cache)` 或 `(from memory cache)`，Size 列显示的是缓存而不是传输字节数。
- **优先级**：`Cache-Control` **优先于** `Expires`。原因：`Expires` 是服务器生成的绝对时间，客户端时钟不准就全盘失效；`max-age` 是相对时长，与时钟无关。两者都在时只看 `Cache-Control`。

常用指令的精确语义：

| 指令 | 精确含义 |
|---|---|
| `max-age=N` | N 秒内强缓存命中，不发请求 |
| `no-cache` | **不是不缓存**。可以缓存副本，但每次使用前必须带着条件头去服务器协商（可 304） |
| `no-store` | 才是「完全不缓存」，任何副本都不落盘 |
| `public` | 中间代理/CDN 也可缓存 |
| `private` | 只允许浏览器缓存（CDN 不得缓存），用户态数据常用 |
| `immutable` | 告诉浏览器在有效期内**即使用户刷新也不要发起协商请求**。配指纹文件名（`app.a1b2c3.js`）使用，解决「F5 时带指纹的静态资源也要发一堆 304」的浪费 |

生产环境经典组合：

```
index.html   ->  Cache-Control: no-cache        (每次协商,保证发版即生效)
app.9f8e7d.js ->  Cache-Control: max-age=31536000, immutable
```

### 8.3 协商缓存（发了请求但可能不带响应体）

- **谁**：浏览器（带条件头发起请求）+ 服务器（比对后裁决）。
- **做什么**：
  - 浏览器把上次存下的 `ETag` 放进 `If-None-Match`、`Last-Modified` 放进 `If-Modified-Since`；
  - 服务器比对：没变 → 返回 **304 Not Modified（无响应体）**，浏览器更新本地副本的有效期后继续用；变了 → 返回 200 + 新资源 + 新的 ETag/Last-Modified。
- **优先级**：服务器校验时 **`ETag` / `If-None-Match` 优先于 `Last-Modified` / `If-Modified-Since`**。原因：`Last-Modified` 只有 1 秒精度，且文件被「改回原样」或秒内多次修改时不可靠；`ETag` 是内容指纹，能精确表达「内容是否真的变了」。
- **304 的语义**：它表达的不是「没有资源」，而是「你手里那份仍然有效」。没有 body，只有一个头的开销。

### 8.4 缓存决策流程图

```
发起资源请求
     |
     v
本地有缓存副本? --否--> 网络请求 --> 200(全量下载并缓存)
     | 是
     v
强缓存是否过期? (max-age / Expires)
     | 未过期                 | 已过期
     v                        v
不发任何请求, 直接       发协商请求, 带条件头
使用本地副本            If-None-Match (ETag)
200 (from memory        If-Modified-Since
 cache / disk cache)          |           |
                              v           v
                          未变: 304    已变: 200
                          用本地副本   新副本,
                          并续期       替换缓存
```

补充（领域专家审校）：`immutable` 的精确作用是——**普通刷新（F5）时**，未过期的 `immutable` 资源跳过「重新协商」，继续直接用本地副本；但**强制刷新（Ctrl+F5）依旧绕过一切**。地址栏回车的常规导航本就不触发协商，无需 `immutable` 参与。

### 8.5 memory cache vs disk cache

| 维度 | memory cache | disk cache |
|---|---|---|
| 存储位置 | 内存 | 磁盘 |
| 读取速度 | 极快（无 IO） | 较快（有磁盘 IO） |
| 生命周期 | 随**当前标签页进程**存活，关页即清 | 持久化，跨会话存活 |
| 典型内容 | 当前页面已加载的脚本、图片 | 一切可持久化资源，含主文档 |
| 分配策略 | 浏览器自动决策，一般**当前会话内已用过的小型资源**优先进内存 | 大文件、需要跨刷新保留的资源 |

- **为什么这么分**：内存宝贵且易失，磁盘便宜且持久。浏览器用「热的放内存、冷的放磁盘」平衡速度与容量。
- **可观察现象**：F5 后，上一次会话加载的资源多显示 `from disk cache`；同一标签页内二次进入或脚本动态再次请求同一图片，常显示 `from memory cache`。该分配是启发式的，不同浏览器/版本表现有差异，不必背具体规则。
- 注意：**强刷新会同时清掉这两类缓存对该站点的命中机会**（请求头层面的绕过），但不会清空磁盘文件本身。

### 8.6 Service Worker

一句话：一个可编程的网络代理，`fetch` 事件里自定义「缓存优先/网络优先/离线兜底」策略，优先级在 HTTP 缓存之上的应用层缓存（PWA 离线能力的基础）。

---

## 九、资源加载与解析

### 9.1 HTML 解析：字节 → DOM

```
字节流(网络) -> 按编码解码成字符流 -> 分词器切出 Token
  -> Token 转换为节点 -> 按嵌套关系构建 DOM 树
```

- **谁**：渲染进程主线程上的 HTML 解析器。
- **为什么分步讲**：这条流水线是**流式**的——收到多少解析多少，不用等整个文件下载完。

### 9.2 遇到 CSS：阻塞渲染，不阻塞 DOM 解析

- `<link rel="stylesheet">` 会阻塞**首次渲染**，但**不阻塞 DOM 树的继续解析**（HTML 解析器照常往下走）。
- **为什么**：CSS 可能改变任意元素的样式，浏览器不敢在 CSSOM 就绪前把「半成品样式」的页面画给你看（否则出现 FOUC 无样式闪烁）；但 DOM 构建本身不依赖 CSS。
- `media` 属性不匹配的样式表（如 `media="print"`）仍会下载，但**不阻塞渲染**。

### 9.3 遇到 JS：默认阻塞 DOM 解析

| 加载方式 | 下载时机 | 执行时机 | 阻塞 DOM 解析? |
|---|---|---|---|
| `<script src>`（默认） | 立即，阻塞解析 | 下载完立刻执行 | **是**（下载+执行全程阻塞） |
| `async` | 并行下载 | 下载完立刻执行（顺序不定） | 仅执行瞬间阻塞 |
| `defer` | 并行下载 | `DOMContentLoaded` 之前、按文档顺序执行 | 执行前不阻塞 |
| `type="module"` | 默认 defer 语义 | 同 defer | 执行前不阻塞 |

- **为什么默认阻塞**：脚本可能 `document.write` 或改 DOM，解析器必须停下来等它执行完，保证结果确定。
- **实践**：业务脚本一律 `defer`；统计类脚本可 `async`；入口模块用 `type="module"`。

### 9.4 preload scanner：不等解析器，提前下手

一句话：主文档字节流一到达，独立的预加载扫描器就并行扫出其中的 CSS/JS/图片 URL 提前发起请求，使「解析到 `<script>` 才发现要下载」的串行等待变成并行下载。

### 9.5 CSSOM 与渲染阻塞判定

- CSS 解析同样走「字节 → 字符 → Token → 节点 → CSSOM 树」。
- **首次渲染的硬性条件**：DOM + CSSOM **两者都就绪**。所以「大 CSS 文件 = 首屏变白」是结构性的，不是玄学。

### 9.6 关键渲染路径（CRP）

CRP = 从收到 HTML 到首次像素上屏所必需的最短步骤：**HTML → DOM，CSS → CSSOM，合成 Render Tree，Layout，Paint**。优化 CRP 的所有手段（内联关键 CSS、`defer` JS、压缩、CDN、缓存）都是在缩短这条链的长度或其中每段的耗时。

---

## 十、浏览器渲染管线（精确分步）

```
(1) Parse HTML  -> DOM 树
(2) Parse CSS   -> CSSOM 树
(3) DOM+CSSOM   -> Render Tree (可见节点)
(4) Layout      -> 几何计算, 输出盒模型
(5) Paint       -> 绘制为位图, 分层
(6) Composite   -> GPU 合成各层, 上屏
```

### 10.1 逐层拆解

1. **Parse HTML → DOM 树**：解析器把字节流转成树；`<script>`（非 defer/async）会中断此过程。
2. **Parse CSS → CSSOM 树**：样式规则树，含层叠与继承的计算结果。
3. **DOM + CSSOM → Render Tree**：只包含「可见」节点——`<head>`、`<meta>`、`display: none` 的元素都**不进入** Render Tree；`visibility: hidden` 的元素**仍在**（占位但不可见）。
   - 精确提醒：`display:none` 不进 Render Tree，但把元素在 `display:none` 与可见之间切换会改变布局树结构，**回流（reflow）依然会发生**——「不渲染」不等于「不参与布局计算」。
4. **Layout / Reflow**：从根开始递归计算每个可见节点的精确位置与尺寸，输出盒模型（Layout Tree）。视口宽度变化、字体加载完成都会触发。
5. **Paint**：把每个层的内容绘制成位图记录（填充像素、画文字、画阴影），可能拆成多个图层。
6. **Composite**：合成线程（GPU 加速）把各层按正确顺序合成最终画面并上屏。`transform`、`opacity` 走的就是这一步。

### 10.2 重排 / 重绘 / 合成

| 阶段 | 触发条件（典型） | 代价 |
|---|---|---|
| Reflow（重排/回流） | 改 `width/height/top/left/font-size`、增删 DOM、读写 `offsetWidth` 等几何属性 | 最高：Layout → Paint → Composite 全部重来 |
| Repaint（重绘） | 改 `color/background/visibility/box-shadow` | 中：跳过 Layout，Paint → Composite 重来 |
| Composite（合成） | 改 `transform/opacity` | 最低：跳过 Layout 与 Paint，只重新合成 |

**代价排序：reflow > repaint > composite**。GSAP 高性能动画的本质就是「把动画属性全部限制在 `transform`/`opacity` 上，把每帧成本压到 composite」。

### 10.3 与事件循环的关系

- 浏览器的事件循环在「渲染机会（rendering opportunities）」节点会执行一帧，帧内顺序为：
  `输入事件回调 / rAF 回调 / Style → Layout → Paint → Composite`。
- 也就是说：**requestAnimationFrame 回调在本帧的样式计算与布局之前执行**——GSAP 正是在这里完成插值计算并写入新样式，浏览器随后立刻用最新值做布局绘制，做到「一帧一改、绝不撕裂」。
- `setInterval`/`setTimeout` 没有这个保证（可能在帧渲染之后才触发，导致掉帧或「丢帧超时」），这是动画必须用 rAF 的根本原因。

---

## 十一、刷新场景完整对照

| 维度 | 首次访问 | F5 / Cmd+R 普通刷新 | Ctrl+F5 / Cmd+Shift+R 强制刷新 |
|---|---|---|---|
| 触发方式 | 地址栏回车 / 链接跳转 | F5、刷新按钮、Cmd+R | Ctrl+F5、Cmd+Shift+R |
| 主文档 | 走正常缓存决策 | **绕过强缓存**（请求头 `Cache-Control: max-age=0`），带条件头协商 | **完全绕过**（请求头 `Cache-Control: no-cache`，无条件头） |
| 主文档典型响应 | 200 | 304（资源未变时）或 200 | 200（必为全量） |
| 子资源（JS/CSS/图片） | 强缓存命中则不发请求 | 按正常规则：未过期强缓存 → 不发请求（`from disk/memory cache`）；过期 → 协商可 304 | 全部绕过缓存，重新下载 200 |
| 强缓存命中表现 | 200 (from disk/memory cache)，请求不出网 | 同左 | 无 |
| 304 数量（典型） | 0 | 主文档 1 个 + 少量过期子资源 | 0 |
| DevTools 现象 | 多数请求 Size 显示缓存来源 | 少量请求出网 | 全部请求出网、Size 为真实字节数 |

补充说明：

- macOS 的 **Cmd+R 等同于 F5**（普通刷新），Cmd+Shift+R 才是强刷；不要混淆。
- **`location.reload()`** 一句话：等价于用户按 F5 的普通刷新——重新请求主文档并绕过其强缓存，子资源仍按缓存规则。
- **soft navigation（SPA 路由跳转，如 React Router `navigate()`）** 一句话：完全不重新加载文档、不发主文档请求、不重建 JS 上下文，与上面所有刷新场景都不在一个层面。
- 扩展：DevTools 勾选「Disable cache」仅在面板打开时对所有请求绕过缓存，且需配合刷新才体现； Service Worker 存在时，刷新请求仍会经过 SW 的 `fetch` 拦截，其策略可能覆盖上述行为。

---

## 十二、全链路性能优化速查

| 链路环节 | 最有效的一项优化 | 落地方式 |
|---|---|---|
| DNS | 预解析第三方域名 | `<link rel="dns-prefetch">` / `preconnect` |
| TCP/TLS | 减少建连次数与 RTT | TLS 1.3 + Session Resumption / HTTP/2 连接复用 / 上 QUIC |
| CDN | 提高边缘命中率 | 指纹化 URL + 长缓存，缓存键稳定，减少带随机 query 的请求 |
| 强缓存 | 指纹 URL + 一年缓存 | `app.9f8e7d.js` + `Cache-Control: max-age=31536000, immutable` |
| 主文档 | `no-cache` 协商缓存 | `index.html` 用 `Cache-Control: no-cache` 保证发版即生效 |
| 关键渲染路径 | 内联关键 CSS | 首屏样式内联进 HTML，其余 CSS 异步加载 |
| JS 阻塞 | 非阻塞加载 | 业务脚本 `defer`，第三方统计 `async` |
| 动画帧率 | 只动 transform/opacity | GSAP 动画属性限定 `x/y/scale/rotate/opacity`，必要时配 `will-change` |
| 传输体积 | 压缩 + 按需 | brotli 压缩文本资源，图片用现代格式（WebP/AVIF），代码分包按需加载 |

---

## 十三、连接管理与长连接

### 13.1 keep-alive vs HTTP/2 多路复用

- **谁/做什么**：HTTP/1.1 的 `keep-alive`（现代实现默认开启）让一条 TCP 连接在一次响应后不断开，后续请求复用同一条连接；HTTP/2 更进一步，把一条连接切成多个**并行流（stream）**。
- **本质区别**：keep-alive 是**串行复用**——省掉的只是重复握手，同一时刻一条连接仍只能跑一个请求；HTTP/2 是**并行流**——多个请求/响应以二进制帧的形式在同一条连接上交错传输，互不等待。

```
HTTP/1.1 + keep-alive（串行复用）
连接:  |-- 请求A - 响应A --|-- 请求B - 响应B --|-- 请求C - 响应C --|
       同一时刻只有一个请求在跑, 后面的必须排队

HTTP/2 多路复用（并行流）
连接:  | A帧 | B帧 | A帧 | C帧 | B帧 | A帧 | C帧 |...
       多个流在同一条连接上交错传输, 应用层不再互相排队
```

### 13.2 浏览器并发连接数限制

- **HTTP/1.1**：同一域名最多 **6 条并发连接**（各浏览器数值略有差异），第 7 个请求必须排队等某条连接空闲——「图片多的页面加载慢」的结构性原因之一。
- **HTTP/2**：**单条连接多路复用**，这条限制实质解除；所有请求挤在同一条连接上并行跑。

### 13.3 连接池与握手摊销

- **谁**：浏览器的 socket 池（连接池），统一管理所有 TCP 连接的生命周期。
- **做什么**：请求结束后连接不销毁，归还池中供同源后续请求复用。
- **为什么「首页之后」的二次请求快**：DNS + TCP + TLS 的一次性握手成本被连接池**摊销**到后续所有请求上——第二个请求直接在已有连接上发 HTTP 报文，零握手开销。`<link rel="preconnect">` 的原理同此：在真正需要资源之前，提前把握手成本付在空闲时间里。

### 13.4 连接什么时候断

| 断开方式 | 说明 |
|---|---|
| `Connection: close` | 响应头显式声明「本响应完成后关闭连接」，下个请求须重新走 TCP/TLS 握手 |
| 服务端空闲超时 | 服务器对 keep-alive 空闲连接设上限（如 Nginx `keepalive_timeout` 默认 75s），超时后静默断开 |
| 浏览器侧淘汰 | 连接池有空闲连接数量上限与超时策略，超量/过期的空闲连接被主动关闭 |

- 浏览器对「复用到已被服务端断开的连接」有容错（对幂等请求自动重发），但依赖它不可靠；最佳实践是让服务端空闲超时明显大于前端两次请求的典型间隔。

### 13.5 现代实践：域名分片已废弃

- **域名分片**（把静态资源散到 `img1.example.com`、`img2.example.com`…）是 HTTP/1.1 时代绕过 6 连接限制的 hack。
- HTTP/2 普及后它**反向有害**：每个新域名都要重新付出 DNS 解析 + TCP/TLS 握手成本，还破坏了单连接上的复用与优先级调度。现代做法是**收敛域名、启用 HTTP/2/3**，让一条连接跑满。

---

## 十四、运行时：主线程、GC 与 GPU

### 14.1 浏览器多进程架构（一句话版）

**浏览器进程**（地址栏、标签管理、网络调度）→ 每个站点一个**渲染进程**（解析/JS/布局/绘制的宿主，内含主线程、合成线程、光栅线程）→ **GPU 进程**（全浏览器共享，负责合成与光栅加速）→ **网络进程**（真正收发包）。多进程 + 沙箱让一个标签页崩溃不至于拖垮整个浏览器。

### 14.2 主线程与长任务（Long Task）

- **谁**：JS 执行、样式计算、布局、绘制记录都在渲染进程**主线程**上排队——它们互相抢同一条线程。
- **Long Task**：**超过 50ms** 的任务。一个长任务会把之后的所有工作整体推迟：输入事件的响应、下一帧的渲染，用户感知为「点了没反应」。
- `requestIdleCallback`：把低优先级工作塞进帧空闲期执行；`scheduler.yield()`：主动让出主线程，让浏览器先处理更高优先级的任务再回来继续——两者都是「把长任务切碎」的手段。

```
理想帧（16.7ms 预算）:  | 输入 | JS | Style | Layout | Paint | 合成 |
出现 80ms 长任务:       |-------- 一段 80ms 的 JS --------| 输入回调排队,
                        本该出现的帧被整体推迟 -> 掉帧 + 操作迟滞
```

### 14.3 JavaScript GC：V8 分代回收

| 代 | 典型对象 | 回收器 | 方式 |
|---|---|---|---|
| 新生代 | 短命对象（临时变量、新分配对象） | Scavenger | **半空间复制**：存活对象在两块等大的半空间之间来回复制，空间换速度 |
| 老生代 | 活过两轮新生代回收的长寿/大对象 | Mark-Sweep / Mark-Compact | 标记清除，碎片多时标记整理；配合**增量 + 并发**执行 |

**「GC 是否阻断渲染」——精确回答**：

- **主线程上的 GC 暂停期间，JS 执行与渲染帧都被阻塞**。GC 和你的代码共享主线程，这一点不因任何优化而消失。
- V8 用**增量标记**（把标记拆成小片，穿插进 JS 任务之间）与**并发标记**（标记的主要工作量移到后台线程）把单次暂停**碎片化**；但收尾与部分阶段仍是 **Stop-The-World**，短暂全停无法完全消除。
- **量级**：多数 GC 暂停在 **1~10ms** 级（新生代 Scavenger 通常更短）；老生代整堆回收或大对象堆场景可能到**上百 ms**。所以既不能说「GC 完全不阻塞」，也不是「GC 总是卡死页面」。
- **因果链**：频繁创建临时对象/闭包 → 新生代回收频繁触发 → GC 压力 → 主线程时间片被 GC 切走 → 掉帧。
- **优化方向**：对象复用（池化，避免在 rAF 循环里每帧 new）；避免**隐藏类突变**——保持对象属性形状稳定（相同顺序初始化相同属性，别事后动态增删），否则 V8 退化为字典式查找并产生额外元数据；用 DevTools **Performance** 面板看内存锯齿与 GC 帧占用，先定位再优化。

### 14.4 GPU 与合成层

- **合成层提升**：`will-change: transform` 或 `transform: translateZ(0)` 让元素获得独立图层，此后动画只需在合成阶段移动该层纹理，不再触发布局与绘制。
- **光栅化（Raster）不在主线程**：图层的像素填充由**光栅线程**完成（可借力 GPU 进程），主线程忙时合成/光栅仍有机会继续出画面。
- **为什么 transform 动画流畅**：每帧只更新该层的变换矩阵并重新合成——主线程零布局、零绘制（呼应第十章「代价排序」与 GSAP 动画原则）。
- **层爆炸（layer explosion）**：`will-change` **不是无脑加**——每个合成层都要占显存（约宽 × 高 × 4 字节），几百个层能把低端设备的显存与纹理上传带宽吃光，反而比不加更卡。只对**实测掉帧**的元素使用，动画结束及时移除。

### 14.5 内存泄漏四种典型

| 类型 | 成因 | 典型场景 |
|---|---|---|
| 意外全局变量 | 未声明赋值挂到 `window`，永不回收 | `function f() { bar = bigData }`（漏写 `let/const`） |
| 定时器/监听未清理 | 回调闭包一直可达，捕获的对象全被钉住 | 组件卸载时未 `clearInterval` / `removeEventListener` |
| 脱离 DOM 树的引用 | JS 变量持有已移除的节点，整棵子树无法回收 | 缓存了 `el` 引用后又 `el.remove()`（detached node） |
| 闭包持有大对象 | 闭包活得久，捕获的大数组就得陪着活 | 事件回调捕获 `bigList` 且回调永不解除 |

排查工具：

- **Heap Snapshot 三快照法**：操作前拍快照 1 → 执行可疑操作（如进出某页面）拍快照 2 → 重复操作并强制 GC 后拍快照 3；对比快照间对象数量增量与 **Detached** 节点，沿 Retainers 链找到「谁在引用它」。
- **Performance Monitor**（DevTools → More tools）：看 **JS Heap Size** 曲线——健康状态是「锯齿状平稳」；持续阶梯上涨且强制 GC 后不回落，即疑似泄漏。

---

## 十五、弱网与异常环境

### 15.1 弱网下发生了什么

- **高 RTT**：每次握手、每个请求的往返都被拉长，串行化的 HTTP/1.1 首当其冲。
- **丢包 → TCP 拥塞控制慢启动**：连接刚建立时拥塞窗口从小值起步，每过一个 RTT 才翻倍；一旦丢包窗口立即减半。弱网 = 反复丢包 = 吞吐被反复压回，「前几秒特别慢」的传输层根源就在这。

### 15.2 队头阻塞（HOL Blocking）在哪一层

| 协议 | 应用层队头阻塞 | TCP 层队头阻塞 |
|---|---|---|
| HTTP/1.1 | **有**：一条连接同一时刻一个请求（13.1 的串行复用），响应还必须按序返回 | **有**：丢一个包，整条连接的数据交付停摆 |
| HTTP/2 | **无**：多路复用，流之间不再排队 | **仍有且更疼**：所有流挤同一条 TCP 连接，**任何一个 TCP 包丢失，所有流的交付一起被阻塞**（TCP 必须按字节序交给应用层）——注意这是传输层问题，不是应用层 |
| HTTP/3（QUIC） | 无 | **无**：QUIC 基于 UDP，每个流独立重传与交付，跨流阻塞被根治 |

### 15.3 资源加载失败的兜底

- **onerror 重试**：`<script>` / `<img>` 的 `onerror` 里可切换备用 CDN 域名或注入降级资源；必须加重试次数上限，防止循环重试。
- **提前建连**：`<link rel="preconnect">` 提前完成 DNS+TCP+TLS，`<link rel="preload">` 提前发起高优资源下载——弱网下把最贵的建连等待挪进空闲时间，也更早暴露网络不可用。
- **离线兜底页**：Service Worker 在 `fetch` 拦截中网络失败时回退到缓存的离线页或缓存副本（呼应 8.6），保证「至少有东西可看」。

### 15.4 弱网模拟与指标劣化

- **DevTools Network throttling**：预设 Slow 3G / Fast 3G，或自定义 RTT 与吞吐；`Offline` 模式专门用来验证离线兜底。
- **Web Vitals 在慢速下的劣化**：LCP 随带宽线性变差（大图首当其冲）；FCP 被 RTT 与慢 HTML 拖长；CLS 常因图片/字体晚到且未预留占位而恶化；INP 在「弱网常伴的弱设备」上对长任务更敏感。

### 15.5 请求超时与取消

```js
// AbortController: 超时与组件卸载取消, 一套机制两用
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000); // 5s 超时
try {
  const res = await fetch('/api/data', { signal: controller.signal });
} finally {
  clearTimeout(timer);
}
```

- **AbortController**：`fetch` 传入 `signal`，调用 `abort()` 立即中断请求；React 组件卸载时 abort 可避免对已卸载组件 setState。
- **重试与幂等性**：只自动重试**幂等**请求（GET/HEAD）——POST 盲目重试可能重复下单；重试须配指数退避 + 抖动，防止服务恢复瞬间的重试风暴。

---

## 十六、安全：劫持与攻击面

按链路环节对照「攻击点 → 防御」：

| 链路环节 | 攻击点 | 防御 |
|---|---|---|
| DNS 解析 | DNS 劫持/污染：LDNS 返回假 IP，把用户引到钓鱼站 | DoH/DoT 加密解析；DNSSEC 对记录做签名验证 |
| HTTP 明文传输 | 运营商/中间节点往响应里插广告、篡改页面 | 全站 HTTPS，HTTP 301 跳转 + HSTS |
| TLS 握手 | 降级攻击：迫使协商到旧协议/弱套件再破解 | 只启用 TLS 1.2+，禁用 SSLv3/TLS 1.0/弱密码套件 |
| 证书信任 | 证书伪造 / 中间人（MITM） | 证书透明度（CT）日志让证书签发公开可审计；防用户被诱导安装伪根证书 |
| 页面脚本 | XSS：注入恶意脚本，偷 cookie/伪造操作 | 输入过滤与转义、CSP 白名单、cookie 加 HttpOnly |
| 跨站请求 | CSRF：借浏览器自动带 cookie 伪造用户请求 | SameSite Cookie、CSRF Token |
| 页面嵌套 | 点击劫持：透明 iframe 叠加诱骗点击 | `X-Frame-Options: DENY` / CSP `frame-ancestors` |
| 页面内资源 | 混合内容：https 页面加载 http 资源 | 浏览器已阻止 active mixed content；资源全量 https |

要点：

- **DoH/DoT vs DNSSEC**：前者把「浏览器 → LDNS」的明文查询装进加密隧道（呼应 1.2），运营商看不到也改不了；后者给 DNS 记录加数字签名验证完整性，但**不加密查询本身**——两者解决的是不同问题，常配合使用。
- **MITM 的最后一环往往不是技术漏洞**：攻击者诱导用户安装伪造根证书后，TLS 对该用户形同虚设。公共 Wi-Fi 上浏览器的证书告警不是「点继续」的事。
- **XSS 三层防御互相兜底而非互相替代**：转义阻止注入发生；CSP 保证即使注入成功也加载不了外域脚本；HttpOnly 保证即使脚本跑起来也偷不走 cookie。
- **CSRF 与 XSS 一句话区分**：CSRF 借的是「浏览器自动携带 cookie」的信任，恶意代码不在你的页面里；XSS 是代码真的跑进了你的页面。

传输安全响应头速查：

| 响应头 | 作用 | 典型值 |
|---|---|---|
| `Strict-Transport-Security`（HSTS） | 强制浏览器后续访问一律 https，杜绝明文降级 | `max-age=31536000; includeSubDomains` |
| `Content-Security-Policy`（CSP） | 白名单限制脚本/样式/帧等资源来源 | `default-src 'self'; script-src 'self'` |
| `X-Content-Type-Options` | 禁止 MIME 嗅探，防止伪装类型被当成脚本执行 | `nosniff` |
| `Referrer-Policy` | 控制跳转外站时携带多少来源信息 | `strict-origin-when-cross-origin` |

- **混合内容分级**：passive（图片/音频等展示类）浏览器多已自动升级为 https，失败则阻止；active（script、iframe 等**可控制页面**的资源）**被 Chrome 等现代浏览器直接阻止加载**。所以 https 页面混 http 脚本不是「有风险」，是「跑不起来」。

---

## 术语速查表

| 术语 | 一句话解释 |
|---|---|
| 强缓存 | 未过期期间浏览器直接用本地副本，**不发任何请求**（200 from disk/memory cache） |
| 协商缓存 | 缓存过期后带条件头问服务器，未变则 304 沿用本地副本 |
| ETag | 资源内容指纹，协商缓存中优先于 Last-Modified |
| TTL | 缓存/DNS 记录的存活秒数，过期即失效 |
| RTT | 一个网络往返时间；TLS 1.2 握手 2-RTT，TLS 1.3 为 1-RTT |
| GSLB | CDN 的全局负载均衡，借 DNS 应答把用户调度到最近边缘节点 |
| Render Tree | DOM + CSSOM 的可见节点子集；`display:none` 与 `<head>` 不在内 |
| Reflow / Repaint / Composite | 重排/重绘/合成，代价依次递减，动画只应停留在合成层 |
| CRP | 关键渲染路径：从收到 HTML 到首屏像素的最短必需步骤 |
| SNI | TLS ClientHello 中的目标域名，同一 IP 托管多张证书的依据 |
| 长任务（Long Task） | 主线程上超过 50ms 的任务，会推迟输入响应与下一帧渲染 |
| Stop-The-World | GC 的全停阶段：主线程完全暂停，JS 执行与渲染一起被阻塞 |
| 合成层 | 拥有独立图层的元素，更新时只走 Composite，动画代价最低 |
| 队头阻塞 | 前一个没完成堵住后面的：HTTP/1.1 在应用层，HTTP/2 残留在 TCP 层，QUIC 根治 |
| CSP | Content-Security-Policy：白名单限制页面可加载的资源来源，XSS 的兜底防线 |
| SameSite | Cookie 属性，限制跨站请求携带 cookie；`Lax` 为现代浏览器默认值，CSRF 主要防线 |
