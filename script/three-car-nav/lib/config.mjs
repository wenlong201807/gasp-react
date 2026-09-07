/**
 * three-car-nav Playwright 套件 · 公共常量
 *
 * 坐标系约定：
 * - 「屏幕坐标」= 2400×1500 视口下 canvas 像素坐标（devicePixelRatio=1，与截图一一对应）。
 * - 「HUD 纹理坐标」= HudSystem 离屏 canvas 的 2048×1024 坐标系（源码锁定布局，y 向下）。
 *   chase 相机 pos(0,3.2,8.5)→lookAt(0,1.2,-6)、fov 60，HUD 面板 4.6×2.3m @ (0,3.9,0.2)：
 *   实测映射 ≈ 0.3589 屏幕像素 / HUD 像素，纹理 (1024,540) → 屏幕 (1200, 468)。
 *   面板随车速上下浮动 ±0.05m（≈±8px），故所有带断言均预留 ≥±6px 余量。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const APP_URL = 'http://localhost:5173';
export const DEV_SERVER_PORT = 5173;

/** TC-14 生产服（vite preview，服务 dist 产物；用例内起停自理） */
export const PREVIEW_SERVER_PORT = 4173;
export const PREVIEW_URL = `http://localhost:${PREVIEW_SERVER_PORT}`;

/**
 * 生产构建的环境变量覆盖：仓库 .env 钉了 NODE_ENV=development 且 vite 构建会读取它，
 * 默认 pnpm build 产出 dev 模式 bundle（import.meta.env.PROD=false → SW 注册代码被 DCE）。
 * TC-14 需要真正的生产产物时必须以该覆盖构建。
 */
export const PROD_BUILD_ENV = { ...process.env, NODE_ENV: 'production' };

export { REPO_ROOT };

/** CDN 域名（CarSystem.CDN_BASE 的 host）：TC-03 route-abort 目标 */
export const CDN_HOST = 'z2586300277.github.io';
export const CDN_GLOB = '**/z2586300277.github.io/**';

export const VIEWPORT = { width: 2400, height: 1500 };

/** modelStatus 就绪预算（Task 5 Step 2：15s 超时降级，验收预算 20s） */
export const MODEL_STATUS_BUDGET_S = 20;

/** 菜单交互（历轮验收使用的选择器） */
export const MENU = {
	expand: 'button[aria-label="展开菜单"]',
	expandAlt: 'button[aria-label="动画视图切换"]',
	entry: 'button:has-text("Three Car Nav")',
	entryName: 'Three Car Nav',
	/** TC-13：dock 上切换到 scroll 页的菜单项 */
	entryScroll: 'button:has-text("Scroll Animation")',
	/** scroll 页独有标记（h1 标题） */
	scrollMarker: 'h1:has-text("GSAP React")',
};

/** TC-15 全屏入口选择器（Layout title 栏按钮 / 沉浸态退出控件 / 旧入口特征） */
export const FULLSCREEN = {
	/** title 栏（logo 旁）进入全屏按钮的 aria-label */
	enter: 'button[aria-label="进入全屏"]',
	/** 沉浸态角落退出控件的 aria-label */
	exit: 'button[aria-label="退出全屏"]',
	/** title 栏 logo 文本（沉浸态应不可见；exact 防与 scroll 页 h1「GSAP React」混淆） */
	logo: 'GSAP-React',
	/** 旧全屏按钮特征（两页控制条，收敛后必须缺席） */
	legacyIcon: '⛶',
	legacyName: '⛶ 全屏',
};

/** TC-10 控制面板选择器（HudControlPanel 的 aria-label 与按钮文本） */
export const PANEL = {
	root: '[aria-label="智驾控制台"]',
	speedSlider: 'input[aria-label="巡航速度"]',
	pause: 'button:has-text("暂停")',
	resume: 'button:has-text("恢复")',
	/** 快捷键按钮（精确文本 30/60/90，text-is 防子串误配） */
	quick: (kmh) => `button:text-is("${kmh}")`,
	/** 视角/日夜按钮（精确文本：追尾/驾驶位/侧方 · 黄昏/白天/夜晚） */
	opt: (label) => `button:text-is("${label}")`,
	/** 页内批量读速度控件 disabled 态：slider + 3 个快捷键（gear P 断言用） */
	disabledProbe: `(() => {
		const root = document.querySelector('[aria-label="智驾控制台"]');
		const slider = root ? root.querySelector('input') : null;
		const presets = root
			? [...root.querySelectorAll('button')].filter((b) => /^\\d+$/.test((b.textContent || '').trim()))
			: [];
		return { slider: slider ? slider.disabled : null, presets: presets.map((b) => b.disabled) };
	})()`,
};

/* ------------------------------------------------------------------ */
/* HUD 纹理坐标（与 engine/HudSystem.ts 锁定常量一一对应）              */
/* ------------------------------------------------------------------ */

export const HUD_TEX = {
	w: 2048,
	h: 1024,
	speedBox: { x: 60, y: 180, w: 500, h: 640 },
	speedCenterX: 310,
	speedBaselineY: 560,
	holeCenter: { x: 1024, y: 540 },
	holeRadius: 330,
	navBox: { x: 1400, y: 180, w: 588, h: 300 },
	laneTrap: { x: 1513, yTop: 620, yBottom: 840, wBottom: 460, wTop: 200 },
	footBox: { x: 60, y: 880, w: 1928, h: 100 },
	footCenterY: 930,
	radarRings: [90, 180, 270, 320],
	radarRMax: 320,
	radarRangeX: 25,
	radarRangeZ: 60,
};

/** 屏幕映射：screen = texToScreen(tex) */
export const HUD_MAP = {
	/** 屏幕像素 / HUD 纹理像素（= 面板投影宽 735px / 2048） */
	scale: 0.3589,
	/** HUD 纹理 x=1024 → 屏幕 x */
	centerX: 1200,
	/** HUD 纹理 y=0 → 屏幕 y（由洞心实测反推：468 − 540×0.3589 ≈ 274） */
	topY: 274,
};

export function texToScreen(tx, ty) {
	return {
		x: HUD_MAP.centerX + (tx - HUD_TEX.w / 2) * HUD_MAP.scale,
		y: HUD_MAP.topY + ty * HUD_MAP.scale,
	};
}

/** HUD 纹理坐标带 → 屏幕 px 带（四边外扩 BAND_PAD，吃掉面板随车速的 ±8px 浮动） */
export function bandToScreen(band, pad = BAND_PAD) {
	const a = texToScreen(band.x0, band.y0);
	const b = texToScreen(band.x1, band.y1);
	return { x0: Math.round(a.x - pad), y0: Math.round(a.y - pad), x1: Math.round(b.x + pad), y1: Math.round(b.y + pad), thr: band.thr };
}

/** 带断言在屏幕坐标下外扩余量（吃掉面板浮动 ±8px 与映射误差） */
export const BAND_PAD = 10;

/**
 * 六块 HUD 的判定带（纹理坐标定义 → 屏幕坐标消费）。
 * 每条带说明见 cases.md TC-06。
 */
export const HUD_BANDS = {
	// ① 时速数字（bold 220px，基线 y=560，居中 x=310）
	speedDigits: { x0: 170, y0: 385, x1: 460, y1: 575, thr: 0.6 },
	// ③ 路名（bold 64px，基线 y=316）与导航行（52px，基线 y=404）
	navRoadName: { x0: 1420, y0: 262, x1: 1900, y1: 332, thr: 0.6 },
	navLine: { x0: 1420, y0: 356, x1: 1985, y1: 418, thr: 0.6 },
	// ④ 车道图透视梯形（当前道 accent 35% 高亮）
	laneTrap: { x0: 1513, y0: 618, x1: 1973, y1: 842, thr: 0.0 },
	// ⑤ footer 行（FOOT_CENTER_Y=930）与回归带（4291273：footer 误画在 (y+h)/2=490）
	footerLeft: { x0: 130, y0: 898, x1: 570, y1: 962, thr: 0.5 },
	footerRight: { x0: 1620, y0: 898, x1: 1985, y1: 962, thr: 0.5 },
	midRightRegress: { x0: 1620, y0: 458, x1: 1985, y1: 522, thr: 0.5 },
	// ⑥ 雷达：环拟合用的环形带（外圈装饰环 accent 0.9 亮度足够）
	radarRingFit: { r0: 105, r1: 125, thr: 0.5 },
};

/** ⑤ 判定阈值（历轮实测：footer 带 ~0.06-0.10，回归带 <0.02） */
export const HUD_THRESHOLDS = {
	footerMinRatio: 0.02,
	midMaxRatio: 0.03,
	midToFooterFactor: 3,
	speedDigitsMinRatio: 0.02,
	navMinRatio: 0.02,
	laneAccentMinRatio: 0.04,
};

/* ------------------------------------------------------------------ */
/* 主车区域（chase 视图屏幕坐标；历轮同视口实测）                       */
/* ------------------------------------------------------------------ */

export const CAR = {
	/** 轮搜索窗（先在窗内找暗色轮胎簇，再取精确 bbox） */
	wheelSearch: {
		rear: { x0: 950, y0: 940, x1: 1130, y1: 1090 },
		front: { x0: 1330, y0: 940, x1: 1510, y1: 1090 },
	},
	/** 轮胎暗色判定阈值（轮胎 lum≈0.06-0.15，路面 lum≈0.42，车身青 lum≈0.6） */
	tireLum: 0.28,
	/** 紧凑轮区半径：以搜索窗内暗色质心为中心的正方形半边长 */
	wheelHalf: 34,
	/** 轮拱内有轮：紧凑轮区暗色（轮胎）占比下限 */
	tireMinRatio: 0.15,
	/** 轮 Blob 质心允许偏离区域中心的距离（px） */
	tireCentroidMaxOffset: 20,
	/** 无漂浮部件：轮 Blob 质心三帧漂移上限（px） */
	wheelDriftMaxPx: 5,
	/** 无漂浮部件：整车包络内 暗色/车漆 像素数三帧波动上限（相对） */
	envelopeStability: 0.03,
	/** 车身控制区（青色门板，静帧）与路面控制区（treadmill 移动） */
	bodyControl: { x0: 1190, y0: 915, x1: 1330, y1: 985 },
	roadControl: { x0: 900, y0: 1180, x1: 1100, y1: 1260 },
	/** 整车包络（含车顶到地面阴影）：漂浮部件会改变其中的暗色/车漆像素数 */
	envelope: { x0: 880, y0: 820, x1: 1520, y1: 1090 },
	/** HUD 360° 视口（洞）屏占 */
	hole: { cx: 1200, cy: 468, r: 118 },
	/**
	 * 360° 侧视检测：洞内水平条带中「车身连通宽度」的最大值（carBody 预测）。
	 * 侧视时车身占满条带；自转 0.35rad/s → 侧视每 ~8.97s 出现一次（半圈）。
	 * 洞为半透明、背后街景持续滚动，亮度类指标被污染，故用车身色（b-r≥35 且不亮）连通宽度。
	 */
	sideStrip: { padX: 0.8, halfH: 12 },
	sideMetric: { pred: 'carBody', minGap: 6 },
	sideMinWidthFrac: 0.88,
	/** 侧视扫描：帧数 × 间隔（30×800ms ≈ 24s ≥ 2.7 个半圈） */
	sideScan: { frames: 30, gapMs: 800 },
};

/** 辐条旋转可见（2d64a41 回归项）判定阈值（历轮实测见 cases.md） */
export const SPOKE = {
	/** 轮区帧间差分（变化像素占比 |Δlum|>0.06）下限 */
	minWheelChangedRatio: 0.04,
	/** 轮区变化占比 / 车身控制区变化占比 的最小倍数（取两轮中较优者判定） */
	minChangedFactor: 3,
	/** 至少一个轮的「亮色轮辋占比」峰谷差需 ≥ 该值（辐条扫过的直接证据，辅助信号） */
	minRimOscillation: 0.03,
	/** 轮辋亮色判定阈值 */
	rimBrightThr: 0.45,
};

/** TC-05 漆面存证四区域（屏幕坐标） */
export const PAINT_CROPS = [
	{ id: 'hood-front', x0: 1330, y0: 880, x1: 1520, y1: 970, label: '车头/引擎盖（HDR 反射）' },
	{ id: 'door-side', x0: 1150, y0: 890, x1: 1340, y1: 980, label: '车侧门板（漆面主体色）' },
	{ id: 'roof-greenhouse', x0: 1080, y0: 820, x1: 1300, y1: 900, label: '车顶/玻璃House（黑色高光）' },
	{ id: 'wheel-arch', x0: 1330, y0: 960, x1: 1500, y1: 1070, label: '前轮拱/轮毂（程序化轮+辐条）' },
];

/** 雷达（⑥）判定参数 */
export const RADAR = {
	/** 环拟合环形带（相对洞心，屏幕 px） */
	ringFit: { r0: 105, r1: 125, thr: 0.5, minPixels: 40 },
	/** 目标点峰值搜索半窗（px）：吃掉面板浮动与雷达映射误差 */
	peakHalf: 14,
	/** 目标点判定：峰值亮度下限 / 需高于全部对照组的最小差值 */
	peakMinLum: 0.5,
	peakMinMargin: 0.15,
	/** 对照组角度（绕洞心旋转，落在无目标的洞内位置） */
	controlAnglesDeg: [90, 180, 270],
	/** 雷达活性：洞区域两帧差分下限（扫描扇形/目标点/车体转动任一在动） */
	liveMinDiff: 0.002,
};

/** TC-07 变道/POI 节奏（HudSystem 锁定常量） */
export const LANE = {
	hintIntervalSec: 45,
	hintDurationSec: 4,
	/** hint 展示时长允许区间（s） */
	hintDuration: { min: 3.2, max: 5.2 },
	/** hint 结束后 laneIndex 落位允许的最长等待（s）：lerp ~2.8s 收敛 97% */
	laneSettleSec: 8,
	/** POI 序列（与 HudSystem.POI_LIST 同源，仅用于 state 侧换算） */
	poi: [
		{ name: '凯恒中心', arriveM: 800 },
		{ name: '朝阳公园', arriveM: 1600 },
		{ name: '蓝色港湾', arriveM: 2400 },
	],
	poiLoopM: 2400,
	/** 整体轮询上限（s） */
	budgetSec: 100,
};

/** TC-08 拖拽参数（HudSystem：yaw -= dx*0.01，up 后自动旋转暂停 3s） */
export const DRAG = {
	/** 拖拽距离（px）→ yaw 变化 0.01*distance rad */
	distancePx: 260,
	steps: 12,
	stepDelayMs: 20,
	/** 判定「yaw 已大幅转动」：拖拽前后车身连通宽度变化下限（px） */
	minWidthDelta: 25,
	/** 相位不巧（宽度恰好对称）时的追加拖拽次数上限 */
	maxAttempts: 3,
	/** 释放后自动旋转暂停期：车身宽度最大允许摆动（px） */
	frozenMaxDeltaPx: 5,
	/** 自转恢复判定：3.2s→5.2s 间车身宽度最小变化（px） */
	resumeMinDeltaPx: 15,
};


/** 证据目录 */
export function artifactRoot() {
	return path.join(REPO_ROOT, 'artifacts', 'three-car-nav');
}
