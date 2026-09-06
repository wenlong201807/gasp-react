import { useState } from 'react';
import { EventLoopPage } from '@/components/event-loop';
import { FiberTodoPage } from '@/components/fiber-todo/FiberTodoPage';
import { FPSPanel } from '@/components/fps';
import { Layout } from '@/components/layout';
import { LottieAnimation } from '@/components/lottie';
import type { AnimationId } from '@/components/menu';
import { MenuDock } from '@/components/menu';
import { WebVitalsPanel } from '@/components/performance';
import { ScrollAnimation } from '@/components/scroll-animation';
import { ThreeCarNavPage } from '@/components/three-car-nav';
import { UrlLifecyclePage } from '@/components/url-lifecycle';

type AnimationType = AnimationId;

function App() {
	const [currentAnimation, setCurrentAnimation] = useState<AnimationType>('scroll');

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
			case 'three-car-nav':
				return <ThreeCarNavPage />;
			default:
				return <ScrollAnimation />;
		}
	};

	return (
		<Layout>
			<FPSPanel />
			<WebVitalsPanel />
			{renderAnimation()}
			<MenuDock currentAnimation={currentAnimation} onSelect={setCurrentAnimation} />
		</Layout>
	);
}

export default App;
