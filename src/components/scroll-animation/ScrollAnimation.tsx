import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { gsap } from '@/utils/gsap';
import styles from './ScrollAnimation.module.css';

export function ScrollAnimation() {
	const containerRef = useRef<HTMLDivElement>(null);
	const section1Ref = useRef<HTMLDivElement>(null);
	const section2Ref = useRef<HTMLDivElement>(null);
	const section3Ref = useRef<HTMLDivElement>(null);
	const { recordLCP, recordFID, recordCLS, recordMemory } = usePerformanceMonitor();
	const { contextSafe } = useGSAP();
	void contextSafe;

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
		recordMemory();
	}, []);

	useGSAP(() => {
		const ctx = gsap.context(() => {
			// Section 1: Scale and fade
			gsap.fromTo(
				section1Ref.current,
				{ scale: 0.8, opacity: 0, rotation: -10 },
				{
					scale: 1,
					opacity: 1,
					rotation: 0,
					duration: 1,
					ease: 'power3.out',
					scrollTrigger: {
						trigger: section1Ref.current,
						start: 'top 80%',
						end: 'top 20%',
						scrub: 1,
					},
				}
			);

			// Section 2: Horizontal slide
			gsap.fromTo(
				section2Ref.current,
				{ x: -100, opacity: 0 },
				{
					x: 0,
					opacity: 1,
					duration: 1,
					ease: 'power2.out',
					scrollTrigger: {
						trigger: section2Ref.current,
						start: 'top 80%',
						end: 'top 30%',
						scrub: 1,
					},
				}
			);

			// Section 3: Stagger reveal
			const cards = section3Ref.current?.querySelectorAll(`.${styles.card}`);
			if (cards) {
				gsap.fromTo(
					cards,
					{ y: 50, opacity: 0 },
					{
						y: 0,
						opacity: 1,
						stagger: 0.1,
						duration: 0.8,
						ease: 'power2.out',
						scrollTrigger: {
							trigger: section3Ref.current,
							start: 'top 70%',
							end: 'top 20%',
							scrub: 1,
						},
					}
				);
			}
		}, containerRef);

		return () => ctx.revert();
	}, []);

	return (
		<div ref={containerRef} className={styles.container}>
			<section ref={section1Ref} className={styles.section}>
				<div className={styles.hero}>
					<h1 className={styles.title}>GSAP React</h1>
					<p className={styles.subtitle}>High-Performance 60FPS Animations</p>
				</div>
			</section>

			<section ref={section2Ref} className={styles.section}>
				<div className={styles.content}>
					<h2>Scroll-Triggered Animations</h2>
					<p>Smooth, GPU-accelerated animations powered by GSAP ScrollTrigger.</p>
				</div>
			</section>

			<section ref={section3Ref} className={styles.section}>
				<div className={styles.cards}>
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className={styles.card}>
							<span className={styles.cardNumber}>{i}</span>
							<h3>Animation {i}</h3>
							<p>Scroll-triggered reveal effect</p>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
