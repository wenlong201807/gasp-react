export interface Todo {
	id: string;
	text: string;
	done: boolean;
	exiting?: boolean;
	hidden?: boolean; // 筛选隐藏：坍缩保留在 DOM，恢复时展开
}

/** key 策略：id = 稳定 key（Fiber 复用 + DOM 真实移动）；index = 位置 key（内容原地变） */
export type KeyMode = 'id' | 'index';

/** MutationObserver 统计的真实 DOM 变更（同节点先删后加折算为 moved） */
export interface DiffStats {
	inserted: number;
	removed: number;
	moved: number;
	textUpdated: number;
	attrUpdated: number;
}

/** 编排层统计的动画数 */
export interface FlipStats {
	entered: number;
	exited: number;
	moved: number;
}

/** 动画窗口内的帧统计（gsap.ticker deltaTime） */
export interface FrameStats {
	frameCount: number;
	avgMs: number;
	maxMs: number;
	jankCount: number; // 帧间隔 > 32ms
}

/** A browser event-loop phase captured for one Todo operation. */
export type EventLoopPhase =
	| 'input'
	| 'task'
	| 'microtask'
	| 'react-render'
	| 'react-commit'
	| 'dom-mutation'
	| 'raf'
	| 'animation'
	| 'long-task'
	| 'heap';

export type EventLoopQueue =
	| 'user-interaction'
	| 'scheduler'
	| 'timer'
	| 'microtask'
	| 'rendering'
	| 'unknown';

export interface SourceLocation {
	file: string;
	functionName: string;
	line?: number;
	column?: number;
}

export interface EventLoopEvent {
	sequence: number;
	operationId: string;
	phase: EventLoopPhase;
	queue: EventLoopQueue;
	startTime: number;
	endTime: number;
	duration: number;
	source?: SourceLocation;
	detail?: string;
}

export interface LongTaskTrace {
	startTime: number;
	endTime: number;
	duration: number;
	attribution?: string;
	overlaps: string[];
}

export interface HeapTrace {
	supported: boolean;
	before?: number;
	peak?: number;
	after?: number;
	delta?: number;
}

export interface EventLoopTrace {
	operationId: string;
	source?: SourceLocation;
	events: EventLoopEvent[];
	longTasks: LongTaskTrace[];
	heap: HeapTrace;
}
/** 一次操作的流水线记录 */
export interface PipelineRecord {
	seq: number;
	op: string;
	operationId: string;
	source?: SourceLocation;
	t0: number;
	triggerToCommitMs: number;
	renderMs: number;
	diff: DiffStats;
	flip: FlipStats;
	frames: FrameStats | null;
	consistent: boolean | null;
	trace: EventLoopTrace;
}

export interface FlipIntent {
	exitIds: Set<string>; // 本轮离场（DOM 保留坍缩，动画后清理 commit 移除）
	hideIds: Set<string>; // 筛选隐藏（坍缩动画但不计 exited——节点未从 DOM 移除）
	enterIds: Set<string>; // filter 恢复展开的项
	changeIds: Set<string>; // 内容变化高亮
}
