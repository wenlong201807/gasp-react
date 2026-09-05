// 舞台与区域布局常量 —— Lottie 编译器与 DOM 叠加层共用同一坐标源
import type { CSSProperties } from 'react';

export const STAGE = { w: 1200, h: 800 } as const;
export const FPS = 60;
export const FRAMES_PER_STEP = 30;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const BLOCK = { w: 160, h: 44 } as const;

export const REGION = {
	phase: { x: 40, y: 24, w: 1120, h: 48 },
	code: { x: 40, y: 96, w: 336, h: 428 },
	stack: { x: 408, y: 96, w: 240, h: 428 },
	webapis: { x: 688, y: 96, w: 472, h: 428 },
	console: { x: 40, y: 548, w: 336, h: 116 },
	macro: { x: 408, y: 548, w: 372, h: 116 },
	micro: { x: 808, y: 548, w: 352, h: 116 },
	narration: { x: 40, y: 688, w: 1120, h: 44 },
} as const satisfies Record<string, Rect>;

export type RegionKey = keyof typeof REGION;

export const COLOR = {
	bg: '#0d1117',
	macro: '#58a6ff',
	micro: '#bc8cff',
	stack: '#3fb950',
	webapis: '#d29922',
	render: '#ff7b72',
	text: '#e6edf3',
	dim: '#30363d',
} as const;

export function hexToRgb01(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 调用栈第 i 层（0=最底）的块中心坐标 */
export function stackSlot(i: number): [number, number] {
	const r = REGION.stack;
	return [
		r.x + (r.w - BLOCK.w) / 2 + BLOCK.w / 2,
		r.y + r.h - 16 - (i + 0.5) * (BLOCK.h + 8),
	];
}

/** 宏/微任务队列第 i 项（从左到右）的块中心坐标 */
export function queueSlot(kind: 'macro' | 'micro', i: number): [number, number] {
	const r = kind === 'macro' ? REGION.macro : REGION.micro;
	return [r.x + 16 + BLOCK.w / 2 + i * (BLOCK.w + 8), r.y + r.h / 2];
}

/** Web APIs 第 i 项（从左到右）的块中心坐标 */
export function apiSlot(i: number): [number, number] {
	const r = REGION.webapis;
	return [r.x + 16 + BLOCK.w / 2 + i * (BLOCK.w + 12), r.y + 24 + BLOCK.h / 2];
}

/** DOM 内联盒样式（面板定位用） */
export function box(rect: Rect): CSSProperties {
	return { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
}
