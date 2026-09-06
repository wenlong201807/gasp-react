import * as THREE from 'three';
import type { CameraMode, DrivingState, EngineStats, TimeOfDay } from '../types';

/** onStats 合并快照：引擎统计 + 驾驶状态（节流 5Hz 推送） */
export type EngineSnapshot = EngineStats & DrivingState;

export type StatsListener = (snapshot: EngineSnapshot) => void;

const STATS_INTERVAL_MS = 200; // 5Hz

/**
 * three-car-nav 引擎骨架。
 * 生命周期：new(container) → start() → [RAF render] → dispose()
 * 后续任务会在此接入 RoadSystem / CitySystem / CameraRig / CarSystem / HudSystem 等子系统。
 */
export class ThreeCarNavEngine {
	readonly state: DrivingState = {
		speedKmh: 60,
		gear: 'D',
		cameraMode: 'chase',
		timeOfDay: 'dusk',
		distanceM: 0,
		laneIndex: 1,
		laneChangeHint: null,
		trafficTargets: [],
	};

	private stats: EngineStats = {
		fps: 0,
		modelStatus: 'loading',
	};

	private container: HTMLElement;
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private renderer: THREE.WebGLRenderer;
	private running = false;
	private listeners = new Set<StatsListener>();
	private statsTimerMs = 0;
	private frameCount = 0;
	private onResize = () => this.resize();

	constructor(container: HTMLElement) {
		this.container = container;

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x2a2340);

		this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		// 追尾视角初始位姿（Task 4 CameraRig 接管后由此过渡）
		this.camera.position.set(0, 3.2, 8.5);
		this.camera.lookAt(0, 1.2, -6);

		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
		container.appendChild(this.renderer.domElement);
		this.resize();

		window.addEventListener('resize', this.onResize);
	}

	/** 订阅合并统计快照，返回取消订阅函数 */
	onStats(listener: StatsListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.statsTimerMs = performance.now();
		this.frameCount = 0;
		this.renderer.setAnimationLoop(this.tick);
	}

	dispose(): void {
		this.renderer.setAnimationLoop(null);
		this.running = false;
		window.removeEventListener('resize', this.onResize);
		this.listeners.clear();

		this.scene.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				obj.geometry.dispose();
				const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
				for (const mat of mats) {
					for (const value of Object.values(mat)) {
						if ((value as THREE.Texture | null)?.isTexture) {
							(value as THREE.Texture).dispose();
						}
					}
					mat.dispose();
				}
			}
		});
		this.scene.clear();

		this.renderer.dispose();
		if (this.renderer.domElement.parentElement === this.container) {
			this.container.removeChild(this.renderer.domElement);
		}
	}

	setTargetSpeed(kmh: number): void {
		this.state.speedKmh = Math.max(0, kmh);
	}

	togglePause(): void {
		this.state.gear = this.state.gear === 'D' ? 'P' : 'D';
	}

	setCameraMode(mode: CameraMode): void {
		this.state.cameraMode = mode;
	}

	setTimeOfDay(t: TimeOfDay): void {
		this.state.timeOfDay = t;
	}

	private tick = (): void => {
		if (!this.running) return;
		this.emitStats();
		this.renderer.render(this.scene, this.camera);
	};

	private emitStats(): void {
		if (this.listeners.size === 0) return;
		const now = performance.now();
		this.frameCount += 1;
		if (now - this.statsTimerMs < STATS_INTERVAL_MS) return;

		const elapsedSec = (now - this.statsTimerMs) / 1000;
		this.stats = { ...this.stats, fps: Math.round(this.frameCount / elapsedSec) };
		this.frameCount = 0;
		this.statsTimerMs = now;

		const snapshot: EngineSnapshot = { ...this.stats, ...this.state };
		for (const listener of this.listeners) {
			listener(snapshot);
		}
	}

	private resize(): void {
		const w = this.container.clientWidth || 1;
		const h = this.container.clientHeight || 1;
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(w, h);
	}
}
