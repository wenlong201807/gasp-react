import { useCallback, useEffect, useRef } from 'react';
import type {
	EventLoopEvent,
	EventLoopPhase,
	EventLoopQueue,
	EventLoopTrace,
	HeapTrace,
	LongTaskTrace,
	SourceLocation,
} from './types';

interface MemoryLike {
	usedJSHeapSize: number;
}

interface TraceHandle {
	operationId: string;
	source?: SourceLocation;
	trace: EventLoopTrace;
}

const MAX_EVENTS = 250;
const MAX_TRACES = 20;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const readHeap = (): number | undefined => {
	if (typeof performance === 'undefined') return undefined;
	const memory = (performance as Performance & { memory?: MemoryLike }).memory;
	return memory?.usedJSHeapSize;
};

const overlap = (event: EventLoopEvent, task: LongTaskTrace) =>
	event.startTime < task.endTime && event.endTime > task.startTime;

export function useEventLoopTrace() {
	const activeRef = useRef<TraceHandle | null>(null);
	const tracesRef = useRef<EventLoopTrace[]>([]);
	const sequenceRef = useRef(0);
	const rafIdsRef = useRef<number[]>([]);
	const observerRef = useRef<PerformanceObserver | null>(null);

	const addEvent = useCallback(
		(
			phase: EventLoopPhase,
			queue: EventLoopQueue,
			startTime: number,
			endTime: number,
			source?: SourceLocation,
			detail?: string
		) => {
			const active = activeRef.current;
			if (!active) return;
			const event: EventLoopEvent = {
				sequence: ++sequenceRef.current,
				operationId: active.operationId,
				phase,
				queue,
				startTime,
				endTime,
				duration: Math.max(0, endTime - startTime),
				source: source ?? active.source,
				detail,
			};
			active.trace.events.push(event);
			if (active.trace.events.length > MAX_EVENTS) active.trace.events.shift();
		},
		[]
	);

	const finish = useCallback(() => {
		const active = activeRef.current;
		if (!active) return null;
		const end = now();
		const before = active.trace.heap.before;
		const after = readHeap();
		active.trace.heap.after = after;
		active.trace.heap.peak =
			Math.max(active.trace.heap.peak ?? before ?? 0, after ?? 0) || undefined;
		if (before !== undefined && after !== undefined) active.trace.heap.delta = after - before;
		addEvent('animation', 'rendering', end, end, undefined, 'operation complete');
		activeRef.current = null;
		tracesRef.current = [active.trace, ...tracesRef.current].slice(0, MAX_TRACES);
		return active.trace;
	}, [addEvent]);

	const start = useCallback(
		(op: string, source: SourceLocation): TraceHandle => {
			if (activeRef.current) finish();
			const operationId = `todo-${Date.now().toString(36)}-${(++sequenceRef.current).toString(36)}`;
			const startTime = now();
			const heap = readHeap();
			const trace: EventLoopTrace = {
				operationId,
				source,
				events: [],
				longTasks: [],
				heap: { supported: heap !== undefined, before: heap, peak: heap },
			};
			activeRef.current = { operationId, source, trace };
			addEvent('input', 'user-interaction', startTime, startTime, source, op);
			addEvent('task', 'user-interaction', startTime, now(), source, `${op} handler start`);
			if (typeof performance !== 'undefined') {
				performance.mark(`${operationId}:start`);
			}
			return activeRef.current;
		},
		[addEvent, finish]
	);

	const mark = useCallback(
		(phase: EventLoopPhase, queue: EventLoopQueue, detail: string, source?: SourceLocation) => {
			const operationId = activeRef.current?.operationId;
			const startTime = now();
			const startMark = operationId ? `todo:${operationId}:${phase}:start` : undefined;
			if (startMark && typeof performance !== 'undefined') {
				try {
					performance.mark(startMark);
				} catch {
					// User Timing is optional and must not affect the operation.
				}
			}
			return () => {
				const endTime = now();
				addEvent(phase, queue, startTime, endTime, source, detail);
				if (!operationId || typeof performance === 'undefined') return;
				const endMark = `todo:${operationId}:${phase}:end`;
				try {
					performance.mark(endMark);
					performance.measure(`todo:${operationId}:${phase}`, startMark, endMark);
				} catch {
					// User Timing is optional and must not affect the operation.
				}
			};
		},
		[addEvent]
	);

	const scheduleMicrotask = useCallback(
		(detail = 'microtask checkpoint') => {
			if (typeof queueMicrotask !== 'function') return;
			const scheduled = now();
			queueMicrotask(() => addEvent('microtask', 'microtask', scheduled, now(), undefined, detail));
		},
		[addEvent]
	);

	const scheduleRaf = useCallback(
		(detail = 'rendering opportunity') => {
			if (typeof requestAnimationFrame !== 'function') return;
			const scheduled = now();
			const id = requestAnimationFrame(() => {
				const end = now();
				addEvent('raf', 'rendering', scheduled, end, undefined, detail);
				rafIdsRef.current = rafIdsRef.current.filter((value) => value !== id);
			});
			rafIdsRef.current.push(id);
		},
		[addEvent]
	);

	useEffect(() => {
		if (typeof PerformanceObserver === 'undefined') return;
		try {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					const active = activeRef.current;
					if (!active) continue;
					const task: LongTaskTrace = {
						startTime: entry.startTime,
						endTime: entry.startTime + entry.duration,
						duration: entry.duration,
						attribution: 'self',
						overlaps: active.trace.events
							.filter((event) =>
								overlap(event, {
									startTime: entry.startTime,
									endTime: entry.startTime + entry.duration,
									duration: entry.duration,
									overlaps: [],
								})
							)
							.map((event) => `${event.phase}:${event.detail ?? 'event'}`),
					};
					active.trace.longTasks.push(task);
					addEvent(
						'long-task',
						'unknown',
						task.startTime,
						task.endTime,
						undefined,
						task.overlaps.join(', ')
					);
				}
			});
			observer.observe({ entryTypes: ['longtask'] });
			observerRef.current = observer;
		} catch {
			observerRef.current = null;
		}
		return () => {
			observerRef.current?.disconnect();
			observerRef.current = null;
			for (const id of rafIdsRef.current) cancelAnimationFrame(id);
			rafIdsRef.current = [];
			activeRef.current = null;
		};
	}, [addEvent]);

	return {
		start,
		mark,
		scheduleMicrotask,
		scheduleRaf,
		finish,
		active: activeRef,
		traces: tracesRef,
	};
}

export type { HeapTrace };
