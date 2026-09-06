import styles from './menu.module.css';

export interface MenuEntry {
	id: string;
	name: string;
	icon: string;
	tag: string;
	desc: string;
	meta: string;
}

export const MENU_ENTRIES: readonly MenuEntry[] = [
	{
		id: 'scroll',
		name: 'Scroll Animation',
		icon: '📜',
		tag: 'CSS3',
		desc: '滚动触发的动画效果',
		meta: 'scroll · CSS',
	},
	{
		id: 'lottie',
		name: 'Lottie Animation',
		icon: '🎨',
		tag: 'Lottie',
		desc: 'Lottie JSON 动画',
		meta: 'lottie-react',
	},
	{
		id: 'fiber-todo',
		name: 'Fiber Todo',
		icon: '🧬',
		tag: 'React',
		desc: 'React Fiber 增删改查 · 真实 DOM 动画 · 全链路性能',
		meta: 'fiber · real DOM',
	},
	{
		id: 'event-loop',
		name: 'Event Loop',
		icon: '🔄',
		tag: 'Browser',
		desc: '三预设 · Lottie 事件循环可视化 · 全链路高亮',
		meta: 'lottie · 3 presets',
	},
	{
		id: 'url-lifecycle',
		name: 'URL Lifecycle',
		icon: '🌐',
		tag: 'Network',
		desc: '两幕 34 步 · 从输入 URL 到上屏 · 缓存/DNS/TLS/渲染管线',
		meta: 'gsap · 2 scenarios',
	},
];

interface MenuPageProps {
	onSelect: (id: string) => void;
}

export function MenuPage({ onSelect }: MenuPageProps) {
	return (
		<div className={styles.menuPage}>
			<div className={styles.menuInner}>
				<header className={styles.menuHeader}>
					<span className={styles.menuEyebrow}>GSAP · LOTTIE · CSS</span>
					<h1 className={styles.menuTitle}>GSAP-React 动画展示</h1>
					<p className={styles.menuSubtitle}>
						高性能动画与全链路可视化 · 统一深色科技风 · 接入 Web Vitals / FPS / 内存监控
					</p>
				</header>

				<div className={styles.menuGrid}>
					{MENU_ENTRIES.map((entry) => (
						<button
							key={entry.id}
							type="button"
							className={styles.menuCard}
							onClick={() => onSelect(entry.id)}
						>
							<div className={styles.menuCardHead}>
								<span className={styles.menuCardIcon}>{entry.icon}</span>
								<span className={styles.menuCardTag}>{entry.tag}</span>
							</div>
							<h2 className={styles.menuCardTitle}>{entry.name}</h2>
							<p className={styles.menuCardDesc}>{entry.desc}</p>
							<span className={styles.menuCardMeta}>{entry.meta}</span>
						</button>
					))}
				</div>

				<footer className={styles.menuFooter}>
					所有动画均接入 Web Vitals · FPS · 内存 · 网络监控
					<br />
					遵循 P10 性能优等标准 · LCP ≤ 2.5s · CLS ≤ 0.1 · FPS ≥ 60
				</footer>
			</div>
		</div>
	);
}
