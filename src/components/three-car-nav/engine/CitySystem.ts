import * as THREE from 'three';
import type { DrivingState } from '../types';

/* ------------------------------------------------------------------ */
/* 常量（计划 Task 3：两侧各 3 排，高度 15–80m / 宽 14–24m）           */
/* ------------------------------------------------------------------ */
const BLOCK_LEN = 120; // 城市分块长度（与路面 60m 段周期不同，回收逻辑一致）
const BLOCK_COUNT = 5; // 块数，整环覆盖 z ∈ [-480, +120]
const TOTAL_LEN = BLOCK_LEN * BLOCK_COUNT; // 600
const RECYCLE_Z = 90; // 块中心超过则整块回收一个周期

/* 排布：避让路面（本向左边线 -5.25 / 对向右边线 +19.25）与路灯（-6.45 / +20.45） */
const ROWS_LEFT = [-25, -48, -71];
const ROWS_RIGHT = [38, 62, 86];
const ROW_H_RANGE: Array<[number, number]> = [
	/* 行高带：近排矮、远排高，均落在 15–80m */
	[15, 40],
	[25, 60],
	[35, 80],
];
const MIN_W = 14; // 楼宽/楼深下限
const MAX_W = 24; // 楼宽/楼深上限
const GAP_MIN = 4; // 楼间最小净距
const GAP_RAND = 8; // 楼间随机净距幅度
const MAX_PER_BLOCK = 40; // 6 排 × 每排最多 ~6 栋

const BLOCK_SEED = 0x1b2c3d4e; // 楼群布局种子（写死保证可复现）
const WINDOW_SEED = 0x51617a21; // 窗灯纹理种子（写死保证可复现）
const DEFAULT_GLOW = 0.55; // dusk 默认窗灯亮度（计划 Task 4 锁定值，DayNightSystem 接管）

/* 地标剪影：接近背景色 #2a2340 略深，固定 -Z 远端不参与回收 */
const LANDMARK_COLOR = 0x221c34;

/** 可复现伪随机（与 RoadSystem 同模式） */
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

/** 窗灯纹理：暖色窗户网格（部分亮灯），作共享 emissiveMap */
function createWindowTexture(): THREE.CanvasTexture {
	const W = 256;
	const H = 512;
	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const tex = new THREE.CanvasTexture(canvas);
	const ctx = canvas.getContext('2d');
	if (!ctx) return tex;

	ctx.fillStyle = '#000000';
	ctx.fillRect(0, 0, W, H);

	const COLS = 10;
	const ROWS = 28;
	const cw = W / COLS;
	const ch = H / ROWS;
	const rand = mulberry32(WINDOW_SEED);
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			if (rand() < 0.55) continue; // ~45% 亮灯
			const v = Math.round(255 * (0.45 + rand() * 0.55));
			ctx.fillStyle = `rgb(${v}, ${Math.round(v * 0.84)}, ${Math.round(v * 0.58)})`;
			ctx.fillRect(c * cw + cw * 0.2, r * ch + ch * 0.24, cw * 0.6, ch * 0.52);
		}
	}

	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

/**
 * 程序化城市天际线：5 块 × 120m treadmill 环（楼群 InstancedMesh）+ 远端地标剪影。
 * 楼体共享 1×1×1 BoxGeometry 按实例缩放；窗灯为共享 emissive CanvasTexture，
 * 亮度由 setWindowGlow 统一驱动（InstancedMesh 共享材质，全局生效）。
 * 地标（国贸三期 / CCTV 环）固定 -Z 远端两侧，MeshBasicMaterial 剪影不参与回收。
 */
export class CitySystem {
	private root = new THREE.Group();
	private blocks: THREE.Group[] = [];
	private buildingMat: THREE.MeshLambertMaterial;
	private geometries: THREE.BufferGeometry[] = [];
	private materials: THREE.Material[] = [];
	private textures: THREE.Texture[] = [];
	private dummy = new THREE.Object3D();

	constructor(scene: THREE.Scene) {
		this.root.name = 'city-system';

		/* 共享几何：楼体与地标统一 1×1×1 盒子，按实例矩阵缩放/旋转 */
		const boxGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));

		/* 共享材质：楼体（深蓝灰 + 窗灯 emissiveMap）与地标剪影（接近背景色略深） */
		this.buildingMat = this.trackMat(
			new THREE.MeshLambertMaterial({
				color: 0x232a38,
				emissive: 0xffffff,
				emissiveMap: this.trackTex(createWindowTexture()),
				emissiveIntensity: DEFAULT_GLOW,
			})
		);
		const landmarkMat = this.trackMat(new THREE.MeshBasicMaterial({ color: LANDMARK_COLOR }));

		const firstBlockCenterZ = -TOTAL_LEN * 0.75 + BLOCK_LEN / 2; // -390，整环覆盖 [-480, +120]
		for (let i = 0; i < BLOCK_COUNT; i++) {
			const block = this.buildBlock(i, boxGeo, this.buildingMat);
			block.position.z = firstBlockCenterZ + i * BLOCK_LEN;
			this.blocks.push(block);
			this.root.add(block);
		}

		this.root.add(this.buildLandmarks(boxGeo, landmarkMat));
		scene.add(this.root);
	}

	/** treadmill 滚动：整体 +Z 平移，块中心超过 RECYCLE_Z 则回收一个周期（地标固定不动） */
	update(dt: number, state: DrivingState): void {
		const scrollSpeed = state.gear === 'P' ? 0 : state.speedKmh / 3.6;
		const dz = scrollSpeed * dt;
		if (dz === 0) return;
		for (const block of this.blocks) {
			block.position.z += dz;
			if (block.position.z > RECYCLE_Z) {
				block.position.z -= TOTAL_LEN;
			}
		}
	}

	/** Task 4 DayNightSystem 联动：窗灯亮度 0（关灯）→ 1（全亮），共享材质全局生效 */
	setWindowGlow(k: number): void {
		this.buildingMat.emissiveIntensity = Math.min(1, Math.max(0, k));
	}

	/** 释放全部几何/材质/纹理/实例缓冲并从场景摘除 */
	dispose(): void {
		this.root.removeFromParent();
		this.root.traverse((obj) => {
			if (obj instanceof THREE.InstancedMesh) obj.dispose(); // 释放 instanceMatrix/instanceColor
		});
		for (const geometry of this.geometries) geometry.dispose();
		for (const material of this.materials) material.dispose();
		for (const texture of this.textures) texture.dispose();
		this.geometries.length = 0;
		this.materials.length = 0;
		this.textures.length = 0;
		this.blocks.length = 0;
	}

	/** 单块楼群：左右各 3 排沿 z 连续布楼，种子随机尺寸/间距/朝向明度（clamp 在块边界内防跨块穿插） */
	private buildBlock(
		index: number,
		boxGeo: THREE.BufferGeometry,
		buildingMat: THREE.Material
	): THREE.Group {
		const block = new THREE.Group();
		block.name = `city-block-${index}`;
		const rand = mulberry32(BLOCK_SEED ^ (index * 2654435761));
		const mesh = new THREE.InstancedMesh(boxGeo, buildingMat, MAX_PER_BLOCK);
		const dummy = this.dummy;
		const tint = new THREE.Color();
		const half = BLOCK_LEN / 2;
		let n = 0;

		for (const rows of [ROWS_LEFT, ROWS_RIGHT]) {
			for (let r = 0; r < rows.length; r++) {
				const [hMin, hMax] = ROW_H_RANGE[r];
				let z = -half + rand() * 8; // 排起点抖动
				while (n < MAX_PER_BLOCK) {
					const w = MIN_W + rand() * (MAX_W - MIN_W);
					const d = MIN_W + rand() * (MAX_W - MIN_W);
					if (z + d > half - 2) break; // 留 2m 边距，避免与相邻块穿模
					const h = hMin + rand() * (hMax - hMin);
					dummy.position.set(rows[r] + (rand() - 0.5) * 4, h / 2, z + d / 2);
					dummy.rotation.set(0, 0, 0);
					dummy.scale.set(w, h, d);
					dummy.updateMatrix();
					mesh.setMatrixAt(n, dummy.matrix);
					/* 楼体明度微差（instanceColor 乘 diffuse），偏蓝灰 */
					const shade = 0.75 + rand() * 0.25;
					tint.setRGB(shade * 0.92, shade * 0.96, shade);
					mesh.setColorAt(n, tint);
					n++;
					z += d + GAP_MIN + rand() * GAP_RAND;
				}
			}
		}
		mesh.count = n;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		block.add(mesh);
		return block;
	}

	/** 地标剪影（1 个 InstancedMesh，共 6 段盒子，全部按实例矩阵摆位） */
	private buildLandmarks(
		boxGeo: THREE.BufferGeometry,
		landmarkMat: THREE.Material
	): THREE.InstancedMesh {
		const mesh = new THREE.InstancedMesh(boxGeo, landmarkMat, 6);
		const dummy = this.dummy;

		/* 国贸三期（-Z 远端左侧）：收分塔身 = 3 段堆叠 box，总高 ~235m */
		const gtx = -130;
		const gtz = -390;
		const tower3: Array<{ s: [number, number, number]; p: [number, number, number] }> = [
			{ s: [36, 100, 36], p: [gtx, 50, gtz] },
			{ s: [28, 80, 28], p: [gtx, 140, gtz] },
			{ s: [20, 55, 20], p: [gtx, 207, gtz] },
		];
		let i = 0;
		for (const part of tower3) {
			dummy.position.set(...part.p);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.set(...part.s);
			dummy.updateMatrix();
			mesh.setMatrixAt(i++, dummy.matrix);
		}

		/* CCTV 环（-Z 远端右侧）：两座相向倾斜塔 + 顶部连接体，围出环路剪影 */
		const cx = 140;
		const cz = -400;
		dummy.position.set(cx - 26, 72, cz); // 塔 A 倾向环内
		dummy.rotation.set(0, 0, 0.1);
		dummy.scale.set(24, 150, 30);
		dummy.updateMatrix();
		mesh.setMatrixAt(i++, dummy.matrix);

		dummy.position.set(cx + 26, 72, cz); // 塔 B 倾向环内
		dummy.rotation.set(0, 0, -0.1);
		dummy.updateMatrix();
		mesh.setMatrixAt(i++, dummy.matrix);

		dummy.position.set(cx, 145, cz); // 顶部连接体
		dummy.rotation.set(0, 0, 0);
		dummy.scale.set(78, 20, 30);
		dummy.updateMatrix();
		mesh.setMatrixAt(i++, dummy.matrix);

		mesh.name = 'city-landmarks';
		return mesh;
	}

	private trackGeo<T extends THREE.BufferGeometry>(geometry: T): T {
		this.geometries.push(geometry);
		return geometry;
	}

	private trackMat<T extends THREE.Material>(material: T): T {
		this.materials.push(material);
		return material;
	}

	private trackTex<T extends THREE.Texture>(texture: T): T {
		this.textures.push(texture);
		return texture;
	}
}
