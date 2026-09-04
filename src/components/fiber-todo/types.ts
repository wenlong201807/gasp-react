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
  hideIds: Set<string>; // 筛选隐藏（坍缩动画但不计 exited——节点未从 DOM 移除）
  enterIds: Set<string>; // filter 恢复展开的项
  changeIds: Set<string>; // 内容变化高亮
}
