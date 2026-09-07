import { useEffect } from 'react';
import type { FullscreenApi } from '@/hooks/useFullscreen';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import styles from './Layout.module.css';

interface LayoutProps {
	children: React.ReactNode;
	/** 全屏 API（来自 App 的 useFullscreen，单一状态源） */
	fullscreen: FullscreenApi;
}

export function Layout({ children, fullscreen }: LayoutProps) {
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
	}, []);

	// 完全沉浸：全屏态不渲染 title 栏与 footer（dock 由 App 层条件渲染），
	// 只留角落半透明退出控件兜底；Esc 由浏览器原生退出并经 fullscreenchange 恢复布局。
	if (fullscreen.isFullscreen) {
		return (
			<div className={`${styles.layout} ${styles.layoutImmersive}`}>
				<main className={styles.main}>{children}</main>
				<button
					type="button"
					className={styles.fullscreenExit}
					aria-label="退出全屏"
					title="退出全屏"
					onClick={fullscreen.exit}
				>
					<span aria-hidden="true">⤡</span>
				</button>
			</div>
		);
	}

	return (
		<div className={styles.layout}>
			<header className={styles.header}>
				<nav className={styles.nav}>
					<div className={styles.logo}>GSAP-React</div>
					{fullscreen.supported && (
						<button
							type="button"
							className={styles.fullscreenToggle}
							aria-label={fullscreen.isFullscreen ? '退出全屏' : '进入全屏'}
							title={fullscreen.isFullscreen ? '退出全屏' : '进入全屏'}
							onClick={fullscreen.toggle}
						>
							<span aria-hidden="true">{fullscreen.isFullscreen ? '⤡' : '⤢'}</span>
						</button>
					)}
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
