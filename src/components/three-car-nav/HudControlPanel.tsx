import { useRef } from 'react';
import type { EngineSnapshot } from './engine/ThreeCarNavEngine';
import styles from './hud-control-panel.module.css';
import type { CameraMode, EngineControls, TimeOfDay } from './types';

const SPEED_PRESETS = [30, 60, 90] as const;
const SPEED_MAX_KMH = 120;

const CAMERA_OPTIONS: Array<{ mode: CameraMode; label: string }> = [
	{ mode: 'chase', label: '追尾' },
	{ mode: 'driver', label: '驾驶位' },
	{ mode: 'side', label: '侧方' },
];

const TIME_OPTIONS: Array<{ value: TimeOfDay; label: string }> = [
	{ value: 'dusk', label: '黄昏' },
	{ value: 'day', label: '白天' },
	{ value: 'night', label: '夜晚' },
];

/** 本地乐观窗口：吃掉 onStats 5Hz 节流（200ms）造成的受控 slider 回跳 */
const SPEED_DRAFT_TTL_MS = 600;

interface HudControlPanelProps {
	stats: EngineSnapshot;
	controls: EngineControls;
}

/**
 * 右下角玻璃拟态控制台：速度 slider + 快捷键、暂停/恢复（gear P/D）、
 * 视角三选、日夜三选。显示值单向来自 5Hz stats，触发走 controls；
 * gear==='P' 时速度控件禁用（RoadSystem 已按 gear 停滚，UI 只是触发器）。
 */
export function HudControlPanel({ stats, controls }: HudControlPanelProps) {
	const speedDraftRef = useRef<{ value: number; at: number } | null>(null);
	const paused = stats.gear === 'P';

	const applySpeed = (kmh: number) => {
		speedDraftRef.current = { value: kmh, at: Date.now() };
		controls.setTargetSpeed(kmh);
	};

	const draft = speedDraftRef.current;
	const draftFresh = draft !== null && Date.now() - draft.at < SPEED_DRAFT_TTL_MS;
	const shownSpeed = Math.round(draftFresh ? draft.value : stats.speedKmh);

	return (
		<section className={styles.panel} aria-label="智驾控制台">
			<header className={styles.header}>
				<h2 className={styles.title}>智驾控制台</h2>
				<span className={styles.gear} data-gear={stats.gear}>
					{stats.gear} 档
				</span>
			</header>

			<div className={styles.group}>
				<div className={styles.groupHead}>
					<span className={styles.groupLabel}>巡航速度</span>
					<span className={styles.speedValue}>{shownSpeed} km/h</span>
				</div>
				<input
					type="range"
					className={styles.slider}
					aria-label="巡航速度"
					min={0}
					max={SPEED_MAX_KMH}
					step={1}
					value={shownSpeed}
					disabled={paused}
					onChange={(event) => applySpeed(Number(event.currentTarget.value))}
				/>
				<div className={styles.presets}>
					{SPEED_PRESETS.map((kmh) => (
						<button
							key={kmh}
							type="button"
							className={styles.presetBtn}
							disabled={paused}
							onClick={() => applySpeed(kmh)}
						>
							{kmh}
						</button>
					))}
				</div>
			</div>

			<button
				type="button"
				className={paused ? `${styles.pauseBtn} ${styles.pauseBtnActive}` : styles.pauseBtn}
				onClick={() => {
					speedDraftRef.current = null;
					controls.togglePause();
				}}
			>
				{paused ? '恢复 (D)' : '暂停 (P)'}
			</button>

			<div className={styles.group}>
				<span className={styles.groupLabel}>视角</span>
				<div className={styles.chips}>
					{CAMERA_OPTIONS.map((opt) => (
						<button
							key={opt.mode}
							type="button"
							className={
								stats.cameraMode === opt.mode ? `${styles.chip} ${styles.chipActive}` : styles.chip
							}
							aria-pressed={stats.cameraMode === opt.mode}
							onClick={() => controls.setCameraMode(opt.mode)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			<div className={styles.group}>
				<span className={styles.groupLabel}>日夜</span>
				<div className={styles.chips}>
					{TIME_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							className={
								stats.timeOfDay === opt.value ? `${styles.chip} ${styles.chipActive}` : styles.chip
							}
							aria-pressed={stats.timeOfDay === opt.value}
							onClick={() => controls.setTimeOfDay(opt.value)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>
		</section>
	);
}
