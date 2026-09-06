/**
 * 三方块低模车 fallback：圆润车身 + 4 圆柱轮 + 前后发光灯带
 * 供 CarSystem 主车 / TrafficSystem 车流 / HudSystem 360° 子平面复用
 */

import * as THREE from 'three';

/** fallback 车分组：group 含整车，wheels 为 4 个轮 mesh 引用（供主车滚动旋转用） */
export interface FallbackCarResult {
	group: THREE.Group;
	wheels: THREE.Mesh[];
}

const BODY_W = 1.8;
const BODY_H = 0.6;
const BODY_L = 4.2;
const WHEEL_R = 0.34;
const WHEEL_W = 0.26;
const TRACK = 1.55; // 轮距
const WHEELBASE = 2.6; // 轴距
const HEADLIGHT_W = 0.32;
const HEADLIGHT_H = 0.08;

/**
 * 程序化生成一辆低模车（与 SU7 比例近似，车长 ~4.2m，车高 ~1.4m）。
 * 材质全部新建不共享（克隆实例各自带色），便于车流染色多样。
 */
export function buildFallbackCar(bodyColor = 0x9aa3ad): FallbackCarResult {
	const group = new THREE.Group();
	group.name = 'fallback-car';

	// 车身（上半弧顶 + 下半主体）
	const bodyMat = new THREE.MeshStandardMaterial({
		color: bodyColor,
		metalness: 0.65,
		roughness: 0.32,
	});
	const lower = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, BODY_H * 0.7, BODY_L), bodyMat);
	lower.position.y = WHEEL_R + (BODY_H * 0.7) / 2;
	group.add(lower);

	const upperGeo = new THREE.BoxGeometry(BODY_W * 0.9, BODY_H * 0.55, BODY_L * 0.55);
	const upper = new THREE.Mesh(upperGeo, bodyMat);
	upper.position.set(0, WHEEL_R + BODY_H * 0.7 + (BODY_H * 0.55) / 2, -BODY_L * 0.05);
	group.add(upper);

	// 风挡（深色玻璃近似）
	const glassMat = new THREE.MeshStandardMaterial({
		color: 0x141821,
		metalness: 0.4,
		roughness: 0.18,
		emissive: 0x0a0d18,
		emissiveIntensity: 0.4,
	});
	const windshield = new THREE.Mesh(
		new THREE.BoxGeometry(BODY_W * 0.82, BODY_H * 0.5, BODY_L * 0.52),
		glassMat,
	);
	windshield.position.set(0, WHEEL_R + BODY_H * 0.7 + (BODY_H * 0.55) / 2, -BODY_L * 0.05);
	group.add(windshield);

	// 头灯 + 尾灯（发光贴片，setLights 切换 emissive）
	const headlightMat = new THREE.MeshStandardMaterial({
		color: 0xfff5d8,
		emissive: 0xfff0c2,
		emissiveIntensity: 0.0,
	});
	const taillightMat = new THREE.MeshStandardMaterial({
		color: 0x4a0a0a,
		emissive: 0xff2020,
		emissiveIntensity: 0.0,
	});
	const hl1 = new THREE.Mesh(
		new THREE.BoxGeometry(HEADLIGHT_W, HEADLIGHT_H, 0.04),
		headlightMat,
	);
	const hl2 = hl1.clone();
	hl1.position.set(-BODY_W / 2 + HEADLIGHT_W / 2 + 0.1, WHEEL_R + BODY_H * 0.45, -BODY_L / 2 - 0.01);
	hl2.position.set(BODY_W / 2 - HEADLIGHT_W / 2 - 0.1, WHEEL_R + BODY_H * 0.45, -BODY_L / 2 - 0.01);
	group.add(hl1, hl2);

	const tl1 = new THREE.Mesh(new THREE.BoxGeometry(HEADLIGHT_W * 1.4, HEADLIGHT_H, 0.04), taillightMat);
	const tl2 = tl1.clone();
	tl1.position.set(-BODY_W / 2 + (HEADLIGHT_W * 1.4) / 2 + 0.1, WHEEL_R + BODY_H * 0.45, BODY_L / 2 + 0.01);
	tl2.position.set(BODY_W / 2 - (HEADLIGHT_W * 1.4) / 2 - 0.1, WHEEL_R + BODY_H * 0.45, BODY_L / 2 + 0.01);
	group.add(tl1, tl2);

	// 4 轮
	const wheelMat = new THREE.MeshStandardMaterial({
		color: 0x111315,
		metalness: 0.2,
		roughness: 0.85,
	});
	const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 18);
	const wheels: THREE.Mesh[] = [];
	const wheelPositions: Array<[number, number, number]> = [
		[-TRACK / 2, WHEEL_R, -WHEELBASE / 2],
		[TRACK / 2, WHEEL_R, -WHEELBASE / 2],
		[-TRACK / 2, WHEEL_R, WHEELBASE / 2],
		[TRACK / 2, WHEEL_R, WHEELBASE / 2],
	];
	for (const [x, y, z] of wheelPositions) {
		const wheel = new THREE.Mesh(wheelGeo, wheelMat);
		wheel.position.set(x, y, z);
		wheel.rotation.z = Math.PI / 2; // 圆柱默认沿 Y，旋转使轮面朝 X
		wheel.name = 'fallback-wheel';
		group.add(wheel);
		wheels.push(wheel);
	}

	// 暴露灯光材质引用给 CarSystem.setLights
	(group as unknown as { __headlightMat: THREE.MeshStandardMaterial }).__headlightMat =
		headlightMat;
	(group as unknown as { __taillightMat: THREE.MeshStandardMaterial }).__taillightMat =
		taillightMat;

	return { group, wheels };
}

/** 切换 fallback 车的头/尾灯发光强度（on=true 时头灯 1.4 / 尾灯 0.6） */
export function setFallbackCarLights(group: THREE.Object3D, on: boolean): void {
	const g = group as unknown as {
		__headlightMat?: THREE.MeshStandardMaterial;
		__taillightMat?: THREE.MeshStandardMaterial;
	};
	g.__headlightMat?.emissiveIntensity && (g.__headlightMat.emissiveIntensity = on ? 1.4 : 0);
	g.__taillightMat?.emissiveIntensity !== undefined &&
		(g.__taillightMat.emissiveIntensity = on ? 0.6 : 0);
}
