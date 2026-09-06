import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

export const StarCanvas: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const stars = useRef<Star[]>([]);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	interface Star {
		x: number;
		y: number;
		size: number;
		speed: number;
		color: string;
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

		const createStar = () => ({
			x: Math.random() * canvas.width,
			y: Math.random() * canvas.height,
			size: Math.random() * 3 + 1,
			speed: Math.random() * 0.5 + 0.3,
			color: `hsl(${Math.random() * 360}, 100%, 90%)`,
		});

		for (let i = 0; i < 300; i++) {
			stars.current.push(createStar());
		}

		const animate = contextSafe(() => {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			ctx.fillStyle = '#fff';

			stars.current.forEach((star) => {
				ctx.globalAlpha = star.size / 3;
				ctx.fillRect(star.x, star.y, star.size, star.size);

				star.y += star.speed;
				if (star.y > canvas.height) {
					star.y = 0;
					star.x = Math.random() * canvas.width;
				}
			});

			ctx.globalAlpha = 1;

			requestAnimationFrame(animate);
		});

		animate();

		return () => {
			window.removeEventListener('resize', resizeCanvas);
		};
	}, []);

	return (
		<div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden">
			<canvas ref={canvasRef} className="absolute inset-0" />
			<div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md px-6 py-3 rounded-2xl text-white/80 text-sm">
				鼠标移动控制星空
			</div>
		</div>
	);
};

export default StarCanvas;
