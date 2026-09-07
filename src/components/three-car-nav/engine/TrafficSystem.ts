import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DrivingState, TrafficTarget } from '../types';

/* ------------------------------------------------------------------ */
/* 锁定常量（计划 Task 6 Step 1–3，禁止调整）                            */
/* ------------------------------------------------------------------ */
const SAME_LANE_X = [-3.5, 0, 3.5]; // 同向车道中心（lane 0/1/2，与 RoadSystem 一致）
const OPP_LANE_X = [10.5, 14, 17.5]; // 对向车道中心（朝 +Z 行驶）
const SAME_SPEED_MIN_KMH = 40; // 同向巡航速度域下限
const SAME_SPEED_MAX_KMH = 70; // 同向巡航速度域上限
const OPP_SPEED_MIN_KMH = 50; // 对向巡航速度域下限
const OPP_SPEED_MAX_KMH = 80; // 对向巡航速度域上限
const SPAWN_GAP_MIN_M = 25; // 同车道生成/重安置最小间距
const DESPAWN_ABS_Z_M = 150; // |z| 超过则重新安置
const RESPAWN_NEAR_M = 140; // 重新安置到 -140m 外：z ∈ [-150, -140)（不越出界值防抖动）
const FOLLOW_GAP_M = 20; // 同车道前车 20m 内减速至前车速度
const RADAR_RANGE_X_M = 25; // 雷达量程 x ±25m
const RADAR_RANGE_Z_M = 60; // 雷达量程 z ±60m
const WHEEL_RADIUS_M = 0.34; // 与 fallbackCar 轮半径一致

/* 实现补充常量（计划未锁定，标注用途） */
const FOLLOW_ACCEL_MS2 = 6; // 跟车减速/回复的加速度上限（平滑，防速度瞬变）
const TRAFFIC_SEED = 0x6f1d2a3c; // 车流布局种子（写死保证可复现）
/** 车轮局部位形（与 fallbackCar 同源：轮距 1.55 / 轴距 2.6 / 半径 0.34） */
const WHEEL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
	[-0.775, -1.3],
	[0.775, -1.3],
	[-0.775, 1.3],
	[0.775, 1.3],
];
/** 车身网格尺寸（与 fallbackCar 同源推导：lower/upper 两盒） */
const BODY_DIMS = { w: 1.8, lowerH: 0.42, upperH: 0.33, lowerL: 4.2, upperW: 1.62, upperL: 2.31 };
/** 玻璃罩高度（fallbackCar BODY_H*0.5） */
const BODY_GLASS_H = 0.3;
/** 车轮实例总数（3 同向 + 2 对向 = 5 车 × 4 轮，InstancedMesh 固定容量） */
const WHEEL_INSTANCE_COUNT = 20;

/** 随机深色系车身调色板（炭黑/深蓝/墨绿/酒红/深棕等） */
const DARK_BODY_COLORS = [
	0x1c1f24, 0x232a38, 0x2b2436, 0x1f3027, 0x30291f, 0x161a22, 0x272b31, 0x231c1c,
];

/** 可复现伪随机（与 RoadSystem/CitySystem 同模式） */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface TrafficCar {
	/** 车身网格组（body/glass/头灯条/尾灯条，几何材质系统级共享，仅 bodyMat 每车独立） */
	group: THREE.Group;
	/** true = 与主车同向（朝 -Z）；false = 对向（朝 +Z，rotation.y = π） */
	sameDir: boolean;
	/** 巡航速度 m/s */
	cruiseSpeed: number;
	/** 当前速度 m/s（跟车减速/避让后） */
	curSpeed: number;
	/** 所在车道中心 x */
	x: number;
	/** treadmill 世界 z（主车 z=0） */
	z: number;
	/** 车轮累计自转角（rad，负向与 fallbackCar rotation.x -= spin 一致） */
	spin: number;
}

/**
 * 车流系统：5 辆低模车（同向 3 + 对向 2）沿 treadmill 世界运动，
 * 出界后重安置到 -140m 外随机合法车位，并每帧把雷达量程内目标写入 state.trafficTargets。
 * 运动锁定公式：同向 dz = (scroll - v)*dt；对向 dz = (scroll + v)*dt。
 *
 * Task 9 性能（draw calls < 120 验收）：车身 = lower+upper 合并 1 mesh + 玻璃 1 +
 * 头灯/尾灯各 1（左右灯对烘焙为单几何）；全部 20 只车轮共用 1 个 InstancedMesh
 * （自转经实例矩阵每帧同步，视觉与逐轮 mesh 一致）。单辆车 11 → 4 draw calls，
 * 整个车流 55 → 5×4 + 1 = 21。
 */
export class TrafficSystem {
	private root = new THREE.Group();
	private cars: TrafficCar[] = [];
	private rand = mulberry32(TRAFFIC_SEED);
	private lightsOn = false;
	/* 共享资源（构造建、dispose 统一释放） */
	private geometries: THREE.BufferGeometry[] = [];
	private materials: THREE.Material[] = [];
	private bodyGeo!: THREE.BufferGeometry;
	private glassGeo!: THREE.BufferGeometry;
	private headlightGeo!: THREE.BufferGeometry;
	private taillightGeo!: THREE.BufferGeometry;
	private glassMat!: THREE.MeshStandardMaterial;
	private headlightMat!: THREE.MeshStandardMaterial;
	private taillightMat!: THREE.MeshStandardMaterial;
	private wheelMesh!: THREE.InstancedMesh;
	private dummy = new THREE.Object3D();
	/** 本帧有车重安置（位姿大变，需重刷车轮实例矩阵） */
	private respawnedThisFrame = false;

	constructor(scene: THREE.Scene) {
		this.root.name = 'traffic-system';

		this.buildSharedResources();

		/* 同向 3 辆：lane 0/1/2 各一辆，速度 40–70km/h；
		   lane1 初始落主车前方 ~30m（雷达开局即有目标），lane2 落主车后方制造超车感 */
		this.spawnSame(0, -85 - this.rand() * 20);
		this.spawnSame(1, -30 - this.rand() * 15);
		this.spawnSame(2, 35 + this.rand() * 20);

		/* 对向 2 辆：从 3 条对向车道取不重复 2 条，速度 50–80km/h，朝 +Z */
		const oppLanes = [0, 1, 2];
		// Fisher–Yates 一步取前两条（种子随机，可复现）
		for (let i = oppLanes.length - 1; i > 0; i--) {
			const j = Math.floor(this.rand() * (i + 1));
			[oppLanes[i], oppLanes[j]] = [oppLanes[j], oppLanes[i]];
		}
		this.spawnOpp(oppLanes[0], -70 - this.rand() * 30);
		this.spawnOpp(oppLanes[1], -10 - this.rand() * 30);

		this.syncWheelInstances();
		scene.add(this.root);
	}

	/** 车灯开/关（DayNightSystem 联动，dusk/night 开；灯带材质全场共享，一次切换） */
	setLights(on: boolean): void {
		this.lightsOn = on;
		this.headlightMat.emissiveIntensity = on ? 1.4 : 0;
		this.taillightMat.emissiveIntensity = on ? 0.6 : 0;
	}

	/** 每帧更新：跟车减速 → 位移（锁定公式）+ 车轮自转 → 出界重安置 → 雷达目标写入 state */
	update(dt: number, state: DrivingState): void {
		const scroll = state.gear === 'P' ? 0 : state.speedKmh / 3.6; // 与 RoadSystem 一致
		const egoX = SAME_LANE_X[state.laneIndex]; // 主车车道中心（微动 ±0.02m 忽略）

		/* 1) 跟车：同车道前车 20m 内减速至前车速度（同向前方为 -Z，对向前方为 +Z）。
		   主车（z=0, 速度=scroll）计入同向同车道前车链防穿模；
		   主车前方 20m 内的同向车加速避让（补充规则：主车速度由用户控制不减速，不避让必穿模） */
		for (const car of this.cars) {
			let target = car.cruiseSpeed;
			let frontGap = Number.POSITIVE_INFINITY;
			let frontSpeed = 0;
			for (const other of this.cars) {
				if (other === car || other.x !== car.x) continue; // 同车道
				const gap = car.sameDir ? car.z - other.z : other.z - car.z; // 与行驶方向前车的间距
				if (gap > 0 && gap < frontGap) {
					frontGap = gap;
					frontSpeed = other.curSpeed;
				}
			}
			if (car.sameDir && Math.abs(car.x - egoX) < 0.01) {
				if (car.z > 0) {
					// 主车在前方（z=0 < car.z）：主车是它的前车
					if (car.z < frontGap) {
						frontGap = car.z;
						frontSpeed = scroll;
					}
				} else {
					// 车在主车前方：后方主车逼近则加速避让（补充，未锁定）
					if (-car.z < FOLLOW_GAP_M) target = Math.max(target, scroll);
				}
			}
			if (frontGap < FOLLOW_GAP_M) target = Math.min(target, frontSpeed);
			// 加速度限幅平滑逼近目标速度（6 m/s² 足以在 20m 缓冲内消除 ≤8.3m/s 的速度差）
			const maxDv = FOLLOW_ACCEL_MS2 * dt;
			const dv = Math.max(-maxDv, Math.min(maxDv, target - car.curSpeed));
			car.curSpeed += dv;
		}

		/* 2) 位移（锁定公式）+ 车轮自转累计 + 同步 mesh */
		for (const car of this.cars) {
			const dz = (car.sameDir ? scroll - car.curSpeed : scroll + car.curSpeed) * dt;
			car.z += dz;
			car.group.position.z = car.z;
			car.spin -= (car.curSpeed / WHEEL_RADIUS_M) * dt; // 局部系前进方向一致（对向已随 yaw 翻转）
		}
		this.syncWheelInstances();

		/* 3) 出界重安置：|z| > 150 → -140m 外随机合法车位 */
		for (const car of this.cars) {
			if (Math.abs(car.z) > DESPAWN_ABS_Z_M) {
				this.respawn(car);
			}
		}
		if (this.respawnedThisFrame) {
			this.syncWheelInstances();
			this.respawnedThisFrame = false;
		}

		/* 4) 雷达目标输出：量程 x±25m / z±60m 内目标，相对主车（主车 z=0 固定） */
		const targets: TrafficTarget[] = [];
		for (const car of this.cars) {
			const relX = car.x - egoX;
			const relZ = car.z;
			if (Math.abs(relX) <= RADAR_RANGE_X_M && Math.abs(relZ) <= RADAR_RANGE_Z_M) {
				targets.push({ relX, relZ });
			}
		}
		state.trafficTargets = targets;
	}

	/** 释放共享几何/材质/实例缓冲并从场景摘除（bodyMat 每车独立，随 materials 一并释放） */
	dispose(): void {
		this.root.removeFromParent();
		this.wheelMesh.dispose(); // instanceMatrix/instanceColor GPU 缓冲
		for (const geometry of this.geometries) geometry.dispose();
		for (const material of this.materials) material.dispose();
		this.geometries.length = 0;
		this.materials.length = 0;
		this.cars.length = 0;
	}

	/* ---------------------------- 内部 ---------------------------- */

	/** 系统级共享资源：合并车身/灯带几何、共享玻璃/灯材质、20 轮共用 InstancedMesh */
	private buildSharedResources(): void {
		const { w, lowerH, upperH, lowerL, upperW, upperL } = BODY_DIMS;
		const lowerY = WHEEL_RADIUS_M + lowerH / 2;
		const upperY = WHEEL_RADIUS_M + lowerH + upperH / 2;

		/* 车身 = lower + upper 两盒合并（平移烘焙进几何） */
		const lower = new THREE.BoxGeometry(w, lowerH, lowerL).translate(0, lowerY, 0);
		const upper = new THREE.BoxGeometry(upperW, upperH, upperL).translate(
			0,
			upperY,
			-lowerL * 0.05
		);
		this.bodyGeo = this.trackGeo(
			mergeGeometries([lower, upper], false) ?? new THREE.BufferGeometry()
		);

		/* 玻璃罩（尺寸/位姿与 fallbackCar windshield 一致） */
		this.glassGeo = this.trackGeo(
			new THREE.BoxGeometry(w * 0.82, BODY_GLASS_H, lowerL * 0.52).translate(
				0,
				upperY,
				-lowerL * 0.05
			)
		);
		this.glassMat = this.trackMat(
			new THREE.MeshStandardMaterial({
				color: 0x141821,
				metalness: 0.4,
				roughness: 0.18,
				emissive: 0x0a0d18,
				emissiveIntensity: 0.4,
			})
		);

		/* 头灯/尾灯：左右灯对合并为单几何（y/z 与 fallbackCar 逐项一致） */
		const lightY = WHEEL_RADIUS_M + 0.6 * 0.45;
		const hlHalf = new THREE.BoxGeometry(0.32, 0.08, 0.04);
		const hl = mergeGeometries(
			[
				hlHalf.clone().translate(-0.64, lightY, -2.11),
				hlHalf.clone().translate(0.64, lightY, -2.11),
			],
			false
		);
		this.headlightGeo = this.trackGeo(hl ?? new THREE.BufferGeometry());
		this.headlightMat = this.trackMat(
			new THREE.MeshStandardMaterial({ color: 0xfff5d8, emissive: 0xfff0c2, emissiveIntensity: 0 })
		);
		const tlHalf = new THREE.BoxGeometry(0.448, 0.08, 0.04);
		const tl = mergeGeometries(
			[
				tlHalf.clone().translate(-0.576, lightY, 2.11),
				tlHalf.clone().translate(0.576, lightY, 2.11),
			],
			false
		);
		this.taillightGeo = this.trackGeo(tl ?? new THREE.BufferGeometry());
		this.taillightMat = this.trackMat(
			new THREE.MeshStandardMaterial({ color: 0x4a0a0a, emissive: 0xff2020, emissiveIntensity: 0 })
		);
		this.setLights(this.lightsOn);

		/* 车轮：轴 X 烘焙进几何（rotateZ(π/2)），全场 5 车 × 4 轮共用 1 个 InstancedMesh */
		const wheelGeo = this.trackGeo(
			new THREE.CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, 0.26, 18).rotateZ(Math.PI / 2)
		);
		const wheelMat = this.trackMat(
			new THREE.MeshStandardMaterial({ color: 0x111315, metalness: 0.2, roughness: 0.85 })
		);
		this.wheelMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, WHEEL_INSTANCE_COUNT);
		this.wheelMesh.name = 'traffic-wheels';
		this.wheelMesh.count = 0; // 生成车辆后按实际数量打开
		this.root.add(this.wheelMesh);
	}

	/** 把每车自转/朝向/位置写入共享车轮 InstancedMesh（自转轴随车辆 yaw 联动） */
	private syncWheelInstances(): void {
		const total = this.cars.length * WHEEL_OFFSETS.length;
		if (this.wheelMesh.count !== total) {
			this.wheelMesh.count = total;
		}
		let i = 0;
		for (const car of this.cars) {
			const yaw = car.sameDir ? 0 : Math.PI;
			const cos = Math.cos(yaw);
			const sin = Math.sin(yaw);
			for (const [ox, oz] of WHEEL_OFFSETS) {
				this.dummy.position.set(
					car.x + ox * cos + oz * sin,
					WHEEL_RADIUS_M,
					car.z - ox * sin + oz * cos
				);
				this.dummy.rotation.set(car.spin, yaw, 0, 'YXZ');
				this.dummy.scale.setScalar(1);
				this.dummy.updateMatrix();
				this.wheelMesh.setMatrixAt(i++, this.dummy.matrix);
			}
		}
		this.wheelMesh.instanceMatrix.needsUpdate = true;
	}

	/** 同向车生成：laneIndex ∈ 0/1/2，速度 40–70km/h 随机，深色车身 */
	private spawnSame(laneIndex: number, z: number): void {
		const kmh = SAME_SPEED_MIN_KMH + this.rand() * (SAME_SPEED_MAX_KMH - SAME_SPEED_MIN_KMH);
		this.spawnCar(true, SAME_LANE_X[laneIndex], z, kmh / 3.6);
	}

	/** 对向车生成：laneIndex ∈ 0/1/2（对向 3 车道），速度 50–80km/h 随机，朝 +Z */
	private spawnOpp(laneIndex: number, z: number): void {
		const kmh = OPP_SPEED_MIN_KMH + this.rand() * (OPP_SPEED_MAX_KMH - OPP_SPEED_MIN_KMH);
		this.spawnCar(false, OPP_LANE_X[laneIndex], z, kmh / 3.6);
	}

	private spawnCar(sameDir: boolean, x: number, z: number, speedMs: number): void {
		const bodyColor = DARK_BODY_COLORS[Math.floor(this.rand() * DARK_BODY_COLORS.length)];
		const bodyMat = this.trackMat(
			new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.65, roughness: 0.32 })
		);
		const group = new THREE.Group();
		group.name = 'traffic-car';
		group.add(
			new THREE.Mesh(this.bodyGeo, bodyMat),
			new THREE.Mesh(this.glassGeo, this.glassMat),
			new THREE.Mesh(this.headlightGeo, this.headlightMat),
			new THREE.Mesh(this.taillightGeo, this.taillightMat)
		);
		if (!sameDir) group.rotation.y = Math.PI; // 对向朝 +Z
		group.position.set(x, 0, z);
		this.root.add(group);
		this.cars.push({ group, sameDir, cruiseSpeed: speedMs, curSpeed: speedMs, x, z, spin: 0 });
	}

	/** 重安置：随机车道 + z ∈ [-150, -140)，需满足同车道 25m 间距 */
	private respawn(car: TrafficCar): void {
		const lanes = car.sameDir ? SAME_LANE_X : OPP_LANE_X;
		for (let attempt = 0; attempt < 10; attempt++) {
			const x = lanes[Math.floor(this.rand() * lanes.length)];
			const z = -(RESPAWN_NEAR_M + this.rand() * (DESPAWN_ABS_Z_M - RESPAWN_NEAR_M));
			if (this.laneSlotFree(car, x, z)) {
				this.place(car, x, z);
				return;
			}
		}
		// 兜底：每向车数 ≤ 车道数，必存在空车道可放最远端
		for (const x of lanes) {
			if (this.laneSlotFree(car, x, -DESPAWN_ABS_Z_M + 0.5)) {
				this.place(car, x, -DESPAWN_ABS_Z_M + 0.5);
				return;
			}
		}
		this.place(car, car.x, -DESPAWN_ABS_Z_M + 0.5); // 理论不可达
	}

	/** 同车道（x 相同且同向）无其他车落在 SPAWN_GAP_MIN_M 内 */
	private laneSlotFree(self: TrafficCar, x: number, z: number): boolean {
		for (const other of this.cars) {
			if (other === self || other.x !== x || other.sameDir !== self.sameDir) continue;
			if (Math.abs(other.z - z) < SPAWN_GAP_MIN_M) return false;
		}
		return true;
	}

	private place(car: TrafficCar, x: number, z: number): void {
		car.x = x;
		car.z = z;
		car.curSpeed = car.cruiseSpeed; // 重新上路恢复巡航
		car.group.position.set(x, 0, z);
		this.respawnedThisFrame = true;
	}

	private trackGeo<T extends THREE.BufferGeometry>(geometry: T): T {
		this.geometries.push(geometry);
		return geometry;
	}

	private trackMat<T extends THREE.Material>(material: T): T {
		this.materials.push(material);
		return material;
	}
}
