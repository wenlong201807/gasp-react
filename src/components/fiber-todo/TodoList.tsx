import { Profiler, useLayoutEffect, useRef } from 'react';
import styles from './FiberTodo.module.css';
import { TodoItem } from './TodoItem';
import type { FlipIntent, FlipStats, KeyMode, Todo } from './types';

interface TodoListProps {
	todos: Todo[];
	keyMode: KeyMode;
	version: number;
	intent: FlipIntent;
	play: (intent: FlipIntent, onComplete: (stats: FlipStats) => void) => FlipStats;
	/** round = 触发本次回放的 version；页面层用它做迟到回调守卫 */
	onFlipComplete: (round: number, stats: FlipStats) => void;
	onToggle: (id: string) => void;
	onEdit: (id: string, text: string) => void;
	onRemove: (id: string) => void;
	onProfilerRender: (info: {
		id: string;
		phase: 'mount' | 'update' | 'nested-update';
		actualDuration: number;
		baseDuration: number;
		startTime: number;
		commitTime: number;
	}) => void;
}

export function TodoList({
	todos,
	keyMode,
	version,
	intent,
	play,
	onFlipComplete,
	onToggle,
	onEdit,
	onRemove,
	onProfilerRender,
}: TodoListProps) {
	const playedVersionRef = useRef(-1);

	// 编排按"操作"粒度触发：version 不变（如离场清理 commit）不回放
	useLayoutEffect(() => {
		if (playedVersionRef.current === version) return;
		playedVersionRef.current = version;
		play(intent, (stats) => onFlipComplete(version, stats));
	}, [version, intent, play, onFlipComplete]);

	const handleProfilerRender: React.ProfilerOnRenderCallback = (
		id,
		phase,
		actualDuration,
		baseDuration,
		startTime,
		commitTime
	) => {
		onProfilerRender({ id, phase, actualDuration, baseDuration, startTime, commitTime });
	};

	return (
		<div className={styles.listWrap}>
			<Profiler id="TodoList" onRender={handleProfilerRender}>
				<ul className={styles.todoList}>
					{todos.map((todo, i) => (
						<TodoItem
							key={keyMode === 'id' ? todo.id : i}
							todo={todo}
							onToggle={onToggle}
							onEdit={onEdit}
							onRemove={onRemove}
						/>
					))}
				</ul>
			</Profiler>
			{todos.length === 0 && <p className={styles.empty}>列表为空，添加一条试试</p>}
		</div>
	);
}
