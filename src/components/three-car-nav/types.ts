export type CameraMode = 'chase' | 'driver' | 'side';
export type TimeOfDay = 'dusk' | 'day' | 'night';
export type Gear = 'D' | 'P';

export interface TrafficTarget {
	/** 相对主车，米；x 右正 z 后正 */
	relX: number;
	relZ: number;
}

export interface DrivingState {
	speedKmh: number;
	gear: Gear;
	cameraMode: CameraMode;
	timeOfDay: TimeOfDay;
	/** 累计里程，米 */
	distanceM: number;
	laneIndex: 0 | 1 | 2;
	laneChangeHint: 'left' | 'right' | null;
	trafficTargets: TrafficTarget[];
}

export interface EngineStats {
	fps: number;
	/** su7: loading → ready | fallback */
	modelStatus: 'loading' | 'ready' | 'fallback';
}

export interface EngineControls {
	setTargetSpeed(kmh: number): void;
	togglePause(): void;
	setCameraMode(mode: CameraMode): void;
	setTimeOfDay(t: TimeOfDay): void;
}
