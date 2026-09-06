import { useThreeCarNav } from './useThreeCarNav';

export function ThreeCarNavPage() {
	const { containerRef, stats } = useThreeCarNav();

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
		</div>
	);
}
