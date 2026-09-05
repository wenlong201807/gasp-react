import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

interface FireworkParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	color: string;
	life: number;
}

export const FireworksCanvas: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const particles = useRef<FireworkParticle[]>([]);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	const createParticle = (x: number, y: number) => {
		particles.current.push({
			x,
			y,
			vx: (Math.random() - 0.5) * 15,
			vy: (Math.random() - 0.5) * 15 - 3,
			size: Math.random() * 8 + 4,
			color: `hsl(${Math.random() * 360}, 100%, 70%)`,
			life: 60,
		});
	};

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

		const fireworkInterval = setInterval(() => {
			const x = Math.random() * canvas.width;
			const y = canvas.height * 0.8;
			createParticle(x, y);
		}, 80);

		const animate = contextSafe(() => {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			particles.current = particles.current.filter((p) => {
				p.x += p.vx;
				p.y += p.vy;
				p.vy += 0.3;
				p.life--;

				ctx.save();
				ctx.globalAlpha = p.life / 60;
				ctx.fillStyle = p.color;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();

				return p.life > 0;
			});

			requestAnimationFrame(animate);
		});

		animate();

		return () => {
			clearInterval(fireworkInterval);
			window.removeEventListener('resize', resizeCanvas);
		};
	}, []);

	return (
		<div ref={containerRef} className="relative w-full h-screen overflow-hidden bg-black">
			<canvas ref={canvasRef} className="absolute inset-0" />
			<div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-white/10 px-8 py-3 rounded-full text-white/80 text-sm backdrop-blur">
				自动发射烟花
			</div>
		</div>
	);
};

export default FireworksCanvas;
