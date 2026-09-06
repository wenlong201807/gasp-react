export const STAGE = { w: 1200, h: 800 } as const;
export const STEP_SECONDS = 1.6; // 每步时长
export const TRANSITION = 0.4; // 步间过渡窗 D

export type NodeId =
	| 'browser' // 浏览器（网络进程视角）
	| 'dnsCache' // DNS 第 1 层：浏览器 DNS 缓存
	| 'osCache' // DNS 第 2 层：操作系统缓存（含 /etc/hosts）
	| 'ldns' // DNS 第 3 层：本地 DNS 服务器（递归）
	| 'rootDns' // DNS 第 4 层：根 → 顶级域 → 权威（迭代）
	| 'cdnEdge' // CDN 边缘节点（GSLB 选出的那台）
	| 'nginx'; // 源站 Nginx

export type PacketKind =
	| 'request' // HTTP 请求（出网方向）
	| 'response' // HTTP 响应（回程方向）
	| 'dnsQuery' // DNS 查询
	| 'dnsAnswer' // DNS 应答
	| 'tcpSyn' // TCP 三次握手第 1 包
	| 'tcpSynAck' // TCP 三次握手第 2 包
	| 'tcpAck' // TCP 三次握手第 3 包
	| 'tlsHandshake'; // TLS 握手报文（ClientHello/证书/PSK 等，label 区分）

export interface Packet {
	id: string; // 步内唯一，建议 `${stage.id}:${序号}`，如 'f12:p1'
	from: NodeId; // 起点（决定初始锚点）
	to: NodeId; // 终点（决定位移目标）
	kind: PacketKind;
	label: string; // 随包飞行的一行小字，如 'SYN(seq=x) 你能听到吗？'
}

export type CacheVerdict =
	| 'miss' // 无本地副本，直接走网络（幕一第 3 步）
	| 'strongHit' // 强缓存命中，不发请求 from disk cache（幕二第 8 步）
	| 'revalidate' // 携条件头协商（max-age=0 / no-cache）
	| 'notModified304' // 协商命中，304 无响应体（幕二第 6 步）
	| 'fresh200'; // 全新 200 落缓存（幕一第 13 步）

export interface Stage {
	id: string; // 'f01'..'f20' / 'r01'..'r14'，剧本内唯一
	title: string; // 一步的短标题（DetailBar 主行、进度点 tooltip）
	detail: string; // 成品解说文案（DetailBar 副行，§5 表内文字直接可用）
	activeNodes: readonly NodeId[]; // 本步高亮的节点，驱动 §6.2 激活动画
	packets: readonly Packet[]; // 本步在飞的数据包，驱动 §6.3 位移动画
	cacheVerdict?: CacheVerdict; // 缺省表示本步不涉及缓存判定
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
	title: string; // '首次加载' / 'F5 刷新'
	subtitle: string; // ScenarioPicker 卡片副标题
	stages: readonly Stage[];
}

export const ZONE_COLOR = {
	net: '#58a6ff', // 网络：browser/cdnEdge/nginx、request/response 包
	dns: '#d29922', // DNS：四层节点与 dnsQuery/dnsAnswer 包
	cache: '#bc8cff', // 缓存：判定区、强缓存/协商/304 徽标
	render: '#3fb950', // 渲染：六格泳道与进度条
	danger: '#ff7b72', // 危险：MISS、回源、绕过缓存类警示
	text: '#e6edf3', // 正文
	border: '#30363d', // 边框
	bg: '#0d1117', // GitHub dark 底色
} as const;
