import * as THREE from 'three';
import type { DrivingState, TrafficTarget } from '../types';
import { buildFallbackCar, setFallbackCarLights } from './fallbackCar';

/* ------------------------------------------------------------------ */
/* 锁定常量（计划 Task 6 Step 1–3，禁止调整）                          */
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
	group: THREE.Group;
	wheels: THREE.Mesh[];
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
}

/**
 * 车流系统：5 辆 fallback 低模车（同向 3 + 对向 2）沿 treadmill 世界运动，
 * 出界后重安置到 -140m 外随机合法车位，并每帧把雷达量程内目标写入 state.trafficTargets。
 * 运动锁定公式：同向 dz = (scroll - v)*dt；对向 dz = (scroll + v)*dt。
 */
export class TrafficSystem {
	private root = new THREE.Group();
	private cars: TrafficCar[] = [];
	private rand = mulberry32(TRAFFIC_SEED);
	private lightsOn = false;

	constructor(scene: THREE.Scene) {
		this.root.name = 'traffic-system';

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

		scene.add(this.root);
	}

	/** 车灯开/关（DayNightSystem 联动， dusk/night 开） */
	setLights(on: boolean): void {
		this.lightsOn = on;
		for (const car of this.cars) {
			setFallbackCarLights(car.group, on);
		}
	}

	/** 每帧更新：跟车减速 → 位移（锁定公式）→ 出界重安置 → 雷达目标写入 state */
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

		/* 2) 位移（锁定公式）+ 车轮滚动 + 同步 mesh */
		for (const car of this.cars) {
			const dz = (car.sameDir ? scroll - car.curSpeed : scroll + car.curSpeed) * dt;
			car.z += dz;
			car.group.position.z = car.z;
			const spin = (car.curSpeed / WHEEL_RADIUS_M) * dt; // 局部系前进方向一致（对向 group 已转 π）
			for (const wheel of car.wheels) {
				wheel.rotation.x -= spin;
			}
		}

		/* 3) 出界重安置：|z| > 150 → -140m 外随机合法车位 */
		for (const car of this.cars) {
			if (Math.abs(car.z) > DESPAWN_ABS_Z_M) {
				this.respawn(car);
			}
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

	/** 释放全部车辆几何/材质并从场景摘除（buildFallbackCar 每辆独立建材质） */
	dispose(): void {
		this.root.removeFromParent();
		for (const car of this.cars) {
			car.group.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.geometry?.dispose();
					const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
					for (const mat of mats) {
						if (mat instanceof THREE.Material) mat.dispose();
					}
				}
			});
		}
		this.cars.length = 0;
	}

	/* ---------------------------- 内部 ---------------------------- */

	/** 同向车生成：laneIndex ∈ 0/1/2，速度 40–70km/h 随机，深色车身 */
	private spawnSame(laneIndex: number, z: number): void {
		const kmh =
			SAME_SPEED_MIN_KMH + this.rand() * (SAME_SPEED_MAX_KMH - SAME_SPEED_MIN_KMH);
		this.spawnCar(true, SAME_LANE_X[laneIndex], z, kmh / 3.6);
	}

	/** 对向车生成：laneIndex ∈ 0/1/2（对向 3 车道），速度 50–80km/h 随机，朝 +Z */
	private spawnOpp(laneIndex: number, z: number): void {
		const kmh = OPP_SPEED_MIN_KMH + this.rand() * (OPP_SPEED_MAX_KMH - OPP_SPEED_MIN_KMH);
		this.spawnCar(false, OPP_LANE_X[laneIndex], z, kmh / 3.6);
	}

	private spawnCar(sameDir: boolean, x: number, z: number, speedMs: number): void {
		const bodyColor = DARK_BODY_COLORS[Math.floor(this.rand() * DARK_BODY_COLORS.length)];
		const { group, wheels } = buildFallbackCar(bodyColor);
		if (!sameDir) group.rotation.y = Math.PI; // 对向朝 +Z
		group.position.set(x, 0, z);
		setFallbackCarLights(group, this.lightsOn);
		this.root.add(group);
		this.cars.push({
			group,
			wheels,
			sameDir,
			cruiseSpeed: speedMs,
			curSpeed: speedMs,
			x,
			z,
		});
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
	}
}
