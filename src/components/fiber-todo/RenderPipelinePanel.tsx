import styles from './FiberTodo.module.css';
import type { PipelineRecord } from './types';

interface RenderPipelinePanelProps {
	record: PipelineRecord | null;
}

const barWidth = (ms: number) => `${Math.min(Math.max((ms / 50) * 100, 2), 100)}%`;

export function RenderPipelinePanel({ record }: RenderPipelinePanelProps) {
	return (
		<section className={styles.panel} aria-label="渲染管线性能">
			<h3 className={styles.panelTitle}>渲染管线 · 触发 → commit → 动画帧</h3>
			{record ? (
				<>
					<div className={styles.kv}><span>本次操作</span><b>#{record.seq} {record.op}</b></div>
					<div className={styles.kv}><span>operationId</span><b className={styles.mono}>{record.operationId}</b></div>
					<div className={styles.kv}>
						<span>触发 → commit</span>
						<b>{record.triggerToCommitMs >= 0 ? `${record.triggerToCommitMs} ms` : '—'}</b>
					</div>
					<div className={styles.bar}><div className={styles.barFill} style={{ width: barWidth(Math.max(record.triggerToCommitMs, 0)) }} /></div>
					<div className={styles.kv}><span>React render（窗口内 commit 之和）</span><b>{record.renderMs} ms</b></div>
					<div className={styles.bar}><div className={styles.barFill} style={{ width: barWidth(record.renderMs) }} /></div>
					{record.frames ? (
						<>
							<div className={styles.kv}><span>动画帧</span><b>{record.frames.frameCount} 帧 · avg {record.frames.avgMs} ms · max {record.frames.maxMs} ms</b></div>
							<div className={styles.bar}><div className={`${styles.barFill} ${record.frames.jankCount > 0 ? styles.bad : ''}`} style={{ width: barWidth(record.frames.avgMs) }} /></div>
							<div className={styles.kv}>
								<span>掉帧样本（间隔 &gt;32ms）</span>
								<b className={record.frames.jankCount > 0 ? styles.bad : styles.good}>{record.frames.jankCount} 次</b>
							</div>
							<div className={styles.kv}><span>采样窗口</span><b>{record.frames.windowMs ?? '—'} ms</b></div>
							<p className={styles.hint}>
								60Hz 每帧预算约 16.67ms；&gt;32ms 表示至少错过一帧。它是帧间隔告警，不等于精确丢失画面数量。
								结合本次 operationId 和动画/rAF 事件，再到 DevTools Performance 的 Main / Call Tree 查看源码。
							</p>
						</>
					) : <div className={styles.kv}><span>动画帧</span><b>本次无采样帧</b></div>}
					<p className={styles.hint}>
						定位顺序：先记住 operationId → 在“事件循环”面板看 Long Task 与阶段重叠 → 在 DevTools Performance
						中按同一时间窗查看 Main / Call Tree。GSAP ticker 可能受 lagSmoothing 钳制，掉帧数量不是唯一根因。
					</p>
				</>
			) : <p className={styles.hint}>执行操作后展示各阶段耗时与动画帧统计</p>}
		</section>
	);
}
