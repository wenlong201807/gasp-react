import { useCallback, useMemo, useRef, useState } from 'react';
import { EventLoopTracePanel } from './EventLoopTracePanel';
import { FiberDiffPanel } from './FiberDiffPanel';
import styles from './FiberTodo.module.css';
import { RenderPipelinePanel } from './RenderPipelinePanel';
import { TodoList } from './TodoList';
import type { FlipIntent, FlipStats, KeyMode, PipelineRecord, Todo } from './types';
import { useDomMutationStats } from './useDomMutationStats';
import { useEventLoopTrace } from './useEventLoopTrace';
import { useFlipList } from './useFlipList';
import { useFrameStats } from './useFrameStats';

const WINDOW_TIMEOUT_MS = 2000; // 兜底：覆盖动画 400ms + 清理 commit + 2 帧宽限
const MAX_RECORDS = 20;
const EMPTY_STATS: FlipStats = { entered: 0, exited: 0, moved: 0 };

const makeId = () =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const seed = (): Todo[] => [
	{ id: makeId(), text: '学习 React Fiber：render → reconcile → commit', done: false },
	{ id: makeId(), text: '给 Todo 增删改查加上 FLIP 动画', done: false },
	{ id: makeId(), text: '监控动画全链路性能', done: true },
	{ id: makeId(), text: '对照 key=id 与 key=index 的 diff 差异', done: false },
];

const STRESS_LABELS = ['对齐颗粒度', '拉通底盘', '闭环交付', '抓手落地', '顶层设计', '底层逻辑'];

let seq = 0;

export function FiberTodoPage() {
	const [todos, setTodos] = useState<Todo[]>(seed);
	const [draft, setDraft] = useState('');
	const [query, setQuery] = useState('');
	const [keyMode, setKeyMode] = useState<KeyMode>('id');
	const [records, setRecords] = useState<PipelineRecord[]>([]);
	const [version, setVersion] = useState(0);

	const listRef = useRef<HTMLDivElement>(null);
	const { open: openWindow, close: closeWindow, supported } = useDomMutationStats(listRef);
	const { start: startFrames, stop: stopFrames } = useFrameStats();
	const { capture, play } = useFlipList();
	const eventTrace = useEventLoopTrace();

	const accRef = useRef<Partial<PipelineRecord>>({});
	const t0Ref = useRef(0);
	const intentRef = useRef<FlipIntent>({
		exitIds: new Set(),
		hideIds: new Set(),
		enterIds: new Set(),
		changeIds: new Set(),
	});
	const windowOpenRef = useRef(false);
	/** 当前打开的统计窗口所属的操作轮次（= version）；迟到回调据此丢弃 */
	const activeRoundRef = useRef(0);
	const timeoutIdRef = useRef(0);
	const commitsRef = useRef<Array<{ commitTime: number; actualDuration: number }>>([]);

	/** 统计窗口内的可见列表：过滤命中的 + 正在离场的（保持挂载以播完坍缩动画） */
	const listTodos = useMemo(() => {
		const q = query.trim().toLowerCase();
		return todos.filter(
			(t) => t.exiting || t.hidden || q === '' || t.text.toLowerCase().includes(q)
		);
	}, [todos, query]);

	/** 关窗出数：汇总一条流水线记录（轮次不符 = 迟到回调，直接丢弃） */
	const finalizeWindow = useCallback(
		(round: number, flipStats: FlipStats, truncated = false) => {
			if (!windowOpenRef.current || round !== activeRoundRef.current) return;
			windowOpenRef.current = false;
			window.clearTimeout(timeoutIdRef.current);

			const trace = eventTrace.finish();
			const diff = closeWindow();
			const frames = stopFrames();
			const commits = commitsRef.current;
			commitsRef.current = [];
			const acc = accRef.current;

			const renderMs = Math.round(commits.reduce((s, c) => s + c.actualDuration, 0) * 100) / 100;
			const firstCommit = commits[0];

			if (!diff && commits.length === 0) return; // 无有效数据（如空操作）

			const inserted = diff?.inserted ?? 0;
			const removed = diff?.removed ?? 0;
			const record: PipelineRecord = {
				seq: acc.seq ?? 0,
				op: acc.op ?? 'unknown',
				operationId: trace?.operationId ?? `todo-unknown-${acc.seq ?? 0}`,
				source: trace?.source,
				t0: t0Ref.current,
				triggerToCommitMs:
					firstCommit !== undefined
						? Math.round((firstCommit.commitTime - t0Ref.current) * 100) / 100
						: -1,
				renderMs,
				diff: {
					inserted,
					removed,
					moved: diff?.moved ?? 0,
					textUpdated: diff?.textUpdated ?? 0,
					attrUpdated: diff?.attrUpdated ?? 0,
				},
				flip: flipStats,
				frames,
				// 截断轮（被打断/超时）窗口未走完整链路，不作一致性判定，UI 显示"统计不可用"
				consistent: diff
					? truncated
						? null
						: inserted === flipStats.entered && removed === flipStats.exited
					: null,
				trace: trace ?? {
					operationId: `todo-unknown-${acc.seq ?? 0}`,
					events: [],
					longTasks: [],
					heap: { supported: false },
				},
			};
			setRecords((prev) => [record, ...prev].slice(0, MAX_RECORDS));
		},
		[closeWindow, stopFrames, eventTrace]
	);

	/** 开新窗口：上一窗口未关则按其轮次强制出数（动画被打断的场景） */
	const beginOp = useCallback(
		(op: string) => {
			if (windowOpenRef.current) {
				finalizeWindow(activeRoundRef.current, EMPTY_STATS, true);
			}
			seq += 1;
			const round = activeRoundRef.current + 1;
			activeRoundRef.current = round;
			t0Ref.current = performance.now();
			accRef.current = { seq, op };
			eventTrace.start(op, {
				file: 'src/components/fiber-todo/FiberTodoPage.tsx',
				functionName: 'beginOp',
				line: 109,
			});
			eventTrace.scheduleMicrotask();
			eventTrace.scheduleRaf();
			intentRef.current = {
				exitIds: new Set(),
				hideIds: new Set(),
				enterIds: new Set(),
				changeIds: new Set(),
			};
			commitsRef.current = [];
			openWindow();
			startFrames();
			capture();
			windowOpenRef.current = true;
			timeoutIdRef.current = window.setTimeout(() => {
				finalizeWindow(round, EMPTY_STATS, true); // 超时=截断轮
			}, WINDOW_TIMEOUT_MS);
		},
		[finalizeWindow, openWindow, startFrames, capture]
	);

	/** Flip 全部动画结束：清理 exiting 项（基于 state 而非本轮 intent，被中断轮遗留项一并回收），再 +2 帧宽限关窗 */
	const handleFlipComplete = useCallback(
		(round: number, stats: FlipStats) => {
			if (round !== activeRoundRef.current) return; // 被打断轮次的迟到回调，丢弃
			// 无 exiting 时返回原引用，React bail out，不产生多余 commit
			// hidden 项不属于清理对象（由筛选恢复）
			setTodos((prev) => (prev.some((t) => t.exiting) ? prev.filter((t) => !t.exiting) : prev));
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					finalizeWindow(round, stats);
				})
			);
		},
		[finalizeWindow]
	);

	const handleProfilerRender = useCallback(
		(info: {
			id: string;
			phase: 'mount' | 'update' | 'nested-update';
			actualDuration: number;
			baseDuration: number;
			startTime: number;
			commitTime: number;
		}) => {
			// 注：生产构建下 Profiler onRender 不触发，triggerToCommitMs=-1 / renderMs=0 属预期
			if (!windowOpenRef.current) return; // keyMode 切换等非操作 commit 不计
			const commits = commitsRef.current;
			const last = commits[commits.length - 1];
			if (last && last.commitTime === info.commitTime) return; // StrictMode/重复去重
			commits.push(info);
		},
		[]
	);

	const bump = () => setVersion(activeRoundRef.current);

	const add = () => {
		const text = draft.trim();
		if (!text) return;
		beginOp(`add "${text.slice(0, 10)}"`);
		setTodos((prev) => prev.filter((t) => !t.exiting).concat({ id: makeId(), text, done: false }));
		setDraft('');
		bump();
	};

	const remove = (id: string) => {
		beginOp('remove');
		intentRef.current.exitIds.add(id);
		setTodos((prev) =>
			prev.filter((t) => !t.exiting).map((t) => (t.id === id ? { ...t, exiting: true } : t))
		);
		bump();
	};

	const toggle = (id: string) => {
		beginOp('toggle');
		intentRef.current.changeIds.add(id);
		setTodos((prev) =>
			prev.filter((t) => !t.exiting).map((t) => (t.id === id ? { ...t, done: !t.done } : t))
		);
		bump();
	};

	const edit = (id: string, text: string) => {
		beginOp(`edit "${text.slice(0, 10)}"`);
		intentRef.current.changeIds.add(id);
		setTodos((prev) =>
			prev.filter((t) => !t.exiting).map((t) => (t.id === id ? { ...t, text } : t))
		);
		bump();
	};

	const reorder = (label: string, next: Todo[]) => {
		beginOp(label);
		if (keyMode === 'index') {
			// 槽位内容变化 → 高亮（index key 下无位移，内容原地变）
			const base = todos.filter((t) => !t.exiting);
			const changed = new Set(
				next.filter((t, i) => base[i] !== undefined && base[i].id !== t.id).map((t) => t.id)
			);
			intentRef.current.changeIds = changed;
		}
		setTodos(next);
		bump();
	};

	const shuffle = () => {
		const base = todos.filter((t) => !t.exiting);
		const next = base.slice();
		for (let i = next.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[next[i], next[j]] = [next[j], next[i]];
		}
		reorder(`shuffle (${keyMode} key)`, next);
	};

	const sortByDone = () => {
		const base = todos.filter((t) => !t.exiting);
		const next = base.slice().sort((a, b) => Number(a.done) - Number(b.done));
		reorder(`sort by done (${keyMode} key)`, next);
	};

	const runFilter = (q: string) => {
		beginOp(`filter "${q.trim() || '∅'}"`);
		const lower = q.trim().toLowerCase();
		const next = todos.map((t) => {
			const match = q.trim() === '' || t.text.toLowerCase().includes(lower);
			if (!match) {
				// 隐藏（非删除）：坍缩保留在 DOM，恢复时展开；不计 exited（节点未移除）
				intentRef.current.hideIds.add(t.id);
				return t.hidden ? t : { ...t, hidden: true };
			}
			if (t.hidden) {
				intentRef.current.enterIds.add(t.id);
				return { ...t, hidden: false };
			}
			return t;
		});
		setTodos(next);
		bump();
	};

	const stress = () => {
		beginOp('stress +100');
		const added: Todo[] = Array.from({ length: 100 }, (_, i) => ({
			id: makeId(),
			text: `${STRESS_LABELS[i % STRESS_LABELS.length]} #${i + 1}`,
			done: false,
		}));
		setTodos((prev) => prev.filter((t) => !t.exiting).concat(added));
		bump();
	};

	const switchKeyMode = (mode: KeyMode) => {
		if (windowOpenRef.current) {
			// 截断在飞窗口：keyMode 切换是配置变更，其全量 remount 不计入统计
			finalizeWindow(activeRoundRef.current, EMPTY_STATS, true);
		}
		setKeyMode(mode);
	};

	return (
		<div className={styles.page}>
			<header className={styles.header}>
				<h1 className={styles.title}>React Fiber · 增删改查真实 DOM 动画</h1>
				<p className={styles.subtitle}>
					每次 CRUD → render → reconcile(diff) → commit → 真实 DOM 变化，动画由 Flip
					快照严格驱动，统计窗口对照 MutationObserver 验证"演的就是真的"
				</p>
			</header>

			<div className={styles.grid}>
				<section className={styles.workspace} aria-label="Todo 操作区">
					<div className={styles.toolbar}>
						<input
							className={styles.input}
							value={draft}
							placeholder="输入内容，回车或点击添加"
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') add();
							}}
						/>
						<button type="button" className={styles.btn} onClick={add}>
							添加
						</button>
					</div>
					<div className={styles.toolbar}>
						<input
							className={styles.input}
							value={query}
							placeholder="筛选（查）：输入即过滤"
							onChange={(e) => {
								setQuery(e.target.value);
								runFilter(e.target.value);
							}}
						/>
						<button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={shuffle}>
							洗牌
						</button>
						<button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={sortByDone}>
							按完成排序
						</button>
						<button type="button" className={`${styles.btn} ${styles.warn}`} onClick={stress}>
							压测 +100
						</button>
					</div>
					<div className={styles.row}>
						<span className={styles.muted}>key 策略：</span>
						<div className={styles.switch} role="group" aria-label="key 策略切换">
							<button
								type="button"
								className={`${styles.switchBtn} ${keyMode === 'id' ? styles.active : ''}`}
								onClick={() => switchKeyMode('id')}
							>
								key=id（复用+移动）
							</button>
							<button
								type="button"
								className={`${styles.switchBtn} ${keyMode === 'index' ? styles.active : ''}`}
								onClick={() => switchKeyMode('index')}
							>
								key=index（内容原地变）
							</button>
						</div>
					</div>

					<div ref={listRef}>
						<TodoList
							todos={listTodos}
							keyMode={keyMode}
							version={version}
							intent={intentRef.current}
							play={play}
							onFlipComplete={handleFlipComplete}
							onToggle={toggle}
							onEdit={edit}
							onRemove={remove}
							onProfilerRender={handleProfilerRender}
						/>
					</div>
				</section>

				<div className={styles.panels}>
					<FiberDiffPanel records={records} supported={supported} />
					<RenderPipelinePanel record={records[0] ?? null} />
					<EventLoopTracePanel record={records[0] ?? null} />
				</div>
			</div>
		</div>
	);
}
