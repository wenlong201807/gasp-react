import type { EventLoopPlayer } from './useEventLoopPlayer';
import styles from './event-loop.module.css';

const SPEEDS = [0.5, 1, 2];

interface PlaybackControlsProps {
	player: EventLoopPlayer;
	frameMap: number[];
	onFullscreen: () => void;
	isFullscreen: boolean;
	isImmersive: boolean;
	designFps: number;
	realtimeFps: number | null;
	fullscreenError: string | null;
}

export function PlaybackControls({
	player,
	frameMap,
	onFullscreen,
	isFullscreen,
	isImmersive,
	designFps,
	realtimeFps,
	fullscreenError,
}: PlaybackControlsProps) {
	return (
		<div className={styles.controlsBar}>
			<button type="button" className={styles.btn} onClick={player.replay}>⏮ 重播</button>
			<button type="button" className={styles.btn} onClick={player.toggle}>
				{player.playing ? '⏸ 暂停' : '▶ 播放'}
			</button>
			<button type="button" className={styles.btn} onClick={player.stepBackward}>↶ 上一步</button>
			<button type="button" className={styles.btn} onClick={player.stepForward}>⏭ 单步</button>
			<div className={styles.speeds}>
				{SPEEDS.map((s) => (
					<button type="button" key={s} className={player.speed === s ? `${styles.btn} ${styles.btnActive}` : styles.btn} onClick={() => player.setSpeed(s)}>
						{s}x
					</button>
				))}
			</div>
			<input type="range" className={styles.slider} min={0} max={player.totalFrames - 1} value={Math.round(player.frame)} onChange={(e) => player.seekFrame(Number(e.target.value))} />
			<div className={styles.dots}>
				{frameMap.map((_, i) => (
					<button type="button" key={i} aria-label={`跳到步骤 ${i + 1}`} className={i === player.stepIndex ? `${styles.dot} ${styles.dotActive}` : styles.dot} onClick={() => player.stepTo(i)} />
				))}
			</div>
			<button type="button" className={styles.btn} onClick={onFullscreen}>
				{isFullscreen ? '⛶ 退出全屏' : isImmersive ? '⛶ 退出沉浸' : '⛶ 全屏'}
			</button>
			<div className={styles.fpsInfo} aria-label="帧率信息">
				设计 {designFps} FPS · 实时 {realtimeFps === null ? '—' : `${realtimeFps} FPS`}
			</div>
			{fullscreenError && <div className={styles.fullscreenNotice} role="status">{fullscreenError}</div>}
		</div>
	);
}
