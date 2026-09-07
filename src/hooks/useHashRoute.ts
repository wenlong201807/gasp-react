import { useEffect, useState } from 'react';
import type { AnimationId } from '@/components/menu/menu-entries';
import { MENU_ENTRIES } from '@/components/menu/menu-entries';

/** 默认路由：hash 为空或未知 id 时落到智驾页 */
export const DEFAULT_ROUTE: AnimationId = 'three-car-nav';

const KNOWN_IDS = new Set<string>(MENU_ENTRIES.map((entry) => entry.id));

/** 解析 `#/<animationId>`：空 / 未知 id → DEFAULT_ROUTE */
export function parseHashRoute(hash: string): AnimationId {
	const id = hash.replace(/^#\/?/, '');
	return KNOWN_IDS.has(id) ? (id as AnimationId) : DEFAULT_ROUTE;
}

/** 切换路由：写 location.hash（同值赋值不触发 hashchange，不产生历史记录） */
export function navigate(id: AnimationId): void {
	window.location.hash = `#/${id}`;
}

/** 无效 hash 归一为 `#/three-car-nav`（replaceState 不追加历史记录，保证 back 语义干净） */
function normalizeHash(): void {
	const raw = window.location.hash.replace(/^#\/?/, '');
	if (!KNOWN_IDS.has(raw)) {
		history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
	}
}

/**
 * hash 路由：dock 点击（navigate 写 hash）/ 前进后退 / 直链刷新 三种入口
 * 统一经 hashchange 汇聚到同一解析函数，行为天然一致。
 */
export function useHashRoute(): AnimationId {
	const [route, setRoute] = useState<AnimationId>(() => parseHashRoute(window.location.hash));

	useEffect(() => {
		const onHashChange = () => {
			normalizeHash();
			setRoute(parseHashRoute(window.location.hash));
		};
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);

	// 首次加载（含直链 #/unknown-id）：URL 归一，不追加历史记录
	useEffect(() => {
		normalizeHash();
	}, []);

	return route;
}
