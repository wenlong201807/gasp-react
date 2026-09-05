import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

export const ParticleProgress: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const particles = useRef<Particle[]>([]);
	const [progress, setProgress] = useState(0);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

	interface Particle {
		x: number;
		y: number;
		vx: number;
		vy: number;
		size: number;
		color: string;
	}

	useEffect(() => {
		recordLCP();
		recordFID();
		recordCLS();

		const interval = setInterval(() => {
			setProgress((prev) => (prev >= 100 ? 0 : prev + 1));
		}, 50);

		return () => clearInterval(interval);
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

		const createParticle = (x: number, y: number) => {
			particles.current.push({
				x,
				y,
				vx: (Math.random() - 0.5) * 12,
				vy: (Math.random() - 0.5) * 12 - 3,
				size: Math.random() * 6 + 3,
				color: `hsl(${Math.random() * 360}, 100%, 70%)`,
			});
		};

		const animate = contextSafe(() => {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			const progressWidth = (canvas.width * progress) / 100;

			for (let i = 0; i < 3; i++) {
				if (Math.random() > 0.7) {
					createParticle(progressWidth, Math.random() * canvas.height);
				}
			}

			particles.current = particles.current.filter((p) => {
				p.x += p.vx;
				p.y += p.vy;
				p.vy += 0.2;
				p.size *= 0.98;

				ctx.save();
				ctx.globalAlpha = p.size / 6;
				ctx.fillStyle = p.color;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();

				return p.size > 0.5;
			});

			requestAnimationFrame(animate);
		});

		animate();

		return () => {
			window.removeEventListener('resize', resizeCanvas);
		};
	}, [progress]);

	return (
		<div
			ref={containerRef}
			className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-green-900 to-blue-900"
		>
			<canvas ref={canvasRef} className="absolute inset-0" />
			<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 max-w-md">
				<div className="bg-white/10 backdrop-blur-md p-8 rounded-3xl">
					<div className="text-white text-center mb-4 text-xl">粒子效果进度条</div>
					<div className="bg-white/20 rounded-full h-8 overflow-hidden">
						<div
							className="h-full bg-gradient-to-r from-green-400 to-blue-500 transition-all duration-100"
							style={{ width: `${progress}%` }}
						/>
					</div>
					<div className="text-white text-center mt-4 font-mono">{progress}%</div>
				</div>
			</div>
		</div>
	);
};

export default ParticleProgress;
