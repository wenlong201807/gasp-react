import { useEffect, useRef } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { usePerformanceMonitor } from '@/hooks/usePerformanceMonitor';

export const DanceCanvas: React.FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const { contextSafe } = useGSAP();
	const { recordLCP, recordFID, recordCLS } = usePerformanceMonitor();

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

		const drawDancer = (x: number, y: number, scale: number, rotation: number) => {
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(rotation);
			ctx.scale(scale, scale);

			ctx.fillStyle = '#3b82f6';
			ctx.fillRect(-20, -40, 40, 60);

			ctx.fillStyle = '#f59e0b';
			ctx.beginPath();
			ctx.arc(0, -50, 18, 0, Math.PI * 2);
			ctx.fill();

			ctx.strokeStyle = '#3b82f6';
			ctx.lineWidth = 6;
			ctx.beginPath();
			ctx.moveTo(-15, -20);
			ctx.lineTo(-30, 10);
			ctx.moveTo(15, -20);
			ctx.lineTo(30, 10);
			ctx.stroke();

			ctx.strokeStyle = '#1e40af';
			ctx.lineWidth = 8;
			ctx.beginPath();
			ctx.moveTo(-15, 20);
			ctx.lineTo(-25, 60);
			ctx.moveTo(15, 20);
			ctx.lineTo(25, 60);
			ctx.stroke();

			ctx.restore();
		};

		const animateDancer = contextSafe(() => {
			let time = 0;
			const duration = 2000;

			const tick = () => {
				time = Date.now() % duration;

				const centerX = canvas.width / 2;
				const centerY = canvas.height * 0.6;
				const scale = 1 + Math.sin(time / 300) * 0.1;
				const rotation = Math.sin(time / 400) * 0.3;

				ctx.clearRect(0, 0, canvas.width, canvas.height);

				ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
				for (let i = 0; i < 50; i++) {
					const px = Math.random() * canvas.width;
					const py = Math.random() * canvas.height;
					ctx.fillRect(px, py, 2, 2);
				}

				drawDancer(centerX, centerY, scale, rotation);

				requestAnimationFrame(tick);
			};

			tick();

			return () => {};
		});

		animateDancer();

		return () => {
			window.removeEventListener('resize', resizeCanvas);
		};
	}, []);

	return (
		<div
			ref={containerRef}
			className="relative w-full h-screen bg-gradient-to-b from-blue-900 to-purple-900 overflow-hidden"
		>
			<canvas ref={canvasRef} className="absolute inset-0" />
			<div className="absolute top-8 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md px-6 py-2 rounded-2xl text-white text-sm">
				鼠标移动控制跳舞
			</div>
		</div>
	);
};

export default DanceCanvas;
