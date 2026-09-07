/**
 * 360° 视口「对侧侧视」配对：HudSystem 自转锁定 0.35rad/s → 半圈 ≈ 8.97s。
 * 洞为半透明，背后街景持续滚动会污染逐帧指标，因此：
 *   1) 三帧滑动平均去噪；2) 取全局峰值作为侧视 A；
 *   3) 在 A ± k·半圈（k=1,2）± 容差窗口内取指标最高的帧作为侧视 B。
 */

export const HALF_ROTATION_MS = Math.round(((Math.PI / 2) / 0.35) * 2 * 1000); // ≈ 8971ms

function smooth3(values) {
	return values.map((_, i) => {
		const w = [values[i - 1], values[i], values[i + 1]].filter((v) => v !== undefined);
		return w.reduce((a, b) => a + b, 0) / w.length;
	});
}

/**
 * @param {number[]} ratios 每帧侧视指标
 * @param {number[]} times 每帧 performance.now() 时间戳
 */
export function pickSideViews(ratios, times, { periodMs = HALF_ROTATION_MS, tolMs = 1400, minRatio = 0.04 } = {}) {
	const smoothed = smooth3(ratios);
	let p1 = 0;
	smoothed.forEach((v, i) => {
		if (v > smoothed[p1]) p1 = i;
	});
	const sideA = { i: p1, ratio: +ratios[p1].toFixed(4), smoothed: +smoothed[p1].toFixed(4), t: times[p1] };
	if (smoothed[p1] < minRatio) return { sideA: null, sideB: null, smoothed };
	let p2 = null;
	for (const k of [1, 2]) {
		for (const sign of [1, -1]) {
			const target = times[p1] + sign * k * periodMs;
			for (let i = 0; i < times.length; i++) {
				if (Math.abs(times[i] - target) > tolMs) continue;
				if (p2 === null || smoothed[i] > smoothed[p2]) p2 = i;
			}
		}
		if (p2 !== null && smoothed[p2] >= minRatio) break;
		p2 = null;
	}
	const sideB = p2 === null ? null : { i: p2, ratio: +ratios[p2].toFixed(4), smoothed: +smoothed[p2].toFixed(4), t: times[p2] };
	return { sideA, sideB, smoothed };
}
