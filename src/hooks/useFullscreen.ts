import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface FullscreenApi {
	/** 当前是否处于全屏（唯一事实源：document.fullscreenElement 与目标元素比对） */
	isFullscreen: boolean;
	/** 当前环境是否支持标准 Fullscreen API（不支持时入口不渲染） */
	supported: boolean;
	/** 进入全屏；无手势/被拒绝时静默维持原状，不抛错、不进入伪全屏 */
	request: () => void;
	/** 退出全屏 */
	exit: () => void;
	/** 按当前状态切换 */
	toggle: () => void;
}

/**
 * 全屏 hook（收敛自 event-loop 与 url-lifecycle 两页各自的实现）。
 *
 * 语义取舍（与旧实现的差异，均有注释锚点）：
 * - 目标元素：旧实现各自全屏页内 `.experience` 容器（元素级）；统一入口在全局
 *   title 栏，全屏语义升级为「整个应用全屏」，默认 documentElement。沉浸感由
 *   App 层在全屏态隐藏 title 栏与 dock 菜单实现，而非元素级全屏只保留舞台。
 *   保留可选 targetRef 参数，未来需要元素级全屏时无需改 hook。
 * - 降级：旧实现拒绝/无 API 时切换「页面内沉浸模式」（CSS 伪全屏）；统一后
 *   完全沉浸方案下不再保留伪全屏——请求失败时 UI 静默维持原状，
 *   isFullscreen 仅由 fullscreenchange 事件驱动，不造假状态。
 * - vendor 前缀：与旧实现一致，仅走标准 API + 特性检测，不做 webkit/moz 分支。
 */
export function useFullscreen(targetRef?: RefObject<Element | null>): FullscreenApi {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const documentElementRef = useRef<Element | null>(null);

	const resolveTarget = useCallback((): Element | null => {
		if (targetRef) return targetRef.current;
		if (documentElementRef.current === null && typeof document !== 'undefined') {
			documentElementRef.current = document.documentElement;
		}
		return documentElementRef.current;
	}, [targetRef]);

	const supported =
		typeof document !== 'undefined' &&
		typeof document.documentElement?.requestFullscreen === 'function';

	useEffect(() => {
		// fullscreenchange 同步：与旧实现一致，以 document.fullscreenElement 为准，
		// 进入/退出全屏（含 Esc 原生退出）都会经此把状态拉回真实值。
		const sync = () => {
			const active =
				document.fullscreenElement !== null && document.fullscreenElement === resolveTarget();
			setIsFullscreen(active);
		};
		sync();
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	}, [resolveTarget]);

	const request = useCallback(() => {
		const target = resolveTarget();
		if (!target || typeof target.requestFullscreen !== 'function') return;
		// 无用户手势/权限被拒时 promise reject：吞掉，UI 维持原状（静默降级）。
		target.requestFullscreen().catch(() => {});
	}, [resolveTarget]);

	const exit = useCallback(() => {
		if (document.fullscreenElement === null) return;
		document.exitFullscreen().catch(() => {});
	}, []);

	const toggle = useCallback(() => {
		if (isFullscreen) {
			exit();
		} else {
			request();
		}
	}, [isFullscreen, exit, request]);

	return { isFullscreen, supported, request, exit, toggle };
}
