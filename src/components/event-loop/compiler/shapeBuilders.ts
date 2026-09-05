// Lottie shape layer 构造器（纯数据工厂，无副作用）
import type { Rect } from './layout';

export type LottieLayer = Record<string, unknown>;
export type Prop = Record<string, unknown>;

export interface Keyframe {
	t: number;
	s: number[];
}

const EASE_IN_OUT = { ix: 0.4, iy: 1, ox: 0.6, oy: 0 };

export const staticProp = (k: number[]): Prop => ({ a: 0, k });

/** 多关键帧属性；仅 1 个关键帧时退化为静态属性（lottie 对单关键帧的 a:1 支持不稳定） */
export function propFrom(keys: Keyframe[]): Prop {
	if (keys.length <= 1) return staticProp(keys[0]?.s ?? [0]);
	return {
		a: 1,
		k: keys.map((key, i) => ({
			t: key.t,
			s: key.s,
			...(i < keys.length - 1
				? {
						i: { x: [EASE_IN_OUT.ix], y: [EASE_IN_OUT.iy] },
						o: { x: [EASE_IN_OUT.ox], y: [EASE_IN_OUT.oy] },
					}
				: {}),
		})),
	};
}

interface BlockLayerInput {
	ind: number;
	name: string;
	size: [number, number];
	fillColor: Prop;
	strokeColor: Prop;
	position: Prop;
	opacity: Prop;
	scale: Prop;
	ip: number;
	op: number;
}

/** 圆角块：半透明底色 + 实线描边（栈帧/队列项/回调实体） */
export function blockLayer(input: BlockLayerInput): LottieLayer {
	return {
		ddd: 0,
		ind: input.ind,
		ty: 4,
		nm: input.name,
		sr: 1,
		ks: {
			o: input.opacity,
			r: staticProp([0]),
			p: input.position,
			a: staticProp([0, 0, 0]),
			s: input.scale,
		},
		ao: 0,
		shapes: [
			{
				ty: 'gr',
				nm: `${input.name}-grp`,
				it: [
					{
						ty: 'rc',
						d: 1,
						s: staticProp([input.size[0], input.size[1]]),
						p: staticProp([0, 0]),
						r: staticProp([10]),
					},
					{ ty: 'fl', c: input.fillColor, o: staticProp([20]) },
					{
						ty: 'st',
						c: input.strokeColor,
						o: staticProp([100]),
						w: staticProp([2]),
						lc: 2,
						lj: 2,
					},
					{
						ty: 'tr',
						p: staticProp([0, 0]),
						a: staticProp([0, 0]),
						s: staticProp([100, 100]),
						r: staticProp([0]),
						o: staticProp([100]),
					},
				],
			},
		],
		ip: input.ip,
		op: input.op,
		st: 0,
		bm: 0,
	};
}

/** 区域发光框：圆角矩形 + 双层描边（外层粗柔光 + 内层实线），透明度由关键帧驱动 */
export function regionGlowLayer(input: {
	ind: number;
	name: string;
	rect: Rect;
	color: [number, number, number];
	opacity: Prop;
	op: number;
}): LottieLayer {
	const { rect } = input;
	return {
		ddd: 0,
		ind: input.ind,
		ty: 4,
		nm: input.name,
		sr: 1,
		ks: {
			o: staticProp([100]),
			r: staticProp([0]),
			p: staticProp([rect.x + rect.w / 2, rect.y + rect.h / 2]),
			a: staticProp([0, 0, 0]),
			s: staticProp([100, 100]),
		},
		ao: 0,
		shapes: [
			{
				ty: 'gr',
				nm: `${input.name}-grp`,
				it: [
					{
						ty: 'rc',
						d: 1,
						s: staticProp([rect.w - 8, rect.h - 8]),
						p: staticProp([0, 0]),
						r: staticProp([12]),
					},
					{
						ty: 'st',
						c: staticProp([...input.color, 1]),
						o: input.opacity,
						w: staticProp([9]),
						lc: 2,
						lj: 2,
					},
					{
						ty: 'st',
						c: staticProp([...input.color, 1]),
						o: input.opacity,
						w: staticProp([2.5]),
						lc: 2,
						lj: 2,
					},
					{
						ty: 'tr',
						p: staticProp([0, 0]),
						a: staticProp([0, 0]),
						s: staticProp([100, 100]),
						r: staticProp([0]),
						o: staticProp([100]),
					},
				],
			},
		],
		ip: 0,
		op: input.op,
		st: 0,
		bm: 0,
	};
}

/** 实心条（阶段条分段），填充透明度由关键帧驱动 */
export function barLayer(input: {
	ind: number;
	name: string;
	rect: Rect;
	color: [number, number, number];
	fillOpacity: Prop;
	op: number;
}): LottieLayer {
	const { rect } = input;
	return {
		ddd: 0,
		ind: input.ind,
		ty: 4,
		nm: input.name,
		sr: 1,
		ks: {
			o: staticProp([100]),
			r: staticProp([0]),
			p: staticProp([rect.x + rect.w / 2, rect.y + rect.h / 2]),
			a: staticProp([0, 0, 0]),
			s: staticProp([100, 100]),
		},
		ao: 0,
		shapes: [
			{
				ty: 'gr',
				nm: `${input.name}-grp`,
				it: [
					{
						ty: 'rc',
						d: 1,
						s: staticProp([rect.w, rect.h]),
						p: staticProp([0, 0]),
						r: staticProp([6]),
					},
					{ ty: 'fl', c: staticProp([...input.color, 1]), o: input.fillOpacity },
					{
						ty: 'tr',
						p: staticProp([0, 0]),
						a: staticProp([0, 0]),
						s: staticProp([100, 100]),
						r: staticProp([0]),
						o: staticProp([100]),
					},
				],
			},
		],
		ip: 0,
		op: input.op,
		st: 0,
		bm: 0,
	};
}
