import { useCallback, useRef, useState } from 'react';

const WINDOW_MS = 1000;
const STALE_MS = 500;

export interface RealtimeFps {
	fps: number | null;
	sample: (timestamp?: number) => void;
	reset: () => void;
}

function calculateFps(timestamps: number[], now: number): number | null {
	if (timestamps.length < 2 || now - timestamps[timestamps.length - 1] > STALE_MS) return null;
	const elapsed = timestamps[timestamps.length - 1] - timestamps[0];
	if (elapsed <= 0) return null;
	return Math.max(0, Math.round(((timestamps.length - 1) * 1000) / elapsed));
}

export function useRealtimeFps(): RealtimeFps {
	const timestampsRef = useRef<number[]>([]);
	const [fps, setFps] = useState<number | null>(null);

	const sample = useCallback((timestamp = performance.now()) => {
		const timestamps = timestampsRef.current;
		timestamps.push(timestamp);
		const cutoff = timestamp - WINDOW_MS;
		while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
		setFps(calculateFps(timestamps, timestamp));
	}, []);

	const reset = useCallback(() => {
		timestampsRef.current = [];
		setFps(null);
	}, []);

	return { fps, sample, reset };
}
