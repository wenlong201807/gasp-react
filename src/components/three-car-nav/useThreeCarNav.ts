import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThreeCarNavEngine } from './engine/ThreeCarNavEngine';
import type { EngineSnapshot } from './engine/ThreeCarNavEngine';
import type { CameraMode, EngineControls, TimeOfDay } from './types';

const INITIAL_SNAPSHOT: EngineSnapshot = {
	fps: 0,
	modelStatus: 'loading',
	speedKmh: 60,
	gear: 'D',
	cameraMode: 'chase',
	timeOfDay: 'dusk',
	distanceM: 0,
	laneIndex: 1,
	laneChangeHint: null,
	trafficTargets: [],
};

/**
 * three-car-nav 页面胶水：挂载引擎、透传 controls、订阅节流统计。
 * StrictMode 双挂载安全——cleanup 完整 dispose 后重建。
 */
export function useThreeCarNav() {
	const containerRef = useRef<HTMLDivElement>(null);
	const engineRef = useRef<ThreeCarNavEngine | null>(null);
	const [stats, setStats] = useState<EngineSnapshot>(INITIAL_SNAPSHOT);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const engine = new ThreeCarNavEngine(container);
		engineRef.current = engine;
		const unsubscribe = engine.onStats(setStats);
		engine.start();

		return () => {
			unsubscribe();
			engine.dispose();
			engineRef.current = null;
		};
	}, []);

	const controls = useMemo<EngineControls>(
		() => ({
			setTargetSpeed: (kmh: number) => engineRef.current?.setTargetSpeed(kmh),
			togglePause: () => engineRef.current?.togglePause(),
			setCameraMode: (mode: CameraMode) => engineRef.current?.setCameraMode(mode),
			setTimeOfDay: (t: TimeOfDay) => engineRef.current?.setTimeOfDay(t),
		}),
		[]
	);

	// 供调试/任务后续扩展的当前 state 只读入口
	const getState = useCallback(() => engineRef.current?.state ?? null, []);

	return { containerRef, controls, stats, getState };
}
