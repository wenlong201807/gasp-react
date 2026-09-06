import { useEffect, useRef, useState } from 'react';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { gsap } from '@/utils/gsap';
import styles from './AnimationControls.module.css';

const animations = [
	{ id: 'menu', label: '主菜单', icon: '🏠' },
	{ id: 'scroll', label: '滚动动画', icon: '📜' },
	{ id: 'lottie', label: 'Lottie动画', icon: '🎨' },
	{ id: 'fiber-todo', label: 'Fiber Todo', icon: '🧬' },
	{ id: 'event-loop', label: '事件循环', icon: '🔄' },
	{ id: 'url-lifecycle', label: 'URL生命周期', icon: '🌐' },
];

interface AnimationControlsProps {
	onAnimationChange: (type: string) => void;
	currentAnimation: string;
}

export function AnimationControls({ onAnimationChange, currentAnimation }: AnimationControlsProps) {
	const dockRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
	}, [recordLCP, recordFID, recordCLS]);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;
		gsap.killTweensOf(panel);
		if (open) {
			gsap.fromTo(
				panel,
				{ opacity: 0, x: 8 },
				{ opacity: 1, x: 0, duration: 0.22, ease: 'power2.out' },
			);
		} else {
			gsap.to(panel, { opacity: 0, x: 8, duration: 0.18, ease: 'power2.in' });
		}
	}, [open]);

	return (
		<div
			ref={dockRef}
			className={`${styles.dock} ${open ? styles.dockOpen : ''}`}
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
		>
			<button
				type="button"
				className={styles.handle}
				aria-label={open ? '收起动画切换' : '展开动画切换'}
				aria-expanded={open}
				onClick={() => setOpen((prev) => !prev)}
			>
				<span className={styles.handleGlyph}>{open ? '✕' : '☰'}</span>
			</button>
			<div ref={panelRef} className={styles.panel} role="menu" aria-hidden={!open}>
				<h3 className={styles.panelTitle}>动画展示</h3>
				<div className={styles.list}>
					{animations.map((anim) => (
						<button
							key={anim.id}
							type="button"
							role="menuitem"
							className={`${styles.btn} ${currentAnimation === anim.id ? styles.btnActive : ''}`}
							onClick={() => onAnimationChange(anim.id)}
						>
							<span className={styles.icon}>{anim.icon}</span>
							{anim.label}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
