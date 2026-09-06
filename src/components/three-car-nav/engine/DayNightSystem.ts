import * as THREE from 'three';
import type { DrivingState, TimeOfDay } from '../types';

/* ------------------------------------------------------------------ */
/* 锁定常量（计划 Task 4 Step 2，禁止调整）                            */
/* ------------------------------------------------------------------ */
const TRANSITION_SEC = 1.5; // 档位切换全参数 lerp 过渡时长
/** 主平行光方位恒定，三档共用 */
const DIR_LIGHT_POS = new THREE.Vector3(-40, 50, 20);

/** 一档昼夜参数（颜色/强度/雾程/窗灯；路灯车灯为开关量） */
interface DayNightParams {
	bg: THREE.Color;
	fogNear: number;
	fogFar: number;
	hemiIntensity: number;
	hemiSky: THREE.Color;
	hemiGround: THREE.Color;
	dirIntensity: number;
	dirColor: THREE.Color;
	windowGlow: number;
	lampsOn: boolean;
}

function makePreset(
	bg: number,
	fogNear: number,
	fogFar: number,
	hemiIntensity: number,
	hemiSky: number,
	hemiGround: number,
	dirIntensity: number,
	dirColor: number,
	windowGlow: number,
	lampsOn: boolean
): DayNightParams {
	return {
		bg: new THREE.Color(bg),
		fogNear,
		fogFar,
		hemiIntensity,
		hemiSky: new THREE.Color(hemiSky),
		hemiGround: new THREE.Color(hemiGround),
		dirIntensity,
		dirColor: new THREE.Color(dirColor),
		windowGlow,
		lampsOn,
	};
}

/** 三档锁定参数表：dusk #2a2340 fog 60→420 / day #aac7e8 / night #0b1026 fog 40→300 */
const PRESETS: Record<TimeOfDay, DayNightParams> = {
	/* dusk：hemi 0.55(#ffd9a0/#3a3550)、dir 1.1 #ff9a5c、窗灯 0.55、路灯/车灯开 */
	dusk: makePreset(0x2a2340, 60, 420, 0.55, 0xffd9a0, 0x3a3550, 1.1, 0xff9a5c, 0.55, true),
	/* day：hemi 0.9(#ffffff/#8fa3bf)、dir 1.5 #fff4e0、窗灯 0、路灯/车灯关（雾程未锁定，沿 dusk） */
	day: makePreset(0xaac7e8, 60, 420, 0.9, 0xffffff, 0x8fa3bf, 1.5, 0xfff4e0, 0, false),
	/* night：hemi 0.25(#4a5a8a/#111322)、dir 0.3 #8aa2ff、窗灯 1、路灯/车灯开 */
	night: makePreset(0x0b1026, 40, 300, 0.25, 0x4a5a8a, 0x111322, 0.3, 0x8aa2ff, 1, true),
};

function cloneParams(p: DayNightParams): DayNightParams {
	return {
		bg: p.bg.clone(),
		fogNear: p.fogNear,
		fogFar: p.fogFar,
		hemiIntensity: p.hemiIntensity,
		hemiSky: p.hemiSky.clone(),
		hemiGround: p.hemiGround.clone(),
		dirIntensity: p.dirIntensity,
		dirColor: p.dirColor.clone(),
		windowGlow: p.windowGlow,
		lampsOn: p.lampsOn,
	};
}

/** 联动出口：路灯（RoadSystem.setLampsOn）、窗灯（CitySystem.setWindowGlow）、车灯（Task 5 CarSystem） */
export interface DayNightLinks {
	setLampsOn(on: boolean): void;
	setWindowGlow(k: number): void;
	setCarLights(on: boolean): void;
}

/**
 * 昼夜系统：场景光照/背景/雾的唯一所有者（引擎不再持有临时灯光）。
 * 三档参数锁定；切换经 1.5s 全参数 lerp（从当前实际渲染值出发，可中途折返）；
 * 构造即以 dusk 满值起步并同步联动出口，避免开场闪变。
 * 路灯/车灯为开关量无法 lerp，随目标档位即刻切换；窗灯随亮度连续 lerp。
 */
export class DayNightSystem {
	private scene: THREE.Scene;
	private renderer: THREE.WebGLRenderer;
	private links: DayNightLinks;
	private hemiLight: THREE.HemisphereLight;
	private dirLight: THREE.DirectionalLight;
	private fog: THREE.Fog;
	private targetKey: TimeOfDay = 'dusk';
	/** 过渡进度：1 = 已贴合目标档（构造起步即 1） */
	private progress = 1;
	private from: DayNightParams;
	/** 当前实际生效值（过渡中逐帧改写；scene.background 直接引用其 bg） */
	private current: DayNightParams;

	constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, links: DayNightLinks) {
		this.scene = scene;
		this.renderer = renderer;
		this.links = links;

		this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
		this.dirLight = new THREE.DirectionalLight(0xffffff, 1);
		this.dirLight.position.copy(DIR_LIGHT_POS);
		this.fog = new THREE.Fog(0x000000, PRESETS.dusk.fogNear, PRESETS.dusk.fogFar);

		this.from = cloneParams(PRESETS.dusk);
		this.current = cloneParams(PRESETS.dusk);

		scene.add(this.hemiLight, this.dirLight);
		scene.fog = this.fog;
		scene.background = this.current.bg; // 引用共享：过渡改写 current.bg 即同步背景
		this.applyCurrent();
	}

	/** 当前路灯/车灯档位（过渡启动即切换，含构造起步） */
	get lampsOn(): boolean {
		return PRESETS[this.targetKey].lampsOn;
	}

	update(dt: number, state: DrivingState): void {
		if (state.timeOfDay !== this.targetKey) {
			this.beginTransition(state.timeOfDay);
		}
		if (this.progress >= 1) return;

		this.progress = Math.min(1, this.progress + dt / TRANSITION_SEC);
		const k = this.progress;
		const from = this.from;
		const to = PRESETS[this.targetKey];
		const cur = this.current;
		cur.bg.lerpColors(from.bg, to.bg, k);
		cur.fogNear = from.fogNear + (to.fogNear - from.fogNear) * k;
		cur.fogFar = from.fogFar + (to.fogFar - from.fogFar) * k;
		cur.hemiIntensity = from.hemiIntensity + (to.hemiIntensity - from.hemiIntensity) * k;
		cur.hemiSky.lerpColors(from.hemiSky, to.hemiSky, k);
		cur.hemiGround.lerpColors(from.hemiGround, to.hemiGround, k);
		cur.dirIntensity = from.dirIntensity + (to.dirIntensity - from.dirIntensity) * k;
		cur.dirColor.lerpColors(from.dirColor, to.dirColor, k);
		cur.windowGlow = from.windowGlow + (to.windowGlow - from.windowGlow) * k;
		this.applyCurrent();
	}

	dispose(): void {
		this.scene.remove(this.hemiLight, this.dirLight);
		this.hemiLight.dispose();
		this.dirLight.dispose();
		this.scene.fog = null;
		this.scene.background = null;
	}

	private beginTransition(next: TimeOfDay): void {
		this.from = cloneParams(this.current); // 从当前实际渲染值出发，支持过渡中途改目标
		this.targetKey = next;
		this.progress = 0;
		const lampsOn = PRESETS[next].lampsOn;
		this.links.setLampsOn(lampsOn);
		this.links.setCarLights(lampsOn);
	}

	/** 把 current 写入场景：灯光/雾/背景 + 窗灯联动出口 */
	private applyCurrent(): void {
		const cur = this.current;
		this.hemiLight.intensity = cur.hemiIntensity;
		this.hemiLight.color.copy(cur.hemiSky);
		this.hemiLight.groundColor.copy(cur.hemiGround);
		this.dirLight.intensity = cur.dirIntensity;
		this.dirLight.color.copy(cur.dirColor);
		this.fog.color.copy(cur.bg);
		this.fog.near = cur.fogNear;
		this.fog.far = cur.fogFar;
		this.renderer.setClearColor(cur.bg); // 与 scene.background 保持同步（双保险）
		this.links.setWindowGlow(cur.windowGlow);
	}
}
