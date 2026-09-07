/**
 * Service Worker 注册与更新流（仅生产构建生效，dev 完全不注册）：
 * - register('/sw.js') → 每 5 分钟 + 页面重新可见时 registration.update()
 * - 发现 waiting worker → 通知应用挂载 UpdateToast（首次安装不提示）
 * - 用户点「立即更新」→ postMessage SKIP_WAITING → controllerchange → 带 guard 地 reload 一次
 */

type WaitingListener = () => void;

const listeners = new Set<WaitingListener>();
let waitingWorker: ServiceWorker | null = null;

function notifyWaitingChange() {
	for (const listener of listeners) listener();
}

/** 当前等待激活的新版本 worker（无则 null） */
export function getWaitingSW(): ServiceWorker | null {
	return waitingWorker;
}

/** 订阅 waiting worker 变化，返回取消订阅函数 */
export function subscribeWaitingSW(listener: WaitingListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** 用户确认更新：让 waiting worker 立即接管 */
export function applyUpdate(): void {
	waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
}

let reloading = false; // controllerchange 后只 reload 一次，防刷新循环

export function registerServiceWorker(): void {
	if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (reloading) return;
		reloading = true;
		window.location.reload();
	});

	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('/sw.js')
			.then((registration) => {
				const checkForUpdate = () => registration.update().catch(() => {});
				window.setInterval(checkForUpdate, 5 * 60 * 1000);
				document.addEventListener('visibilitychange', () => {
					if (document.visibilityState === 'visible') checkForUpdate();
				});

				// 打开页面时已有 waiting（上次检查发现但用户未处理）
				if (registration.waiting && navigator.serviceWorker.controller) {
					waitingWorker = registration.waiting;
					notifyWaitingChange();
					return;
				}
				registration.addEventListener('updatefound', () => {
					const installing = registration.installing;
					if (!installing) return;
					installing.addEventListener('statechange', () => {
						// 首次安装（页面尚无 controller）不提示
						if (installing.state === 'installed' && navigator.serviceWorker.controller) {
							waitingWorker = installing;
							notifyWaitingChange();
						}
					});
				});
			})
			.catch(() => {
				// SW 注册失败不影响页面功能
			});
	});
}
