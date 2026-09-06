import * as THREE from 'three';
import type { CameraMode, DrivingState, EngineStats, TimeOfDay } from '../types';
import { CameraRig } from './CameraRig';
import { CitySystem } from './CitySystem';
import { DayNightSystem } from './DayNightSystem';
import { RoadSystem } from './RoadSystem';

/** onStats 合并快照：引擎统计 + 驾驶状态（节流 5Hz 推送） */
export type EngineSnapshot = EngineStats & DrivingState;

export type StatsListener = (snapshot: EngineSnapshot) => void;

/** Task 5 CarSystem 将实现的车灯接口（本任务先以空值保护形式预留联动） */
interface CarLightControllable {
	setLights(on: boolean): void;
}

const STATS_INTERVAL_MS = 200; // 5Hz
const MAX_DT_SEC = 0.1; // 切后台回来防止 dt 跳变

/**
 * three-car-nav 引擎。
 * 生命周期：new(container) → start() → [RAF render] → dispose()
 * 已接入：RoadSystem / CitySystem / CameraRig / DayNightSystem（光照唯一所有者）。
 * 后续任务将接入 CarSystem / TrafficSystem / HudSystem。
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
	private roadSystem: RoadSystem;
	private citySystem: CitySystem;
	private dayNightSystem: DayNightSystem;
	private cameraRig: CameraRig;
	/** Task 5 CarSystem 接入点：DayNightSystem 经空值保护调用其车灯接口 */
	private carSystem: CarLightControllable | null = null;
	private clock = new THREE.Clock();
	private running = false;
	private listeners = new Set<StatsListener>();
	private statsTimerMs = 0;
	private frameCount = 0;
	private onResize = () => this.resize();

	constructor(container: HTMLElement) {
		this.container = container;

		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });

		this.roadSystem = new RoadSystem(this.scene);
		this.citySystem = new CitySystem(this.scene);

		/* 光照/背景/雾归 DayNightSystem 所有：构造即以 dusk 满值起步并同步路灯/窗灯联动 */
		this.dayNightSystem = new DayNightSystem(this.scene, this.renderer, {
			setLampsOn: (on) => this.roadSystem.setLampsOn(on),
			setWindowGlow: (k) => this.citySystem.setWindowGlow(k),
			setCarLights: (on) => this.carSystem?.setLights(on), // Task 5 前恒为空调用
		});
		this.cameraRig = new CameraRig(this.camera, this.state.cameraMode);

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

		// 子系统先自释放（几何/材质/纹理/灯光全清）并从场景摘除
		this.roadSystem.dispose();
		this.citySystem.dispose();
		this.dayNightSystem.dispose();
		this.cameraRig.dispose();

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
		this.state.cameraMode = mode; // CameraRig 每帧读取 state 平滑过渡
	}

	setTimeOfDay(t: TimeOfDay): void {
		this.state.timeOfDay = t; // DayNightSystem 每帧检测变化并启动 1.5s 过渡
	}

	/** Task 5 落地 CarSystem 后调用：接入车灯联动并立即同步当前档位开关状态 */
	attachCarSystem(car: CarLightControllable): void {
		this.carSystem = car;
		car.setLights(this.dayNightSystem.lampsOn);
	}

	private tick = (): void => {
		if (!this.running) return;
		const dt = Math.min(this.clock.getDelta(), MAX_DT_SEC);
		this.roadSystem.update(dt, this.state);
		this.citySystem.update(dt, this.state);
		this.dayNightSystem.update(dt, this.state);
		this.cameraRig.update(dt, this.state); // 相机最后更新，反映当帧最新状态
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
