import { useEffect, useRef } from 'react';
import { gsap } from '@/utils/gsap';
import { DETAIL_BAR } from './layout';
import type { Stage } from './types';
import styles from './url-lifecycle.module.css';

interface DetailBarProps {
	stage: Stage;
	index: number;
	total: number;
	scenarioTitle: string;
}

/** 顶部解说条：title/detail 成品文案、步号、幕名。文案是 stepIndex 的纯函数，脉冲只是装饰。 */
export function DetailBar({ stage, index, total, scenarioTitle }: DetailBarProps) {
	const barRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// §6.6 stepIndex 变化时的装饰性脉冲（不影响 seek 正确性）
		if (barRef.current) {
			gsap.fromTo(
				barRef.current,
				{ autoAlpha: 0, y: 8 },
				{ autoAlpha: 1, y: 0, duration: 0.3, overwrite: true }
			);
		}
	}, [index]);

	return (
		<div
			ref={barRef}
			className={styles.detailBar}
			style={{ left: DETAIL_BAR.x, top: DETAIL_BAR.y, width: DETAIL_BAR.w, height: DETAIL_BAR.h }}
		>
			<div className={styles.detailMain}>
				<span className={styles.detailTitle}>{stage.title}</span>
			</div>
			<div className={styles.detailText}>{stage.detail}</div>
			<span className={styles.stepCounter}>
				{String(index + 1).padStart(2, '0')}/{total}
			</span>
			<span className={styles.scenarioTag}>{scenarioTitle}</span>
		</div>
	);
}
