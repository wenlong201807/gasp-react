import type { Preset } from './types';
import { presets } from './presets';
import styles from './event-loop.module.css';

export function PresetPicker({ onSelect }: { onSelect: (preset: Preset) => void }) {
	return (
		<div className={styles.picker}>
			<h2 className={styles.pickerTitle}>选择一段代码，看它如何跑过事件循环</h2>
			<div className={styles.pickerCards}>
				{presets.map((preset) => (
					<button
						type="button"
						key={preset.id}
						className={styles.presetCard}
						onClick={() => onSelect(preset)}
					>
						<div className={styles.presetCardTitle}>{preset.title}</div>
						<div className={styles.difficulty}>难度 {'★'.repeat(preset.difficulty)}</div>
						<div className={styles.presetCode}>{preset.code}</div>
					</button>
				))}
			</div>
		</div>
	);
}
