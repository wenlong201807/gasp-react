import { useEffect, useRef, useState } from 'react';
import type { FPSData } from '@/types';
import { FPSMonitor } from '@/utils/fps';

export function useFPS(interval = 500) {
	const [fpsData, setFpsData] = useState<FPSData>({
		fps: 0,
		timestamp: Date.now(),
	});
	const monitorRef = useRef<FPSMonitor | null>(null);

	useEffect(() => {
		monitorRef.current = new FPSMonitor();
		monitorRef.current.start();

		const updateInterval = setInterval(() => {
			if (monitorRef.current) {
				setFpsData({
					fps: monitorRef.current.getFPS(),
					timestamp: Date.now(),
					memory: monitorRef.current.getMemory(),
				});
			}
		}, interval);

		return () => {
			clearInterval(updateInterval);
			monitorRef.current?.stop();
		};
	}, [interval]);

	return fpsData;
}
