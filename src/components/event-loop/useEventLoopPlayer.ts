import { useCallback, useRef, useState } from 'react';
import type { LottieRefCurrentProps } from 'lottie-react';
import { FRAMES_PER_STEP } from './compiler/layout';
import type { CompiledAnimation, Preset } from './types';

export function useEventLoopPlayer(preset: Preset, compiled: CompiledAnimation) {
	const lottieRef = useRef<LottieRefCurrentProps>(null);
	const [frame, setFrame] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeedState] = useState(1);

	const { totalFrames } = compiled;
	const stepCount = preset.trace.length;
	const stepIndex = Math.max(0, Math.min(stepCount - 1, Math.floor(frame / FRAMES_PER_STEP)));

	// lottie-react 的 lottieRef 是封装层（无 addEventListener），
	// 帧事件通过 <Lottie onEnterFrame={...}> prop 接入。
	// 实测本版 lottie-web 的 enterFrame 事件没有 frame 字段，
	// 携带的是 currentTime（亚帧精度的当前帧号，可为小数）
	const handleEnterFrame = useCallback((e: unknown) => {
		const currentTime = (e as { currentTime?: number } | null | undefined)?.currentTime;
		if (typeof currentTime === 'number') setFrame(currentTime);
	}, []);

	const play = useCallback(() => {
		const player = lottieRef.current;
		if (!player) return;
		if (frame >= totalFrames - 1) {
			player.goToAndStop(0, true);
			setFrame(0);
		}
		player.play();
		setPlaying(true);
	}, [frame, totalFrames]);

	const pause = useCallback(() => {
		lottieRef.current?.pause();
		setPlaying(false);
	}, []);

	const toggle = useCallback(() => {
		if (playing) pause();
		else play();
	}, [playing, play, pause]);

	const stepTo = useCallback(
		(i: number) => {
			const clamped = Math.max(0, Math.min(stepCount - 1, i));
			const target = clamped * FRAMES_PER_STEP + FRAMES_PER_STEP - 1;
			lottieRef.current?.goToAndStop(target, true);
			setFrame(target);
			setPlaying(false);
		},
		[stepCount]
	);

	const stepForward = useCallback(() => stepTo(stepIndex + 1), [stepIndex, stepTo]);
	const stepBackward = useCallback(() => stepTo(stepIndex - 1), [stepIndex, stepTo]);

	const replay = useCallback(() => {
		const player = lottieRef.current;
		if (!player) return;
		player.goToAndStop(0, true);
		setFrame(0);
		player.play();
		setPlaying(true);
	}, []);

	const setSpeed = useCallback((s: number) => {
		lottieRef.current?.setSpeed(s);
		setSpeedState(s);
	}, []);

	const seekFrame = useCallback(
		(f: number) => {
			const clamped = Math.max(0, Math.min(totalFrames - 1, f));
			lottieRef.current?.goToAndStop(clamped, true);
			setFrame(clamped);
			setPlaying(false);
		},
		[totalFrames]
	);

	return {
		lottieRef,
		handleEnterFrame,
		frame,
		stepIndex,
		playing,
		speed,
		play,
		pause,
		toggle,
		stepTo,
		stepForward,
		stepBackward,
		replay,
		setSpeed,
		seekFrame,
		totalFrames,
	};
}

export type EventLoopPlayer = ReturnType<typeof useEventLoopPlayer>;
