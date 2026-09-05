import { useEffect, useState } from 'react';
import styles from './WebVitalsPanel.module.css';

export function WebVitalsPanel() {
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [metrics, setMetrics] = useState<Array<{ name: string; value: number; rating: string }>>(
		[]
	);

	useEffect(() => {
		let observer: PerformanceObserver | null = null;

		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					setMetrics((prev) => {
						const next = [
							...prev,
							{
								name: entry.name,
								value: entry.duration,
								rating: entry.duration < 200 ? 'good' : 'poor',
							},
						];
						return next.slice(-20);
					});
				}
			});

			observer.observe({ entryTypes: ['navigation', 'resource', 'paint'] });
		} catch (e) {
			console.warn('PerformanceObserver not supported');
		}

		return () => {
			observer?.disconnect();
		};
	}, []);

	const getRatingColor = (rating: string) => {
		switch (rating) {
			case 'good':
				return '#22c55e';
			case 'needs-improvement':
				return '#eab308';
			case 'poor':
				return '#ef4444';
			default:
				return '#6b7280';
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
					{metrics.map((metric, idx) => (
						<div key={`${metric.name}-${idx}`} className={styles.metric}>
							<span className={styles.metricName}>{metric.name}</span>
							<span className={styles.metricValue}>{metric.value.toFixed(0)}</span>
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
