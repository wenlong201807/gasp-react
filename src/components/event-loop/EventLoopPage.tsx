import { useState } from 'react';
import { EventLoopStage } from './EventLoopStage';
import { PresetPicker } from './PresetPicker';
import type { Preset } from './types';
import styles from './event-loop.module.css';

export function EventLoopPage() {
	const [preset, setPreset] = useState<Preset | null>(null);

	if (!preset) {
		return (
			<div className={styles.page}>
				<PresetPicker onSelect={setPreset} />
			</div>
		);
	}
	return <EventLoopStage preset={preset} onBack={() => setPreset(null)} />;
}
