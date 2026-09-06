import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { DrivingState } from '../types';
import { buildFallbackCar, setFallbackCarLights } from './fallbackCar';

const CDN_BASE = 'https://z2586300277.github.io/3d-file-server/';
const HDR_URL = `${CDN_BASE}files/hdr/1k.hdr`;
const MODEL_URL = `${CDN_BASE}models/su7/sm_car.gltf`;
const LOAD_TIMEOUT_MS = 15000;
const HUD_CLONE_SCALE = 0.9; // 360° 视口用的小车缩放

export interface CarStats {
	/** su7: loading → ready | fallback */
	modelStatus: 'loading' | 'ready' | 'fallback';
}

export interface CarStatusListener {
	(status: CarStats): void;
}

interface CarLightControllable {
	setLights(on: boolean): void;
}

/**
 * 主车系统：CDN 加载 SU7（GLTF + MeshoptDecoder + RGBELoader + PMREMGenerator），
 * 失败/超时降级 fallback 低模车；并接管车轮滚动、车道微动、车灯联动。
 * 提供 getHudClone() 给 HudSystem 360° 子平面复用（共享材质 / 共享几何以减重）。
 */
export class CarSystem implements CarLightControllable {
	private scene: THREE.Scene;
	private root = new THREE.Group();
	private carGroup: THREE.Group | null = null;
	private wheels: THREE.Mesh[] = [];
	private headlightMat: THREE.MeshStandardMaterial | null = null;
	private taillightMat: THREE.MeshStandardMaterial | null = null;
	private fallbackMode = false;
	private status: CarStats = { modelStatus: 'loading' };
	private listeners = new Set<CarStatusListener>();
	private loadTimer: ReturnType<typeof setTimeout> | null = null;
	private loaded = false;
	private swayT = 0;
	private lightsOn = false;

	constructor(scene: THREE.Scene) {
		this.scene = scene;
		this.root.name = 'car-system';
		this.root.position.set(0, 0, 0);
		scene.add(this.root);
		this.startLoad();
	}

	/** 订阅 modelStatus 变化（loading → ready/fallback） */
	onStatus(listener: CarStatusListener): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 当前 modelStatus（外部读取用） */
	get modelStatus(): CarStats['modelStatus'] {
		return this.status.modelStatus;
	}

	/** 车灯开/关（DayNightSystem 联动） */
	setLights(on: boolean): void {
		this.lightsOn = on;
		if (this.fallbackMode && this.carGroup) {
			setFallbackCarLights(this.carGroup, on);
			return;
		}
		// SU7 ready：调整车身材质的 emissive（简化为车头方向两 MeshStandardMaterial 的 emissiveIntensity）
		if (this.headlightMat) this.headlightMat.emissiveIntensity = on ? 1.4 : 0;
		if (this.taillightMat) this.taillightMat.emissiveIntensity = on ? 0.6 : 0;
	}

	/** 360° 子平面用的小车克隆：共享材质 / 共享几何以减重 */
	getHudClone(): THREE.Group {
		if (this.fallbackMode && this.carGroup) {
			const { group, wheels } = buildFallbackCar(0x9aa3ad);
			group.scale.setScalar(HUD_CLONE_SCALE);
			setFallbackCarLights(group, this.lightsOn);
			group.userData.wheels = wheels;
			return group;
		}
		// SU7 加载成功：用 SkeletonUtils / clone 共享材质
		if (this.carGroup) {
			const clone = this.carGroup.clone(true);
			clone.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.castShadow = false;
					obj.receiveShadow = false;
					if (obj.material instanceof THREE.MeshStandardMaterial) {
						// 共享材质即可
					}
				}
			});
			clone.scale.setScalar(HUD_CLONE_SCALE);
			// 收集轮子引用
			const wheels: THREE.Mesh[] = [];
			clone.traverse((obj) => {
				if (obj instanceof THREE.Mesh && /wheel|tyre|tire/i.test(obj.name)) {
					wheels.push(obj);
				}
			});
			clone.userData.wheels = wheels;
			return clone;
		}
		// 仍在 loading：返回临时 fallback（HUD 不会因为主车未好而空白）
		const { group, wheels } = buildFallbackCar(0x9aa3ad);
		group.scale.setScalar(HUD_CLONE_SCALE);
		group.userData.wheels = wheels;
		return group;
	}

	/** 每帧更新：车轮滚动 + 车道微动 */
	update(dt: number, state: DrivingState): void {
		if (!this.loaded) return;
		this.swayT += dt;

		// 车轮滚动：按 -speed / wheelRadius * dt 旋转（fallback 模式不滚，fallback 走独立克隆的轮引用）
		if (this.fallbackMode) {
			for (const w of this.wheels) {
				// 圆柱被旋转 z=π/2 之后，原始 Y 轴变成 X 轴 → 绕 X 旋转 = 滚动
				const speed = state.gear === 'P' ? 0 : state.speedKmh / 3.6;
				w.rotation.x -= (speed / 0.34) * dt;
			}
		} else if (this.carGroup) {
			// SU7 真实模型：traverse 名字匹配 wheel/tyre/tire
			const speed = state.gear === 'P' ? 0 : state.speedKmh / 3.6;
			this.carGroup.traverse((obj) => {
				if (obj instanceof THREE.Mesh && /wheel|tyre|tire/i.test(obj.name)) {
					obj.rotation.x -= (speed / 0.34) * dt;
				}
			});
		}

		// 车道微动：yaw + 横向 sin（叠加在引擎做的车道中心 lerp 上）
		if (this.carGroup) {
			this.carGroup.rotation.y = Math.sin(this.swayT * 0.8) * 0.007;
			const baseX = state.laneIndex === 0 ? -3.5 : state.laneIndex === 1 ? 0 : 3.5;
			this.carGroup.position.x = baseX + Math.sin(this.swayT * 0.5) * 0.02;
		}
	}

	dispose(): void {
		if (this.loadTimer) {
			clearTimeout(this.loadTimer);
			this.loadTimer = null;
		}
		this.root.removeFromParent();
		if (this.carGroup) {
			this.carGroup.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.geometry?.dispose();
					const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
					for (const mat of mats) {
						if (mat instanceof THREE.Material) mat.dispose();
					}
				}
			});
		}
		this.wheels = [];
		this.carGroup = null;
		this.listeners.clear();
	}

	private setStatus(s: CarStats['modelStatus']): void {
		if (this.status.modelStatus === s) return;
		this.status = { modelStatus: s };
		for (const l of this.listeners) l(this.status);
	}

	private startLoad(): void {
		// 15s 超时降级
		this.loadTimer = setTimeout(() => {
			if (!this.loaded) {
				this.spawnFallback('timeout');
			}
		}, LOAD_TIMEOUT_MS);

		// HDR 环境
		const pmrem = new THREE.PMREMGenerator(new THREE.WebGLRenderer({ antialias: false })); // 临时 renderer 仅用于 PMREM，HUD 360 子平面会复用
		pmrem.compileEquirectangularShader();

		const gltf = new GLTFLoader();
		const draco = new DRACOLoader();
		draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
		gltf.setDRACOLoader(draco);
		gltf.setMeshoptDecoder(MeshoptDecoder);

		const rgh = new RGBELoader();
		rgh.load(
			HDR_URL,
			(hdrTex) => {
				pmrem.dispose();
				const envRT = pmrem.fromEquirectangular(hdrTex);
				this.scene.environment = envRT.texture;
				hdrTex.dispose();
			},
			undefined,
			() => {
				pmrem.dispose();
			},
		);

		gltf.load(
			MODEL_URL,
			(gltfData) => {
				if (this.loaded) return;
				this.loaded = true;
				if (this.loadTimer) {
					clearTimeout(this.loadTimer);
					this.loadTimer = null;
				}
				this.spawnSu7(gltfData.scene);
			},
			undefined,
			() => {
				if (this.loaded) return;
				this.spawnFallback('error');
			},
		);
	}

	private spawnSu7(model: THREE.Group): void {
		this.fallbackMode = false;
		// 归一化：包围盒缩放到车高 1.4m 并落地 y=0
		const box2 = new THREE.Box3().setFromObject(model);
		model.position.y = -box2.min.y;
		// 设 envMap 反射
		model.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				if (obj.material instanceof THREE.MeshStandardMaterial) {
					obj.material.envMap = this.scene.environment;
				}
			}
		});

		// 收集轮子引用
		model.traverse((obj) => {
			if (obj instanceof THREE.Mesh && /wheel|tyre|tire/i.test(obj.name)) {
				this.wheels.push(obj);
			}
			// 找头灯/尾灯材质（启发式：含 emissive 且颜色偏暖/偏红）
			if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
				const c = obj.material.color;
				if (!this.headlightMat && c.r > 0.9 && c.g > 0.85) this.headlightMat = obj.material;
				if (!this.taillightMat && c.r > 0.6 && c.g < 0.3) this.taillightMat = obj.material;
			}
		});

		this.carGroup = model;
		this.root.add(model);
		this.setStatus('ready');
		// 初始灯
		this.setLights(this.lightsOn);
	}

	private spawnFallback(_reason: 'timeout' | 'error'): void {
		if (this.loaded) return;
		this.loaded = true;
		if (this.loadTimer) {
			clearTimeout(this.loadTimer);
			this.loadTimer = null;
		}
		this.fallbackMode = true;
		const { group, wheels } = buildFallbackCar(0x9aa3ad);
		this.carGroup = group;
		this.wheels = wheels;
		this.root.add(group);
		this.setStatus('fallback');
		// 初始灯
		this.setLights(this.lightsOn);
	}
}
