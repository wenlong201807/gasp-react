import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

export const ParticleText: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const texts = useRef<ParticleText[]>([]);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	interface ParticleText {
		text: string;
		x: number;
		y: number;
		vx: number;
		vy: number;
		size: number;
		color: string;
		alpha: number;
	}

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();
	}, []);

	useGSAP(() => {
		const container = containerRef.current;
		if (!container || !canvasRef.current) return;

		const canvas = canvasRef.current;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const resizeCanvas = () => {
			canvas.width = container.clientWidth;
			canvas.height = container.clientHeight;
		};

		window.addEventListener('resize', resizeCanvas);
		resizeCanvas();

		const createParticleText = (text: string, x: number, y: number) => {
			const letters = text.split('');
			const particleTexts: ParticleText[] = [];

			letters.forEach((letter, index) => {
				particleTexts.push({
					text: letter,
					x: x + (index - letters.length / 2) * 25,
					y: y,
					vx: (Math.random() - 0.5) * 8,
					vy: (Math.random() - 0.5) * 8 - 2,
					size: 28 + Math.random() * 12,
					color: `hsl(${Math.random() * 360}, 100%, 70%)`,
					alpha: 1,
				});
			});

			texts.current.push(...particleTexts);
		};

		const animate = contextSafe(() => {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			texts.current = texts.current.filter((p) => {
				p.x += p.vx;
				p.y += p.vy;
				p.vy += 0.2;
				p.alpha -= 0.008;

				ctx.save();
				ctx.globalAlpha = p.alpha;
				ctx.font = `${p.size}px Arial`;
				ctx.fillStyle = p.color;
				ctx.fillText(p.text, p.x, p.y);
				ctx.restore();

				return p.alpha > 0;
			});

			requestAnimationFrame(animate);
		});

		container.addEventListener('click', (e) => {
			const rect = container.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;

			const textsToCreate = ['G', 'A', 'S', 'P'];
			textsToCreate.forEach((text, index) => {
				createParticleText(text, x + (index - 1.5) * 30, y - 50);
			});

			const randomTexts = ['React', 'Vite', 'GSAP', 'Lottie', 'Performance'];
			randomTexts.forEach((text) => {
				createParticleText(text, Math.random() * canvas.width, Math.random() * canvas.height);
			});
		});

		animate();

		return () => {
			window.removeEventListener('resize', resizeCanvas);
		};
	}, []);

	return (
		<div
			ref={containerRef}
			className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-purple-900 via-blue-900 to-cyan-900"
		>
			<canvas ref={canvasRef} className="absolute inset-0" />
			<div className="absolute top-10 left-1/2 -translate-x-1/2 text-white/80 text-2xl font-mono tracking-widest">
				点击屏幕释放粒子文字
			</div>
		</div>
	);
};

export default ParticleText;
