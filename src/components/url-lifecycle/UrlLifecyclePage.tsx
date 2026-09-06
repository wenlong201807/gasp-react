import { useEffect, useRef, useState } from 'react';
import { URL_BAR } from './layout';
import { CachePanel } from './CachePanel';
import { DetailBar } from './DetailBar';
import { NetworkStage } from './NetworkStage';
import { RenderPipeline } from './RenderPipeline';
import { ScenarioPicker } from './ScenarioPicker';
import { useScenarioPlayer } from './useScenarioPlayer';
import { STAGE } from './types';
import type { Scenario } from './types';
import styles from './url-lifecycle.module.css';

const SPEEDS = [0.5, 1, 2];

export function UrlLifecyclePage() {
	const [scenario, setScenario] = useState<Scenario | null>(null);

	if (!scenario) {
		return (
			<div className={styles.page}>
				<ScenarioPicker onSelect={setScenario} />
			</div>
		);
	}
	return <UrlLifecycleStage key={scenario.id} scenario={scenario} onBack={() => setScenario(null)} />;
}

function UrlLifecycleStage({ scenario, onBack }: { scenario: Scenario; onBack: () => void }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const fullscreenTargetRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isImmersive, setIsImmersive] = useState(false);
	const [fullscreenError, setFullscreenError] = useState<string | null>(null);
	const player = useScenarioPlayer(scenario, stageRef);
	const stage = scenario.stages[player.stepIndex];
	const total = scenario.stages.length;

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => setScale(entries[0].contentRect.width / STAGE.w));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const syncFullscreen = () => {
			const active = document.fullscreenElement === fullscreenTargetRef.current;
			setIsFullscreen(active);
			if (active) {
				setIsImmersive(false);
				setFullscreenError(null);
			}
		};
		document.addEventListener('fullscreenchange', syncFullscreen);
		return () => document.removeEventListener('fullscreenchange', syncFullscreen);
	}, []);

	const handleFullscreen = async () => {
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
	};

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<button type="button" className={styles.backBtn} onClick={onBack}>
					← 换一幕
				</button>
				<h2 className={styles.title}>URL 生命周期 · {scenario.title}</h2>
			</header>
			<div ref={fullscreenTargetRef} className={`${styles.experience} ${isImmersive ? styles.immersive : ''}`}>
				<div ref={wrapRef} className={styles.stageWrap}>
					<div
						ref={stageRef}
						className={styles.stage}
						style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}
					>
						<div
							className={styles.urlBar}
						style={{ left: URL_BAR.x, top: URL_BAR.y, width: URL_BAR.w, height: URL_BAR.h }}
						>
							{scenario.id === 'refresh' && <span className={styles.refreshBadge}>⌘R / F5</span>}
							<span className={styles.urlText}>https://www.example.com/index.html</span>
						</div>
						<DetailBar stage={stage} index={player.stepIndex} total={total} scenarioTitle={scenario.title} />
						<NetworkStage scenario={scenario} stage={stage} />
						<CachePanel stage={stage} />
						<RenderPipeline />
					</div>
				</div>
				<div className={styles.controlsBar}>
					<button type="button" className={styles.btn} onClick={player.replay}>
						⏮ 重播
					</button>
					<button type="button" className={styles.btn} onClick={player.toggle}>
						{player.playing ? '⏸ 暂停' : '▶ 播放'}
					</button>
					<button type="button" className={styles.btn} onClick={player.stepBackward}>
						↶ 上一步
					</button>
					<button type="button" className={styles.btn} onClick={player.stepForward}>
						⏭ 单步
					</button>
					<div className={styles.speeds}>
						{SPEEDS.map((s) => (
							<button
								key={s}
								type="button"
								className={player.speed === s ? `${styles.btn} ${styles.btnActive}` : styles.btn}
								onClick={() => player.setSpeed(s)}
							>
								{s}x
							</button>
						))}
					</div>
					<input
						type="range"
						className={styles.slider}
						min={0}
						max={player.total}
						step={0.05}
						value={player.progress * player.total}
						onChange={(e) => player.seek(Number(e.target.value))}
					/>
					<div className={styles.dots}>
						{scenario.stages.map((s, i) => (
							<button
								key={s.id}
								type="button"
								aria-label={`跳到步骤 ${i + 1}`}
								title={s.title}
								className={`${styles.dot} ${i === player.stepIndex ? styles.dotActive : ''} ${i < player.stepIndex ? styles.dotPast : ''}`}
								onClick={() => player.stepTo(i)}
							/>
						))}
					</div>
					<button
						type="button"
						className={styles.btn}
						aria-label={isFullscreen ? '退出全屏' : isImmersive ? '退出沉浸' : '进入全屏'}
						title={isFullscreen ? '退出全屏' : isImmersive ? '退出沉浸' : '进入全屏'}
						onClick={handleFullscreen}
					>
						{isFullscreen ? '⛶ 退出全屏' : isImmersive ? '⛶ 退出沉浸' : '⛶ 全屏'}
					</button>
					{fullscreenError && <span className={styles.fullscreenNotice} role="status">{fullscreenError}</span>}
				</div>
			</div>
		</div>
	);
}
