import * as THREE from 'three';
import type { CameraMode, DrivingState, TimeOfDay } from '../types';

/* ------------------------------------------------------------------ */
/* 锁定常量（计划 Task 7 Step 1/2，禁止调整）                          */
/* ------------------------------------------------------------------ */
/** 离屏 canvas 尺寸：静态层与动态层各一张同尺寸 */
const CANVAS_W = 2048;
const CANVAS_H = 1024;
/** 平滑系数：与 CameraRig 一致，k = 1 - exp(-4·dt) */
const LERP_RATE = 4;
/** 主面板尺寸（米） */
const PANEL_W = 4.6;
const PANEL_H = 2.3;
/** 发光背板在主面板基础上的单边外扩（米） */
const GLOW_PAD = 0.18;
/** 随车速上下浮动幅度（米，锁定 ±0.05） */
const BOB_AMPLITUDE = 0.05;

/* 布局锁定 px（2048×1024 坐标系，y 向下） */
/** 时速区 x60..560：数字 bold 220px 居中 (310,560) */
const SPEED_BOX = { x: 60, y: 180, w: 500, h: 640 };
const SPEED_CENTER_X = 310;
const SPEED_BASELINE_Y = 560;
/** 中央 360° 洞：圆心 (1024,540) r330（7a 只画雷达装饰环占位） */
const HOLE_CENTER = { x: 1024, y: 540 };
const HOLE_RADIUS = 330;
/** 右列 x1400..1988：路名 64px + 导航行 52px（7a 静态占位文案） */
const NAV_BOX = { x: 1400, y: 180, w: 588, h: 300 };
/** 右下车道图 460×260 透视梯形（当前道青色 35% 高亮） */
const LANE_BOX = { x: 1498, y: 560, w: 490, h: 300 };
const LANE_TRAP = { x: 1513, yTop: 620, yBottom: 840, wBottom: 460, wTop: 200 };
/** 底部 y880..980：续航 · 时间（:SS 闪烁）· 信号点 + 智驾状态 */
const FOOT_BOX = { x: 60, y: 880, w: 1928, h: 100 };
/** footer 行纵向中心（y + h/2 = 930；勿写 (y + h) / 2 = 490 会叠到时速区） */
const FOOT_CENTER_Y = FOOT_BOX.y + FOOT_BOX.h / 2;

/* ------------------------------------------------------------------ */
/* 7b 锁定常量：360° RTT 小车视口（计划 Task 7 Step 3）                  */
/* ------------------------------------------------------------------ */
/** RTT 尺寸（锁定 512×512） */
const CAR_RT_SIZE = 512;
/** mini 相机 fov（锁定 32°）；环绕半径 9.5m——裁定：fov 32 下 4.5m 半径可见框仅 ~2.58m，容不下 SU7 归一化后 ~4.4m 车长（正侧视角出框），放宽至可见框 ~5.45m（资产车长适配，fov 保持锁定） */
const CAR_CAM_FOV = 32;
const CAR_ORBIT_RADIUS = 9.5;
/** 环绕目标高度：克隆车高 ≈1.26m（1.4 归一 × 0.9 缩放），取半高附近 */
const CAR_TARGET_Y = 0.62;
/** 自动旋转角速度（锁定 0.35 rad/s）与拖拽后恢复延时 */
const CAR_AUTO_ROTATE = 0.35;
const CAR_RESUME_DELAY_SEC = 3;
/** 拖拽灵敏度（锁定 0.01 rad/px）与俯仰限位（锁定 ±0.5 rad） */
const CAR_DRAG_SENSITIVITY = 0.01;
const CAR_PITCH_LIMIT = 0.5;
/** 洞直径 660px → 面板局部边长：/2048*4.6 与 /1024*2.3 均为 ≈1.4824m */
const HOLE_PLANE_SIZE = ((HOLE_RADIUS * 2) / CANVAS_W) * PANEL_W;
/** 洞心映射到面板局部坐标（canvas y 向下 → three y 向上需翻转） */
const HOLE_LOCAL_X = ((HOLE_CENTER.x - CANVAS_W / 2) / CANVAS_W) * PANEL_W;
const HOLE_LOCAL_Y = ((CANVAS_H / 2 - HOLE_CENTER.y) / CANVAS_H) * PANEL_H;
/** 子平面相对面板微小后移（面板 z=0、发光背板 z=-0.02，取中间防 z-fighting） */
const CAR_PLANE_Z = -0.01;
/** 初始环绕角（3/4 前侧视角）与基础俯仰 */
const CAR_INITIAL_YAW = 0.6;
const CAR_BASE_PITCH = 0.25;

/* ------------------------------------------------------------------ */
/* 7c 锁定常量：数据脚本 + 雷达（计划 Task 7 Step 4）                   */
/* ------------------------------------------------------------------ */
/** POI 序列（锁定）：到达里程按累计里程制，循环时累加一轮总里程偏移 */
const POI_LIST = [
	{ name: '凯恒中心', arriveM: 800 },
	{ name: '朝阳公园', arriveM: 1600 },
	{ name: '蓝色港湾', arriveM: 2400 },
];
/** 一轮 POI 总里程 = 最远 POI 到达里程（第二轮凯恒中心 = 800 + 2400×N） */
const POI_LOOP_M = 2400;
/** 剩余距离低于该值切换下一 POI */
const POI_SWITCH_REMAIN_M = 50;
/** 变道提示间隔 / 提示时长 / 车道图箭头闪烁周期 */
const LANE_HINT_INTERVAL_SEC = 45;
const LANE_HINT_DURATION_SEC = 4;
const LANE_HINT_BLINK_SEC = 1.2;
/** 雷达（锁定）：同心环由内向外透明度衰减；量程 x±25m z±60m 映射到 r_max */
const RADAR_RINGS = [90, 180, 270, 320];
const RADAR_RING_ALPHA = [0.4, 0.3, 0.2, 0.12];
const RADAR_RANGE_X_M = 25;
const RADAR_RANGE_Z_M = 60;
const RADAR_R_MAX = 320;
/** 扫描扇形角速度（锁定 1.2 rad/s）与拖尾弧长 */
const RADAR_SWEEP_SPEED = 1.2;
const RADAR_SWEEP_TRAIL = 1.1;

/** 三档 HUD 配色（计划允许自定，要求协调：dusk 暖紫 / day 亮调 / night 深蓝调） */
interface HudPalette {
	/** 面板底渐变顶/底（带透明度，保留全息通透感） */
	panelTop: string;
	panelBottom: string;
	/** 分区框描边 */
	frame: string;
	/** 分区标签小字 */
	label: string;
	/** 主文字 */
	text: string;
	/** 次级文字 */
	subtle: string;
	/** 时速三档色：<60 青 / 60-100 浅蓝 / >100 琥珀（day 档用加深变体保证浅底可读） */
	speedCalm: string;
	speedNormal: string;
	speedFast: string;
	/** 强调色：装饰环 / 车道高亮 / 档位 pill */
	accent: string;
	/** 360° 洞底色（7b 由 RTT 子平面覆盖） */
	hole: string;
	/** 发光描边（背板 additive 纹理）外晕/内芯 */
	glowOuter: string;
	glowCore: string;
}

const PALETTES: Record<TimeOfDay, HudPalette> = {
	/* dusk：暖紫调，呼应 #2a2340 天空与 #ff9a5c 斜阳 */
	dusk: {
		panelTop: 'rgba(64, 42, 96, 0.50)',
		panelBottom: 'rgba(30, 20, 52, 0.62)',
		frame: 'rgba(196, 181, 253, 0.35)',
		label: 'rgba(216, 196, 255, 0.75)',
		text: '#efe9ff',
		subtle: 'rgba(214, 204, 240, 0.92)',
		speedCalm: '#22d3ee',
		speedNormal: '#93c5fd',
		speedFast: '#fbbf24',
		accent: '#22d3ee',
		hole: 'rgba(16, 10, 34, 0.55)',
		glowOuter: 'rgba(167, 139, 250, 0.55)',
		glowCore: 'rgba(216, 191, 253, 0.95)',
	},
	/* day：亮调浅底深字 */
	day: {
		panelTop: 'rgba(240, 247, 255, 0.50)',
		panelBottom: 'rgba(206, 222, 242, 0.60)',
		frame: 'rgba(43, 74, 112, 0.38)',
		label: 'rgba(30, 58, 95, 0.72)',
		text: '#16324f',
		subtle: 'rgba(30, 64, 110, 0.92)',
		speedCalm: '#0e7490',
		speedNormal: '#2563eb',
		speedFast: '#b45309',
		accent: '#0e7490',
		hole: 'rgba(228, 238, 250, 0.55)',
		glowOuter: 'rgba(90, 130, 180, 0.45)',
		glowCore: 'rgba(70, 110, 165, 0.9)',
	},
	/* night：深蓝调，冷色辉光 */
	night: {
		panelTop: 'rgba(20, 32, 72, 0.52)',
		panelBottom: 'rgba(6, 12, 34, 0.66)',
		frame: 'rgba(138, 162, 255, 0.32)',
		label: 'rgba(170, 192, 255, 0.72)',
		text: '#e8efff',
		subtle: 'rgba(196, 210, 245, 0.9)',
		speedCalm: '#2dd4ee',
		speedNormal: '#8ab8ff',
		speedFast: '#f5b73d',
		accent: '#2dd4ee',
		hole: 'rgba(3, 8, 24, 0.6)',
		glowOuter: 'rgba(120, 150, 255, 0.5)',
		glowCore: 'rgba(178, 200, 255, 0.95)',
	},
};

/** 面板位姿（锁定）：chase 车顶上方 / driver 前挡风全息投影位 / side 侧向朝相机 */
interface HudPose {
	pos: THREE.Vector3;
	rotX: number;
	yaw: number;
}

const HUD_POSES: Record<CameraMode, HudPose> = {
	chase: { pos: new THREE.Vector3(0, 3.9, 0.2), rotX: -0.18, yaw: 0 },
	driver: { pos: new THREE.Vector3(0, 2.1, -7.5), rotX: -0.35, yaw: 0 },
	side: { pos: new THREE.Vector3(0, 3.6, 1.8), rotX: -0.2, yaw: 0.35 },
};

/** 手写圆角矩形路径（不依赖 roundRect 的 lib 兼容性） */
function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.arcTo(x + w, y, x + w, y + r, r);
	ctx.lineTo(x + w, y + h - r);
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
	ctx.lineTo(x + r, y + h);
	ctx.arcTo(x, y + h, x, y + h - r, r);
	ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r);
	ctx.closePath();
}

/** 7b 依赖注入：RTT 渲染器 / raycast 用主相机 / pointer 事件容器 / 小车克隆 getter */
export interface HudViewportDeps {
	renderer: THREE.WebGLRenderer;
	camera: THREE.PerspectiveCamera;
	container: HTMLElement;
	/** 引擎传 `() => carSystem.getHudClone()`（getter：SU7 就绪前后取到的克隆不同） */
	getCarClone: () => THREE.Group;
}

/**
 * 全息 HUD 系统（Task 7a：面板底图 + 时速 + 位姿；7b：中央 360° RTT 小车视口 + 拖拽；
 * 7c：POI 导航脚本 + 变道 hint 脚本 + 中央洞雷达）。
 *
 * 双层 canvas 缓存（Task 9 性能检查项）：
 * - 静态层（底渐变/分区框/标签/装饰环/静态文案）仅在 timeOfDay 变化时重绘；
 * - 动态层每帧先整幅拷贝静态层，再叠加车速/档位/时钟/导航行/车道图/雷达后上传纹理。
 *
 * 7b 360° 视口：mini Scene（hemi+dir 简灯 + 同步主场景 environment 引用）经
 * WebGLRenderTarget(512²) 渲染，子平面嵌在面板中央洞（renderOrder 先于面板绘制，
 * alpha 0 清屏使车体外透明、洞内装饰环可透出）；pointerdown raycast 命中子平面
 * 进入拖拽（yaw/pitch 环绕），释放后自动旋转暂停 3s 再恢复。
 *
 * 7c 数据脚本（updateScripts）：唯一直写 state.distanceM（累计里程）与
 * state.laneChangeHint（45s 周期 / 4s 提示）——与 TrafficSystem 直写 trafficTargets
 * 同一先例；变道「执行」不在 HUD：CarSystem 帧间侦测 hint 沿（出现→记目标道，
 * 消失→x 缓缓 lerp→到位写 laneIndex）。P 档冻结脚本计时（里程/hint 不推进），
 * 视觉时钟 vizT（扫描/闪烁/脉冲）不受档位影响。
 */
export class HudSystem {
	private scene: THREE.Scene;
	private group: THREE.Group;
	private panel: THREE.Mesh;
	private backboard: THREE.Mesh;
	private panelGeometry: THREE.PlaneGeometry;
	private backboardGeometry: THREE.PlaneGeometry;
	private panelMaterial: THREE.MeshBasicMaterial;
	private backboardMaterial: THREE.MeshBasicMaterial;
	/** 静态层（timeOfDay 变化才重绘） */
	private staticCanvas: HTMLCanvasElement;
	/** 动态层（每帧重绘，CanvasTexture 数据源） */
	private dynamicCanvas: HTMLCanvasElement;
	private dynamicTexture: THREE.CanvasTexture;
	private glowCanvas: HTMLCanvasElement;
	private glowTexture: THREE.CanvasTexture;
	private lastTimeOfDay: TimeOfDay | null = null;
	/** 静态层累计重绘次数（Task 9：TC-12 断言 timeOfDay 不变时不增；getter 暴露 staticRedrawCount） */
	private staticRedraws = 0;
	/** 位姿插值当前值（浮动量叠加其上，不污染插值基准） */
	private currentPos: THREE.Vector3;
	private currentRotX: number;
	private currentYaw: number;
	private bobPhase = 0;

	/* 7b：360° RTT 小车视口（`!` 断言：均在构造器调用的 initCarViewport() 内赋值） */
	private deps: HudViewportDeps;
	private miniScene!: THREE.Scene;
	private miniCamera!: THREE.PerspectiveCamera;
	private carRT!: THREE.WebGLRenderTarget;
	private carPlane!: THREE.Mesh;
	private carPlaneGeometry!: THREE.PlaneGeometry;
	private carPlaneMaterial!: THREE.MeshBasicMaterial;
	private miniHemi!: THREE.HemisphereLight;
	private miniDir!: THREE.DirectionalLight;
	/** 当前展示的克隆（几何/材质与主模型共享，所有权在 CarSystem，只持引用） */
	private carClone: THREE.Group | null = null;
	private orbitYaw = CAR_INITIAL_YAW;
	private orbitPitch = CAR_BASE_PITCH;
	/** 自动旋转剩余暂停秒数（拖拽释放后置 3s） */
	private autoRotatePause = 0;
	private dragging = false;
	private lastPointerX = 0;
	private lastPointerY = 0;
	private raycaster = new THREE.Raycaster();
	private pointerNdc = new THREE.Vector2();

	/* 7c：数据脚本状态（纯计时字段，无 GPU 资源；dispose 复位防复用残留） */
	/** 视觉时钟：雷达扫描角 / hint 箭头闪烁 / 目标脉冲相位（P 档也推进） */
	private vizT = 0;
	/** 当前 POI 下标与循环累计偏移（第二轮凯恒中心 = 800 + 2400×N） */
	private poiIndex = 0;
	private poiOffsetM = 0;
	/** 距下次 hint 触发的倒计时 / hint 展示剩余秒（>0 即展示中） */
	private hintCountdownSec = LANE_HINT_INTERVAL_SEC;
	private hintTimerSec = 0;
	/** lane 1 出发的 hint 方向交替开关（边界道 0/2 只能往内，不消耗开关） */
	private hintFlip = false;

	constructor(
		scene: THREE.Scene,
		deps: HudViewportDeps,
		initialMode: CameraMode = 'chase',
		initialTimeOfDay: TimeOfDay = 'dusk'
	) {
		this.scene = scene;
		this.deps = deps;

		this.staticCanvas = document.createElement('canvas');
		this.staticCanvas.width = CANVAS_W;
		this.staticCanvas.height = CANVAS_H;
		this.dynamicCanvas = document.createElement('canvas');
		this.dynamicCanvas.width = CANVAS_W;
		this.dynamicCanvas.height = CANVAS_H;

		/* 每帧上传的 UI 纹理禁 mipmap：避免 needsUpdate 时重复生成 mipmap 的无谓开销 */
		this.dynamicTexture = new THREE.CanvasTexture(this.dynamicCanvas);
		this.dynamicTexture.colorSpace = THREE.SRGBColorSpace;
		this.dynamicTexture.generateMipmaps = false;
		this.dynamicTexture.minFilter = THREE.LinearFilter;

		this.panelGeometry = new THREE.PlaneGeometry(PANEL_W, PANEL_H);
		this.panelMaterial = new THREE.MeshBasicMaterial({
			map: this.dynamicTexture,
			transparent: true,
			toneMapped: false,
		});
		this.panel = new THREE.Mesh(this.panelGeometry, this.panelMaterial);
		this.panel.renderOrder = 1;

		/* 发光边框 = 更大背板 + additive 渐变描边纹理（timeOfDay 变化时随静态层重绘换色） */
		this.glowCanvas = document.createElement('canvas');
		this.glowCanvas.width = 1024;
		this.glowCanvas.height = 512;
		this.glowTexture = new THREE.CanvasTexture(this.glowCanvas);
		this.glowTexture.colorSpace = THREE.SRGBColorSpace;
		this.backboardGeometry = new THREE.PlaneGeometry(
			PANEL_W + GLOW_PAD * 2,
			PANEL_H + GLOW_PAD * 2
		);
		this.backboardMaterial = new THREE.MeshBasicMaterial({
			map: this.glowTexture,
			transparent: true,
			blending: THREE.AdditiveBlending,
			toneMapped: false,
			depthWrite: false,
		});
		this.backboard = new THREE.Mesh(this.backboardGeometry, this.backboardMaterial);
		this.backboard.position.z = -0.02;
		this.backboard.renderOrder = 0;

		this.group = new THREE.Group();
		this.group.add(this.backboard, this.panel);
		scene.add(this.group);

		/* 构造即贴合初始档位（与 CameraRig 同策略，避免开场漂移），并绘制首帧静态层 */
		const pose = HUD_POSES[initialMode];
		this.currentPos = pose.pos.clone();
		this.currentRotX = pose.rotX;
		this.currentYaw = pose.yaw;
		this.applyPose(0);
		this.redrawStaticLayer(initialTimeOfDay);

		/* 7b：RTT 视口（子平面已可加入 group；克隆先取 loading 期 fallback，就绪后引擎调 refreshCar 换车） */
		this.initCarViewport();
	}

	/** Task 9：静态层累计重绘次数（经 engine.getRenderInfo 暴露给 TC-12） */
	get staticRedrawCount(): number {
		return this.staticRedraws;
	}

	update(dt: number, state: DrivingState): void {
		/* 静态层仅在 timeOfDay 变化时重绘（含发光边框纹理随档位换色） */
		if (state.timeOfDay !== this.lastTimeOfDay) {
			this.redrawStaticLayer(state.timeOfDay);
		}

		/* 7c：数据脚本先于绘制——本帧导航行/雷达/hint 箭头即读到最新 state */
		this.updateScripts(dt, state);

		this.drawDynamicLayer(state);

		/* 位姿随 cameraMode 平滑过渡（k = 1 - exp(-4dt)，与 CameraRig 同模式） */
		const pose = HUD_POSES[state.cameraMode];
		const k = 1 - Math.exp(-LERP_RATE * dt);
		this.currentPos.lerp(pose.pos, k);
		this.currentRotX += (pose.rotX - this.currentRotX) * k;
		this.currentYaw += (pose.yaw - this.currentYaw) * k;

		/* 随车速上下浮动 sin ±0.05m：幅度随速度 0..1 缩放（停车即静止），频率随速度略升 */
		const speedFactor = Math.min(state.speedKmh / 30, 1);
		this.bobPhase += dt * (1.2 + state.speedKmh / 45);
		this.applyPose(Math.sin(this.bobPhase) * BOB_AMPLITUDE * speedFactor);

		/* 7b：环绕推进 + RTT 渲染（引擎在 update 之后才渲染主场景，故此处先画 RT 再复位目标） */
		this.updateCarViewport(dt);
	}

	dispose(): void {
		/* 7b：拖拽监听逐一移除（挂载在引擎容器上） */
		const { container } = this.deps;
		container.removeEventListener('pointerdown', this.onPointerDown);
		container.removeEventListener('pointermove', this.onPointerMove);
		container.removeEventListener('pointerup', this.onPointerUp);
		container.removeEventListener('pointercancel', this.onPointerUp);
		/* 7c：脚本计时全为帧驱动字段（无 setTimeout/setInterval，停帧即停），
		   此处复位防止引擎实例被复用时的脚本状态残留 */
		this.vizT = 0;
		this.poiIndex = 0;
		this.poiOffsetM = 0;
		this.hintCountdownSec = LANE_HINT_INTERVAL_SEC;
		this.hintTimerSec = 0;
		this.hintFlip = false;
		/* RT 与子平面几何/材质释放（材质 map 即 rt.texture，随 RT 一并回收） */
		this.carRT.dispose();
		this.carPlaneGeometry.dispose();
		this.carPlaneMaterial.dispose();
		/* mini 灯光：无 GPU 资源，按与主场景灯光相同的惯例显式 dispose */
		this.miniHemi.dispose();
		this.miniDir.dispose();
		/* SU7 克隆与主模型共享资源（所有权在 CarSystem）：仅移除引用；
		   fallback 克隆独享几何/材质（userData.ownsResources 标记），须就地释放防泄漏 */
		if (this.carClone) {
			this.miniScene.remove(this.carClone);
			HudSystem.disposeIfOwned(this.carClone);
			this.carClone = null;
		}
		/* environment 引用自 CarSystem 的 envRT：仅解除引用，不 dispose */
		this.miniScene.environment = null;
		this.miniScene.clear();

		this.scene.remove(this.group);
		this.panelGeometry.dispose();
		this.backboardGeometry.dispose();
		this.dynamicTexture.dispose();
		this.glowTexture.dispose();
		this.panelMaterial.dispose();
		this.backboardMaterial.dispose();
		this.group.clear();
	}

	/* ---------------------------------------------------------------- */
	/* 静态层：底渐变 / 分区框 / 标签 / 装饰环 / 静态文案                  */
	/* ---------------------------------------------------------------- */

	private redrawStaticLayer(tod: TimeOfDay): void {
		this.lastTimeOfDay = tod;
		this.staticRedraws += 1;
		const p = PALETTES[tod];
		const ctx = this.staticCanvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

		/* 1. 面板底渐变（圆角整幅，保留透明全息感） */
		const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
		grad.addColorStop(0, p.panelTop);
		grad.addColorStop(1, p.panelBottom);
		ctx.fillStyle = grad;
		roundRectPath(ctx, 12, 12, CANVAS_W - 24, CANVAS_H - 24, 56);
		ctx.fill();
		/* 内缘细描边提亮轮廓 */
		ctx.strokeStyle = p.frame;
		ctx.lineWidth = 3;
		ctx.stroke();

		/* 2. 分区框 + 标签 */
		this.drawSection(ctx, p, SPEED_BOX, 'SPEED · 车速');
		this.drawSection(ctx, p, NAV_BOX, 'NAV · 导航');
		this.drawSection(ctx, p, LANE_BOX, 'LANE · 车道引导');

		/* 3. 时速区静态：'km/h' 单位（数字与档位在动态层） */
		ctx.fillStyle = p.label;
		ctx.font = "600 60px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText('km/h', SPEED_CENTER_X, SPEED_BASELINE_Y + 88);

		/* 4. 中央 360° 洞：雷达装饰环占位（RTT 小车子平面是 7b；扫描/目标点是 7c） */
		this.drawHoleRings(ctx, p);

		/* 5. 右列静态：路名固定；导航行随 distanceM 递减，由 7c 移至动态层绘制 */
		ctx.textAlign = 'left';
		ctx.fillStyle = p.text;
		ctx.font = "bold 64px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillText('朝阳北路', NAV_BOX.x + 28, NAV_BOX.y + 136);

		/* 6. 底部条静态：续航 / 信号点 / 智驾状态（时间在动态层） */
		this.drawSection(ctx, p, FOOT_BOX, '');
		ctx.textBaseline = 'middle';
		ctx.font = "500 46px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillStyle = p.subtle;
		ctx.textAlign = 'left';
		ctx.fillText('续航 512 km', FOOT_BOX.x + 80, FOOT_CENTER_Y);
		/* 三信号点 */
		ctx.fillStyle = p.accent;
		for (let i = 0; i < 3; i++) {
			ctx.beginPath();
			ctx.arc(1462 + i * 52, FOOT_CENTER_Y, 11, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.font = "600 44px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillStyle = p.text;
		ctx.fillText('NOC · 智驾已开启', 1636, FOOT_CENTER_Y);

		/* 发光边框纹理随档位一并换色 */
		this.paintGlowTexture(p);
	}

	/** 分区框（圆角描边 + 左上角标签） */
	private drawSection(
		ctx: CanvasRenderingContext2D,
		p: HudPalette,
		box: { x: number; y: number; w: number; h: number },
		label: string
	): void {
		ctx.strokeStyle = p.frame;
		ctx.lineWidth = 2;
		roundRectPath(ctx, box.x, box.y, box.w, box.h, 28);
		ctx.stroke();
		if (!label) return;
		ctx.fillStyle = p.label;
		ctx.font = "600 30px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(label, box.x + 26, box.y + 52);
	}

	/** 中央洞装饰环：外双圈 + 5°/30° 刻度 + 极淡同心底纹 + 暗洞底（7b RTT 平面将覆盖洞心） */
	private drawHoleRings(ctx: CanvasRenderingContext2D, p: HudPalette): void {
		const { x: cx, y: cy } = HOLE_CENTER;

		/* 洞底（径向渐变，中心最深） */
		const holeGrad = ctx.createRadialGradient(cx, cy, HOLE_RADIUS * 0.1, cx, cy, HOLE_RADIUS);
		holeGrad.addColorStop(0, p.hole);
		holeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
		ctx.fillStyle = holeGrad;
		ctx.beginPath();
		ctx.arc(cx, cy, HOLE_RADIUS, 0, Math.PI * 2);
		ctx.fill();

		/* 极淡同心底纹（雷达量程环的静态底；带透明度衰减的目标环是 7c） */
		ctx.strokeStyle = p.frame;
		ctx.lineWidth = 2;
		for (const r of [110, 220, 300]) {
			ctx.globalAlpha = 0.5;
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		/* 外圈双环 */
		ctx.strokeStyle = p.accent;
		ctx.globalAlpha = 0.9;
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.arc(cx, cy, HOLE_RADIUS, 0, Math.PI * 2);
		ctx.stroke();
		ctx.globalAlpha = 0.4;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(cx, cy, HOLE_RADIUS - 14, 0, Math.PI * 2);
		ctx.stroke();
		ctx.globalAlpha = 1;

		/* 刻度：每 5° 短线，每 30° 长线加亮 */
		for (let deg = 0; deg < 360; deg += 5) {
			const major = deg % 30 === 0;
			const rad = (deg * Math.PI) / 180;
			const inner = HOLE_RADIUS - (major ? 34 : 18);
			ctx.strokeStyle = major ? p.accent : p.frame;
			ctx.globalAlpha = major ? 0.85 : 0.55;
			ctx.lineWidth = major ? 4 : 2;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
			ctx.lineTo(cx + Math.cos(rad) * (HOLE_RADIUS - 8), cy + Math.sin(rad) * (HOLE_RADIUS - 8));
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		/* 洞顶小标签 */
		ctx.fillStyle = p.label;
		ctx.font = "600 30px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText('360° VIEW', cx, HOLE_CENTER.y - HOLE_RADIUS - 26);
	}

	/* ---------------------------------------------------------------- */
	/* 动态层：每帧拷贝静态层后叠加车速/档位/时钟/导航行/车道图/雷达        */
	/* ---------------------------------------------------------------- */

	private drawDynamicLayer(state: DrivingState): void {
		const p = PALETTES[this.lastTimeOfDay ?? 'dusk'];
		const ctx = this.dynamicCanvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
		ctx.drawImage(this.staticCanvas, 0, 0);

		this.drawSpeedNumber(ctx, state, p);
		this.drawGearPill(ctx, state, p);
		this.drawClock(ctx, p);
		this.drawNavLine(ctx, state, p);
		this.drawLaneMap(ctx, state, p);
		this.drawRadar(ctx, state, p);

		this.dynamicTexture.needsUpdate = true;
	}

	/** 时速数字：bold 220px 居中 (310,560)；<60 青 / 60-100 浅蓝 / >100 琥珀 */
	private drawSpeedNumber(ctx: CanvasRenderingContext2D, state: DrivingState, p: HudPalette): void {
		const kmh = Math.round(state.speedKmh);
		ctx.fillStyle = kmh < 60 ? p.speedCalm : kmh <= 100 ? p.speedNormal : p.speedFast;
		ctx.font = "bold 220px 'DIN Alternate', 'Helvetica Neue', Arial, sans-serif";
		ctx.textAlign = 'center';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(String(kmh), SPEED_CENTER_X, SPEED_BASELINE_Y);
	}

	/** 档位 pill：D 档青色 / P 档琥珀描边胶囊 */
	private drawGearPill(ctx: CanvasRenderingContext2D, state: DrivingState, p: HudPalette): void {
		const cx = SPEED_CENTER_X;
		const cy = SPEED_BASELINE_Y + 172;
		const color = state.gear === 'D' ? p.accent : p.speedFast;
		ctx.strokeStyle = color;
		ctx.globalAlpha = 0.85;
		ctx.lineWidth = 4;
		roundRectPath(ctx, cx - 76, cy - 36, 152, 72, 36);
		ctx.stroke();
		ctx.globalAlpha = 0.18;
		ctx.fillStyle = color;
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.fillStyle = color;
		ctx.font = "bold 46px 'Helvetica Neue', Arial, sans-serif";
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(state.gear, cx, cy + 2);
	}

	/** 时钟 HH:MM（:SS 以 1Hz 闪烁） */
	private drawClock(ctx: CanvasRenderingContext2D, p: HudPalette): void {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
		const ss = `:${pad(now.getSeconds())}`;
		const cy = FOOT_CENTER_Y;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		ctx.font = "bold 56px 'DIN Alternate', 'Helvetica Neue', Arial, sans-serif";
		ctx.fillStyle = p.text;
		ctx.fillText(hhmm, 1024 - 34, cy);
		/* 偶数秒显示 :SS、奇数秒隐藏 → 1Hz 闪烁 */
		if (now.getSeconds() % 2 === 0) {
			ctx.font = "600 40px 'DIN Alternate', 'Helvetica Neue', Arial, sans-serif";
			ctx.fillStyle = p.label;
			ctx.textAlign = 'left';
			ctx.fillText(ss, 1024 + 26, cy);
		}
	}

	/* ---------------------------------------------------------------- */
	/* 7c：数据脚本——里程累计 / POI 循环 / 变道 hint 触发（直写 state）   */
	/* ---------------------------------------------------------------- */

	/**
	 * 每帧推进数据脚本（P 档冻结计时）：
	 * 1) 唯一推进 state.distanceM（引擎与各系统均不写它，里程按 kmh/3.6 m/s 累计）；
	 * 2) 当前 POI 剩余 <50m 切换下一个，绕回队首时偏移累加一轮总里程
	 *    （累计里程制：第二轮凯恒中心到达里程 = 800 + 2400×N，剩余距离显示不跳变）；
	 * 3) 每 ~45s 触发一次 laneChangeHint（持续 4s）——HUD 只发「意图」，
	 *    CarSystem 帧间侦测 hint 消失沿后执行 x 缓变与 laneIndex 落位（驾驶逻辑不进 HUD）。
	 */
	private updateScripts(dt: number, state: DrivingState): void {
		this.vizT += dt;
		if (state.gear === 'P') return; // 停车冻结：里程不累计、hint 计时不推进

		state.distanceM += (state.speedKmh / 3.6) * dt;

		const arrival = POI_LIST[this.poiIndex].arriveM + this.poiOffsetM;
		if (arrival - state.distanceM < POI_SWITCH_REMAIN_M) {
			this.poiIndex = (this.poiIndex + 1) % POI_LIST.length;
			if (this.poiIndex === 0) {
				this.poiOffsetM += POI_LOOP_M;
			}
		}

		if (this.hintTimerSec > 0) {
			this.hintTimerSec -= dt;
			if (this.hintTimerSec <= 0) {
				this.hintTimerSec = 0;
				state.laneChangeHint = null; // 提示结束沿：CarSystem 下一帧侦测到并开始缓变
			}
		} else {
			this.hintCountdownSec -= dt;
			if (this.hintCountdownSec <= 0) {
				this.hintCountdownSec = LANE_HINT_INTERVAL_SEC;
				state.laneChangeHint = this.pickHintDirection(state.laneIndex);
				this.hintTimerSec = LANE_HINT_DURATION_SEC;
			}
		}
	}

	/** 目标道在 0/1/2 内合法选择（边界道只往内；lane 1 左右交替，确定性便于 e2e 断言） */
	private pickHintDirection(lane: 0 | 1 | 2): 'left' | 'right' {
		if (lane === 0) return 'right';
		if (lane === 2) return 'left';
		this.hintFlip = !this.hintFlip;
		return this.hintFlip ? 'right' : 'left';
	}

	/** 7c 导航行：「前方 {剩余距离} m · {名称}」，随 state.distanceM 递减（样式沿用 7a 占位） */
	private drawNavLine(ctx: CanvasRenderingContext2D, state: DrivingState, p: HudPalette): void {
		const poi = POI_LIST[this.poiIndex];
		const remainM = Math.max(0, Math.round(poi.arriveM + this.poiOffsetM - state.distanceM));
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = p.subtle;
		ctx.font = "500 52px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillText(`前方 ${remainM} m · ${poi.name}`, NAV_BOX.x + 28, NAV_BOX.y + 224);
	}

	/** 车道图：460×260 透视梯形三车道，当前道青色 35% 高亮 + 7c hint 箭头 1.2s 闪烁 */
	private drawLaneMap(ctx: CanvasRenderingContext2D, state: DrivingState, p: HudPalette): void {
		const { x, yTop, yBottom, wBottom, wTop } = LANE_TRAP;
		/** 纵向 t∈[0,1]（0=远端）处车道图半宽与中心 x（透视：宽度按 t^1.5 收敛） */
		const halfWidthAt = (t: number) => {
			const w = wTop + (wBottom - wTop) * Math.pow(t, 1.5);
			return w / 2;
		};
		const yAt = (t: number) => yTop + (yBottom - yTop) * t;
		const cx = x + wBottom / 2;

		/*
		 * 车道横向比例：三车道均分 [-1,1]，每道宽 2/3。
		 * lane i 中心 frac = (2i+1)/3 - 1（0 → -2/3，1 → 0，2 → +2/3），左右边界 = 中心 ∓ 1/3
		 */
		const lane = state.laneIndex;
		const laneCenterFrac = (lane * 2 + 1) / 3 - 1;
		const laneLeftFrac = laneCenterFrac - 1 / 3;
		const laneRightFrac = laneCenterFrac + 1 / 3;

		/* 当前道高亮（先画，垫底）：沿左边界 t:0→1 再沿右边界 t:1→0 闭合 */
		ctx.beginPath();
		for (let i = 0; i <= 8; i++) {
			const t = i / 8;
			const px = cx + halfWidthAt(t) * laneLeftFrac;
			if (i === 0) ctx.moveTo(px, yAt(t));
			else ctx.lineTo(px, yAt(t));
		}
		for (let i = 8; i >= 0; i--) {
			const t = i / 8;
			ctx.lineTo(cx + halfWidthAt(t) * laneRightFrac, yAt(t));
		}
		ctx.closePath();
		ctx.globalAlpha = 0.35;
		ctx.fillStyle = p.accent;
		ctx.fill();
		ctx.globalAlpha = 1;

		/* 车道分隔线（0/1/2/3 四条边界）+ 两侧边线 */
		ctx.strokeStyle = p.subtle;
		ctx.globalAlpha = 0.5;
		ctx.lineWidth = 3;
		for (let b = 0; b <= 3; b++) {
			const frac = (b * 2) / 3 - 1; // -1..+1
			ctx.beginPath();
			for (let i = 0; i <= 8; i++) {
				const t = i / 8;
				const px = cx + halfWidthAt(t) * frac;
				if (i === 0) ctx.moveTo(px, yAt(t));
				else ctx.lineTo(px, yAt(t));
			}
			ctx.stroke();
		}
		/* 近端路面横线 ×2（增强透视） */
		for (const t of [0.45, 1]) {
			const half = halfWidthAt(t);
			ctx.beginPath();
			ctx.moveTo(cx - half, yAt(t));
			ctx.lineTo(cx + half, yAt(t));
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		/* 主车标记：近端当前道中心小圆点 */
		const t0 = 0.86;
		ctx.fillStyle = p.text;
		ctx.beginPath();
		ctx.arc(cx + halfWidthAt(t0) * laneCenterFrac, yAt(t0), 12, 0, Math.PI * 2);
		ctx.fill();

		/* 7c 变道 hint 箭头：目标道方向双 chevron，1.2s 周期闪烁（前半周期可见） */
		if (state.laneChangeHint && this.vizT % LANE_HINT_BLINK_SEC < LANE_HINT_BLINK_SEC / 2) {
			const dir = state.laneChangeHint === 'left' ? -1 : 1;
			const targetFrac = laneCenterFrac + (dir * 2) / 3;
			const ax = cx + halfWidthAt(0.55) * targetFrac;
			const ay = yAt(0.55);
			ctx.strokeStyle = p.speedNormal;
			ctx.lineWidth = 10;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.globalAlpha = 0.95;
			for (let c = 0; c < 2; c++) {
				const ox = ax - dir * c * 34; // 第二道 chevron 拖在指向后方
				ctx.beginPath();
				ctx.moveTo(ox - dir * 16, ay - 22);
				ctx.lineTo(ox + dir * 16, ay);
				ctx.lineTo(ox - dir * 16, ay + 22);
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
			ctx.lineCap = 'butt';
		}
	}

	/**
	 * 7c 雷达（中央洞内，动态层每帧）：
	 * 同心环 r90/180/270/320 透明度由内向外衰减 + 1.2rad/s 旋转扫描扇形（细楔形
	 * 序列渐隐近似锥形渐变，免 createConicGradient 的兼容性分支）+
	 * state.trafficTargets 映射目标点 (relX/25·r_max, relZ/60·r_max)。
	 * 方向：relX 右正 → 屏幕右；relZ 前负后正（车头朝 -Z）→ 前方目标映到洞上方。
	 */
	private drawRadar(ctx: CanvasRenderingContext2D, state: DrivingState, p: HudPalette): void {
		const { x: cx, y: cy } = HOLE_CENTER;

		/* 同心环：透明度由内向外衰减 */
		ctx.strokeStyle = p.accent;
		ctx.lineWidth = 2.5;
		for (let i = 0; i < RADAR_RINGS.length; i++) {
			ctx.globalAlpha = RADAR_RING_ALPHA[i];
			ctx.beginPath();
			ctx.arc(cx, cy, RADAR_RINGS[i], 0, Math.PI * 2);
			ctx.stroke();
		}

		/* 扫描扇形：前沿最亮、向后 RADAR_SWEEP_TRAIL 弧长渐隐；角度由 vizT 推导无累计漂移 */
		const sweep = (this.vizT * RADAR_SWEEP_SPEED) % (Math.PI * 2);
		const steps = 12;
		ctx.fillStyle = p.accent;
		for (let i = 0; i < steps; i++) {
			const a1 = sweep - (RADAR_SWEEP_TRAIL * i) / steps;
			const a2 = a1 - RADAR_SWEEP_TRAIL / steps - 0.01;
			ctx.globalAlpha = 0.1 * (1 - i / steps);
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, RADAR_RINGS[RADAR_RINGS.length - 1], a2, a1);
			ctx.closePath();
			ctx.fill();
		}

		/* 目标点：接近（|relZ| 变小）→ 基点更大 + 呼吸光环脉冲放大 */
		for (let i = 0; i < state.trafficTargets.length; i++) {
			const t = state.trafficTargets[i];
			const px = cx + (t.relX / RADAR_RANGE_X_M) * RADAR_R_MAX;
			const py = cy + (t.relZ / RADAR_RANGE_Z_M) * RADAR_R_MAX;
			const closeness = 1 - Math.min(Math.abs(t.relZ) / RADAR_RANGE_Z_M, 1);
			const base = 6 + closeness * 8;
			ctx.strokeStyle = p.accent;
			ctx.lineWidth = 2.5;
			ctx.globalAlpha = 0.35;
			ctx.beginPath();
			ctx.arc(px, py, base + 5 + Math.sin(this.vizT * 5 + i * 1.7) * 3, 0, Math.PI * 2);
			ctx.stroke();
			ctx.globalAlpha = 0.95;
			ctx.fillStyle = p.accent;
			ctx.beginPath();
			ctx.arc(px, py, base, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}

	/* ---------------------------------------------------------------- */
	/* 发光边框背板纹理（timeOfDay 变化时随静态层一并重绘）                */
	/* ---------------------------------------------------------------- */

	/** 在 glowCanvas 上重绘发光描边并标记纹理更新（透明底：外层宽晕 + 内芯亮线） */
	private paintGlowTexture(p: HudPalette): void {
		const ctx = this.glowCanvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);
		const pad = 36;
		roundRectPath(
			ctx,
			pad,
			pad,
			this.glowCanvas.width - pad * 2,
			this.glowCanvas.height - pad * 2,
			60
		);
		ctx.strokeStyle = p.glowOuter;
		ctx.lineWidth = 26;
		ctx.shadowColor = p.glowOuter;
		ctx.shadowBlur = 48;
		ctx.stroke();
		ctx.stroke(); // 二次描边加强外晕（additive 叠加更亮）
		ctx.shadowBlur = 0;
		ctx.strokeStyle = p.glowCore;
		ctx.lineWidth = 5;
		ctx.stroke();
		this.glowTexture.needsUpdate = true;
	}

	/** 把插值位姿 + 当帧浮动量写入 group */
	private applyPose(bobOffset: number): void {
		this.group.position.set(this.currentPos.x, this.currentPos.y + bobOffset, this.currentPos.z);
		this.group.rotation.x = this.currentRotX;
		this.group.rotation.y = this.currentYaw;
	}

	/* ---------------------------------------------------------------- */
	/* 7b：中央 360° RTT 小车视口 + 拖拽环绕                               */
	/* ---------------------------------------------------------------- */

	/** 建 mini 场景/相机/RT，子平面嵌入面板中央洞，挂 pointer 拖拽监听 */
	private initCarViewport(): void {
		/* RT 512×512（锁定）：默认含深度缓冲；清屏 alpha 0 → 车体外透明，洞内装饰环可透出 */
		this.carRT = new THREE.WebGLRenderTarget(CAR_RT_SIZE, CAR_RT_SIZE);

		/* mini 场景：hemi+dir 简灯打底；SU7 就绪后 updateCarViewport 每帧同步主场景 environment 引用（漆面反射） */
		this.miniScene = new THREE.Scene();
		this.miniHemi = new THREE.HemisphereLight(0xcfd8ff, 0x22242e, 1.0);
		this.miniDir = new THREE.DirectionalLight(0xffffff, 2.0);
		this.miniDir.position.set(3, 5, 2);
		this.miniScene.add(this.miniHemi, this.miniDir);

		this.miniCamera = new THREE.PerspectiveCamera(CAR_CAM_FOV, 1, 0.1, 30);

		/* 子平面嵌洞：局部坐标按洞心映射；renderOrder 0 → 先于面板(1)绘制，面板洞区半透明装饰叠在其上 */
		this.carPlaneGeometry = new THREE.PlaneGeometry(HOLE_PLANE_SIZE, HOLE_PLANE_SIZE);
		this.carPlaneMaterial = new THREE.MeshBasicMaterial({
			map: this.carRT.texture,
			transparent: true,
			toneMapped: false,
			depthWrite: false,
		});
		this.carPlane = new THREE.Mesh(this.carPlaneGeometry, this.carPlaneMaterial);
		this.carPlane.position.set(HOLE_LOCAL_X, HOLE_LOCAL_Y, CAR_PLANE_Z);
		/* 与发光背板同 renderOrder：透明队列内按深度排序，背板(z=-0.02)更远先画，子平面随后、面板最后 */
		this.carPlane.renderOrder = 0;
		this.group.add(this.carPlane);

		/* 初始克隆（多半是 loading 期 fallback），modelStatus 就绪后由引擎调 refreshCar() 换车 */
		this.refreshCar();

		const { container } = this.deps;
		container.addEventListener('pointerdown', this.onPointerDown);
		container.addEventListener('pointermove', this.onPointerMove);
		container.addEventListener('pointerup', this.onPointerUp);
		container.addEventListener('pointercancel', this.onPointerUp);
	}

	/**
	 * 换车：mini 场景移除旧克隆、放入新克隆。
	 * 克隆(clone(true)/fallback 构建)与主模型共享几何与材质，所有权在 CarSystem——只动引用，绝不 dispose。
	 */
	refreshCar(): void {
		const next = this.deps.getCarClone();
		if (this.carClone) {
			this.miniScene.remove(this.carClone);
			HudSystem.disposeIfOwned(this.carClone); // fallback 旧克隆独享资源，弃用即释放
		}
		this.carClone = next;
		this.miniScene.add(next);
	}

	/** 每帧：自动旋转推进 → 环绕位姿 → RTT 渲染（先画 RT 再复位渲染目标与清屏色） */
	private updateCarViewport(dt: number): void {
		if (!this.dragging) {
			if (this.autoRotatePause > 0) {
				this.autoRotatePause -= dt;
			} else {
				this.orbitYaw += CAR_AUTO_ROTATE * dt;
			}
		}

		/* HDR 就绪后同步 environment 引用（envRT 所有权在 CarSystem，这里只引用不持有） */
		if (this.miniScene.environment !== this.scene.environment) {
			this.miniScene.environment = this.scene.environment;
		}

		/* 环绕位姿：绕目标点 (0, CAR_TARGET_Y, 0) 半径 4.5m，pitch 即仰角 */
		const cp = Math.cos(this.orbitPitch);
		this.miniCamera.position.set(
			Math.sin(this.orbitYaw) * cp * CAR_ORBIT_RADIUS,
			CAR_TARGET_Y + Math.sin(this.orbitPitch) * CAR_ORBIT_RADIUS,
			Math.cos(this.orbitYaw) * cp * CAR_ORBIT_RADIUS
		);
		this.miniCamera.lookAt(0, CAR_TARGET_Y, 0);

		/* RTT：保存主 renderer 清屏状态 → alpha 0 清屏画 mini 场景 → 复位（主场景渲染随后由引擎执行） */
		const { renderer } = this.deps;
		const prevClearColor = renderer.getClearColor(new THREE.Color());
		const prevClearAlpha = renderer.getClearAlpha();
		renderer.setRenderTarget(this.carRT);
		renderer.setClearColor(0x000000, 0);
		renderer.render(this.miniScene, this.miniCamera);
		renderer.setRenderTarget(null);
		renderer.setClearColor(prevClearColor, prevClearAlpha);
	}

	/** pointerdown：主相机 raycast 命中子平面（洞内）才进入拖拽，并捕获指针保证拖出容器仍可追踪 */
	private onPointerDown = (e: PointerEvent): void => {
		const rect = this.deps.container.getBoundingClientRect();
		this.pointerNdc.set(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1
		);
		/* 事件可能落在两帧之间，先刷新世界矩阵再射线求交 */
		this.group.updateMatrixWorld(true);
		this.raycaster.setFromCamera(this.pointerNdc, this.deps.camera);
		if (this.raycaster.intersectObject(this.carPlane, false).length === 0) return;

		e.preventDefault();
		this.dragging = true;
		this.lastPointerX = e.clientX;
		this.lastPointerY = e.clientY;
		const target = e.target;
		if (target instanceof HTMLElement) {
			try {
				target.setPointerCapture(e.pointerId);
			} catch {
				/* 指针已失效等竞态下捕获失败可容忍：move/up 仍挂在容器上 */
			}
		}
	};

	/** pointermove：拖拽中 yaw -= dx*0.01（锁定），pitch 随 dy 并 clamp ±0.5rad */
	private onPointerMove = (e: PointerEvent): void => {
		if (!this.dragging) return;
		const dx = e.clientX - this.lastPointerX;
		const dy = e.clientY - this.lastPointerY;
		this.lastPointerX = e.clientX;
		this.lastPointerY = e.clientY;
		this.orbitYaw -= dx * CAR_DRAG_SENSITIVITY;
		this.orbitPitch = Math.max(
			-CAR_PITCH_LIMIT,
			Math.min(CAR_PITCH_LIMIT, this.orbitPitch + dy * CAR_DRAG_SENSITIVITY)
		);
	};

	/** pointerup / pointercancel：释放拖拽并暂停自动旋转 3s */
	private onPointerUp = (): void => {
		if (!this.dragging) return;
		this.dragging = false;
		this.autoRotatePause = CAR_RESUME_DELAY_SEC;
	};

	/** 独享资源的克隆（userData.ownsResources=true，CarSystem 新建的 fallback）就地释放；
	    共享克隆（SU7 clone）与主模型同源，处置权在 CarSystem，这里不动 */
	private static disposeIfOwned(clone: THREE.Object3D): void {
		if (!clone.userData.ownsResources) return;
		clone.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				obj.geometry?.dispose();
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
	}
}
