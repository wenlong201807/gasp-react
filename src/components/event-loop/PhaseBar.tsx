import { box, REGION } from './compiler/layout';
import type { Step } from './types';
import styles from './event-loop.module.css';

const LABELS: { key: Step['phase']; text: string }[] = [
	{ key: 'task', text: '① 任务（宏任务）' },
	{ key: 'microtask', text: '② 微任务' },
	{ key: 'render', text: '③ 渲染' },
];

export function PhaseBar({ step }: { step: Step }) {
	return (
		<section className={styles.phaseLabel} style={box(REGION.phase)}>
			{LABELS.map((label) => (
				<span
					key={label.key}
					className={step.phase === label.key ? styles.phaseSpanActive : undefined}
				>
					{label.text}
				</span>
			))}
		</section>
	);
}
