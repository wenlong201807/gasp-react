import styles from './UpdateToast.module.css';

interface UpdateToastProps {
	/** 用户确认更新：postMessage SKIP_WAITING → controllerchange → 页面自动刷新 */
	onApply: () => void;
}

/** 右下角玻璃拟态更新提示（样式语言对齐 hud-control-panel） */
export function UpdateToast({ onApply }: UpdateToastProps) {
	return (
		<div className={styles.toast} data-update-toast role="status" aria-live="polite">
			<span className={styles.text}>发现新版本</span>
			<button type="button" className={styles.button} onClick={onApply}>
				立即更新
			</button>
		</div>
	);
}
