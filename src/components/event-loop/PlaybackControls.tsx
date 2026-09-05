import type { EventLoopPlayer } from './useEventLoopPlayer';
import styles from './event-loop.module.css';

const SPEEDS = [0.5, 1, 2];

export function PlaybackControls({
	player,
	frameMap,
}: {
	player: EventLoopPlayer;
	frameMap: number[];
}) {
	return (
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
						type="button"
						key={s}
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
				max={player.totalFrames - 1}
				value={player.frame}
				onChange={(e) => player.seekFrame(Number(e.target.value))}
			/>
			<div className={styles.dots}>
				{frameMap.map((_, i) => (
					<button
						type="button"
						key={i}
						aria-label={`跳到步骤 ${i + 1}`}
						className={i === player.stepIndex ? `${styles.dot} ${styles.dotActive}` : styles.dot}
						onClick={() => player.stepTo(i)}
					/>
				))}
			</div>
		</div>
	);
}
