import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@/hooks/useGSAP';
import { gsap } from '@/utils/gsap';
import styles from './menu-dock.module.css';
import type { AnimationId } from './menu-entries';
import { MENU_ENTRIES } from './menu-entries';

type DockPhase = 'collapsed' | 'expanding' | 'expanded' | 'collapsing';

const OPEN_INTENT_MS = 180;
const CLOSE_GRACE_MS = 240;
const FOCUS_SUPPRESS_MS = 200;

const prefersReducedMotion = () =>
	typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const hasCoarsePointer = () =>
	typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

interface MenuDockProps {
	currentAnimation: AnimationId;
	onSelect: (id: AnimationId) => void;
}

export function MenuDock({ currentAnimation, onSelect }: MenuDockProps) {
	const rootRef = useRef<HTMLElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const handleRef = useRef<HTMLButtonElement>(null);
	const openTimerRef = useRef<number | null>(null);
	const closeTimerRef = useRef<number | null>(null);
	const phaseRef = useRef<DockPhase>('collapsed');
	const focusSuppressUntilRef = useRef(0);
	const [phase, setPhase] = useState<DockPhase>('collapsed');

	const isOpen = phase === 'expanded' || phase === 'expanding';

	const applyPhase = (next: DockPhase) => {
		phaseRef.current = next;
		setPhase(next);
	};

	const clearTimers = () => {
		if (openTimerRef.current !== null) {
			window.clearTimeout(openTimerRef.current);
			openTimerRef.current = null;
		}
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
	};

	const { contextSafe } = useGSAP(() => {
		const panel = panelRef.current;
		if (panel) {
			gsap.set(panel, { xPercent: -100, autoAlpha: 0 });
		}
	}, []);

	const expand = contextSafe(() => {
		clearTimers();
		if (phaseRef.current === 'expanded' || phaseRef.current === 'expanding') {
			return;
		}
		const panel = panelRef.current;
		if (!panel) {
			return;
		}
		applyPhase('expanding');
		const items = listRef.current?.children;
		const reduced = prefersReducedMotion();
		gsap.killTweensOf(panel);
		gsap.to(panel, {
			xPercent: 0,
			autoAlpha: 1,
			duration: reduced ? 0.01 : 0.45,
			ease: 'power3.out',
			overwrite: true,
			onComplete: () => applyPhase('expanded'),
		});
		if (items && items.length > 0) {
			gsap.fromTo(
				items,
				{ y: 12, autoAlpha: 0 },
				{
					y: 0,
					autoAlpha: 1,
					duration: reduced ? 0.01 : 0.3,
					ease: 'power2.out',
					stagger: reduced ? 0 : 0.04,
					overwrite: true,
				}
			);
		}
	});

	const collapse = contextSafe(() => {
		clearTimers();
		if (phaseRef.current === 'collapsed' || phaseRef.current === 'collapsing') {
			return;
		}
		const panel = panelRef.current;
		if (!panel) {
			return;
		}
		applyPhase('collapsing');
		const items = listRef.current?.children;
		if (items && items.length > 0) {
			gsap.killTweensOf(items);
		}
		gsap.killTweensOf(panel);
		gsap.to(panel, {
			xPercent: -100,
			autoAlpha: 0,
			duration: prefersReducedMotion() ? 0.01 : 0.35,
			ease: 'power3.in',
			overwrite: true,
			onComplete: () => applyPhase('collapsed'),
		});
	});

	const toggle = contextSafe(() => {
		if (phaseRef.current === 'collapsed' || phaseRef.current === 'collapsing') {
			expand();
		} else {
			collapse();
		}
	});

	const select = contextSafe((id: AnimationId) => {
		onSelect(id);
		collapse();
	});

	const handlePointerEnter = () => {
		if (hasCoarsePointer()) {
			return;
		}
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
		if (phaseRef.current === 'collapsed' || phaseRef.current === 'collapsing') {
			openTimerRef.current = window.setTimeout(() => {
				openTimerRef.current = null;
				expand();
			}, OPEN_INTENT_MS);
		}
	};

	const handlePointerLeave = () => {
		if (hasCoarsePointer()) {
			return;
		}
		if (openTimerRef.current !== null) {
			window.clearTimeout(openTimerRef.current);
			openTimerRef.current = null;
		}
		if (phaseRef.current === 'collapsed') {
			return;
		}
		closeTimerRef.current = window.setTimeout(() => {
			closeTimerRef.current = null;
			collapse();
		}, CLOSE_GRACE_MS);
	};

	const collapseRef = useRef(collapse);

	useEffect(() => {
		collapseRef.current = collapse;
	});

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onDocumentPointerDown = (event: PointerEvent) => {
			const root = rootRef.current;
			if (root && event.target instanceof Node && !root.contains(event.target)) {
				collapseRef.current();
			}
		};
		document.addEventListener('pointerdown', onDocumentPointerDown);
		return () => {
			document.removeEventListener('pointerdown', onDocumentPointerDown);
		};
	}, [isOpen]);

	return (
		<nav
			ref={rootRef}
			className={styles.dock}
			data-phase={phase}
			aria-label="动画视图切换"
			onPointerEnter={handlePointerEnter}
			onPointerLeave={handlePointerLeave}
			onFocusCapture={(event) => {
				if (Date.now() < focusSuppressUntilRef.current) {
					return;
				}
				const target = event.target as HTMLElement;
				try {
					if (!target.matches(':focus-visible')) {
						return;
					}
				} catch {
					// 老浏览器不支持 :focus-visible 选择器时，按键盘聚焦处理
				}
				expand();
			}}
			onBlurCapture={(event) => {
				const next = event.relatedTarget;
				const root = rootRef.current;
				if (root && next instanceof Node && root.contains(next)) {
					return;
				}
				if (phaseRef.current === 'collapsed') {
					return;
				}
				closeTimerRef.current = window.setTimeout(() => {
					closeTimerRef.current = null;
					collapse();
				}, CLOSE_GRACE_MS);
			}}
			onKeyDown={(event) => {
				if (event.key !== 'Escape') {
					return;
				}
				if (phaseRef.current === 'collapsed' || phaseRef.current === 'collapsing') {
					return;
				}
				event.preventDefault();
				collapse();
				focusSuppressUntilRef.current = Date.now() + FOCUS_SUPPRESS_MS;
				handleRef.current?.focus();
			}}
		>
			<div ref={panelRef} id="menu-dock-panel" className={styles.panel} aria-hidden={!isOpen}>
				<header className={styles.header}>
					<h2 className={styles.title}>动画展示</h2>
					<p className={styles.subtitle}>高性能动画 · P10 性能优等标准</p>
				</header>
				<ul ref={listRef} className={styles.list}>
					{MENU_ENTRIES.map((entry) => {
						const active = currentAnimation === entry.id;
						return (
							<li key={entry.id}>
								<button
									type="button"
									className={active ? `${styles.entry} ${styles.entryActive}` : styles.entry}
									aria-current={active ? 'true' : undefined}
									onClick={() => select(entry.id)}
								>
									<span className={styles.entryIcon} aria-hidden="true">
										{entry.icon}
									</span>
									<span className={styles.entryBody}>
										<span className={styles.entryName}>{entry.name}</span>
										<span className={styles.entryDesc}>{entry.desc}</span>
									</span>
									<span className={styles.entryMeta}>{entry.meta}</span>
								</button>
							</li>
						);
					})}
				</ul>
				<footer className={styles.footer}>
					<span className={styles.badge}>FPS ≥ 60</span>
					<span className={styles.badge}>LCP ≤ 2.5s</span>
					<span className={styles.badge}>CLS ≤ 0.1</span>
				</footer>
			</div>
			<button
				ref={handleRef}
				type="button"
				className={styles.handle}
				aria-expanded={isOpen}
				aria-controls="menu-dock-panel"
				aria-label={isOpen ? '收起菜单' : '展开菜单'}
				onClick={toggle}
			>
				<span className={styles.handleGlyph} aria-hidden="true">
					{isOpen ? '✕' : '☰'}
				</span>
				<span className={styles.handleLabel} aria-hidden="true">
					{isOpen ? '收起' : '菜单'}
				</span>
			</button>
		</nav>
	);
}
