export type AnimationId = 'scroll' | 'lottie' | 'fiber-todo' | 'event-loop' | 'url-lifecycle';

export interface MenuEntry {
	id: AnimationId;
	name: string;
	icon: string;
	desc: string;
	meta: string;
}

export const MENU_ENTRIES: readonly MenuEntry[] = [
	{
		id: 'scroll',
		name: 'Scroll Animation',
		icon: '📜',
		desc: '滚动触发的动画效果',
		meta: 'ScrollTrigger',
	},
	// {
	// 	id: 'lottie',
	// 	name: 'Lottie Animation',
	// 	icon: '🎨',
	// 	desc: 'Lottie JSON 动画',
	// 	meta: 'lottie-react',
	// },
	{
		id: 'fiber-todo',
		name: 'Fiber Todo',
		icon: '🧬',
		desc: 'React Fiber 增删改查 · 真实 DOM 动画 · 全链路性能',
		meta: 'Fiber + Flip',
	},
	{
		id: 'event-loop',
		name: 'Event Loop',
		icon: '🔄',
		desc: '三预设 · Lottie 事件循环可视化 · 全链路高亮',
		meta: 'Lottie 编排',
	},
	{
		id: 'url-lifecycle',
		name: 'URL Lifecycle',
		icon: '🌐',
		desc: '两幕 34 步 · 从输入 URL 到上屏 · 缓存/DNS/TLS/渲染管线',
		meta: 'DNS · TLS · 渲染',
	},
];
