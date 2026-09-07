/*
 * 自研轻量 Service Worker：应用壳预缓存 + 静态资源 cache-first + CDN 模型缓存（条目上限 LRU）。
 * 版本号由构建注入（vite.config.ts 的 swManifest 插件全量替换版本占位符）：
 * 产物内容变化 → version 变 → sw.js 字节变 → registration.update() 才能发现新版本。
 */
const VERSION = '__SW_VERSION__';
const SHELL_CACHE = `app-shell-${VERSION}`;
const CDN_CACHE = 'cdn-models-v1';
const CDN_HOST = 'z2586300277.github.io';
const CDN_MAX_ENTRIES = 30; // 条目上限：单个模型分块 ~300KB，30 条 ≈ 10MB

/* ---------- install：按 sw-manifest.json 预缓存应用壳（不自动 skipWaiting，等页面指令） ---------- */
self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL_CACHE);
			const manifest = await fetch('/sw-manifest.json', { cache: 'no-store' })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null);
			const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
			// 逐条 put 而非 addAll：单个资源失败不拖垮整个 install
			await Promise.allSettled(
				['/', ...assets].map((url) => fetch(url).then((r) => (r.ok ? cache.put(url, r) : null)))
			);
		})()
	);
});

/* ---------- activate：按缓存名版本对比清旧缓存 + 接管已打开页面 ---------- */
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keep = new Set([SHELL_CACHE, CDN_CACHE]);
			const names = await caches.keys();
			await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
			await self.clients.claim();
		})()
	);
});

/* ---------- message：页面指令触发跳过等待 ---------- */
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- CDN 模型域：cache-first + 简单 LRU（内存记录最近使用时间，超上限逐出最旧） ---------- */
const cdnRecent = new Map(); // url -> lastUsedMs

async function cdnCacheFirst(request) {
	const cache = await caches.open(CDN_CACHE);
	const hit = await cache.match(request);
	if (hit) {
		cdnRecent.set(request.url, Date.now());
		return hit;
	}
	const response = await fetch(request);
	// 正常 cors 响应（GitHub Pages 带 ACAO:*）或 no-cors 的 opaque 响应均可入缓存（put 允许 opaque）
	if (response && (response.ok || response.type === 'opaque')) {
		await cache.put(request, response.clone());
		cdnRecent.set(request.url, Date.now());
		while (cdnRecent.size > CDN_MAX_ENTRIES) {
			let oldest = null;
			for (const [url, ts] of cdnRecent) {
				if (oldest === null || ts < cdnRecent.get(oldest)) oldest = url;
			}
			cdnRecent.delete(oldest);
			await cache.delete(oldest);
		}
	}
	return response;
}

/* ---------- fetch 分发 ---------- */
self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);

	// ① 同源 /assets/*：cache-first（产物文件名带内容 hash，内容不可变）
	if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(SHELL_CACHE);
				const hit = await cache.match(request);
				if (hit) return hit;
				const response = await fetch(request);
				if (response.ok) cache.put(request, response.clone());
				return response;
			})()
		);
		return;
	}

	// ② CDN 模型域：cache-first + LRU
	if (url.hostname === CDN_HOST) {
		event.respondWith(cdnCacheFirst(request));
		return;
	}

	// ③ 导航请求：network-first，断网/失败回退缓存首页
	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					return await fetch(request);
				} catch {
					return (await caches.match('/')) ?? Response.error();
				}
			})()
		);
	}
	// 其余请求（含 /sw-manifest.json 自身）放行，保证版本检测读到最新内容
});
