import { useEffect, useRef, useCallback } from 'react';
import { gsap, ScrollTrigger } from '@/utils/gsap';

export function useGSAP(callback?: () => void, deps?: React.DependencyList) {
  const contextRef = useRef<gsap.Context | null>(null);

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

  return { context: contextRef, revert };
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