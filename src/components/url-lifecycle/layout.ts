import type { NodeId, RenderLaneId } from './types';

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** §4.2 节点坐标表（1200×800 逻辑坐标，top-left 原点） */
export const NODE_RECT: Record<NodeId, Rect> = {
	browser: { x: 40, y: 190, w: 140, h: 110 },
	dnsCache: { x: 230, y: 170, w: 190, h: 56 },
	osCache: { x: 230, y: 238, w: 190, h: 56 },
	ldns: { x: 230, y: 306, w: 190, h: 56 },
	rootDns: { x: 230, y: 374, w: 190, h: 56 },
	cdnEdge: { x: 470, y: 190, w: 150, h: 110 },
	nginx: { x: 670, y: 190, w: 150, h: 110 },
};

/** 固定区域矩形 */
export const URL_BAR: Rect = { x: 40, y: 24, w: 1120, h: 44 };
export const DETAIL_BAR: Rect = { x: 40, y: 80, w: 1120, h: 64 };
export const TLS_ZONE: Rect = { x: 470, y: 340, w: 350, h: 84 };
export const CACHE_PANEL: Rect = { x: 870, y: 170, w: 290, h: 254 };
export const PROGRESS_BAR: Rect = { x: 40, y: 720, w: 1120, h: 24 };

/** 渲染泳道标题行 y=456，六格 x=40..990，每格 170×200 */
export const LANE_TITLE_Y = 456;

export const RENDER_LANES: readonly { id: RenderLaneId; title: string; rect: Rect }[] = [
	{ id: 'parseHtml', title: '(1) Parse HTML → DOM', rect: { x: 40, y: 490, w: 170, h: 200 } },
	{ id: 'parseCss', title: '(2) Parse CSS → CSSOM', rect: { x: 230, y: 490, w: 170, h: 200 } },
	{ id: 'renderTree', title: '(3) Render Tree', rect: { x: 420, y: 490, w: 170, h: 200 } },
	{ id: 'layout', title: '(4) Layout 几何', rect: { x: 610, y: 490, w: 170, h: 200 } },
	{ id: 'paint', title: '(5) Paint 位图', rect: { x: 800, y: 490, w: 170, h: 200 } },
	{ id: 'composite', title: '(6) Composite GPU', rect: { x: 990, y: 490, w: 170, h: 200 } },
];

/** 返回矩形对应边中点坐标，数据包位移的起终点全部由它计算，剧本零坐标 */
export function anchor(node: NodeId, side: 'left' | 'right' | 'top' | 'bottom'): { x: number; y: number } {
	const r = NODE_RECT[node];
	switch (side) {
		case 'left':
			return { x: r.x, y: r.y + r.h / 2 };
		case 'right':
			return { x: r.x + r.w, y: r.y + r.h / 2 };
		case 'top':
			return { x: r.x + r.w / 2, y: r.y };
		case 'bottom':
			return { x: r.x + r.w / 2, y: r.y + r.h };
	}
}

/** 数据包起终点的边选择：按两节点矩形相对位置取「面对面」的边 */
export function sideOf(from: NodeId, to: NodeId): 'left' | 'right' | 'top' | 'bottom' {
	const a = NODE_RECT[from];
	const b = NODE_RECT[to];
	const dx = b.x + b.w / 2 - (a.x + a.w / 2);
	const dy = b.y + b.h / 2 - (a.y + a.h / 2);
	if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
	return dy > 0 ? 'bottom' : 'top';
}
