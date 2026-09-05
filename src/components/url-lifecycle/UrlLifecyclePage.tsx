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
	// key={scenario.id} 强制整舞台重挂载：refs、timeline、常驻包元素全部重建（§9.4）
	return <UrlLifecycleStage key={scenario.id} scenario={scenario} onBack={() => setScenario(null)} />;
}

function UrlLifecycleStage({ scenario, onBack }: { scenario: Scenario; onBack: () => void }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	const player = useScenarioPlayer(scenario, stageRef);
	const stage = scenario.stages[player.stepIndex];
	const total = scenario.stages.length;

	// ResizeObserver 等比缩放（复刻 stageWrap 模式，各自实现）
	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => setScale(entries[0].contentRect.width / STAGE.w));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<button type="button" className={styles.backBtn} onClick={onBack}>
					← 换一幕
				</button>
				<h2 className={styles.title}>URL 生命周期 · {scenario.title}</h2>
			</header>
			<div ref={wrapRef} className={styles.stageWrap}>
				<div
					ref={stageRef}
					className={styles.stage}
					style={{ width: STAGE.w, height: STAGE.h, transform: `scale(${scale})` }}
				>
					{/* urlBar：幕一显示完整 URL；幕二左侧追加 ⌘R/F5 徽标（危险红描边） */}
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
							className={`${styles.dot} ${i === player.stepIndex ? styles.dotActive : ''} ${
								i < player.stepIndex ? styles.dotPast : ''
							}`}
							onClick={() => player.stepTo(i)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
