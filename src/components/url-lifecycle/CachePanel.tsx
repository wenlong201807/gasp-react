import { CACHE_PANEL } from './layout';
import type { CacheVerdict, Stage } from './types';
import styles from './url-lifecycle.module.css';

/** 五分支迷你决策树（对应底稿 §8.4 流程图）：判定徽标缓存紫，MISS 类警示危险红 */
const BRANCHES: readonly { verdict: CacheVerdict; badge: string; text: string; danger?: boolean }[] = [
	{ verdict: 'miss', badge: 'MISS', text: '无本地副本 → 走网络', danger: true },
	{ verdict: 'strongHit', badge: 'from disk cache', text: '强缓存命中 · 不发请求' },
	{ verdict: 'revalidate', badge: 'max-age=0', text: '携条件头协商 · no-cache 同义' },
	{ verdict: 'notModified304', badge: '304', text: '未变 · 无响应体 · 副本续期' },
	{ verdict: 'fresh200', badge: '200', text: '全新响应落缓存' },
];

/**
 * 右侧缓存判定区：五分支决策树与徽标。
 * 分支 opacity / 徽标 scale 由时间轴驱动（data-verdict / data-badge），
 * disk cache 徽标由 stepIndex 声明式渲染。
 */
export function CachePanel({ stage }: { stage: Stage }) {
	const diskChipLit = stage.detail.includes('disk cache');

	return (
		<div
			data-cache-panel
			className={styles.cachePanel}
			style={{ left: CACHE_PANEL.x, top: CACHE_PANEL.y, width: CACHE_PANEL.w, height: CACHE_PANEL.h }}
		>
			<span className={styles.cacheTitle}>缓存判定 Cache</span>
			{BRANCHES.map((b) => (
				<div key={b.verdict} data-verdict={b.verdict} className={styles.branch}>
					<span data-badge className={`${styles.branchBadge} ${b.danger ? styles.branchBadgeDanger : ''}`}>
						{b.badge}
					</span>
					<span className={styles.branchText}>{b.text}</span>
				</div>
			))}
			{diskChipLit && <span className={styles.diskChip}>200 (from disk cache)</span>}
		</div>
	);
}
