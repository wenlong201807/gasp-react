import { box, REGION } from './compiler/layout';
import type { Step } from './types';
import styles from './event-loop.module.css';

export function NarrationBar({
	step,
	index,
	total,
}: {
	step: Step;
	index: number;
	total: number;
}) {
	return (
		<section className={styles.narration} style={box(REGION.narration)}>
			<span className={styles.stepCounter}>
				步骤 {index + 1}/{total}
			</span>
			<span className={styles.narrationText}>{step.title}</span>
		</section>
	);
}
