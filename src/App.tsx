import { useState } from 'react';
import { AnimationControls } from '@/components/controls';
import { EventLoopPage } from '@/components/event-loop';
import { FiberTodoPage } from '@/components/fiber-todo/FiberTodoPage';
import { FPSPanel } from '@/components/fps';
import { Layout } from '@/components/layout';
import { LottieAnimation } from '@/components/lottie';
import { WebVitalsPanel } from '@/components/performance';
import { ScrollAnimation } from '@/components/scroll-animation';
import { UrlLifecyclePage } from '@/components/url-lifecycle';
import { MenuPage } from '@/components/menu';

type AnimationType =
	| 'menu'
	| 'scroll'
	| 'lottie'
	| 'fiber-todo'
	| 'event-loop'
	| 'url-lifecycle';

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
			case 'url-lifecycle':
				return <UrlLifecyclePage />;
			default:
				return <MenuPage onSelect={(id) => setCurrentAnimation(id as AnimationType)} />;
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

export default App;
