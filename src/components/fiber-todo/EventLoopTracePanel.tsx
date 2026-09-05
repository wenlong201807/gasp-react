import styles from './FiberTodo.module.css';
import type { EventLoopEvent, EventLoopQueue, PipelineRecord } from './types';

interface EventLoopTracePanelProps {
	record: PipelineRecord | null;
}

const queueLabel: Record<EventLoopQueue, string> = {
	'user-interaction': '用户交互 Task',
	scheduler: 'React Scheduler Task',
	timer: 'Timer Task',
	microtask: 'Microtask',
	rendering: '渲染阶段',
	unknown: '未归类',
};

const phaseLabel: Record<EventLoopEvent['phase'], string> = {
	input: '输入',
	task: 'Task / 宏任务',
	microtask: '微任务',
	'react-render': 'React render',
	'react-commit': 'React commit',
	'dom-mutation': '真实 DOM mutation',
	raf: 'requestAnimationFrame',
	animation: '动画',
	'long-task': 'Long Task',
	heap: 'Heap',
};

const format = (value: number) => `${value.toFixed(2)} ms`;

export function EventLoopTracePanel({ record }: EventLoopTracePanelProps) {
	const trace = record?.trace;
	const events = trace?.events ?? [];
	const longTasks = trace?.longTasks ?? [];
	const longest = longTasks.reduce((max, item) => Math.max(max, item.duration), 0);

	return (
		<section className={styles.panel} aria-label="事件循环完整链路">
			<h3 className={styles.panelTitle}>事件循环 · 完整操作链路</h3>
			{!trace ? (
				<p className={styles.hint}>
					执行一次 Todo 操作后，展示 Task → 微任务 → React → DOM → rAF 链路
				</p>
			) : (
				<>
					<div className={styles.kv}>
						<span>operationId</span>
						<b className={styles.mono}>{trace.operationId}</b>
					</div>
					{trace.source && (
						<div className={styles.kv}>
							<span>入口源码</span>
							<b>
								{trace.source.file}:{trace.source.line ?? '—'} · {trace.source.functionName}
							</b>
						</div>
					)}
					<div className={styles.traceTimeline}>
						{events.map((event) => (
							<div className={styles.traceEvent} key={`${event.sequence}-${event.phase}`}>
								<span className={styles.traceSequence}>#{event.sequence}</span>
								<span className={styles.tracePhase}>{phaseLabel[event.phase]}</span>
								<span className={styles.traceQueue}>{queueLabel[event.queue]}</span>
								<span>{format(event.duration)}</span>
								{event.detail && <small>{event.detail}</small>}
							</div>
						))}
					</div>
					<div className={styles.kv}>
						<span>Long Task</span>
						<b className={longest > 50 ? styles.bad : styles.good}>
							{longTasks.length} 次 · 最长 {longTasks.length ? format(longest) : '—'}
						</b>
					</div>
					{longTasks.map((task, index) => (
						<div className={styles.traceWarning} key={`${task.startTime}-${task.duration}`}>
							Long Task #{index + 1}：{format(task.duration)} · 重叠：
							{task.overlaps.length ? task.overlaps.join('、') : '未归因'}
						</div>
					))}
					<div className={styles.kv}>
						<span>Heap used</span>
						<b>
							{trace.heap.supported
								? `${trace.heap.before ? `${(trace.heap.before / 1024 / 1024).toFixed(2)} MB` : '—'} → ${trace.heap.after ? `${(trace.heap.after / 1024 / 1024).toFixed(2)} MB` : '—'}（Δ ${trace.heap.delta !== undefined ? `${(trace.heap.delta / 1024 / 1024).toFixed(2)} MB` : '—'}）`
								: '当前浏览器不支持 performance.memory'}
						</b>
					</div>
					<p className={styles.hint}>
						overlap 表示时间区间重叠，不代表唯一根因；精确分配栈请使用 DevTools Allocation
						instrumentation。
					</p>
				</>
			)}
		</section>
	);
}
