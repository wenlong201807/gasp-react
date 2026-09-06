import type { Scenario, Stage } from '../types';

const stages: readonly Stage[] = [
	{
		id: 'f01',
		title: '输入 URL 并回车',
		detail:
			'用户在地址栏输入 https://www.example.com/index.html 并回车；浏览器进程把导航请求交给网络进程，一切从这一刻开始。',
		activeNodes: ['browser'],
		packets: [],
	},
	{
		id: 'f02',
		title: 'URL 解析与 HSTS 升级',
		detail:
			'拆出协议 https、主机 www.example.com、路径 /index.html；HSTS 列表命中该域名，即使输入 http 也会被强制升级为 https。',
		activeNodes: ['browser'],
		packets: [],
	},
	{
		id: 'f03',
		title: '浏览器 HTTP 缓存检查',
		detail: '首次访问没有任何本地副本，判定未命中，只能走网络：先解析 IP，再建连接。',
		activeNodes: ['browser'],
		packets: [],
		cacheVerdict: 'miss',
	},
	{
		id: 'f04',
		title: 'DNS 第 1 层：浏览器缓存',
		detail:
			'进程内维护「域名 → IP」表，条目带 TTL；本例未命中，继续向外查——绝大多数请求其实走不到下一层。',
		activeNodes: ['browser', 'dnsCache'],
		packets: [
			{ id: 'f04:p1', from: 'browser', to: 'dnsCache', kind: 'dnsQuery', label: 'www.example.com？' },
		],
	},
	{
		id: 'f05',
		title: 'DNS 第 2 层：OS 缓存与 hosts',
		detail:
			'/etc/hosts 静态映射优先级高于一切 DNS 查询，其次查系统级缓存；仍未命中，只能向本地 DNS 发真正的网络包。',
		activeNodes: ['browser', 'osCache'],
		packets: [
			{ id: 'f05:p1', from: 'browser', to: 'osCache', kind: 'dnsQuery', label: '查 hosts / 系统缓存' },
		],
	},
	{
		id: 'f06',
		title: 'DNS 第 3 层：本地 DNS 递归',
		detail:
			'客户端只问一句，LDNS（运营商或 223.5.5.5 这类公共 DNS）承诺跑完整条解析链、拿到最终 IP 才返回；它自己也有缓存。',
		activeNodes: ['browser', 'ldns'],
		packets: [
			{ id: 'f06:p1', from: 'browser', to: 'ldns', kind: 'dnsQuery', label: 'www.example.com 的 IP？' },
		],
	},
	{
		id: 'f07',
		title: 'DNS 第 4 层：迭代与 GSLB',
		detail:
			'根与顶级域只指路不给答案；权威 DNS 答 CNAME 指向 CDN，GSLB 按请求来源地理位置与节点负载返回最近的边缘节点 IP。',
		activeNodes: ['ldns', 'rootDns'],
		packets: [
			{ id: 'f07:p1', from: 'ldns', to: 'rootDns', kind: 'dnsQuery', label: '问根(.)' },
			{ id: 'f07:p2', from: 'rootDns', to: 'ldns', kind: 'dnsAnswer', label: '去问 .com' },
		],
	},
	{
		id: 'f08',
		title: 'DNS 应答回到浏览器',
		detail:
			'IP 沿原路返回并逐层缓存（浏览器、OS、LDNS 各自遵守 TTL）；浏览器拿到边缘节点 IP，DNS 阶段结束。',
		activeNodes: ['ldns', 'browser'],
		packets: [
			{ id: 'f08:p1', from: 'ldns', to: 'browser', kind: 'dnsAnswer', label: '边缘节点 112.34.x.x（TTL 60s）' },
		],
	},
	{
		id: 'f09',
		title: 'TCP 三次握手：SYN',
		detail:
			'向边缘节点 443 端口发出第一个 TCP 包；握手要三次，是因为双方都得确认「我能发你能收、你能发我能收」。',
		activeNodes: ['browser', 'cdnEdge'],
		packets: [
			{ id: 'f09:p1', from: 'browser', to: 'cdnEdge', kind: 'tcpSyn', label: 'SYN(seq=x) 你能听到吗？' },
		],
	},
	{
		id: 'f10',
		title: 'SYN-ACK 与 ACK：连接建立',
		detail:
			'三个包走完，TCP 通道就绪。TLS 只能在这条通道上进行——先 TCP、再 TLS、最后 HTTP，顺序不能反。',
		activeNodes: ['browser', 'cdnEdge'],
		packets: [
			{ id: 'f10:p1', from: 'cdnEdge', to: 'browser', kind: 'tcpSynAck', label: 'SYN-ACK(seq=y, ack=x+1)' },
			{ id: 'f10:p2', from: 'browser', to: 'cdnEdge', kind: 'tcpAck', label: 'ACK(ack=y+1)' },
		],
	},
	{
		id: 'f11',
		title: 'TLS 1.3 握手（1-RTT）',
		detail:
			'客户端首个包就带上密钥交换材料，一个来回完成协商；同时逐级校验证书链直至本地信任库里的根 CA。',
		activeNodes: ['browser', 'cdnEdge'],
		packets: [
			{ id: 'f11:p1', from: 'browser', to: 'cdnEdge', kind: 'tlsHandshake', label: 'ClientHello + key_share' },
			{ id: 'f11:p2', from: 'cdnEdge', to: 'browser', kind: 'tlsHandshake', label: '证书 + Finished' },
		],
	},
	{
		id: 'f12',
		title: '发送 HTTPS 请求，边缘 MISS',
		detail: '边缘节点查本地缓存未命中（X-Cache: MISS），于是作为客户端向源站 Nginx 取主文档。',
		activeNodes: ['browser', 'cdnEdge', 'nginx'],
		packets: [
			{ id: 'f12:p1', from: 'browser', to: 'cdnEdge', kind: 'request', label: 'GET /index.html' },
			{ id: 'f12:p2', from: 'cdnEdge', to: 'nginx', kind: 'request', label: '回源（MISS）' },
		],
	},
	{
		id: 'f13',
		title: 'Nginx 返回 200 主文档',
		detail:
			'源站返回压缩后的 HTML；边缘按源站响应头的 Cache-Control 决定本地缓存多久——一次配置、全网生效。',
		activeNodes: ['nginx', 'cdnEdge', 'browser'],
		packets: [
			{ id: 'f13:p1', from: 'nginx', to: 'cdnEdge', kind: 'response', label: '200 + gzip HTML' },
			{ id: 'f13:p2', from: 'cdnEdge', to: 'browser', kind: 'response', label: '200' },
		],
		cacheVerdict: 'fresh200',
	},
	{
		id: 'f14',
		title: '字节流到达，preload scanner 抢跑',
		detail:
			'主文档边下载边解析，独立的预加载扫描器并行扫出 CSS/JS/图片 URL 提前发请求，把「解析到才发现」的串行等待变成并行下载。',
		activeNodes: ['browser', 'cdnEdge'],
		packets: [
			{ id: 'f14:p1', from: 'browser', to: 'cdnEdge', kind: 'request', label: 'GET app.9f8e7d.js / style.css' },
		],
	},
	{
		id: 'f15',
		title: 'Parse HTML → DOM',
		detail:
			'字节流解码成字符、切 Token、拼成 DOM 树，全程流式、收到多少解析多少；非 defer 的 script 会中断这一步。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 1,
	},
	{
		id: 'f16',
		title: 'Parse CSS → CSSOM',
		detail:
			'CSS 阻塞的是首次渲染而不是 DOM 解析——浏览器不敢把半成品样式画给你看；DOM 与 CSSOM 都就绪才能往下走。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 2,
	},
	{
		id: 'f17',
		title: 'defer 脚本按序执行',
		detail:
			'app.9f8e7d.js 已并行下载完，在 DOMContentLoaded 之前按文档顺序执行；执行前不阻塞解析，业务脚本一律 defer。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 2,
	},
	{
		id: 'f18',
		title: 'DOM + CSSOM → Render Tree',
		detail: '只保留可见节点：display:none 不进 Render Tree；visibility:hidden 仍在（占位但不可见）。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 3,
	},
	{
		id: 'f19',
		title: 'Layout 与 Paint',
		detail:
			'Layout 从根递归算出每个节点的精确位置尺寸；Paint 把各层内容绘制成位图，填充像素、画文字与阴影。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 5,
	},
	{
		id: 'f20',
		title: 'Composite：GPU 合成上屏',
		detail:
			'合成线程把各层按正确顺序合成最终画面并上屏，首屏完成；transform 与 opacity 只走这一步——这正是 GSAP 动画快的根本原因。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 6,
	},
];

export const FIRST_LOAD: Scenario = {
	id: 'first-load',
	title: '首次加载',
	subtitle: '20 步 · URL 解析 → DNS 四层 → TCP/TLS → CDN → 渲染管线六阶段 → 上屏',
	stages,
};
