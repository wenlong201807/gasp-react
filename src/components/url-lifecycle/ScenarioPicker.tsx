import { FIRST_LOAD } from './stages/firstLoad';
import { REFRESH } from './stages/refresh';
import type { Scenario } from './types';
import styles from './url-lifecycle.module.css';

/** 两幕选择卡片（首次加载 / F5 刷新），含各自副标题 */
export function ScenarioPicker({ onSelect }: { onSelect: (scenario: Scenario) => void }) {
	const cards: readonly Scenario[] = [FIRST_LOAD, REFRESH];

	return (
		<div className={styles.picker}>
			<h2 className={styles.pickerTitle}>URL 生命周期 · 选择一幕</h2>
			<div className={styles.pickerCards}>
				{cards.map((scenario) => (
					<button
						key={scenario.id}
						type="button"
						className={styles.presetCard}
						onClick={() => onSelect(scenario)}
					>
						<h3 className={styles.presetCardTitle}>{scenario.title}</h3>
						<p className={styles.presetCardSub}>{scenario.subtitle}</p>
						<span className={styles.presetCardMeta}>{scenario.stages.length} 步 · 每步 1.6s</span>
					</button>
				))}
			</div>
		</div>
	);
}
