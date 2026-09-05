export interface FPSData {
	fps: number;
	timestamp: number;
	memory?: number;
}

export interface WebVitalsData {
	lcp?: number;
	fid?: number;
	cls?: number;
	fcp?: number;
	ttfb?: number;
}

export interface AnimationProgress {
	id: string;
	progress: number;
	state: 'playing' | 'paused' | 'completed';
}

export interface PerformanceMetrics {
	fps: FPSData[];
	vitals: WebVitalsData;
	memory: {
		used: number;
		total: number;
	};
}
