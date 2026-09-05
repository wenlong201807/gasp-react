import { LANE_TITLE_Y, PROGRESS_BAR, RENDER_LANES } from './layout';
import styles from './url-lifecycle.module.css';

/**
 * 底部六格渲染泳道 + 六段进度条。
 * 泳道 fill（scaleY）与进度段（scaleX）均常驻 DOM，由时间轴按 renderProgress 点亮。
 */
export function RenderPipeline() {
	return (
		<>
			<span className={styles.laneTitleRow} style={{ left: 40, top: LANE_TITLE_Y }}>
				渲染管线 Render Pipeline
			</span>
			{RENDER_LANES.map((lane, i) => (
				<div
					key={lane.id}
					data-lane={i}
					className={styles.lane}
					style={{ left: lane.rect.x, top: lane.rect.y, width: lane.rect.w, height: lane.rect.h }}
				>
					<span data-fill className={styles.laneFill} />
					<span className={styles.laneTitle}>{lane.title}</span>
				</div>
			))}
			<div
				className={styles.progressTrack}
				style={{ left: PROGRESS_BAR.x, top: PROGRESS_BAR.y, width: PROGRESS_BAR.w, height: PROGRESS_BAR.h }}
			>
				{RENDER_LANES.map((lane, i) => (
					<div key={lane.id} data-seg={i} className={styles.seg}>
						<span data-fill className={styles.segFill} />
					</div>
				))}
			</div>
		</>
	);
}
