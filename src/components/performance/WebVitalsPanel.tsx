import { useState } from 'react';
import { useWebVitals } from '@/hooks/useWebVitals';
import styles from './WebVitalsPanel.module.css';

export function WebVitalsPanel() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const metrics = useWebVitals();

  const getRatingColor = (rating: 'good' | 'needs-improvement' | 'poor') => {
    switch (rating) {
      case 'good':
        return '#22c55e';
      case 'needs-improvement':
        return '#eab308';
      case 'poor':
        return '#ef4444';
    }
  };

  return (
    <div className={`${styles.panel} ${isCollapsed ? styles.collapsed : ''}`}>
      <div className={styles.header} onClick={() => setIsCollapsed(!isCollapsed)}>
        <span className={styles.title}>Web Vitals</span>
        <span className={styles.badge}>
          {metrics.filter((m) => m.rating === 'good').length}/{metrics.length}
        </span>
      </div>

      {!isCollapsed && (
        <div className={styles.content}>
          {metrics.map((metric) => (
            <div key={metric.name} className={styles.metric}>
              <span className={styles.metricName}>{metric.name}</span>
              <span className={styles.metricValue}>{metric.value}</span>
              <span
                className={styles.metricRating}
                style={{ backgroundColor: getRatingColor(metric.rating) }}
              >
                {metric.rating === 'good' ? '✓' : metric.rating === 'needs-improvement' ? '~' : '✗'}
              </span>
            </div>
          ))}
          {metrics.length === 0 && <div className={styles.loading}>Collecting...</div>}
        </div>
      )}
    </div>
  );
}
