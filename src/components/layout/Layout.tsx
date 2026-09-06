import { useEffect } from 'react';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import styles from './Layout.module.css';

export function Layout({ children }: { children: React.ReactNode }) {
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
	}, []);

	return (
		<div className={styles.layout}>
			<header className={styles.header}>
				<nav className={styles.nav}>
					<div className={styles.logo}>Gasp-React</div>
					<ul className={styles.menu}>
						<li>
							<a href="#fps">FPS</a>
						</li>
						<li>
							<a href="#vitals">Vitals</a>
						</li>
						<li>
							<a href="#animations">动画</a>
						</li>
					</ul>
				</nav>
			</header>

			<main className={styles.main}>{children}</main>

			<footer className={styles.footer}>
				<p>所有动画已接入性能监控 • LCP ≤ 2.5s • CLS ≤ 0.1 • FPS ≥ 60 • 内存 ≤ 150MB</p>
			</footer>
		</div>
	);
}
