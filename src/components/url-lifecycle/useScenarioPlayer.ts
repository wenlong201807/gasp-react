import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { gsap } from '@/utils/gsap';
import { anchor, sideOf } from './layout';
import { STEP_SECONDS, TRANSITION } from './types';
import type { CacheVerdict, NodeId, Scenario } from './types';

const ALL_VERDICTS: readonly CacheVerdict[] = [
	'miss',
	'strongHit',
	'revalidate',
	'notModified304',
	'fresh200',
];

const LANE_COUNT = 6;

/**
 * GSAP timeline 播放器 hook（§6/§8/§9）：
 * - useLayoutEffect 内 gsap.context 一次性建 timeline，卸载 revert；
 * - stepIndex/progress 只由播放头时间派生（onUpdate 通路）；
 * - 所有窗口过渡均为 fromTo（from = 上一步完成态，to = 本步完成态），
 *   且带 immediateRender:false，保证 seek 双向落点即完成态。
 */
export function useScenarioPlayer(scenario: Scenario, stageRef: RefObject<HTMLDivElement | null>) {
	const tlRef = useRef<gsap.core.Timeline | null>(null);
	const [stepIndex, setStepIndex] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeedState] = useState(1);
	const [progress, setProgress] = useState(0);

	const stages = scenario.stages;
	const stepCount = stages.length;
	const total = stepCount * STEP_SECONDS;

	// §9.6 剧本数据防御：脏数据在构建期暴露而非播放期崩帧
	if (import.meta.env.DEV) {
		if (stepCount === 0) {
			console.error(`[url-lifecycle] 剧本 ${scenario.id} stages 为空数组`);
		}
		stages.forEach((s) => {
			if (s.renderProgress != null && (s.renderProgress < 0 || s.renderProgress > LANE_COUNT)) {
				console.error(`[url-lifecycle] 步骤 ${s.id} renderProgress 越界：${s.renderProgress}`);
			}
		});
	}

	// onUpdate 通路：React 侧唯一状态来源（seek 后同函数即时调用对齐）
	const syncStepFromTime = useCallback(() => {
		const tl = tlRef.current;
		if (!tl) return;
		const t = tl.time();
		setStepIndex(Math.max(0, Math.min(stepCount - 1, Math.floor(t / STEP_SECONDS))));
		setProgress(total > 0 ? t / total : 0);
	}, [stepCount, total]);

	useLayoutEffect(() => {
		const scope = stageRef.current;
		if (!scope) return;
		const per = STEP_SECONDS;
		const D = TRANSITION;

		const ctx = gsap.context(() => {
			const q = gsap.utils.selector(scope);
			const nodeEl = (id: NodeId) => q(`[data-node="${id}"]`)[0];
			const glowEl = (id: NodeId) => q(`[data-node="${id}"] [data-glow]`)[0];

			const tl = gsap.timeline({
				paused: true,
				onUpdate: () => syncStepFromTime(),
				onComplete: () => setPlaying(false), // §6.6 播完自动停
			});
			// 占位 tween：锁定总时长 = 步数 × 每步秒数
			tl.to({}, { duration: stages.length * per });

			let prevActive = new Set<NodeId>();
			let prevVerdict: CacheVerdict | null = null;
			let prevLit = 0;

			stages.forEach((stage, i) => {
				// §6.1 步首即成：第 i 步过渡窗 [i*per - D, i*per]，第 0 步固定 t=0、时长 0.01s
				const start = i === 0 ? 0 : i * per - D;
				const dur = i === 0 ? 0.01 : D;

				// §6.2 节点激活：scale 0.96→1.04(back.out(2)) + 光晕 opacity 0→1；失活反向接管
				const curActive = new Set(stage.activeNodes);
				for (const id of curActive) {
					if (prevActive.has(id)) continue;
					const el = nodeEl(id);
					const glow = glowEl(id);
					if (!el || !glow) continue;
					tl.fromTo(
						el,
						{ scale: 0.96 },
						{ scale: 1.04, duration: dur, ease: 'back.out(2)', immediateRender: false },
						start
					);
					tl.fromTo(
						glow,
						{ autoAlpha: 0 },
						{ autoAlpha: 1, duration: dur, immediateRender: false },
						start
					);
				}
				for (const id of prevActive) {
					if (curActive.has(id)) continue;
					const el = nodeEl(id);
					const glow = glowEl(id);
					if (!el || !glow) continue;
					tl.fromTo(
						el,
						{ scale: 1.04 },
						{ scale: 1, duration: dur, immediateRender: false },
						start
					);
					tl.fromTo(
						glow,
						{ autoAlpha: 1 },
						{ autoAlpha: 0, duration: dur, immediateRender: false },
						start
					);
				}
				prevActive = curActive;

				// §6.3 数据包：x/y 插值直线位移，常驻 DOM、autoAlpha 控制显隐
				stage.packets.forEach((p) => {
					const el = q(`[data-packet="${p.id}"]`)[0];
					if (!el) return;
					const a = anchor(p.from, sideOf(p.from, p.to)); // 起点锚点
					const b = anchor(p.to, sideOf(p.to, p.from)); // 终点锚点
					tl.fromTo(
						el,
						{ x: a.x, y: a.y, xPercent: -50, yPercent: -50, autoAlpha: 0 },
						{ autoAlpha: 1, duration: D, immediateRender: false },
						start
					);
					tl.fromTo(
						el,
						{ x: a.x, y: a.y, xPercent: -50, yPercent: -50 },
						{ x: b.x, y: b.y, duration: per * 0.9, ease: 'power1.inOut', immediateRender: false },
						start
					);
					// 下一步过渡窗内淡出
					tl.to(el, { autoAlpha: 0, duration: D }, (i + 1) * per - D);
				});

				// §6.4 缓存判定：命中分支 opacity 0.15→1 + 徽标 scale 0.8→1；无判定步骤面板待机 0.35
				const verdict: CacheVerdict | null = stage.cacheVerdict ?? null;
				if (verdict !== prevVerdict) {
					const panel = q('[data-cache-panel]')[0];
					if (panel) {
						tl.fromTo(
							panel,
							{ opacity: prevVerdict ? 1 : 0.35 },
							{ opacity: verdict ? 1 : 0.35, duration: dur, immediateRender: false },
							start
						);
					}
					for (const v of ALL_VERDICTS) {
						const branch = q(`[data-verdict="${v}"]`)[0];
						const badge = q(`[data-verdict="${v}"] [data-badge]`)[0];
						if (!branch) continue;
						const fromOpacity = prevVerdict === v ? 1 : 0.15;
						const toOpacity = verdict === v ? 1 : 0.15;
						if (fromOpacity !== toOpacity) {
							tl.fromTo(
								branch,
								{ opacity: fromOpacity },
								{ opacity: toOpacity, duration: dur, immediateRender: false },
								start
							);
						}
						if (badge) {
							if (verdict === v) {
								tl.fromTo(
									badge,
									{ scale: 0.8 },
									{ scale: 1, duration: dur, ease: 'back.out(2)', immediateRender: false },
									start
								);
							} else if (prevVerdict === v) {
								tl.fromTo(
									badge,
									{ scale: 1 },
									{ scale: 0.8, duration: dur, immediateRender: false },
									start
								);
							}
						}
					}
					prevVerdict = verdict;
				}

				// §6.5 渲染泳道：fill scaleY 0→1 自下而上；进度条六段独立 scaleX
				const lit = stage.renderProgress ?? prevLit;
				if (lit !== prevLit) {
					for (let j = 0; j < LANE_COUNT; j++) {
						const wasLit = j < prevLit;
						const isLit = j < lit;
						if (wasLit === isLit) continue;
						const fill = q(`[data-lane="${j}"] [data-fill]`)[0];
						if (fill) {
							tl.fromTo(
								fill,
								{ scaleY: wasLit ? 1 : 0 },
								{ scaleY: isLit ? 1 : 0, duration: dur, immediateRender: false },
								start
							);
						}
						const seg = q(`[data-seg="${j}"] [data-fill]`)[0];
						if (seg) {
							tl.fromTo(
								seg,
								{ scaleX: wasLit ? 1 : 0 },
								{ scaleX: isLit ? 1 : 0, duration: dur, immediateRender: false },
								start
							);
						}
					}
					prevLit = lit;
				}
			});

			tlRef.current = tl;
		}, scope);

		// §9：revert 同时 kill 全部 tween 并恢复 DOM；再显式 kill 一次作防御性收尾
		return () => {
			ctx.revert();
			tlRef.current?.kill();
			tlRef.current = null;
		};
	}, [scenario.id, stageRef, syncStepFromTime, stages]);

	const play = useCallback(() => {
		const tl = tlRef.current;
		if (!tl) return;
		if (tl.time() >= total - 0.01) tl.seek(0); // 末步再按 Play：回 0 再播
		tl.play();
		setPlaying(true);
	}, [total]);

	const pause = useCallback(() => {
		tlRef.current?.pause();
		setPlaying(false);
	}, []);

	const toggle = useCallback(() => {
		if (playing) pause();
		else play();
	}, [playing, play, pause]);

	const stepTo = useCallback(
		(i: number) => {
			const tl = tlRef.current;
			if (!tl) return;
			const clamped = Math.max(0, Math.min(stepCount - 1, i));
			tl.pause();
			tl.seek(clamped * STEP_SECONDS); // 步首即成：落点即完成态
			syncStepFromTime();
			setPlaying(false);
		},
		[stepCount, syncStepFromTime]
	);

	const stepForward = useCallback(() => stepTo(stepIndex + 1), [stepIndex, stepTo]);
	const stepBackward = useCallback(() => stepTo(stepIndex - 1), [stepIndex, stepTo]);

	const replay = useCallback(() => {
		const tl = tlRef.current;
		if (!tl) return;
		tl.seek(0);
		tl.play();
		syncStepFromTime();
		setPlaying(true);
	}, [syncStepFromTime]);

	const setSpeed = useCallback((s: number) => {
		tlRef.current?.timeScale(s); // 纯播放速率缩放，不改 per
		setSpeedState(s);
	}, []);

	const seek = useCallback(
		(t: number) => {
			const tl = tlRef.current;
			if (!tl) return;
			const clamped = Math.max(0, Math.min(total, t)); // §9.5 seek 越界 clamp
			tl.pause();
			tl.seek(clamped);
			syncStepFromTime();
			setPlaying(false);
		},
		[total, syncStepFromTime]
	);

	return {
		stepIndex,
		playing,
		speed,
		progress,
		total,
		play,
		pause,
		toggle,
		stepTo,
		stepForward,
		stepBackward,
		replay,
		setSpeed,
		seek,
	};
}

export type ScenarioPlayer = ReturnType<typeof useScenarioPlayer>;
