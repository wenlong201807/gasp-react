import { useMemo } from 'react';
import { NODE_RECT, TLS_ZONE } from './layout';
import type { NodeId, PacketKind, Scenario, Stage } from './types';
import styles from './url-lifecycle.module.css';

/** 节点展示元信息（纯表现，不含坐标——坐标在 layout.ts） */
const NODE_META: Record<NodeId, { title: string; sub: string; dns: boolean }> = {
	browser: { title: '🌐 浏览器', sub: '网络进程', dns: false },
	dnsCache: { title: '浏览器 DNS 缓存', sub: 'DNS 第 1 层', dns: true },
	osCache: { title: 'OS 缓存 + /etc/hosts', sub: 'DNS 第 2 层', dns: true },
	ldns: { title: '本地 DNS（递归）', sub: 'DNS 第 3 层', dns: true },
	rootDns: { title: '根 → .com → 权威（迭代）', sub: 'DNS 第 4 层', dns: true },
	cdnEdge: { title: 'CDN 边缘节点', sub: 'GSLB 就近', dns: false },
	nginx: { title: 'Nginx 源站', sub: '应用服务器', dns: false },
};

const PACKET_CLASS: Record<PacketKind, string> = {
	request: styles.pkReq,
	response: styles.pkResp,
	dnsQuery: styles.pkDns,
	dnsAnswer: styles.pkDns,
	tcpSyn: styles.pkTcp,
	tcpSynAck: styles.pkTcp,
	tcpAck: styles.pkTcp,
	tlsHandshake: styles.pkTls,
};

const NODE_ORDER: readonly NodeId[] = [
	'browser',
	'dnsCache',
	'osCache',
	'ldns',
	'rootDns',
	'cdnEdge',
	'nginx',
];

interface NetworkStageProps {
	scenario: Scenario;
	stage: Stage;
}

/**
 * 中部网络管线：七个节点、常驻数据包元素、TLS 握手区。
 * 节点高亮边框与各类徽标由 stepIndex 声明式渲染；位移/光晕由时间轴命令式驱动。
 */
export function NetworkStage({ scenario, stage }: NetworkStageProps) {
	// 两幕全部数据包常驻 DOM（挂载时一次性渲染，显隐由时间轴控制）
	const allPackets = useMemo(() => scenario.stages.flatMap((s) => s.packets), [scenario]);
	const tlsLit = stage.packets.some((p) => p.kind === 'tlsHandshake');
	const tlsBadge = scenario.id === 'first-load' ? '1-RTT' : 'Session Resumption';
	const edgeMiss = stage.packets.some((p) => p.label.includes('MISS'));

	return (
		<>
			{NODE_ORDER.map((id) => {
				const meta = NODE_META[id];
				const rect = NODE_RECT[id];
				const active = stage.activeNodes.includes(id);
				const activeCls = active ? (meta.dns ? styles.nodeActiveDns : styles.nodeActiveNet) : '';
				return (
					<div
						key={id}
						data-node={id}
						className={`${styles.node} ${activeCls}`}
						style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
					>
						<span data-glow className={meta.dns ? styles.glowDns : styles.glowNet} />
						<span className={styles.nodeTitle}>{meta.title}</span>
						<span className={styles.nodeSub}>{meta.sub}</span>
						{id === 'cdnEdge' && edgeMiss && <span className={styles.cornerChip}>X-Cache: MISS</span>}
					</div>
				);
			})}

			{/* TLS 握手区：ClientHello / 证书 / Finished / PSK 摘要行 */}
			<div
				className={styles.tlsZone}
				style={{ left: TLS_ZONE.x, top: TLS_ZONE.y, width: TLS_ZONE.w, height: TLS_ZONE.h }}
			>
				<span className={styles.tlsTitle}>TLS 握手</span>
				<span className={styles.tlsLines}>ClientHello · 证书 · Finished · PSK</span>
				{tlsLit && <span className={styles.tlsChip}>{tlsBadge}</span>}
			</div>

			{allPackets.map((p) => (
				<span key={p.id} data-packet={p.id} className={`${styles.packet} ${PACKET_CLASS[p.kind]}`}>
					{p.label}
				</span>
			))}
		</>
	);
}
