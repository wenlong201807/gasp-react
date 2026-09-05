import { useState } from 'react';
import { AnimationControls } from '@/components/controls';
import { EventLoopPage } from '@/components/event-loop';
import { FiberTodoPage } from '@/components/fiber-todo/FiberTodoPage';
import { FPSPanel } from '@/components/fps';
import { Layout } from '@/components/layout';
import { LottieAnimation } from '@/components/lottie';
import { WebVitalsPanel } from '@/components/performance';
import { ScrollAnimation } from '@/components/scroll-animation';

type AnimationType =
	| 'menu'
	| 'scroll'
	| 'lottie'
	| 'fiber-todo'
	| 'event-loop';

function App() {
	const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('menu');

	const renderAnimation = () => {
		switch (currentAnimation) {
			case 'scroll':
				return <ScrollAnimation />;
			case 'lottie':
				return <LottieAnimation />;
			case 'fiber-todo':
				return <FiberTodoPage />;
			case 'event-loop':
				return <EventLoopPage />;
			default:
				return <MenuPage onSelect={setCurrentAnimation} />;
		}
	};

	return (
		<Layout>
			<FPSPanel />
			<WebVitalsPanel />
			{renderAnimation()}
			<AnimationControls
				onAnimationChange={(value) => setCurrentAnimation(value as AnimationType)}
				currentAnimation={currentAnimation}
			/>
		</Layout>
	);
}

const MenuPage: React.FC<{ onSelect: (type: AnimationType) => void }> = ({ onSelect }) => {
	const animations = [
		{ id: 'scroll', name: 'Scroll Animation', icon: '📜', color: 'from-blue-500 to-purple-500' },
		{ id: 'lottie', name: 'Lottie Animation', icon: '🎨', color: 'from-pink-500 to-rose-500' },
		{ id: 'fiber-todo', name: 'Fiber Todo', icon: '🧬', color: 'from-emerald-500 to-teal-500' },
		{ id: 'event-loop', name: 'Event Loop', icon: '🔄', color: 'from-sky-500 to-indigo-500' },
	] as const;

	return (
		<div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-zinc-900 to-black p-8">
			<div className="max-w-7xl mx-auto">
				<header className="mb-16 text-center">
					<h1 className="text-6xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4">
						Gasp-React
					</h1>
					<p className="text-white/60 text-xl font-light">高性能动画展示 · P10 性能优等标准</p>
				</header>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{animations.map((animation) => (
						<button
							key={animation.id}
							onClick={() => onSelect(animation.id as AnimationType)}
							className="group relative overflow-hidden bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 hover:bg-white/10 transition-all duration-300 hover:scale-105"
						>
							<div
								className={`absolute inset-0 bg-gradient-to-r ${animation.color} opacity-0 group-hover:opacity-20 transition-opacity duration-300`}
							/>
							<div className="relative">
								<div className="text-6xl mb-4">{animation.icon}</div>
								<h3 className="text-white text-xl font-semibold mb-2">{animation.name}</h3>
								<p className="text-white/60 text-sm">
									{animation.id === 'scroll' && '滚动触发的动画效果'}
									{animation.id === 'lottie' && 'Lottie JSON 动画'}
									{animation.id === 'fiber-todo' &&
										'React Fiber 增删改查 · 真实 DOM 动画 · 全链路性能'}
									{animation.id === 'event-loop' &&
										'三预设 · Lottie 事件循环可视化 · 全链路高亮'}
								</p>
							</div>
						</button>
					))}
				</div>

				<footer className="mt-16 text-center text-white/40 text-sm">
					<p>所有动画均接入 Web Vitals · FPS · 内存 · 网络监控</p>
					<p className="mt-2">遵循 P10 性能优等标准 · LCP ≤ 2.5s · CLS ≤ 0.1 · FPS ≥ 60</p>
				</footer>
			</div>
		</div>
	);
};

export default App;
