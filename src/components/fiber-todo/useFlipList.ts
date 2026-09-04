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
      const exited = [...prev.keys()].filter(
        (id) => !next.has(id) || intent.exitIds.has(id)
      ).length;
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

      return stats;
    },
    []
  );

  return { capture, play };
}
