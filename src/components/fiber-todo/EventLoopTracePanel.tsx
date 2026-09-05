import styles from './FiberTodo.module.css';
import type { EventLoopEvent, EventLoopQueue, PipelineRecord } from './types';

interface EventLoopTracePanelProps { record: PipelineRecord | null; }
const queueLabel: Record<EventLoopQueue, string> = {
	'user-interaction': '用户交互 Task', scheduler: 'React Scheduler Task', timer: 'Timer Task',
	microtask: 'Microtask', rendering: '渲染阶段', unknown: '未归类',
};
const phaseLabel: Record<EventLoopEvent['phase'], string> = {
	input: '输入', task: 'Task / 宏任务', microtask: '微任务', 'react-render': 'React render',
	'react-commit': 'React commit', 'dom-mutation': '真实 DOM mutation', raf: 'requestAnimationFrame',
	animation: '动画', 'long-task': 'Long Task', heap: 'Heap',
};
const format = (value: number) => `${value.toFixed(2)} ms`;
const sourceText = (source?: EventLoopEvent['source']) => source ? `${source.file}:${source.line ?? '—'} · ${source.functionName}` : '浏览器仅提供时间区间，未归因';

export function EventLoopTracePanel({ record }: EventLoopTracePanelProps) {
	const trace = record?.trace;
	const events = trace?.events ?? [];
	const longTasks = trace?.longTasks ?? [];
	const longest = longTasks.reduce((max, item) => Math.max(max, item.duration), 0);
	return <section className={styles.panel} aria-label="事件循环完整链路">
		<h3 className={styles.panelTitle}>事件循环 · 操作与源码定位</h3>
		{!trace ? <p className={styles.hint}>执行一次 Todo 操作后，展示 Task → 微任务 → React → DOM → rAF 链路。</p> : <>
			<div className={styles.kv}><span>本次操作</span><b>#{record?.seq} {record?.op}</b></div>
			<div className={styles.kv}><span>operationId（定位键）</span><b className={styles.mono}>{trace.operationId}</b></div>
			{trace.source && <div className={styles.kv}><span>入口源码</span><b>{sourceText(trace.source)}</b></div>}
			<div className={styles.traceTimeline}>{events.map((event) => <div className={styles.traceEvent} key={`${event.sequence}-${event.phase}`}>
				<span className={styles.traceSequence}>#{event.sequence}</span><span className={styles.tracePhase}>{phaseLabel[event.phase]}</span><span className={styles.traceQueue}>{queueLabel[event.queue]}</span><span>{format(event.duration)}</span>
				{event.detail && <small>{event.detail} · {sourceText(event.source)}</small>}
			</div>)}</div>
			<div className={styles.traceWarning}><b>Long Task：{longTasks.length} 次，最长 {longTasks.length ? format(longest) : '—'}</b><br />判定阈值：主线程连续阻塞 &gt;50ms。下方重叠仅表示同一时间窗口，不代表唯一根因。</div>
			{longTasks.map((task, index) => <div className={styles.kv} key={`${task.startTime}-${task.duration}`}><span>Long Task #{index + 1}</span><b>{format(task.duration)} · {task.overlaps.length ? `重叠：${task.overlaps.join('、')}` : '未观测到重叠阶段'}</b></div>)}
			<div className={styles.kv}><span>heapUsedSize（窗口线索）</span><b>{trace.heap.supported ? `${trace.heap.before ? (trace.heap.before / 1024 / 1024).toFixed(2) : '—'} → ${trace.heap.after ? (trace.heap.after / 1024 / 1024).toFixed(2) : '—'} MB · Δ ${trace.heap.delta !== undefined ? (trace.heap.delta / 1024 / 1024).toFixed(2) : '—'} MB` : '不支持 performance.memory'}</b></div>
			<p className={styles.hint}><b>具体定位：</b>先复制 operationId，在本面板找到对应 Long Task 和 React/DOM/动画重叠；再在 DevTools Performance 录制同一操作，按 User Timing 的 operationId 对齐 Main 线程，最后用 Call Tree / Bottom-Up 与 source map 确认真实调用栈。面板里的入口源码是埋点位置，不等于 Long Task 唯一根因。</p>
		</>}
	</section>;
}
