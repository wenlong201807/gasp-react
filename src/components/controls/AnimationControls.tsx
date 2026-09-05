import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { gsap } from '@/utils/gsap';
import styles from './AnimationControls.module.css';

const animations = [
	{ id: 'menu', label: '主菜单', icon: '🏠' },
	{ id: 'scroll', label: '滚动动画', icon: '📜' },
	{ id: 'lottie', label: 'Lottie动画', icon: '🎨' },
	{ id: 'fiber-todo', label: 'Fiber Todo', icon: '🧬' },
	{ id: 'event-loop', label: '事件循环', icon: '🔄' },
];

interface AnimationControlsProps {
	onAnimationChange: (type: string) => void;
	currentAnimation: string;
}

export function AnimationControls({ onAnimationChange, currentAnimation }: AnimationControlsProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
	}, []);

	useGSAP(() => {
		const container = containerRef.current;
		if (!container) return;

		contextSafe(() => {
			gsap.fromTo(
				container,
				{ y: 50, opacity: 0 },
				{
					y: 0,
					opacity: 1,
					duration: 0.8,
					ease: 'power3.out',
				}
			);

			gsap.to(container, {
				y: -10,
				duration: 2,
				repeat: -1,
				yoyo: true,
				ease: 'sine.inOut',
			});
		})();
	}, []);

	return (
		<div ref={containerRef} className={styles.controls}>
			<h3 className={styles.title}>动画展示</h3>
			<div className={styles.buttons}>
				{animations.map((anim) => (
					<button
						key={anim.id}
						onClick={() => onAnimationChange(anim.id)}
						className={`${styles.btn} ${currentAnimation === anim.id ? styles.active : ''}`}
					>
						<span className="text-xl mr-2">{anim.icon}</span>
						{anim.label}
					</button>
				))}
			</div>
			<div className={styles.hint}>点击上方按钮切换动画 • 所有动画已接入性能监控</div>
		</div>
	);
}
