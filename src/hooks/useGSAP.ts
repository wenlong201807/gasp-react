import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useCallback, useEffect, useRef } from 'react';
import { gsap } from '@/utils/gsap';

gsap.registerPlugin(ScrollTrigger);

export function useGSAP(callback?: () => void | (() => void), deps?: React.DependencyList) {
	const contextRef = useRef<gsap.Context | null>(null);

	const contextSafe = useCallback(<T extends (...args: any[]) => any>(fn: T): T => {
		return ((...args: any[]) => {
			if (contextRef.current) {
				return contextRef.current.add(() => fn(...args));
			}
			return fn(...args);
		}) as T;
	}, []);

	useEffect(() => {
		if (callback) {
			contextRef.current = gsap.context(callback);
		}

		return () => {
			contextRef.current?.revert();
		};
	}, deps || []);

	const revert = useCallback(() => {
		contextRef.current?.revert();
	}, []);

	return { context: contextRef, revert, contextSafe };
}

interface ScrollTriggerOptions {
	start?: string;
	end?: string;
	[key: string]: unknown;
}

export function useScrollTrigger(
	triggerRef: React.RefObject<HTMLElement>,
	options: ScrollTriggerOptions = {}
) {
	const triggerRefInternal = useRef<ScrollTrigger | null>(null);

	useEffect(() => {
		if (!triggerRef.current) return;

		const { start, end, ...rest } = options;

		triggerRefInternal.current = ScrollTrigger.create({
			trigger: triggerRef.current,
			start: start || 'top center',
			end: end || 'bottom center',
			...rest,
		});

		return () => {
			triggerRefInternal.current?.kill();
		};
	}, [triggerRef, options.start, options.end]);

	return triggerRefInternal;
}
