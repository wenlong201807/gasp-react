import styles from './FiberTodo.module.css';
import type { PipelineRecord } from './types';

interface FiberDiffPanelProps {
  records: PipelineRecord[];
  supported: boolean;
}

export function FiberDiffPanel({ records, supported }: FiberDiffPanelProps) {
  const latest = records[0] ?? null;

  return (
    <section className={styles.panel} aria-label="Fiber Diff 统计">
      <h3 className={styles.panelTitle}>Fiber Diff · 真实 DOM 变更 vs 动画</h3>
      {!supported && (
        <p className={styles.hint}>
          当前浏览器不支持 MutationObserver，本面板统计不可用
        </p>
      )}
      {latest ? (
        <>
          <div className={styles.kv}>
            <span>
              #{latest.seq} {latest.op}
            </span>
          </div>
          <table className={styles.compare}>
            <thead>
              <tr>
                <th>指标</th>
                <th>真实 DOM</th>
                <th>动画</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>新增</td>
                <td>+{latest.diff.inserted}</td>
                <td>{latest.flip.entered}</td>
              </tr>
              <tr>
                <td>移除</td>
                <td>-{latest.diff.removed}</td>
                <td>{latest.flip.exited}</td>
              </tr>
              <tr>
                <td>移动</td>
                <td>{latest.diff.moved}</td>
                <td>{latest.flip.moved}</td>
              </tr>
              <tr>
                <td>文本变更</td>
                <td>{latest.diff.textUpdated}</td>
                <td>—</td>
              </tr>
              <tr>
                <td>属性变更</td>
                <td>{latest.diff.attrUpdated}</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
          <span
            className={`${styles.tag} ${latest.consistent ? styles.ok : styles.bad}`}
          >
            {latest.consistent === null
              ? '统计不可用'
              : latest.consistent
                ? '✓ 动画与真实变更一致'
                : '✗ 数量不一致'}
          </span>
          {records.length > 1 && (
            <div className={styles.history}>
              {records.slice(1).map((r) => (
                <div key={r.seq} className={styles.historyItem}>
                  <span>
                    #{r.seq} {r.op}
                  </span>
                  <span>
                    +{r.diff.inserted} / -{r.diff.removed} / mv{r.diff.moved}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className={styles.hint}>
          执行任意增删改查操作后，这里展示本次 Fiber commit 的真实变更统计
        </p>
      )}
    </section>
  );
}
