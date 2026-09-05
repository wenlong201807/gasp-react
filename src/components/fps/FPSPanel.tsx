import { useEffect, useState } from 'react';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import styles from './FPSPanel.module.css';

export function FPSPanel() {
	const { metrics, recordLCP, recordFID, recordCLS } = usePerformanceMonitor();
	void metrics;
	const [isCollapsed, setIsCollapsed] = useState(false);
	const [fps, setFps] = useState(60);

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();

		let frameCount = 0;
		let lastTime = performance.now();
		let rafId = 0;

		const tick = () => {
			frameCount++;
			const now = performance.now();
			if (now - lastTime >= 1000) {
				setFps(frameCount);
				frameCount = 0;
				lastTime = now;
			}
			rafId = requestAnimationFrame(tick);
		};

		rafId = requestAnimationFrame(tick);

		return () => cancelAnimationFrame(rafId);
	}, [recordLCP, recordFID, recordCLS]);

	const getFPSColor = (value: number): string => {
		if (value >= 55) return '#22c55e';
		if (value >= 30) return '#eab308';
		return '#ef4444';
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
				</div>
			)}
		</div>
	);
}
