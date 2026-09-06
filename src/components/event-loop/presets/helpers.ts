import type {
	ActiveRegion,
	Phase,
	QueueItem,
	StackFrame,
	Step,
	StepEvent,
	WebApiEntry,
} from '../types';

export const sf = (id: string, label: string): StackFrame => ({ id, label });

export const q = (id: string, label: string, kind: 'macro' | 'micro'): QueueItem => ({
	id,
	label,
	kind,
});

export const timer = (id: string, label: string): WebApiEntry => ({
	id,
	label,
	type: 'timer',
	remainingMs: 0,
});

export const raf = (id: string, label: string): WebApiEntry => ({
	id,
	label,
	type: 'raf',
	remainingMs: 0,
});

interface StepInput {
	title: string;
	phase: Phase;
	line?: number;
	ev?: StepEvent;
	stack?: StackFrame[];
	webApis?: WebApiEntry[];
	macro?: QueueItem[];
	micro?: QueueItem[];
	console?: string[];
	active?: ActiveRegion[];
}

export const step = (s: StepInput): Step => ({
	id: 0,
	title: s.title,
	phase: s.phase,
	codeLine: s.line ?? null,
	stack: s.stack ?? [],
	webApis: s.webApis ?? [],
	macroQueue: s.macro ?? [],
	microQueue: s.micro ?? [],
	consoleLines: s.console ?? [],
	active: s.active ?? [],
	event: s.ev ?? null,
});

export const withIds = (steps: Step[]): Step[] => steps.map((s, i) => ({ ...s, id: i }));
