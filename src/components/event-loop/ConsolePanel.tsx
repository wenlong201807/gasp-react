import { box, REGION } from './compiler/layout';
import type { Step } from './types';
import styles from './event-loop.module.css';

export function ConsolePanel({ step }: { step: Step }) {
	return (
		<section className={styles.panel} style={box(REGION.console)}>
			<h4 className={styles.panelTitle}>Console</h4>
			{step.consoleLines.map((line, i) => (
				<div
					key={i}
					className={
						i === step.consoleLines.length - 1
							? `${styles.consoleLine} ${styles.consoleNew}`
							: styles.consoleLine
					}
				>
					{line}
				</div>
			))}
		</section>
	);
}
