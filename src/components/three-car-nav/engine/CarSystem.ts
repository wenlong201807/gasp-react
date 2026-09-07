import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { DrivingState } from '../types';
import { buildFallbackCar, setFallbackCarLights } from './fallbackCar';

const CDN_BASE = 'https://z2586300277.github.io/3d-file-server/';
const HDR_URL = `${CDN_BASE}files/hdr/1k.hdr`;
const MODEL_URL = `${CDN_BASE}models/su7/sm_car.gltf`;
const LOAD_TIMEOUT_MS = 15000;
const HUD_CLONE_SCALE = 0.9; // 360° 视口用的小车缩放
/* 7c 变道执行（计划 Task 7 Step 4）：意图由 HudSystem 写入 state.laneChangeHint */
const LANE_CENTER_X = [-3.5, 0, 3.5]; // 本向三车道中心（与 RoadSystem/TrafficSystem 一致）
/** 变道缓变系数：x += Δ·(1-exp(-1.25·dt))，约 2.8s 收敛 97%（计划建议 2.5–3s） */
const LANE_LERP_RATE = 1.25;
/** 到位阈值：|Δx| 小于该值即落位（3.5m 跨度的约 1.7%） */
const LANE_ARRIVE_M = 0.06;

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
	private renderer: THREE.WebGLRenderer;
	private root = new THREE.Group();
	private carGroup: THREE.Group | null = null;
	/** 车轮 mesh：只收真轮 mesh；名字匹配的父 Group 无 mesh，转它会让子轮绕车体中心公转 */
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
	/* 7c 变道状态机（意图来自 HudSystem 每帧写入的 state.laneChangeHint） */
	private prevHint: 'left' | 'right' | null = null;
	private lanePhase: 'hold' | 'hint' | 'lerp' = 'hold';
	private laneTarget: 0 | 1 | 2 = 1;
	/** 主车平滑 x：hold 贴当前道中心，lerp 时缓缓逼向目标道中心 */
	private carX = 0;
	private envRT: THREE.WebGLRenderTarget | null = null;
	private disposed = false;

	constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
		this.scene = scene;
		this.renderer = renderer;
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
		// SU7 加载成功：clone 共享材质 / 共享几何
		if (this.carGroup) {
			const clone = this.carGroup.clone(true);
			clone.scale.setScalar(HUD_CLONE_SCALE);
			// 收集轮子 mesh（名字匹配的父 Group 无 mesh，转它会让子轮绕车体中心公转）
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

	/** 每帧更新：变道状态机 + 车轮滚动 + 车道微动 */
	update(dt: number, state: DrivingState): void {
		// 状态机先于 early-return：加载期 hint 沿也能被记录（不丢意图，只暂无车身可视化）
		this.updateLaneChange(dt, state);
		if (!this.loaded) return;
		this.swayT += dt;

		// 车轮滚动：按 -speed / wheelRadius * dt 绕自身 x 轴旋转
		// （fallback 圆柱被旋转 z=π/2 后原始 Y 轴变成 X 轴；SU7 轮子无论是 Mesh 还是 Group 节点同样适用）
		const speed = state.gear === 'P' ? 0 : state.speedKmh / 3.6;
		for (const w of this.wheels) {
			w.rotation.x -= (speed / 0.34) * dt;
		}

		// 车道微动：yaw + 横向 sin（叠加在车道中心/变道缓变的 carX 上）
		if (this.carGroup) {
			this.carGroup.rotation.y = Math.sin(this.swayT * 0.8) * 0.007;
			this.carGroup.position.x = this.carX + Math.sin(this.swayT * 0.5) * 0.02;
		}
	}

	/**
	 * 7c 变道执行状态机（HudSystem 只发意图，驾驶逻辑在车）：
	 * - hint 出现沿：按方向记录目标道（须落在 0/1/2 内，边界道只往内，非法方向忽略）；
	 * - hint 消失沿（4s 提示结束）：进入 lerp，主车 x 向目标道中心缓缓逼近
	 *   （x += Δ·(1-exp(-1.25·dt))，~2.8s 完成约 97%，真实变道感）；
	 * - |Δx| < 0.06m 判到位：x 贴齐目标中心 + state.laneIndex 落位（唯一写点），回 hold。
	 *
	 * 与 TrafficSystem 的一致性取舍：TrafficSystem 用 state.laneIndex 推 egoX（跟车链
	 * 与雷达 relX 的基准），变道窗口内（~3s）实际车 x 与 egoX 偏差最大 3.5m（一个道宽）。
	 * 跟车按「同车道号」判定不受影响；雷达 relX 的该误差只是装饰性显示的短暂失真，
	 * 落位后即归零——接受此偏差，换取 laneIndex 仅在变道完成时原子更新。
	 */
	private updateLaneChange(dt: number, state: DrivingState): void {
		const hint = state.laneChangeHint;
		if (hint !== this.prevHint) {
			if (hint !== null && this.lanePhase === 'hold') {
				const dir = hint === 'left' ? -1 : 1;
				const target = state.laneIndex + dir;
				if (target >= 0 && target <= 2) {
					this.laneTarget = target as 0 | 1 | 2;
					this.lanePhase = 'hint';
				}
			} else if (hint === null && this.lanePhase === 'hint') {
				this.lanePhase = 'lerp';
			}
			this.prevHint = hint;
		}

		if (this.lanePhase === 'lerp') {
			const targetX = LANE_CENTER_X[this.laneTarget];
			this.carX += (targetX - this.carX) * (1 - Math.exp(-LANE_LERP_RATE * dt));
			if (Math.abs(targetX - this.carX) < LANE_ARRIVE_M) {
				this.carX = targetX;
				state.laneIndex = this.laneTarget; // 到位落位：laneIndex 唯一写点
				this.lanePhase = 'hold';
			}
		} else {
			// hold / hint（4s 提示期车保持原道）：贴当前道中心
			this.carX = LANE_CENTER_X[state.laneIndex];
		}
	}

	dispose(): void {
		this.disposed = true;
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
		// 释放 HDR 环境贴图（挂在 scene.environment 上，引擎的材质遍历清不到）并解除引用
		this.envRT?.texture.dispose();
		this.envRT = null;
		this.scene.environment = null;
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

		// HDR 环境：PMREM 挂主 renderer（跨 GL context 的纹理主渲染器采样不到），
		// 产出的 envRT.texture 设为 scene.environment 后 generator 即可丢弃
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		pmrem.compileEquirectangularShader();

		const gltf = new GLTFLoader();
		gltf.setMeshoptDecoder(MeshoptDecoder);

		const rgh = new RGBELoader();
		rgh.load(
			HDR_URL,
			(hdrTex) => {
				if (this.disposed) {
					// 引擎已销毁（如 StrictMode 双挂载）：只清本次资源，不碰已 dispose 的 renderer
					hdrTex.dispose();
					pmrem.dispose();
					return;
				}
				this.envRT = pmrem.fromEquirectangular(hdrTex);
				this.scene.environment = this.envRT.texture;
				hdrTex.dispose();
				pmrem.dispose();
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
		// 归一化：先缩放到车高 1.4m，再重算包围盒落地 y=0（顺序：缩放 → 更新矩阵 → 重取盒 → 落地）
		const box1 = new THREE.Box3().setFromObject(model);
		const size = box1.getSize(new THREE.Vector3());
		if (size.y > 0) {
			model.scale.setScalar(1.4 / size.y);
		}
		model.updateWorldMatrix(true, true);
		const box2 = new THREE.Box3().setFromObject(model);
		model.position.y = -box2.min.y;
		// 环境反射统一依赖 scene.environment（对所有 MeshStandardMaterial 全局生效），不逐材质赋 envMap

		model.traverse((obj) => {
			// 只收真轮 mesh：名字匹配的父 Group（如 sm_car.gltf 的 Wheel 组）无 mesh、
			// 位于车体原点，转它会让子轮绕车体中心公转
			if (obj instanceof THREE.Mesh && /wheel|tyre|tire/i.test(obj.name)) {
				this.wheels.push(obj);
			}
			// 找头灯/尾灯材质（启发式：含 emissive 且颜色偏暖/偏红）
			if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
				// 假 AO：Car_body 的 occlusionTexture（sm_car_img0.webp）实为 UV atlas 遮罩图，three 采 R 通道会把车漆晕染出暗青斑 → 置空（aoMap 名含 img0 的兜底同置）
				if (obj.material.name === 'Car_body' || (obj.material.aoMap && obj.material.aoMap.name.includes('img0'))) {
					obj.material.aoMap = null;
					obj.material.aoMapIntensity = 0;
				}
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
