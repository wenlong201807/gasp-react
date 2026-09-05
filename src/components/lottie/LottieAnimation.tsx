import Lottie, { type LottieRefCurrentProps } from 'lottie-react';
import { useEffect, useRef, useState } from 'react';
import animationData from '@/assets/loading.json';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';
import { gsap } from '@/utils/gsap';
import styles from './LottieAnimation.module.css';

export function LottieAnimation() {
	const lottieRef = useRef<LottieRefCurrentProps>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isPlaying, setIsPlaying] = useState(true);
	const [progress, setProgress] = useState(0);
	const { recordLCP, recordFID, recordCLS, recordMemory } = usePerformanceMonitor();
	const { contextSafe } = useGSAP();

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
		recordMemory();

		if (lottieRef.current) {
			lottieRef.current.setSpeed(1);
		}
	}, []);

	useGSAP(() => {
		const container = containerRef.current;
		if (!container) return;

		contextSafe(() => {
			gsap.fromTo(
				container,
				{ opacity: 0, scale: 0.9 },
				{
					opacity: 1,
					scale: 1,
					duration: 1,
					ease: 'power3.out',
				}
			);

			const card = container.querySelector(`.${styles.animationWrapper}`);
			if (card) {
				gsap.to(card, {
					y: -10,
					duration: 2,
					repeat: -1,
					yoyo: true,
					ease: 'sine.inOut',
				});
			}
		})();
	});

	const handlePlay = () => {
		lottieRef.current?.play();
		setIsPlaying(true);
	};

	const handlePause = () => {
		lottieRef.current?.pause();
		setIsPlaying(false);
	};

	const handleStop = () => {
		lottieRef.current?.stop();
		setIsPlaying(false);
		setProgress(0);
	};

	const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = parseFloat(e.target.value);
		if (lottieRef.current) {
			const totalFrames = lottieRef.current.getDuration(true) || 100;
			lottieRef.current.goToAndStop((value / 100) * totalFrames, true);
			setProgress(value);
		}
	};

	return (
		<div ref={containerRef} className={styles.container}>
			<h2 className={styles.title}>Lottie Animation</h2>

			<div className={styles.animationWrapper}>
				<Lottie
					lottieRef={lottieRef}
					animationData={animationData}
					loop
					autoplay
					style={{ width: 200, height: 200 }}
					onComplete={() => setIsPlaying(false)}
				/>
			</div>

			<div className={styles.controls}>
				<button onClick={handlePlay} disabled={isPlaying} className={styles.btn}>
					▶ Play
				</button>
				<button onClick={handlePause} disabled={!isPlaying} className={styles.btn}>
					⏸ Pause
				</button>
				<button onClick={handleStop} className={styles.btn}>
					⏹ Stop
				</button>
			</div>

			<div className={styles.progressControl}>
				<span>Progress: {progress.toFixed(0)}%</span>
				<input
					type="range"
					min="0"
					max="100"
					value={progress}
					onChange={handleProgressChange}
					className={styles.slider}
				/>
			</div>
		</div>
	);
}
