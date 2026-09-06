import type { Scenario, Stage } from '../types';

const stages: readonly Stage[] = [
	{
		id: 'r01',
		title: '按下 F5：普通刷新',
		detail:
			'Cmd+R / F5 只对地址栏这个主文档「不讲情面」，子资源照常讲缓存规则；Ctrl+F5 才是对谁都翻脸的强制刷新。',
		activeNodes: ['browser'],
		packets: [],
	},
	{
		id: 'r02',
		title: '主文档绕过强缓存',
		detail:
			'刷新请求头自动带 Cache-Control: max-age=0，跳过本地副本的强缓存判定、直接与服务器协商，同时保留 If-None-Match 条件头。',
		activeNodes: ['browser'],
		packets: [],
		cacheVerdict: 'revalidate',
	},
	{
		id: 'r03',
		title: 'DNS：浏览器缓存直接命中',
		detail:
			'刚访问过的域名还留在浏览器 DNS 缓存里（TTL 未过），一个包都不出网；绝大多数 DNS 查询止步于第 1、2 层。',
		activeNodes: ['browser', 'dnsCache'],
		packets: [
			{ id: 'r03:p1', from: 'dnsCache', to: 'browser', kind: 'dnsAnswer', label: 'www.example.com → 边缘 IP' },
		],
	},
	{
		id: 'r04',
		title: 'TLS 会话复用',
		detail:
			'keep-alive 连接还活着就完全免握手；若已断开，TLS 1.3 凭缓存的 PSK 跳过证书与密钥交换，1-RTT 甚至 0-RTT 重建通道——二次访问快就靠它。',
		activeNodes: ['browser', 'cdnEdge'],
		packets: [
			{ id: 'r04:p1', from: 'browser', to: 'cdnEdge', kind: 'tlsHandshake', label: 'PSK（上次会话票据）' },
		],
	},
	{
		id: 'r05',
		title: '协商请求出网',
		detail:
			'请求带着上次存下的 ETag 出网；ETag 优先于 Last-Modified——内容指纹比只有 1 秒精度的修改时间可靠。',
		activeNodes: ['browser', 'cdnEdge', 'nginx'],
		packets: [
			{
				id: 'r05:p1',
				from: 'browser',
				to: 'cdnEdge',
				kind: 'request',
				label: 'GET /index.html + If-None-Match: "33a64df5"',
			},
			{ id: 'r05:p2', from: 'cdnEdge', to: 'nginx', kind: 'request', label: '转发校验' },
		],
	},
	{
		id: 'r06',
		title: '服务器比对：304',
		detail:
			'ETag 比对未变，服务器只回一个头、没有 body；304 表达的不是「没有资源」，而是「你手里那份仍然有效」。',
		activeNodes: ['nginx', 'cdnEdge', 'browser'],
		packets: [
			{ id: 'r06:p1', from: 'nginx', to: 'cdnEdge', kind: 'response', label: '304 Not Modified' },
			{ id: 'r06:p2', from: 'cdnEdge', to: 'browser', kind: 'response', label: '304（无响应体）' },
		],
		cacheVerdict: 'notModified304',
	},
	{
		id: 'r07',
		title: '主文档续期，进入解析',
		detail: '浏览器用本地副本并更新其有效期，拿到的是与上次一模一样的 HTML，直接进入渲染管线。',
		activeNodes: ['browser'],
		packets: [],
	},
	{
		id: 'r08',
		title: '子资源判定：强缓存未过期',
		detail:
			'app.9f8e7d.js 的 Cache-Control: max-age=31536000 远未过期（指纹文件名配 immutable，连刷新都不再协商），浏览器根本不向服务器发请求。',
		activeNodes: ['browser'],
		packets: [],
		cacheVerdict: 'strongHit',
	},
	{
		id: 'r09',
		title: 'from disk cache：0 请求出网',
		detail:
			'DevTools 显示 200 (from disk cache)，Size 列标的是缓存来源而非传输字节；刚用过的热资源也可能 from memory cache——热的放内存、冷的放磁盘。',
		activeNodes: ['browser'],
		packets: [],
	},
	{
		id: 'r10',
		title: 'no-cache 不是不缓存',
		detail:
			'主文档的 no-cache 指令含义是「可以缓存副本，但每次使用前必须协商」；真正完全不缓存的是 no-store——这对名字最容易骗人。',
		activeNodes: ['browser'],
		packets: [],
		cacheVerdict: 'revalidate',
	},
	{
		id: 'r11',
		title: 'Parse HTML → DOM',
		detail: '重新解析主文档；304 省掉的是传输体积，解析的工作量一点没少。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 1,
	},
	{
		id: 'r12',
		title: 'Parse CSS → CSSOM',
		detail: 'CSS 从磁盘缓存瞬时就绪，没有网络往返；缓存优化的是「等待」，不是「工作」。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 2,
	},
	{
		id: 'r13',
		title: 'Render Tree + Layout',
		detail: '可见节点合成渲染树并完成几何计算，与首次加载完全同构——刷新省下的全部时间都在网络与缓存侧。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 4,
	},
	{
		id: 'r14',
		title: 'Paint + Composite：二次上屏',
		detail:
			'对账：出网请求只有 1 个 304，命中强缓存的子资源 0 请求——这就是 F5 比首次访问快得多的全部秘密。',
		activeNodes: ['browser'],
		packets: [],
		renderProgress: 6,
	},
];

export const REFRESH: Scenario = {
	id: 'refresh',
	title: 'F5 刷新',
	subtitle: '14 步 · max-age=0 协商 304 · 子资源强缓存 0 请求出网 · TLS 会话复用',
	stages,
};
