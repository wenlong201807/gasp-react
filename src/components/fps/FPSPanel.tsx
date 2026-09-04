import { useState } from 'react';
import { useFPS } from '@/hooks/useFPS';
import styles from './FPSPanel.module.css';

export function FPSPanel() {
  const { fps, memory } = useFPS(200);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const getFPSColor = (value: number): string => {
    if (value >= 55) return '#22c55e';
    if (value >= 30) return '#eab308';
    return '#ef4444';
  };

  const formatMemory = (bytes?: number): string => {
    if (!bytes) return 'N/A';
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className={`${styles.panel} ${isCollapsed ? styles.collapsed : ''}`}>
      <div className={styles.header} onClick={() => setIsCollapsed(!isCollapsed)}>
        <span className={styles.title}>FPS Monitor</span>
        <span className={styles.indicator} style={{ backgroundColor: getFPSColor(fps) }}>
          {fps}
        </span>
      </div>

      {!isCollapsed && (
        <div className={styles.content}>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{
                width: `${Math.min((fps / 60) * 100, 100)}%`,
                backgroundColor: getFPSColor(fps),
              }}
            />
          </div>
          <div className={styles.stats}>
            <span>Memory: {formatMemory(memory)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
