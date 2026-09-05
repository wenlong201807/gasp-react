import { useCallback, useEffect, useRef } from 'react';
import { gsap } from '@/utils/gsap';
import type { FrameStats } from './types';

interface Sampling {
	count: number;
	sum: number;
	max: number;
	jank: number;
}

/**
 * 采样 gsap.ticker 帧间隔（deltaTime，ms）。
 * start() 开始采样，stop() 结束并返回统计；掉帧判定：帧间隔 > 32ms。
 */
export function useFrameStats() {
	const samplingRef = useRef<Sampling | null>(null);

	useEffect(() => {
		const tick = (_time: number, deltaTime: number) => {
			const s = samplingRef.current;
			if (!s || deltaTime <= 0) return;
			s.count += 1;
			s.sum += deltaTime;
			if (deltaTime > s.max) s.max = deltaTime;
			if (deltaTime > 32) s.jank += 1;
			// 注：gsap lagSmoothing(500, 33) 会把 >500ms 的长冻结钳到约 33ms，
			// maxMs 不反映真实冻结时长；jankCount 判定（>32ms）不受影响。
		};
		gsap.ticker.add(tick);
		return () => gsap.ticker.remove(tick);
	}, []);

	const start = useCallback(() => {
		samplingRef.current = { count: 0, sum: 0, max: 0, jank: 0 };
	}, []);

	const stop = useCallback((): FrameStats | null => {
		const s = samplingRef.current;
		samplingRef.current = null;
		if (!s || s.count === 0) return null;
		return {
			frameCount: s.count,
			avgMs: Math.round((s.sum / s.count) * 100) / 100,
			maxMs: Math.round(s.max * 100) / 100,
			jankCount: s.jank,
				thresholdMs: 32,
				estimatedDroppedFrames: s.jank,
				windowMs: Math.round(s.sum * 100) / 100,
		};
	}, []);

	return { start, stop };
}
