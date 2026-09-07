import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DrivingState } from '../types';

/* ------------------------------------------------------------------ */
/* 锁定常量（计划 Task 2 Step 1，禁止调整）                            */
/* ------------------------------------------------------------------ */
const LANE_W = 3.5; // 车道宽
const SEG_LEN = 60; // 单段长度
const SEG_COUNT = 8; // 段数，整环覆盖 z ∈ [-360, +120]
const RECYCLE_Z = 90; // 段中心超过则整段回收一个周期
const TOTAL_LEN = SEG_LEN * SEG_COUNT; // 480
const LAMP_SPACING = 30; // 路灯间距（双侧交错）
const SIGN_EVERY_SEG = 240 / SEG_LEN; // 每 4 段一块路牌（240m）

/* 横向布局（世界坐标约定：本向车道中心 x = {-3.5, 0, +3.5}，隔离带 x ∈ [5.25, 8.75]，对向 {+10.5, +14, +17.5}） */
const ROAD_X_MIN = -1.5 * LANE_W; // -5.25 本向左边线
const ROAD_X_MAX = 5.5 * LANE_W; // +19.25 对向右边线
const MEDIAN_X = 2.5 * LANE_W; // 7 隔离带中心
const MEDIAN_W = 3.5;
const MEDIAN_H = 0.22;

/* 车道线 */
const LINE_W = 0.15; // 线宽（虚线锁定 0.15，实线同宽）
const LINE_Y = 0.015; // 路面上标线高度（防 z-fighting）
const GREEN_Y = MEDIAN_H + 0.001; // 隔离带绿面高度（略抬防与路缘顶面 z-fighting）
const DASH_SEG_LEN = 3; // 虚线 3m 段
const DASH_GAP = 6; // 6m 空
const DASH_PER_SEG = Math.floor(SEG_LEN / (DASH_SEG_LEN + DASH_GAP)); // 7 根/列
const DASH_XS = [-0.5 * LANE_W, 0.5 * LANE_W, 3.5 * LANE_W, 4.5 * LANE_W]; // 本向 2 列 + 对向 2 列
const SOLID_WHITE_XS = [-1.5 * LANE_W, 1.5 * LANE_W, 2.5 * LANE_W, 5.5 * LANE_W]; // 两侧边线
const DOUBLE_YELLOW_XS = [MEDIAN_X - 0.175, MEDIAN_X + 0.175]; // 中央双黄实线（骑隔离带绿面）

/* 路灯（双侧交错：本向侧相位 0，对向侧相位半程） */
const LAMP_X_NEAR = ROAD_X_MIN - 1.2; // -6.45 本向侧路外
const LAMP_X_FAR = ROAD_X_MAX + 1.2; // +20.45 对向侧路外
const LAMP_POLE_H = 7;
const LAMP_ARM_LEN = 3;
const LAMP_HEAD_Y = 6.72;

/* 路牌（悬臂指路牌，骑隔离带立柱，臂伸本向上空） */
const SIGN_Z = -20;
const SIGN_POST_X = 6.6;
const SIGN_POST_H = 6;
const SIGN_ARM_LEN = 7.6;
const SIGN_FACE_W = 5;
const SIGN_FACE_H = 1.8;

/* 灌木（隔离带内，避开中央双黄线） */
const BUSH_PER_SEG = 16;

/** 可复现伪随机（后续 CitySystem 采用同模式） */
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

function drawLeftArrow(
	ctx: CanvasRenderingContext2D,
	cx: number,
	cy: number,
	len: number,
	thick: number
): void {
	const head = thick * 0.9;
	ctx.beginPath();
	ctx.moveTo(cx + len / 2, cy - thick / 2);
	ctx.lineTo(cx - head / 2, cy - thick / 2);
	ctx.lineTo(cx - head / 2, cy - thick);
	ctx.lineTo(cx - len / 2, cy);
	ctx.lineTo(cx - head / 2, cy + thick);
	ctx.lineTo(cx - head / 2, cy + thick / 2);
	ctx.lineTo(cx + len / 2, cy + thick / 2);
	ctx.closePath();
	ctx.fill();
}

/** 绿底白字悬臂指路牌纹理：「⇦ 朝阳北路 | 凯恒中心」 */
function createSignTexture(): THREE.CanvasTexture {
	const W = 1024;
	const H = 368;
	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const tex = new THREE.CanvasTexture(canvas);
	const ctx = canvas.getContext('2d');
	if (!ctx) return tex;

	ctx.fillStyle = '#0d7a43';
	ctx.fillRect(0, 0, W, H);

	ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
	ctx.lineWidth = 10;
	ctx.beginPath();
	ctx.roundRect(18, 18, W - 36, H - 36, 28);
	ctx.stroke();

	ctx.fillStyle = '#ffffff';
	ctx.textBaseline = 'middle';
	drawLeftArrow(ctx, 96, 140, 56, 40);

	ctx.font = 'bold 116px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
	ctx.fillText('朝阳北路', 176, 142);

	ctx.globalAlpha = 0.92;
	ctx.font = 'bold 84px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
	ctx.fillText('凯恒中心', 176, 262);
	ctx.globalAlpha = 1;

	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

/**
 * 程序化道路：8 段 × 60m treadmill 环。
 * 每段 = 整幅沥青路面（本向 + 隔离带 + 对向）+ 车道线 + 隔离绿化带 + 路灯（InstancedMesh）+ 偶数段路牌。
 *
 * Task 9 性能（draw calls < 120 验收）：段内全部静态不发光内容
 * （路面/车道线/隔离带/灌木/灯杆灯臂/路牌骨架）合并为 **1 个顶点色 mesh**，
 * 仅路灯头发光头与路牌牌面（贴图材质）保持独立绘制——颜色/位姿与合并前逐项一致。
 * 合并前 8 段约 118 draw calls，合并后 8×2 + 2 牌面 ≈ 18。
 */
export class RoadSystem {
	private root = new THREE.Group();
	private segments: THREE.Group[] = [];
	private lampHeadMat: THREE.MeshBasicMaterial;
	private geometries: THREE.BufferGeometry[] = [];
	private materials: THREE.Material[] = [];
	private textures: THREE.Texture[] = [];
	private dummy = new THREE.Object3D();

	constructor(scene: THREE.Scene) {
		this.root.name = 'road-system';

		/* 合并源模板几何（clone 后变换上色，只作 merge 原料） */
		const roadGeo = this.trackGeo(new THREE.PlaneGeometry(ROAD_X_MAX - ROAD_X_MIN, SEG_LEN));
		const solidGeo = this.trackGeo(new THREE.PlaneGeometry(LINE_W, SEG_LEN));
		const dashGeo = this.trackGeo(new THREE.PlaneGeometry(LINE_W, DASH_SEG_LEN));
		const medianGeo = this.trackGeo(new THREE.BoxGeometry(MEDIAN_W, MEDIAN_H, SEG_LEN));
		const greenGeo = this.trackGeo(new THREE.PlaneGeometry(MEDIAN_W, SEG_LEN));
		const bushGeo = this.trackGeo(new THREE.IcosahedronGeometry(0.45, 1));
		const poleGeo = this.trackGeo(new THREE.CylinderGeometry(0.09, 0.12, LAMP_POLE_H, 8));
		const armGeo = this.trackGeo(new THREE.BoxGeometry(LAMP_ARM_LEN, 0.12, 0.18));
		const headGeo = this.trackGeo(new THREE.BoxGeometry(1.1, 0.16, 0.42));
		const signPostGeo = this.trackGeo(new THREE.CylinderGeometry(0.1, 0.13, SIGN_POST_H, 8));
		const signArmGeo = this.trackGeo(new THREE.BoxGeometry(SIGN_ARM_LEN, 0.14, 0.2));
		const signFaceGeo = this.trackGeo(new THREE.PlaneGeometry(SIGN_FACE_W, SIGN_FACE_H));

		/* 材质：沥青走 Standard（PBR，与合并前一致地接受 scene.environment 环境光——
		   换 Lambert 会显著变暗，TC-04 暗色包络判定即被污染）；其余静态件合并前均为
		   Lambert，保持 Lambert。灯头发光 + 路牌贴图独立材质。 */
		const asphaltMat = this.trackMat(
			new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
		);
		const staticMat = this.trackMat(new THREE.MeshLambertMaterial({ vertexColors: true }));
		this.lampHeadMat = this.trackMat(new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
		const signMat = this.trackMat(
			new THREE.MeshBasicMaterial({ map: this.trackTex(createSignTexture()) })
		);

		/* 顶点色取色（setHex 已按色彩管理转到工作色彩空间，直接写顶点属性即为线性值） */
		const colors = {
			asphalt: new THREE.Color(0x2b2d31),
			white: new THREE.Color(0xdadde0),
			yellow: new THREE.Color(0xd9a318),
			median: new THREE.Color(0x3c423c),
			medianGreen: new THREE.Color(0x1d3a24),
			bush: new THREE.Color(0x2a5230),
			metal: new THREE.Color(0x494f56),
		};

		const firstSegCenterZ = -TOTAL_LEN * 0.75 + SEG_LEN / 2; // -330，整环覆盖 [-360, +120]
		for (let i = 0; i < SEG_COUNT; i++) {
			const seg = this.buildSegment(i, {
				roadGeo,
				solidGeo,
				dashGeo,
				medianGeo,
				greenGeo,
				bushGeo,
				poleGeo,
				armGeo,
				headGeo,
				signPostGeo,
				signArmGeo,
				signFaceGeo,
				asphaltMat,
				staticMat,
				signMat,
				colors,
			});
			seg.position.z = firstSegCenterZ + i * SEG_LEN;
			this.segments.push(seg);
			this.root.add(seg);
		}

		scene.add(this.root);
	}

	/** treadmill 滚动：整体 +Z 平移，段中心超过 RECYCLE_Z 则回收一个周期 */
	update(dt: number, state: DrivingState): void {
		const scrollSpeed = state.gear === 'P' ? 0 : state.speedKmh / 3.6;
		const dz = scrollSpeed * dt;
		if (dz === 0) return;
		for (const seg of this.segments) {
			seg.position.z += dz;
			if (seg.position.z > RECYCLE_Z) {
				seg.position.z -= TOTAL_LEN;
			}
		}
	}

	/** Task 4 DayNightSystem 联动预留：路灯头亮/灭 */
	setLampsOn(on: boolean): void {
		this.lampHeadMat.color.setHex(on ? 0xffe2a8 : 0x565b60);
	}

	/** 释放全部几何/材质/纹理/实例缓冲并从场景摘除 */
	dispose(): void {
		this.root.removeFromParent();
		/* InstancedMesh 的 instanceMatrix/instanceColor 是独立 GPU 缓冲（与 CitySystem 同例） */
		this.root.traverse((obj) => {
			if (obj instanceof THREE.InstancedMesh) obj.dispose();
		});
		for (const geometry of this.geometries) geometry.dispose();
		for (const material of this.materials) material.dispose();
		for (const texture of this.textures) texture.dispose();
		this.geometries.length = 0;
		this.materials.length = 0;
		this.textures.length = 0;
		this.segments.length = 0;
	}

	private buildSegment(
		index: number,
		res: {
			roadGeo: THREE.BufferGeometry;
			solidGeo: THREE.BufferGeometry;
			dashGeo: THREE.BufferGeometry;
			medianGeo: THREE.BufferGeometry;
			greenGeo: THREE.BufferGeometry;
			bushGeo: THREE.BufferGeometry;
			poleGeo: THREE.BufferGeometry;
			armGeo: THREE.BufferGeometry;
			headGeo: THREE.BufferGeometry;
			signPostGeo: THREE.BufferGeometry;
			signArmGeo: THREE.BufferGeometry;
			signFaceGeo: THREE.BufferGeometry;
			asphaltMat: THREE.Material;
			staticMat: THREE.Material;
			signMat: THREE.Material;
			colors: Record<
				'asphalt' | 'white' | 'yellow' | 'median' | 'medianGreen' | 'bush' | 'metal',
				THREE.Color
			>;
		}
	): THREE.Group {
		const seg = new THREE.Group();
		seg.name = `road-seg-${index}`;
		const half = SEG_LEN / 2;
		const dummy = this.dummy;
		/* 沥青（Standard）与其余静态件（Lambert）分材质合并，各自 1 draw call */
		const asphaltParts: THREE.BufferGeometry[] = [];
		const parts: THREE.BufferGeometry[] = [];

		/** 模板几何 → 变换（dummy 当前位姿）→ 烘顶点色 → 收进待合并列表 */
		const pushPart = (
			geo: THREE.BufferGeometry,
			color: THREE.Color,
			into: THREE.BufferGeometry[] = parts
		): void => {
			dummy.updateMatrix();
			const g = geo.clone().applyMatrix4(dummy.matrix).toNonIndexed();
			const count = g.getAttribute('position').count;
			const arr = new Float32Array(count * 3);
			for (let v = 0; v < count; v++) {
				arr[v * 3] = color.r;
				arr[v * 3 + 1] = color.g;
				arr[v * 3 + 2] = color.b;
			}
			g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
			into.push(g);
		};

		/* 整幅沥青路面（本向 + 隔离带占位 + 对向）——Standard 材质，接受环境光 */
		dummy.position.set((ROAD_X_MIN + ROAD_X_MAX) / 2, 0, 0);
		dummy.rotation.set(-Math.PI / 2, 0, 0);
		dummy.scale.setScalar(1);
		pushPart(res.roadGeo, res.colors.asphalt, asphaltParts);

		/* 白色实线（两侧边线 ×2 侧道路） */
		for (const x of SOLID_WHITE_XS) {
			dummy.position.set(x, LINE_Y, 0);
			dummy.rotation.set(-Math.PI / 2, 0, 0);
			pushPart(res.solidGeo, res.colors.white);
		}

		/* 中央双黄实线（骑隔离带绿面） */
		for (const x of DOUBLE_YELLOW_XS) {
			dummy.position.set(x, MEDIAN_H + 0.01, 0);
			dummy.rotation.set(-Math.PI / 2, 0, 0);
			pushPart(res.solidGeo, res.colors.yellow);
		}

		/* 白色虚线（本向 + 对向车道分隔，3m 段 / 6m 空） */
		for (const x of DASH_XS) {
			for (let k = 0; k < DASH_PER_SEG; k++) {
				dummy.position.set(x, LINE_Y, -half + DASH_SEG_LEN / 2 + k * (DASH_SEG_LEN + DASH_GAP));
				dummy.rotation.set(-Math.PI / 2, 0, 0);
				pushPart(res.dashGeo, res.colors.white);
			}
		}

		/* 隔离绿化带：灰色路缘体 + 绿色顶面（原 BoxGeometry 六面材质组的视觉等价拆分） */
		dummy.position.set(MEDIAN_X, MEDIAN_H / 2, 0);
		dummy.rotation.set(0, 0, 0);
		pushPart(res.medianGeo, res.colors.median);
		dummy.position.set(MEDIAN_X, GREEN_Y, 0);
		dummy.rotation.set(-Math.PI / 2, 0, 0);
		pushPart(res.greenGeo, res.colors.medianGreen);

		/* 灌木（种子随机与合并前同序同值，可复现） */
		const rand = mulberry32(0x9e3779b9 ^ (index * 2654435761));
		for (let k = 0; k < BUSH_PER_SEG; k++) {
			const side = k % 2 === 0 ? -1 : 1;
			const x = MEDIAN_X + side * (0.6 + rand() * 0.7);
			const z = -half + 2 + rand() * (SEG_LEN - 4);
			const s = 0.7 + rand() * 0.7;
			dummy.position.set(x, MEDIAN_H + 0.3 * s, z);
			dummy.rotation.set(0, rand() * Math.PI, 0);
			dummy.scale.setScalar(s);
			pushPart(res.bushGeo, res.colors.bush);
		}
		dummy.scale.setScalar(1);

		/* 路灯杆/悬臂（双侧交错：本向侧 2 盏 + 对向侧 2 盏，间距 30m）——骨架并入静态体 */
		const lamps = [
			{ x: LAMP_X_NEAR, armDir: 1, z: -LAMP_SPACING },
			{ x: LAMP_X_NEAR, armDir: 1, z: 0 },
			{ x: LAMP_X_FAR, armDir: -1, z: -LAMP_SPACING / 2 },
			{ x: LAMP_X_FAR, armDir: -1, z: LAMP_SPACING / 2 },
		];
		const headMats: Array<{ x: number; y: number; z: number }> = [];
		for (const lamp of lamps) {
			dummy.rotation.set(0, 0, 0);
			dummy.position.set(lamp.x, LAMP_POLE_H / 2, lamp.z);
			pushPart(res.poleGeo, res.colors.metal);
			dummy.position.set(lamp.x + lamp.armDir * (LAMP_ARM_LEN / 2), LAMP_POLE_H - 0.1, lamp.z);
			pushPart(res.armGeo, res.colors.metal);
			headMats.push({
				x: lamp.x + lamp.armDir * LAMP_ARM_LEN,
				y: LAMP_HEAD_Y,
				z: lamp.z,
			});
		}

		/* 悬臂路牌：每 240m 一块（每 4 段），立柱/横臂并入静态体，牌面朝 +Z 迎向来车 */
		if (index % SIGN_EVERY_SEG === 0) {
			dummy.rotation.set(0, 0, 0);
			dummy.position.set(SIGN_POST_X, SIGN_POST_H / 2, SIGN_Z);
			pushPart(res.signPostGeo, res.colors.metal);
			dummy.position.set(SIGN_POST_X - SIGN_ARM_LEN / 2 + 0.2, SIGN_POST_H - 0.1, SIGN_Z);
			pushPart(res.signArmGeo, res.colors.metal);
			const face = new THREE.Mesh(res.signFaceGeo, res.signMat);
			face.position.set(SIGN_POST_X - SIGN_ARM_LEN + 1.4, SIGN_POST_H - 0.9, SIGN_Z + 0.12);
			seg.add(face);
		}

		/* 静态合并体（沥青 Standard 1 call + 其余 Lambert 1 call 承载整段路面内容） */
		const asphaltMerged = this.trackGeo(
			mergeGeometries(asphaltParts, false) ?? new THREE.BufferGeometry()
		);
		const asphaltMesh = new THREE.Mesh(asphaltMerged, res.asphaltMat);
		asphaltMesh.name = `road-seg-asphalt-${index}`;
		seg.add(asphaltMesh);
		const merged = this.trackGeo(mergeGeometries(parts, false) ?? new THREE.BufferGeometry());
		const staticMesh = new THREE.Mesh(merged, res.staticMat);
		staticMesh.name = `road-seg-static-${index}`;
		seg.add(staticMesh);

		/* 路灯头发光体（DayNight 联动需独立材质，保持 InstancedMesh） */
		const heads = new THREE.InstancedMesh(res.headGeo, this.lampHeadMat, headMats.length);
		for (let k = 0; k < headMats.length; k++) {
			dummy.position.set(headMats[k].x, headMats[k].y, headMats[k].z);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.setScalar(1);
			dummy.updateMatrix();
			heads.setMatrixAt(k, dummy.matrix);
		}
		seg.add(heads);

		return seg;
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
