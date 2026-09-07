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

/**
 * 全息 HUD 系统（Task 7a：面板底图 + 时速 + 位姿）。
 *
 * 双层 canvas 缓存（Task 9 性能检查项）：
 * - 静态层（底渐变/分区框/标签/装饰环/静态文案）仅在 timeOfDay 变化时重绘；
 * - 动态层每帧先整幅拷贝静态层，再叠加车速数字/档位/时钟/车道图后上传纹理。
 *
 * 后续子块（勿在 7a 实现）：7b RTT 360° 小车 + 拖拽；7c 雷达目标点/POI 递减/变道 hint。
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
	/** 位姿插值当前值（浮动量叠加其上，不污染插值基准） */
	private currentPos: THREE.Vector3;
	private currentRotX: number;
	private currentYaw: number;
	private bobPhase = 0;

	constructor(scene: THREE.Scene, initialMode: CameraMode = 'chase', initialTimeOfDay: TimeOfDay = 'dusk') {
		this.scene = scene;

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
		this.backboardGeometry = new THREE.PlaneGeometry(PANEL_W + GLOW_PAD * 2, PANEL_H + GLOW_PAD * 2);
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
	}

	update(dt: number, state: DrivingState): void {
		/* 静态层仅在 timeOfDay 变化时重绘（含发光边框纹理随档位换色） */
		if (state.timeOfDay !== this.lastTimeOfDay) {
			this.redrawStaticLayer(state.timeOfDay);
		}

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
	}

	dispose(): void {
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

		/* 5. 右列静态占位文案（POI 数据脚本是 7c） */
		ctx.textAlign = 'left';
		ctx.fillStyle = p.text;
		ctx.font = "bold 64px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillText('朝阳北路', NAV_BOX.x + 28, NAV_BOX.y + 136);
		ctx.fillStyle = p.subtle;
		ctx.font = "500 52px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillText('前方 320 m · 凯恒中心', NAV_BOX.x + 28, NAV_BOX.y + 224);

		/* 6. 底部条静态：续航 / 信号点 / 智驾状态（时间在动态层） */
		this.drawSection(ctx, p, FOOT_BOX, '');
		ctx.textBaseline = 'middle';
		ctx.font = "500 46px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillStyle = p.subtle;
		ctx.textAlign = 'left';
		ctx.fillText('续航 512 km', FOOT_BOX.x + 80, (FOOT_BOX.y + FOOT_BOX.h) / 2);
		/* 三信号点 */
		ctx.fillStyle = p.accent;
		for (let i = 0; i < 3; i++) {
			ctx.beginPath();
			ctx.arc(1462 + i * 52, (FOOT_BOX.y + FOOT_BOX.h) / 2, 11, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.font = "600 44px 'PingFang SC', 'Microsoft YaHei', sans-serif";
		ctx.fillStyle = p.text;
		ctx.fillText('NOC · 智驾已开启', 1636, (FOOT_BOX.y + FOOT_BOX.h) / 2);

		/* 发光边框纹理随档位一并换色 */
		this.paintGlowTexture(p);
	}

	/** 分区框（圆角描边 + 左上角标签） */
	private drawSection(ctx: CanvasRenderingContext2D, p: HudPalette, box: { x: number; y: number; w: number; h: number }, label: string): void {
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
	/* 动态层：每帧拷贝静态层后叠加车速 / 档位 / 时钟 / 车道图             */
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
		this.drawLaneMap(ctx, state, p);

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
		const cy = (FOOT_BOX.y + FOOT_BOX.h) / 2;
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

	/** 车道图：460×260 透视梯形三车道，当前道青色 35% 高亮（hint 箭头闪烁是 7c） */
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
		const laneCenterFrac = ((lane * 2 + 1) / 3) - 1;
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
		roundRectPath(ctx, pad, pad, this.glowCanvas.width - pad * 2, this.glowCanvas.height - pad * 2, 60);
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
}
