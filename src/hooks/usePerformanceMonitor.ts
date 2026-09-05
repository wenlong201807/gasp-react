import { useEffect, useRef } from 'react';
import { onCLS, onFCP, onFID, onINP, onLCP, onTTFB } from 'web-vitals';

export interface PerformanceMetric {
	name: string;
	value: number;
	rating: 'good' | 'needs-improvement' | 'poor';
	timestamp: number;
}

export interface PerformanceReport {
	metrics: PerformanceMetric[];
	startTime: number;
	endTime: number;
	duration: number;
}

const isDevelopment = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

const sendToAnalytics = (metric: PerformanceMetric) => {
	if (isDevelopment) {
		console.log(`[Performance] ${metric.name}:`, {
			value: metric.value,
			rating: metric.rating,
			timestamp: new Date(metric.timestamp).toISOString(),
		});
	}

	if (typeof window !== 'undefined' && (window as any).gtag) {
		(window as any).gtag('event', metric.name, {
			value: Math.round(metric.value),
			metric_rating: metric.rating,
		});
	}
};

export function usePerformanceMonitor() {
	const metricsRef = useRef<PerformanceMetric[]>([]);

	const recordMetric = (metric: PerformanceMetric) => {
		metricsRef.current.push(metric);
		sendToAnalytics(metric);
	};

	const recordLCP = () => {
		onLCP((metric) => {
			recordMetric({
				name: 'LCP',
				value: metric.value,
				rating: metric.rating,
				timestamp: Date.now(),
			});
		});
	};

	const recordFID = () => {
		onFID((metric) => {
			recordMetric({
				name: 'FID',
				value: metric.value,
				rating: metric.rating,
				timestamp: Date.now(),
			});
		});
	};

	const recordCLS = () => {
		onCLS((metric) => {
			recordMetric({
				name: 'CLS',
				value: metric.value,
				rating: metric.rating,
				timestamp: Date.now(),
			});
		});
	};

	const recordFCP = () => {
		onFCP((metric) => {
			recordMetric({
				name: 'FCP',
				value: metric.value,
				rating: metric.rating,
				timestamp: Date.now(),
			});
		});
	};

	const recordTTFB = () => {
		onTTFB((metric) => {
			recordMetric({
				name: 'TTFB',
				value: metric.value,
				rating: metric.rating,
				timestamp: Date.now(),
			});
		});
	};

	const recordINP = () => {
		onINP((metric) => {
			recordMetric({
				name: 'INP',
				value: metric.value,
				rating: metric.rating,
				timestamp: Date.now(),
			});
		});
	};

	const recordMemory = () => {
		if (typeof performance !== 'undefined' && (performance as any).memory) {
			const memory = (performance as any).memory;
			recordMetric({
				name: 'Memory.usedJSHeapSize',
				value: memory.usedJSHeapSize,
				rating: memory.usedJSHeapSize < 150 * 1024 * 1024 ? 'good' : 'poor',
				timestamp: Date.now(),
			});
		}
	};

	const recordNetwork = () => {
		if (typeof navigator !== 'undefined' && (navigator as any).connection) {
			const connection = (navigator as any).connection;
			recordMetric({
				name: 'Network.effectiveType',
				value: parseFloat(connection.downlink || 0),
				rating: connection.effectiveType === '4g' ? 'good' : 'poor',
				timestamp: Date.now(),
			});
		}
	};

	const recordLongTasks = () => {
		if (typeof PerformanceObserver !== 'undefined') {
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						recordMetric({
							name: 'LongTask',
							value: entry.duration,
							rating: entry.duration < 50 ? 'good' : 'poor',
							timestamp: Date.now(),
						});
					}
				});
				observer.observe({ entryTypes: ['longtask'] });
			} catch (e) {
				console.warn('Long task observer not supported');
			}
		}
	};

	const recordResources = () => {
		if (typeof PerformanceObserver !== 'undefined') {
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						const initiator = (entry as PerformanceResourceTiming).initiatorType || 'unknown';
						recordMetric({
							name: `Resource.${initiator}`,
							value: entry.duration,
							rating: entry.duration < 200 ? 'good' : 'poor',
							timestamp: Date.now(),
						});
					}
				});
				observer.observe({ entryTypes: ['resource'] });
			} catch (e) {
				console.warn('Resource observer not supported');
			}
		}
	};

	useEffect(() => {
		recordFCP();
		recordTTFB();
		recordMemory();
		recordNetwork();
		recordLongTasks();
		recordResources();
	}, []);

	return {
		metrics: metricsRef.current,
		recordLCP,
		recordFID,
		recordCLS,
		recordFCP,
		recordTTFB,
		recordINP,
		recordMemory,
		recordNetwork,
		recordLongTasks,
		recordResources,
	};
}
