import { HudControlPanel } from './HudControlPanel';
import styles from './hud-control-panel.module.css';
import { useThreeCarNav } from './useThreeCarNav';

export function ThreeCarNavPage() {
	const { containerRef, controls, stats, webglUnsupported } = useThreeCarNav();

	return (
		<div
			ref={containerRef}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 1,
				background: '#2a2340',
				overflow: 'hidden',
			}}
		>
			{webglUnsupported ? (
				/* Task 9 Step 1：WebGL 不可用降级卡片（玻璃拟态同款语言），不挂 canvas/控制台 */
				<div className={styles.webglFallback} role="alert">
					<p className={styles.webglFallbackTitle}>当前环境不支持 WebGL</p>
					<p className={styles.webglFallbackHint}>
						请更换支持 WebGL 的浏览器，或开启硬件加速后重试
					</p>
				</div>
			) : (
				<>
					{stats.modelStatus === 'loading' && (
						<div
							style={{
								position: 'absolute',
								bottom: 120,
								left: '50%',
								transform: 'translateX(-50%)',
								padding: '8px 20px',
								borderRadius: 999,
								background: 'rgba(10, 12, 30, 0.65)',
								color: 'rgba(255, 255, 255, 0.85)',
								fontSize: 14,
								letterSpacing: '0.05em',
								pointerEvents: 'none',
							}}
						>
							模型加载中…
						</div>
					)}
					<HudControlPanel stats={stats} controls={controls} />
				</>
			)}
		</div>
	);
}
