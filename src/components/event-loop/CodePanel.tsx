import { useMemo } from 'react';
import { box, REGION } from './compiler/layout';
import type { Step } from './types';
import styles from './event-loop.module.css';

export function CodePanel({ code, step }: { code: string; step: Step }) {
	const lines = useMemo(() => code.split('\n'), [code]);
	return (
		<section className={styles.panel} style={box(REGION.code)}>
			<h4 className={styles.panelTitle}>代码</h4>
			<ol className={styles.codeList}>
				{lines.map((line, i) => (
					<li
						key={i}
						className={
							step.codeLine === i + 1
								? `${styles.codeLine} ${styles.activeLine}`
								: styles.codeLine
						}
					>
						<span className={styles.lineNo}>{i + 1}</span>
						<code>{line}</code>
					</li>
				))}
			</ol>
		</section>
	);
}
