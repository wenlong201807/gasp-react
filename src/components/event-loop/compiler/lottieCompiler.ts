// Step[] → Lottie JSON 编译器（纯函数）
// 视觉主体：区块飞行（实体跨步骤复用同一 layer）+ 区域发光 + 阶段条
import type { ActiveRegion, CompiledAnimation, Phase, Preset, Step } from '../types';
import {
	apiSlot,
	BLOCK,
	COLOR,
	FPS,
	FRAMES_PER_STEP,
	hexToRgb01,
	queueSlot,
	REGION,
	stackSlot,
	STAGE,
} from './layout.ts';
import type { Keyframe, LottieLayer, Prop } from './shapeBuilders.ts';
import { barLayer, blockLayer, propFrom, regionGlowLayer, staticProp } from './shapeBuilders.ts';

type ItemRegion = 'stack' | 'webapis' | 'macro' | 'micro';
type GlowKey = Exclude<ActiveRegion, 'render'>;

interface Appearance {
	step: number;
	region: ItemRegion;
	slot: number;
}

const GLOW_REGIONS: { key: GlowKey; color: string }[] = [
	{ key: 'code', color: COLOR.text },
	{ key: 'stack', color: COLOR.stack },
	{ key: 'webapis', color: COLOR.webapis },
	{ key: 'macro', color: COLOR.macro },
	{ key: 'micro', color: COLOR.micro },
	{ key: 'console', color: COLOR.text },
];

const PHASES: { key: Phase; color: string }[] = [
	{ key: 'task', color: COLOR.macro },
	{ key: 'microtask', color: COLOR.micro },
	{ key: 'render', color: COLOR.render },
];

function collectEntities(steps: Step[]): Map<string, Appearance[]> {
	const map = new Map<string, Appearance[]>();
	const push = (id: string, app: Appearance) => {
		const list = map.get(id) ?? [];
		list.push(app);
		map.set(id, list);
	};
	steps.forEach((st, si) => {
		st.stack.forEach((frame, i) => push(frame.id, { step: si, region: 'stack', slot: i }));
		st.webApis.forEach((entry, i) => push(entry.id, { step: si, region: 'webapis', slot: i }));
		st.macroQueue.forEach((item, i) => push(item.id, { step: si, region: 'macro', slot: i }));
		st.microQueue.forEach((item, i) => push(item.id, { step: si, region: 'micro', slot: i }));
	});
	return map;
}

function slotPos(region: ItemRegion, slot: number): [number, number] {
	if (region === 'stack') return stackSlot(slot);
	if (region === 'webapis') return apiSlot(slot);
	return queueSlot(region, slot);
}

function regionColor(region: ItemRegion): [number, number, number] {
	const hex =
		region === 'stack'
			? COLOR.stack
			: region === 'webapis'
				? COLOR.webapis
				: region === 'macro'
					? COLOR.macro
					: COLOR.micro;
	return hexToRgb01(hex);
}

function entityLayer(ind: number, id: string, apps: Appearance[], steps: Step[]): LottieLayer {
	const first = apps[0].step;
	const last = apps[apps.length - 1].step;
	const ip = first * FRAMES_PER_STEP;
	const goneAt = last + 1 < steps.length ? last + 1 : -1;
	const op = goneAt === -1 ? steps.length * FRAMES_PER_STEP : goneAt * FRAMES_PER_STEP + 14;

	const posKeys: Keyframe[] = [];
	const colKeys: Keyframe[] = [];
	const opaKeys: Keyframe[] = [];
	let prev: Appearance | null = null;
	for (const app of apps) {
		const f = app.step * FRAMES_PER_STEP;
		const p = slotPos(app.region, app.slot);
		if (!prev) {
			posKeys.push({ t: f, s: [p[0], p[1], 0] });
			colKeys.push({ t: f, s: [...regionColor(app.region), 1] });
		} else if (prev.region !== app.region || prev.slot !== app.slot) {
			const from = slotPos(prev.region, prev.slot);
			posKeys.push({ t: f, s: [from[0], from[1], 0] });
			posKeys.push({ t: f + 14, s: [p[0], p[1], 0] });
			colKeys.push({ t: f, s: [...regionColor(prev.region), 1] });
			colKeys.push({ t: f + 14, s: [...regionColor(app.region), 1] });
		}
		prev = app;
	}
	if (first > 0) {
		opaKeys.push({ t: ip, s: [0] }, { t: ip + 12, s: [100] });
	}
	if (goneAt !== -1) {
		opaKeys.push(
			{ t: goneAt * FRAMES_PER_STEP, s: [100] },
			{ t: goneAt * FRAMES_PER_STEP + 12, s: [0] }
		);
	}
	const sclKeys: Keyframe[] =
		first > 0 ? [{ t: ip, s: [55, 55] }, { t: ip + 12, s: [100, 100] }] : [{ t: ip, s: [100, 100] }];

	const opacity: Prop = opaKeys.length > 0 ? propFrom(opaKeys) : staticProp([100]);

	return blockLayer({
		ind,
		name: id,
		size: [BLOCK.w, BLOCK.h],
		fillColor: propFrom(colKeys),
		strokeColor: propFrom(colKeys),
		position: propFrom(posKeys),
		opacity,
		scale: propFrom(sclKeys),
		ip,
		op,
	});
}

function glowOpacityKeys(steps: Step[], key: ActiveRegion): Keyframe[] {
	const keys: Keyframe[] = [];
	steps.forEach((st, i) => {
		const f = i * FRAMES_PER_STEP;
		if (st.active.includes(key)) {
			keys.push({ t: f, s: [45] }, { t: f + 15, s: [85] });
		} else {
			keys.push({ t: f, s: [0] });
		}
	});
	return keys;
}

function phaseRect(i: number) {
	const pad = 8;
	const gap = 8;
	const w = (REGION.phase.w - pad * 2 - gap * 2) / 3;
	return { x: REGION.phase.x + pad + i * (w + gap), y: REGION.phase.y + 10, w, h: REGION.phase.h - 20 };
}

export function compilePreset(preset: Preset): CompiledAnimation {
	const steps = preset.trace;
	const totalFrames = steps.length * FRAMES_PER_STEP;
	const entities = collectEntities(steps);
	const layers: LottieLayer[] = [];
	let ind = 0;

	for (const [id, apps] of entities) {
		layers.push(entityLayer(++ind, id, apps, steps));
	}
	for (const g of GLOW_REGIONS) {
		layers.push(
			regionGlowLayer({
				ind: ++ind,
				name: `glow-${g.key}`,
				rect: REGION[g.key],
				color: hexToRgb01(g.color),
				opacity: propFrom(glowOpacityKeys(steps, g.key)),
				op: totalFrames,
			})
		);
	}
	PHASES.forEach((ph, i) => {
		layers.push(
			barLayer({
				ind: ++ind,
				name: `phase-${ph.key}`,
				rect: phaseRect(i),
				color: hexToRgb01(ph.color),
				fillOpacity: propFrom(
					steps.map((st, si) => ({
						t: si * FRAMES_PER_STEP,
						s: [st.phase === ph.key ? 85 : 22],
					}))
				),
				op: totalFrames,
			})
		);
	});

	const lottieJson = {
		v: '5.9.0',
		fr: FPS,
		ip: 0,
		op: totalFrames,
		w: STAGE.w,
		h: STAGE.h,
		nm: `event-loop-${preset.id}`,
		ddd: 0,
		assets: [],
		layers,
		markers: steps.map((st, i) => ({
			tm: i * FRAMES_PER_STEP,
			cm: `s${i} ${st.title.slice(0, 16)}`,
			dr: 1,
		})),
	};
	const frameMap = steps.map((_, i) => i * FRAMES_PER_STEP);
	return { lottieJson, frameMap, totalFrames };
}

export function validateCompilation(compiled: CompiledAnimation, preset: Preset): string[] {
	const errors: string[] = [];
	const steps = preset.trace;
	if (compiled.frameMap.length !== steps.length) {
		errors.push(`frameMap 长度 ${compiled.frameMap.length} ≠ 步数 ${steps.length}`);
	}
	steps.forEach((_, i) => {
		if (compiled.frameMap[i] !== i * FRAMES_PER_STEP) {
			errors.push(`frameMap[${i}] 应为 ${i * FRAMES_PER_STEP}`);
		}
	});
	if (compiled.totalFrames !== steps.length * FRAMES_PER_STEP) {
		errors.push('totalFrames 与步数不符');
	}
	const json = compiled.lottieJson as { layers?: unknown[] };
	const expected = collectEntities(steps).size + GLOW_REGIONS.length + PHASES.length;
	if (json.layers?.length !== expected) {
		errors.push(`layer 数 ${json.layers?.length} ≠ 预期 ${expected}`);
	}
	return errors;
}
