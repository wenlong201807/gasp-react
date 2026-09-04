import type { PipelineRecord } from './types';
import styles from './FiberTodo.module.css';

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
          <div className={styles.kv}>
            <span>
              #{record.seq} {record.op}
            </span>
          </div>
          <div className={styles.kv}>
            <span>触发 → commit</span>
            <b>{record.triggerToCommitMs >= 0 ? `${record.triggerToCommitMs} ms` : '—'}</b>
          </div>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{ width: barWidth(Math.max(record.triggerToCommitMs, 0)) }}
            />
          </div>
          <div className={styles.kv}>
            <span>React render（窗口内 commit 之和）</span>
            <b>{record.renderMs} ms</b>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: barWidth(record.renderMs) }} />
          </div>
          {record.frames ? (
            <>
              <div className={styles.kv}>
                <span>动画帧</span>
                <b>
                  {record.frames.frameCount} 帧 · avg {record.frames.avgMs} ms · max{' '}
                  {record.frames.maxMs} ms
                </b>
              </div>
              <div className={styles.bar}>
                <div
                  className={`${styles.barFill} ${record.frames.jankCount > 0 ? styles.bad : ''}`}
                  style={{ width: barWidth(record.frames.avgMs) }}
                />
              </div>
              <div className={styles.kv}>
                <span>掉帧（&gt;32ms）</span>
                <b>{record.frames.jankCount}</b>
              </div>
            </>
          ) : (
            <div className={styles.kv}>
              <span>动画帧</span>
              <b>本次无采样帧</b>
            </div>
          )}
          <p className={styles.hint}>FPS / Web Vitals / Long Task / 内存见全局悬浮面板</p>
        </>
      ) : (
        <p className={styles.hint}>执行操作后展示各阶段耗时与动画帧统计</p>
      )}
    </section>
  );
}
