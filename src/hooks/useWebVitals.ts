import { useEffect, useState } from 'react';
import type { WebVitalsMetric } from '@/utils/webVitals';
import { webVitalsCollector } from '@/utils/webVitals';

export function useWebVitals() {
	const [metrics, setMetrics] = useState<WebVitalsMetric[]>([]);

	useEffect(() => {
		const collect = () => {
			setMetrics(webVitalsCollector.getMetrics());
		};

		collect();

		const interval = setInterval(collect, 5000);
		return () => clearInterval(interval);
	}, []);

	return metrics;
}
