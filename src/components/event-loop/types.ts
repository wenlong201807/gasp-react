export type Phase = 'task' | 'microtask' | 'render';

export type ActiveRegion =
	| 'code'
	| 'stack'
	| 'webapis'
	| 'macro'
	| 'micro'
	| 'console'
	| 'render';

export type StepEvent =
	| 'push'
	| 'pop'
	| 'enqueue'
	| 'dequeue'
	| 'callback-run'
	| 'render-frame';

export interface QueueItem {
	id: string;
	label: string;
	kind: 'macro' | 'micro';
}

export interface StackFrame {
	id: string;
	label: string;
}

export interface WebApiEntry {
	id: string;
	label: string;
	type: 'timer' | 'raf';
	remainingMs: number;
}

export interface Step {
	id: number;
	title: string;
	phase: Phase;
	codeLine: number | null;
	stack: StackFrame[];
	webApis: WebApiEntry[];
	macroQueue: QueueItem[];
	microQueue: QueueItem[];
	consoleLines: string[];
	active: ActiveRegion[];
	event: StepEvent | null;
}

export type PresetId = 'basic' | 'await' | 'render';

export interface Preset {
	id: PresetId;
	title: string;
	difficulty: 1 | 2 | 3;
	code: string;
	expectedOutput: string[];
	trace: Step[];
}

export interface CompiledAnimation {
	lottieJson: Record<string, unknown>;
	frameMap: number[];
	totalFrames: number;
}
