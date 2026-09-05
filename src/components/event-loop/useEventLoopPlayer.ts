import { useCallback, useEffect, useRef, useState } from 'react';
import type { LottieRefCurrentProps } from 'lottie-react';
import { FRAMES_PER_STEP } from './compiler/layout';
import type { CompiledAnimation, Preset } from './types';

interface AnimationPlayerLike {
	addEventListener: (type: string, cb: (e: { frame: number }) => void) => void;
	removeEventListener: (type: string, cb: (e: { frame: number }) => void) => void;
}

export function useEventLoopPlayer(preset: Preset, compiled: CompiledAnimation) {
	const lottieRef = useRef<LottieRefCurrentProps>(null);
	const [frame, setFrame] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeedState] = useState(1);

	const { totalFrames } = compiled;
	const stepCount = preset.trace.length;
	const stepIndex = Math.max(0, Math.min(stepCount - 1, Math.floor(frame / FRAMES_PER_STEP)));

	useEffect(() => {
		const player = lottieRef.current as unknown as AnimationPlayerLike | null;
		if (!player) return;
		const onEnterFrame = (e: { frame: number }) => setFrame(e.frame);
		player.addEventListener('enterFrame', onEnterFrame);
		return () => player.removeEventListener('enterFrame', onEnterFrame);
	}, [compiled]);

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
