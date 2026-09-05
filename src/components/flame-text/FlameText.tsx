import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

export const FlameText: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const flames = useRef<Flame[]>([]);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	interface Flame {
		x: number;
		y: number;
		width: number;
		height: number;
		color: string;
		life: number;
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

		const createFlame = () => ({
			x: Math.random() * canvas.width,
			y: canvas.height,
			width: Math.random() * 60 + 40,
			height: Math.random() * 80 + 60,
			color: `hsl(${Math.random() * 60 + 10}, 100%, 60%)`,
			life: 1,
		});

		for (let i = 0; i < 5; i++) {
			flames.current.push(createFlame());
		}

		const animate = contextSafe(() => {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			ctx.globalCompositeOperation = 'lighter';

			flames.current.forEach((flame) => {
				flame.y -= 2 + Math.random() * 3;
				flame.width += 2;
				flame.height += 1;
				flame.life -= 0.01;

				if (flame.life <= 0) {
					flame.y = canvas.height;
					flame.width = Math.random() * 60 + 40;
					flame.height = Math.random() * 80 + 60;
					flame.life = 1;
				}

				const gradient = ctx.createLinearGradient(
					flame.x,
					flame.y,
					flame.x,
					flame.y - flame.height
				);
				gradient.addColorStop(0, flame.color);
				gradient.addColorStop(1, 'transparent');

				ctx.fillStyle = gradient;
				ctx.beginPath();
				ctx.ellipse(
					flame.x,
					flame.y - flame.height / 2,
					flame.width / 2,
					flame.height / 2,
					0,
					0,
					Math.PI * 2
				);
				ctx.fill();
			});

			ctx.globalCompositeOperation = 'source-over';

			requestAnimationFrame(animate);
		});

		animate();

		return () => {
			window.removeEventListener('resize', resizeCanvas);
		};
	}, []);

	return (
		<div
			ref={containerRef}
			className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-orange-900 to-red-900"
		>
			<canvas ref={canvasRef} className="absolute inset-0" />
			<div className="absolute top-10 left-1/2 -translate-x-1/2 text-white/80 text-2xl font-mono">
				火焰文字特效
			</div>
		</div>
	);
};

export default FlameText;
