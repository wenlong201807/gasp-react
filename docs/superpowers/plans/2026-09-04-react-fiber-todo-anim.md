# React Fiber Todo 动画演示页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个演示页：Todo 增删改查时，GSAP Flip 动画严格呈现 React Fiber commit 产生的真实 DOM 变化，并全链路监控性能（触发→render→commit→DOM 变更→动画帧）。

**Architecture:** 页面级编排器 `FiberTodoPage` 持有 todos 状态与"操作统计窗口"（MutationObserver 开窗/关窗、gsap.ticker 帧采样、Profiler 计时）；`TodoList` 为 Flip 编排层（快照→commit→回放），`useFlipList` 封装快照/回放/离场坍缩，两个面板展示 diff 对照与管线耗时。路由跟随现有 `App.tsx` switch 模式。

**Tech Stack:** React 18 + TS + Vite、GSAP 3.12（Flip 插件）、MutationObserver、React Profiler API、CSS Modules（`index.css` 已有 `--color-*` 变量；**项目无 Tailwind，禁用其类名**）。

**规格:** `docs/superpowers/specs/2026-09-04-react-fiber-todo-anim-design.md`（已按计划阶段修订：窗口兜底 2s、filter 恢复机制、keyMode 切换不计统计）

**测试约定:** 项目无测试框架（规格 §8 明确不引入）。每任务的验证 = `pnpm exec tsc -b`（类型）+ `pnpm exec biome check <files>`（规范），最后任务做 `pnpm build` + `pnpm lint` + Playwright 浏览器验收。

---

### Task 1: Flip 插件注册 + 共享类型

**Files:**
- Modify: `src/utils/gsap.ts`
- Create: `src/components/fiber-todo/types.ts`

- [ ] **Step 1.1: utils/gsap.ts 注册 Flip**

```ts
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(ScrollTrigger, Flip);

export { gsap, ScrollTrigger, Flip };
```

- [ ] **Step 1.2: 创建 types.ts**

```ts
export interface Todo {
  id: string;
  text: string;
  done: boolean;
  exiting?: boolean;
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

/** 一次操作的流水线记录 */
export interface PipelineRecord {
  seq: number;
  op: string;
  t0: number;
  triggerToCommitMs: number; // Profiler commitTime - t0（无 commit 时 -1）
  renderMs: number; // 窗口内各 commit actualDuration 之和
  diff: DiffStats;
  flip: FlipStats;
  frames: FrameStats | null;
  consistent: boolean | null; // inserted===entered && removed===exited
}

/** 一次操作携带的动画意图（由页面在操作时计算，commit 后由 TodoList 消费） */
export interface FlipIntent {
  exitIds: Set<string>; // 本轮离场（DOM 保留坍缩，动画后清理 commit 移除）
  enterIds: Set<string>; // filter 恢复展开的项
  changeIds: Set<string>; // 内容变化高亮
}
```

- [ ] **Step 1.3: 验证**

Run: `pnpm exec tsc -b && pnpm exec biome check src/utils/gsap.ts src/components/fiber-todo/types.ts`
Expected: 无错误输出（biome 输出 `Checked N files in ...`，无诊断）

- [ ] **Step 1.4: Commit**

```bash
git add src/utils/gsap.ts src/components/fiber-todo/types.ts
git commit -m "feat(fiber-todo): 注册 Flip 插件并定义共享类型"
```

---

### Task 2: useDomMutationStats（真实 DOM 变更统计）

**Files:**
- Create: `src/components/fiber-todo/useDomMutationStats.ts`

- [ ] **Step 2.1: 实现**

```ts
import { useEffect, useRef } from 'react';

interface MutationWindow {
  added: Set<Node>;
  removed: Set<Node>;
  textUpdated: number;
  attrUpdated: number;
}

export interface MutationWindowResult {
  inserted: number;
  removed: number;
  moved: number;
  textUpdated: number;
  attrUpdated: number;
}

/**
 * 监听容器内真实 DOM 变更，按"操作窗口"聚合。
 * open() 开窗 → React commit 的变更流入 → close() 关窗返回统计。
 * 折算规则：窗口内加了又删 = 未发生；先删后加同一节点 = moved。
 */
export function useDomMutationStats(containerRef: React.RefObject<HTMLElement>) {
  const currentRef = useRef<MutationWindow | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof MutationObserver === 'undefined') return;

    const observer = new MutationObserver((records) => {
      const win = currentRef.current;
      if (!win) return;
      for (const record of records) {
        for (const node of record.addedNodes) win.added.add(node);
        for (const node of record.removedNodes) {
          if (win.added.has(node)) {
            win.added.delete(node);
          } else {
            win.removed.add(node);
          }
        }
        if (record.type === 'characterData') win.textUpdated += 1;
        if (record.type === 'attributes') win.attrUpdated += 1;
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });

    return () => observer.disconnect();
  }, [containerRef]);

  const open = () => {
    currentRef.current = { added: new Set(), removed: new Set(), textUpdated: 0, attrUpdated: 0 };
  };

  const close = (): MutationWindowResult | null => {
    const win = currentRef.current;
    currentRef.current = null;
    if (!win) return null;
    let moved = 0;
    for (const node of win.removed) {
      if (win.added.has(node)) moved += 1;
    }
    return {
      inserted: win.added.size - moved,
      removed: win.removed.size - moved,
      moved,
      textUpdated: win.textUpdated,
      attrUpdated: win.attrUpdated,
    };
  };

  return { open, close, supported: typeof MutationObserver !== 'undefined' };
}
```

- [ ] **Step 2.2: 验证**

Run: `pnpm exec tsc -b && pnpm exec biome check src/components/fiber-todo/useDomMutationStats.ts`
Expected: 无错误

- [ ] **Step 2.3: Commit**

```bash
git add src/components/fiber-todo/useDomMutationStats.ts
git commit -m "feat(fiber-todo): MutationObserver 操作窗口聚合 hook"
```

---

### Task 3: useFrameStats（动画帧采样）

**Files:**
- Create: `src/components/fiber-todo/useFrameStats.ts`

- [ ] **Step 3.1: 实现**

```ts
import { useEffect, useRef } from 'react';
import { gsap } from '@/utils/gsap';
import type { FrameStats } from './types';

interface Sampling {
  count: number;
  sum: number;
  max: number;
  jank: number;
}

/**
 * 采样 gsap.ticker 帧间隔（deltaTime，ms）。
 * start() 开始采样，stop() 结束并返回统计；掉帧判定：帧间隔 > 32ms。
 */
export function useFrameStats() {
  const samplingRef = useRef<Sampling | null>(null);

  useEffect(() => {
    const tick = (_time: number, deltaTime: number) => {
      const s = samplingRef.current;
      if (!s || deltaTime <= 0) return;
      s.count += 1;
      s.sum += deltaTime;
      if (deltaTime > s.max) s.max = deltaTime;
      if (deltaTime > 32) s.jank += 1;
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  const start = () => {
    samplingRef.current = { count: 0, sum: 0, max: 0, jank: 0 };
  };

  const stop = (): FrameStats | null => {
    const s = samplingRef.current;
    samplingRef.current = null;
    if (!s || s.count === 0) return null;
    return {
      frameCount: s.count,
      avgMs: Math.round((s.sum / s.count) * 100) / 100,
      maxMs: Math.round(s.max * 100) / 100,
      jankCount: s.jank,
    };
  };

  return { start, stop };
}
```

- [ ] **Step 3.2: 验证**

Run: `pnpm exec tsc -b && pnpm exec biome check src/components/fiber-todo/useFrameStats.ts`
Expected: 无错误

- [ ] **Step 3.3: Commit**

```bash
git add src/components/fiber-todo/useFrameStats.ts
git commit -m "feat(fiber-todo): gsap.ticker 帧采样 hook"
```

---

### Task 4: useFlipList（FLIP 编排核心）

**Files:**
- Create: `src/components/fiber-todo/useFlipList.ts`

- [ ] **Step 4.1: 实现**

```ts
import { useCallback, useEffect, useRef } from 'react';
import { Flip, gsap } from '@/utils/gsap';
import type { FlipIntent, FlipStats } from './types';

export const ITEM_SELECTOR = '.fiber-todo-item';

/**
 * Flip 编排核心：
 * - capture()：操作前拍快照（Flip.getState + 各项 rect 按 data-todo-id 映射）
 * - play(intent, onComplete)：commit 后回放动画并统计动画数；
 *   entered/exited/moved 由前后 rect 映射推得，与 MutationObserver 对照。
 */
export function useFlipList() {
  const stateRef = useRef<Flip.FlipState | null>(null);
  const rectsRef = useRef<Map<string, DOMRect>>(new Map());
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    return () => {
      tlRef.current?.kill();
    };
  }, []);

  const measure = (): Map<string, DOMRect> => {
    const map = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>(ITEM_SELECTOR).forEach((el) => {
      const id = el.dataset.todoId;
      if (id) map.set(id, el.getBoundingClientRect());
    });
    return map;
  };

  const findByTodoId = (id: string): HTMLElement | null =>
    document.querySelector<HTMLElement>(`${ITEM_SELECTOR}[data-todo-id="${id}"]`);

  const capture = useCallback(() => {
    tlRef.current?.kill(); // 中断上一轮：Flip 的内建中断语义
    stateRef.current = Flip.getState(ITEM_SELECTOR);
    rectsRef.current = measure();
  }, []);

  const play = useCallback(
    (intent: FlipIntent, onComplete: (stats: FlipStats) => void): FlipStats => {
      const state = stateRef.current;
      const prev = rectsRef.current;
      stateRef.current = null;

      if (!state) {
        // 无快照（如首挂载）：不出动画，只回调
        const empty = { entered: 0, exited: 0, moved: 0 };
        onComplete(empty);
        return empty;
      }

      const next = measure();

      // 动画数统计：entered/exited/moved
      let moved = 0;
      for (const [id, rect] of next) {
        const old = prev.get(id);
        if (old && (Math.abs(old.top - rect.top) > 1 || Math.abs(old.left - rect.left) > 1)) {
          moved += 1;
        }
      }
      const entered = [...next.keys()].filter((id) => !prev.has(id)).length;
      const exited =
        [...prev.keys()].filter((id) => !next.has(id) || intent.exitIds.has(id)).length;
      const stats: FlipStats = { entered, exited, moved };

      // 多路完成计数：Flip 位移 + 离场坍缩 全部结束后才算本轮结束
      let pending = 0;
      const done = () => {
        pending -= 1;
        if (pending <= 0) onComplete(stats);
      };

      // 内容变化高亮
      for (const id of intent.changeIds) {
        const el = findByTodoId(id);
        if (el) {
          gsap.fromTo(
            el,
            { backgroundColor: 'rgba(102, 126, 234, 0.35)' },
            {
              backgroundColor: 'rgba(102, 126, 234, 0)',
              duration: 0.8,
              ease: 'power2.out',
              clearProps: 'backgroundColor',
            }
          );
        }
      }

      // 位移 / 入场回放
      pending += 1;
      tlRef.current = Flip.from(state, {
        targets: ITEM_SELECTOR,
        duration: 0.4,
        ease: 'power2.inOut',
        absolute: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { opacity: 0, scale: 0.85, y: 24 },
            { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'power2.out', clearProps: 'all' }
          ),
        onComplete: done,
      });

      // 离场：高度坍缩 + 淡出（其余项随布局连续上移）
      const exitingEls = [...intent.exitIds]
        .map(findByTodoId)
        .filter((el): el is HTMLElement => el !== null);
      if (exitingEls.length > 0) {
        pending += 1;
        gsap.to(exitingEls, {
          opacity: 0,
          scale: 0.85,
          height: 0,
          marginTop: 0,
          marginBottom: 0,
          paddingTop: 0,
          paddingBottom: 0,
          duration: 0.3,
          ease: 'power2.in',
          overwrite: 'auto',
          onComplete: done,
        });
      }

      // filter 恢复：清掉坍缩内联样式后展开入场
      for (const id of intent.enterIds) {
        const el = findByTodoId(id);
        if (el) {
          gsap.set(el, { clearProps: 'all' });
          gsap.from(el, { height: 0, opacity: 0, duration: 0.4, ease: 'power2.out' });
        }
      }

      // 无位移且无离场时 Flip.from 的 timeline 可能零时长立即完成，
      // onComplete 已挂在 Flip.from 上；零待办兜底：
      if (pending <= 0) onComplete(stats);

      return stats;
    },
    []
  );

  return { capture, play };
}
```

- [ ] **Step 4.2: 验证**

Run: `pnpm exec tsc -b && pnpm exec biome check src/components/fiber-todo/useFlipList.ts`
Expected: 无错误（若 `Flip.FlipState` 类型名报错，改用 `ReturnType<typeof Flip.getState>`）

- [ ] **Step 4.3: Commit**

```bash
git add src/components/fiber-todo/useFlipList.ts
git commit -m "feat(fiber-todo): Flip 快照编排与离场/恢复/高亮 hook"
```

---

### Task 5: TodoItem + TodoList

**Files:**
- Create: `src/components/fiber-todo/TodoItem.tsx`
- Create: `src/components/fiber-todo/TodoList.tsx`

- [ ] **Step 5.1: TodoItem.tsx**

```tsx
import type { Todo } from './types';
import styles from './FiberTodo.module.css';

interface TodoItemProps {
  todo: Todo;
  onToggle: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}

export function TodoItem({ todo, onToggle, onEdit, onRemove }: TodoItemProps) {
  return (
    <li
      data-todo-id={todo.id}
      className={`fiber-todo-item ${styles.todoItem} ${todo.done ? styles.done : ''} ${
        todo.exiting ? styles.exiting : ''
      }`}
    >
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
        aria-label={`切换完成：${todo.text}`}
      />
      <span
        className={styles.todoText}
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => {
          const text = e.currentTarget.textContent?.trim();
          if (text && text !== todo.text) onEdit(todo.id, text);
        }}
      >
        {todo.text}
      </span>
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove(todo.id)}
        aria-label={`删除：${todo.text}`}
      >
        ✕
      </button>
    </li>
  );
}
```

注：`fiber-todo-item` 原生类名是 Flip 选择器的锚点（`ITEM_SELECTOR`），与 CSS Module 并存。

- [ ] **Step 5.2: TodoList.tsx**

```tsx
import { Profiler, useLayoutEffect, useRef } from 'react';
import { TodoItem } from './TodoItem';
import type { FlipIntent, FlipStats, KeyMode, Todo } from './types';
import styles from './FiberTodo.module.css';

interface TodoListProps {
  todos: Todo[];
  keyMode: KeyMode;
  version: number;
  intent: FlipIntent;
  play: (intent: FlipIntent, onComplete: (stats: FlipStats) => void) => FlipStats;
  onFlipComplete: (stats: FlipStats) => void;
  onToggle: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onProfilerRender: (info: { actualDuration: number; commitTime: number }) => void;
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
    play(intent, onFlipComplete);
  }, [version, intent, play, onFlipComplete]);

  const handleProfilerRender: React.ProfilerOnRenderCallback = (
    _id,
    _phase,
    actualDuration,
    _baseDuration,
    _startTime,
    commitTime
  ) => {
    onProfilerRender({ actualDuration, commitTime });
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
```

- [ ] **Step 5.3: 验证**

Run: `pnpm exec tsc -b`
Expected: 无错误（`FiberTodo.module.css` 尚不存在会报模块找不到，属预期——Task 7 创建后消除；若阻塞可先建空文件）

- [ ] **Step 5.4: Commit**

```bash
git add src/components/fiber-todo/TodoItem.tsx src/components/fiber-todo/TodoList.tsx
git commit -m "feat(fiber-todo): 列表项与 Flip 编排层组件（含 Profiler）"
```

---

### Task 6: 两个统计面板

**Files:**
- Create: `src/components/fiber-todo/FiberDiffPanel.tsx`
- Create: `src/components/fiber-todo/RenderPipelinePanel.tsx`

- [ ] **Step 6.1: FiberDiffPanel.tsx**

```tsx
import type { PipelineRecord } from './types';
import styles from './FiberTodo.module.css';

interface FiberDiffPanelProps {
  records: PipelineRecord[];
  supported: boolean;
}

export function FiberDiffPanel({ records, supported }: FiberDiffPanelProps) {
  const latest = records[0] ?? null;

  return (
    <section className={styles.panel} aria-label="Fiber Diff 统计">
      <h3 className={styles.panelTitle}>Fiber Diff · 真实 DOM 变更 vs 动画</h3>
      {!supported && (
        <p className={styles.hint}>当前浏览器不支持 MutationObserver，本面板统计不可用</p>
      )}
      {latest ? (
        <>
          <div className={styles.kv}>
            <span>
              #{latest.seq} {latest.op}
            </span>
          </div>
          <table className={styles.compare}>
            <thead>
              <tr>
                <th>指标</th>
                <th>真实 DOM</th>
                <th>动画</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>新增</td>
                <td>+{latest.diff.inserted}</td>
                <td>{latest.flip.entered}</td>
              </tr>
              <tr>
                <td>移除</td>
                <td>-{latest.diff.removed}</td>
                <td>{latest.flip.exited}</td>
              </tr>
              <tr>
                <td>移动</td>
                <td>{latest.diff.moved}</td>
                <td>{latest.flip.moved}</td>
              </tr>
              <tr>
                <td>文本变更</td>
                <td>{latest.diff.textUpdated}</td>
                <td>—</td>
              </tr>
              <tr>
                <td>属性变更</td>
                <td>{latest.diff.attrUpdated}</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
          <span className={`${styles.tag} ${latest.consistent ? styles.ok : styles.bad}`}>
            {latest.consistent === null
              ? '统计不可用'
              : latest.consistent
                ? '✓ 动画与真实变更一致'
                : '✗ 数量不一致'}
          </span>
          {records.length > 1 && (
            <div className={styles.history}>
              {records.slice(1).map((r) => (
                <div key={r.seq} className={styles.historyItem}>
                  <span>
                    #{r.seq} {r.op}
                  </span>
                  <span>
                    +{r.diff.inserted} / -{r.diff.removed} / mv{r.diff.moved}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className={styles.hint}>执行任意增删改查操作后，这里展示本次 Fiber commit 的真实变更统计</p>
      )}
    </section>
  );
}
```

- [ ] **Step 6.2: RenderPipelinePanel.tsx**

```tsx
import type { PipelineRecord } from './types';
import styles from './FiberTodo.module.css';

interface RenderPipelinePanelProps {
  record: PipelineRecord | null;
}

const barWidth = (ms: number) => `${Math.min(Math.max((ms / 50) * 100, 2), 100)}%`;

export function RenderPipelinePanel({ record }: RenderPipelinePanelProps) {
  return (
    <section className={styles.panel} aria-label="渲染管线性能">
      <h3 className={styles.panelTitle}>渲染管线 · 触发 → commit → 动画帧</h3>
      {record ? (
        <>
          <div className={styles.kv}>
            <span>
              #{record.seq} {record.op}
            </span>
          </div>
          <div className={styles.kv}>
            <span>触发 → commit</span>
            <b>{record.triggerToCommitMs >= 0 ? `${record.triggerToCommitMs} ms` : '—'}</b>
          </div>
          <div className={styles.bar}>
            <div
              className={styles.barFill}
              style={{ width: barWidth(Math.max(record.triggerToCommitMs, 0)) }}
            />
          </div>
          <div className={styles.kv}>
            <span>React render（窗口内 commit 之和）</span>
            <b>{record.renderMs} ms</b>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: barWidth(record.renderMs) }} />
          </div>
          {record.frames ? (
            <>
              <div className={styles.kv}>
                <span>动画帧</span>
                <b>
                  {record.frames.frameCount} 帧 · avg {record.frames.avgMs} ms · max{' '}
                  {record.frames.maxMs} ms
                </b>
              </div>
              <div className={styles.bar}>
                <div
                  className={`${styles.barFill} ${record.frames.jankCount > 0 ? styles.bad : ''}`}
                  style={{ width: barWidth(record.frames.avgMs) }}
                />
              </div>
              <div className={styles.kv}>
                <span>掉帧（&gt;32ms）</span>
                <b>{record.frames.jankCount}</b>
              </div>
            </>
          ) : (
            <div className={styles.kv}>
              <span>动画帧</span>
              <b>本次无采样帧</b>
            </div>
          )}
          <p className={styles.hint}>FPS / Web Vitals / Long Task / 内存见全局悬浮面板</p>
        </>
      ) : (
        <p className={styles.hint}>执行操作后展示各阶段耗时与动画帧统计</p>
      )}
    </section>
  );
}
```

- [ ] **Step 6.3: 验证**

Run: `pnpm exec tsc -b`
Expected: 仅剩 CSS Module 缺失类错误（Task 7 消除）

- [ ] **Step 6.4: Commit**

```bash
git add src/components/fiber-todo/FiberDiffPanel.tsx src/components/fiber-todo/RenderPipelinePanel.tsx
git commit -m "feat(fiber-todo): diff 对照面板与渲染管线面板"
```

---

### Task 7: FiberTodoPage 页面编排器 + 样式

**Files:**
- Create: `src/components/fiber-todo/FiberTodoPage.tsx`
- Create: `src/components/fiber-todo/FiberTodo.module.css`

- [ ] **Step 7.1: FiberTodoPage.tsx**

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { FiberDiffPanel } from './FiberDiffPanel';
import { RenderPipelinePanel } from './RenderPipelinePanel';
import { TodoList } from './TodoList';
import { useDomMutationStats } from './useDomMutationStats';
import { useFlipList } from './useFlipList';
import { useFrameStats } from './useFrameStats';
import type { FlipIntent, FlipStats, KeyMode, PipelineRecord, Todo } from './types';
import styles from './FiberTodo.module.css';

const WINDOW_TIMEOUT_MS = 2000; // 兜底：覆盖动画 400ms + 清理 commit + 2 帧宽限
const MAX_RECORDS = 20;
const EMPTY_INTENT: FlipIntent = { exitIds: new Set(), enterIds: new Set(), changeIds: new Set() };
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

  const accRef = useRef<Partial<PipelineRecord>>({});
  const t0Ref = useRef(0);
  const intentRef = useRef<FlipIntent>(EMPTY_INTENT);
  const windowOpenRef = useRef(false);
  const timeoutIdRef = useRef(0);
  const commitsRef = useRef<Array<{ commitTime: number; actualDuration: number }>>([]);

  /** 统计窗口内的可见列表：过滤命中的 + 正在离场的（保持挂载以播完坍缩动画） */
  const listTodos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todos.filter((t) => t.exiting || q === '' || t.text.toLowerCase().includes(q));
  }, [todos, query]);

  /** 关窗出数：汇总一条流水线记录 */
  const finalizeWindow = useCallback(
    (flipStats: FlipStats) => {
      if (!windowOpenRef.current) return;
      windowOpenRef.current = false;
      window.clearTimeout(timeoutIdRef.current);

      const diff = closeWindow();
      const frames = stopFrames();
      const commits = commitsRef.current;
      commitsRef.current = [];
      const acc = accRef.current;

      const renderMs =
        Math.round(commits.reduce((s, c) => s + c.actualDuration, 0) * 100) / 100;
      const firstCommit = commits[0];

      if (!diff && commits.length === 0) return; // 无有效数据（如空操作）

      const inserted = diff?.inserted ?? 0;
      const removed = diff?.removed ?? 0;
      const record: PipelineRecord = {
        seq: acc.seq ?? 0,
        op: acc.op ?? 'unknown',
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
        consistent: diff ? inserted === flipStats.entered && removed === flipStats.exited : null,
      };
      setRecords((prev) => [record, ...prev].slice(0, MAX_RECORDS));
    },
    [closeWindow, stopFrames]
  );

  /** 开新窗口：上一窗口未关则强制出数（动画被打断的场景） */
  const beginOp = useCallback(
    (op: string) => {
      if (windowOpenRef.current) {
        finalizeWindow(EMPTY_STATS);
      }
      seq += 1;
      t0Ref.current = performance.now();
      accRef.current = { seq, op };
      intentRef.current = { exitIds: new Set(), enterIds: new Set(), changeIds: new Set() };
      commitsRef.current = [];
      openWindow();
      startFrames();
      capture();
      windowOpenRef.current = true;
      timeoutIdRef.current = window.setTimeout(() => {
        if (windowOpenRef.current) finalizeWindow(EMPTY_STATS);
      }, WINDOW_TIMEOUT_MS);
    },
    [finalizeWindow, openWindow, startFrames, capture]
  );

  /** Flip 全部动画结束：触发离场清理 commit，再 +2 帧宽限关窗 */
  const handleFlipComplete = useCallback(
    (stats: FlipStats) => {
      if (intentRef.current.exitIds.size > 0) {
        intentRef.current = { ...intentRef.current, exitIds: new Set() };
        setTodos((prev) => prev.filter((t) => !t.exiting)); // 清理 commit：真实 DOM 移除计入本窗口
      }
      requestAnimationFrame(() => requestAnimationFrame(() => finalizeWindow(stats)));
    },
    [finalizeWindow]
  );

  const handleProfilerRender = useCallback(
    (info: { actualDuration: number; commitTime: number }) => {
      if (!windowOpenRef.current) return; // keyMode 切换等非操作 commit 不计
      const commits = commitsRef.current;
      const last = commits[commits.length - 1];
      if (last && last.commitTime === info.commitTime) return; // StrictMode/重复去重
      commits.push(info);
    },
    []
  );

  const bump = () => setVersion((v) => v + 1);

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
    setTodos((prev) => prev.filter((t) => !t.exiting).map((t) => (t.id === id ? { ...t, text } : t)));
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
      if (!match && !t.exiting) {
        intentRef.current.exitIds.add(t.id);
        return { ...t, exiting: true };
      }
      if (match && t.exiting) {
        intentRef.current.enterIds.add(t.id);
        return { ...t, exiting: false };
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>React Fiber · 增删改查真实 DOM 动画</h1>
        <p className={styles.subtitle}>
          每次 CRUD → render → reconcile(diff) → commit → 真实 DOM 变化，动画由 Flip 快照严格驱动，统计窗口对照
          MutationObserver 验证"演的就是真的"
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
                onClick={() => setKeyMode('id')}
              >
                key=id（复用+移动）
              </button>
              <button
                type="button"
                className={`${styles.switchBtn} ${keyMode === 'index' ? styles.active : ''}`}
                onClick={() => setKeyMode('index')}
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
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: FiberTodo.module.css**

```css
.page {
  min-height: 100vh;
  padding: var(--spacing-xl);
  color: var(--color-text-primary);
  background: linear-gradient(135deg, var(--color-bg-dark), #14141d);
}

.header {
  margin-bottom: var(--spacing-lg);
}

.title {
  font-size: 1.75rem;
  font-weight: 700;
  margin: 0 0 var(--spacing-xs);
}

.subtitle {
  color: var(--color-text-secondary);
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(300px, 2fr);
  gap: var(--spacing-lg);
  align-items: start;
}

@media (max-width: 1023px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.workspace {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.input {
  flex: 1 1 200px;
  min-width: 0;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  font-size: 0.9rem;
}

.input:focus {
  outline: 1px solid var(--color-primary);
}

.btn {
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: 8px 14px;
  font-size: 0.9rem;
  cursor: pointer;
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.btn.ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.btn.warn {
  background: var(--color-error);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  flex-wrap: wrap;
}

.muted {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.switch {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.switchBtn {
  padding: 6px 14px;
  background: transparent;
  color: var(--color-text-secondary);
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
}

.switchBtn.active {
  background: var(--color-primary);
  color: #fff;
}

.listWrap {
  min-height: 200px;
}

.todoList {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.todoItem {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  overflow: hidden;
  will-change: transform;
}

.todoText {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.done .todoText {
  color: var(--color-text-secondary);
  text-decoration: line-through;
}

.exiting {
  pointer-events: none;
}

.checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
  flex-shrink: 0;
}

.removeBtn {
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.removeBtn:hover {
  color: var(--color-error);
  background: rgba(239, 68, 68, 0.12);
}

.empty {
  color: var(--color-text-secondary);
  text-align: center;
  padding: var(--spacing-xl);
}

.panels {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.panel {
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.panelTitle {
  margin: 0 0 var(--spacing-sm);
  font-size: 0.9rem;
  color: var(--color-text-primary);
  letter-spacing: 0.5px;
}

.kv {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 3px 0;
  color: var(--color-text-secondary);
}

.kv b {
  color: var(--color-text-primary);
  font-weight: 600;
  text-align: right;
}

.compare {
  width: 100%;
  border-collapse: collapse;
  margin: var(--spacing-sm) 0;
}

.compare th,
.compare td {
  text-align: right;
  padding: 4px 6px;
  border-bottom: 1px solid var(--color-border);
}

.compare th {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.compare th:first-child,
.compare td:first-child {
  text-align: left;
}

.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: var(--radius-full);
  font-weight: 700;
}

.tag.ok {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-success);
}

.tag.bad {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-error);
}

.bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
  margin: 4px 0 10px;
}

.barFill {
  height: 100%;
  background: var(--color-primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.barFill.bad {
  background: var(--color-error);
}

.history {
  margin-top: var(--spacing-sm);
  max-height: 180px;
  overflow-y: auto;
}

.historyItem {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  color: var(--color-text-secondary);
  border-bottom: 1px dashed var(--color-border);
}

.hint {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  margin: var(--spacing-sm) 0 0;
  line-height: 1.6;
}
```

- [ ] **Step 7.3: 验证**

Run: `pnpm exec tsc -b && pnpm exec biome check src/components/fiber-todo/`
Expected: 无错误

- [ ] **Step 7.4: Commit**

```bash
git add src/components/fiber-todo/FiberTodoPage.tsx src/components/fiber-todo/FiberTodo.module.css
git commit -m "feat(fiber-todo): 页面编排器（操作窗口/清理 commit/记录汇总）与样式"
```

---

### Task 8: 入口接线（App / AnimationControls / 菜单）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/controls/AnimationControls.tsx:7-18`

- [ ] **Step 8.1: App.tsx 三处修改**

`AnimationType` 联合类型加成员：

```ts
type AnimationType =
  | 'menu'
  | 'scroll'
  | 'lottie'
  | 'fireworks'
  | 'dance'
  | 'particle-text'
  | 'star'
  | 'countdown'
  | 'flame'
  | 'particle-progress'
  | 'fiber-todo';
```

顶部 import：

```ts
import { FiberTodoPage } from '@/components/fiber-todo/FiberTodoPage';
```

switch 加 case（放在 `case 'particle-progress'` 之后）：

```tsx
      case 'fiber-todo':
        return <FiberTodoPage />;
```

MenuPage 的 `animations` 数组末尾加：

```tsx
    { id: 'fiber-todo', name: 'Fiber Todo', icon: '🧬', color: 'from-emerald-500 to-teal-500' },
```

描述行加：

```tsx
              {animation.id === 'fiber-todo' && 'React Fiber 增删改查 · 真实 DOM 动画 · 全链路性能'}
```

- [ ] **Step 8.2: AnimationControls.tsx 的 animations 数组末尾加**

```ts
  { id: 'fiber-todo', label: 'Fiber Todo', icon: '🧬' },
```

- [ ] **Step 8.3: 验证**

Run: `pnpm exec tsc -b && pnpm exec biome check src/App.tsx src/components/controls/AnimationControls.tsx`
Expected: 无错误

- [ ] **Step 8.4: Commit**

```bash
git add src/App.tsx src/components/controls/AnimationControls.tsx
git commit -m "feat(fiber-todo): 接入菜单与动画切换器"
```

---

### Task 9: 全量构建 + Lint

**Files:** 无新增

- [ ] **Step 9.1: 构建**

Run: `pnpm build`
Expected: `tsc -b` 与 `vite build` 均成功，输出 `dist/` 产物尺寸表

- [ ] **Step 9.2: Lint + 格式**

Run: `pnpm lint && pnpm format:check`
Expected: 无 error（如有格式诊断，`pnpm lint:fix` 后重跑）

- [ ] **Step 9.3: Commit（如有 fix）**

```bash
git add -u src/ biome.json
git commit -m "style: fiber-todo 构建与规范修复"
```

---

### Task 10: 浏览器验收（webapp-testing / Playwright）

**Files:** 无新增（验证任务）

- [ ] **Step 10.1: 启动 dev server**

Run: `pnpm dev`（后台，端口 5173）

- [ ] **Step 10.2: Playwright 逐项验收（对照规格 §7 清单）**

用 webapp-testing 技能驱动浏览器：

1. 打开 `http://localhost:5173`，菜单出现 "Fiber Todo" 卡片 🧬 → 点击进入页面
2. **add**：输入文本回车 → 新项入场动画；diff 面板 `真实DOM 新增 +1`、`动画 entered 1`、一致性 ✓
3. **remove**：点 ✕ → 离场坍缩动画；完成后面板 `移除 -1`、`exited 1`、✓
4. **update**：勾选 checkbox → 高亮闪烁；面板 `文本/属性变更 ≥1`、✓
5. **查：筛选**：输入关键字 → 不匹配项离场；清空 → 恢复展开；计数一致
6. **key=id 洗牌**：节点平滑位移；面板 `移动 mv>0`、`文本变更 0`、✓
7. **key=index 洗牌**：无位移、内容高亮；面板 `移动 0`、`文本/属性 ≈ 列表长`、✓
8. **压测 +100**：一次性入场；渲染管线面板 renderMs/帧统计有数，全局 FPSPanel 无崩溃
9. 动画进行中连点操作：无报错、无残留半透明节点（控制台无红色错误）

- [ ] **Step 10.3: 记录验收结论**

把每项 ✓/✗ 与关键截图路径写入本计划文件末尾的「验收记录」小节；有 ✗ 回到对应 Task 修复后重验。

- [ ] **Step 10.4: 最终提交**

```bash
git add docs/superpowers/plans/2026-09-04-react-fiber-todo-anim.md
git commit -m "docs: fiber-todo 实施计划与验收记录"
```

---

## 验收记录（Task 10 执行时填写）

| 项 | 结果 | 备注 |
|---|---|---|
| add | 待验 | |
| remove | 待验 | |
| update | 待验 | |
| filter | 待验 | |
| id-key shuffle | 待验 | |
| index-key shuffle | 待验 | |
| stress +100 | 待验 | |
| 连续打断 | 待验 | |
