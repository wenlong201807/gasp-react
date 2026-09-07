import { EventLoopPage } from '@/components/event-loop';
import { FiberTodoPage } from '@/components/fiber-todo/FiberTodoPage';
import { FPSPanel } from '@/components/fps';
import { Layout } from '@/components/layout';
import { LottieAnimation } from '@/components/lottie';
import { MenuDock } from '@/components/menu';
import { WebVitalsPanel } from '@/components/performance';
import { ScrollAnimation } from '@/components/scroll-animation';
import { ThreeCarNavPage } from '@/components/three-car-nav';
import { UrlLifecyclePage } from '@/components/url-lifecycle';
import { navigate, useHashRoute } from '@/hooks/useHashRoute';

function App() {
	const route = useHashRoute();

	const renderAnimation = () => {
		switch (route) {
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
			<MenuDock currentAnimation={route} onSelect={navigate} />
		</Layout>
	);
}

export default App;
