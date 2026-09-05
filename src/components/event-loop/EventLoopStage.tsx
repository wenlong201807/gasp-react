import Lottie from 'lottie-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compilePreset } from './compiler/lottieCompiler';
import { apiSlot, FPS, queueSlot, REGION, stackSlot, STAGE } from './compiler/layout';
import { useEventLoopPlayer } from './useEventLoopPlayer';
import { useRealtimeFps } from './useRealtimeFps';
import type { Preset, Step } from './types';
import { CodePanel } from './CodePanel';
import { ConsolePanel } from './ConsolePanel';
import { NarrationBar } from './NarrationBar';
import { PhaseBar } from './PhaseBar';
import { PlaybackControls } from './PlaybackControls';
import styles from './event-loop.module.css';

const REGION_TITLES = [
	{ key: 'stack', text: '调用栈' },
	{ key: 'webapis', text: 'Web APIs' },
	{ key: 'macro', text: '宏任务队列' },
	{ key: 'micro', text: '微任务队列' },
] as const;

interface ItemLabel { id: string; label: string; x: number; y: number; cls: string }

function collectLabels(step: Step): ItemLabel[] {
	const labels: ItemLabel[] = [];
	const add = (id: string, label: string, pos: [number, number], cls: string) => labels.push({ id, label, x: pos[0], y: pos[1], cls });
	step.stack.forEach((f, i) => add(f.id, f.label, stackSlot(i), styles.lblStack));
	step.webApis.forEach((e, i) => add(e.id, e.label, apiSlot(i), styles.lblWebapis));
	step.macroQueue.forEach((q, i) => add(q.id, q.label, queueSlot('macro', i), styles.lblMacro));
	step.microQueue.forEach((q, i) => add(q.id, q.label, queueSlot('micro', i), styles.lblMicro));
	return labels;
}

export function EventLoopStage({ preset, onBack }: { preset: Preset; onBack: () => void }) {
	const compiled = useMemo(() => compilePreset(preset), [preset]);
	const fps = useRealtimeFps();
	const player = useEventLoopPlayer(preset, compiled, fps.sample);
	const step = preset.trace[player.stepIndex];
	const labels = useMemo(() => collectLabels(step), [step]);
	const fullscreenTargetRef = useRef<HTMLDivElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isImmersive, setIsImmersive] = useState(false);
	const [fullscreenError, setFullscreenError] = useState<string | null>(null);

	useEffect(() => {
		fps.reset();
	}, [preset.id]);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => setScale(entries[0].contentRect.width / STAGE.w));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const sync = () => {
			const active = document.fullscreenElement === fullscreenTargetRef.current;
			setIsFullscreen(active);
			if (active) {
				setIsImmersive(false);
				setFullscreenError(null);
			}
		};
		document.addEventListener('fullscreenchange', sync);
		return () => document.removeEventListener('fullscreenchange', sync);
	}, []);

	const handleFullscreen = useCallback(async () => {
		const target = fullscreenTargetRef.current;
		if (!target) return;
		if (isImmersive) {
			setIsImmersive(false);
			setFullscreenError(null);
			return;
		}
		if (document.fullscreenElement === target) {
			await document.exitFullscreen();
			return;
		}
		if (!target.requestFullscreen) {
			setIsImmersive(true);
			setFullscreenError('浏览器未允许进入全屏，已切换为沉浸模式');
			return;
		}
		try {
			await target.requestFullscreen();
		} catch {
			setIsImmersive(true);
			setFullscreenError('浏览器未允许进入全屏，已切换为沉浸模式');
		}
	}, [isImmersive]);

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<button type="button" className={styles.backBtn} onClick={onBack}>← 换个预设</button>
				<h2 className={styles.title}>{preset.title}</h2>
			</header>
			<div ref={fullscreenTargetRef} className={`${styles.experience} ${isImmersive ? styles.immersive : ''}`}>
				<div ref={wrapRef} className={styles.stageWrap}>
					<div className={styles.stage} style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}>
						<Lottie lottieRef={player.lottieRef} animationData={compiled.lottieJson as never} loop={false} autoplay={false} style={{ position: 'absolute', top: 0, left: 0, width: STAGE.w, height: STAGE.h }} onEnterFrame={player.handleEnterFrame} onComplete={() => player.pause()} />
						<div className={styles.overlay}>
							<PhaseBar step={step} /><CodePanel code={preset.code} step={step} /><ConsolePanel step={step} /><NarrationBar step={step} index={player.stepIndex} total={preset.trace.length} />
							{REGION_TITLES.map((r) => <span key={r.key} className={styles.regionTitle} style={{ left: REGION[r.key].x + 10, top: REGION[r.key].y + 6 }}>{r.text}</span>)}
							{labels.map((it) => <span key={it.id} className={`${styles.itemLabel} ${it.cls}`} style={{ left: it.x, top: it.y }}>{it.label}</span>)}
						</div>
					</div>
				</div>
				<PlaybackControls player={player} frameMap={compiled.frameMap} onFullscreen={handleFullscreen} isFullscreen={isFullscreen} isImmersive={isImmersive} designFps={FPS} realtimeFps={fps.fps} fullscreenError={fullscreenError} />
			</div>
		</div>
	);
}
