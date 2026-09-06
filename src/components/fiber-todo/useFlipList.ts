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
  const sideTweensRef = useRef<gsap.core.Tween[]>([]);

  useEffect(() => {
    return () => {
      tlRef.current?.kill();
      for (const tw of sideTweensRef.current) tw.kill();
      sideTweensRef.current = [];
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
    document.querySelector<HTMLElement>(
      `${ITEM_SELECTOR}[data-todo-id="${id}"]`,
    );

  const capture = useCallback(() => {
    // 中断在飞的旁路动画（高亮/展开/离场坍缩）。Flip 主 timeline 不裸 kill：
    // Flip.getState 自带的 interrupt 会在下一次 Flip.from 时接管并应用终态。
    // 被中断轮的 onComplete 会被丢弃，由页面层的 2s 超时兜底回收窗口。
    for (const tw of sideTweensRef.current) tw.kill();
    sideTweensRef.current = [];
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
        if (
          old &&
          (Math.abs(old.top - rect.top) > 1 ||
            Math.abs(old.left - rect.left) > 1)
        ) {
          moved += 1;
        }
      }
      const entered = [...next.keys()].filter((id) => !prev.has(id)).length;
      const exited = [...prev.keys()].filter(
        (id) => !next.has(id) || intent.exitIds.has(id),
      ).length;
      const stats: FlipStats = { entered, exited, moved };

      // 多路完成计数：Flip 位移 + 离场坍缩 全部结束后才算本轮结束（防重入）
      let pending = 0;
      let finished = false;
      const done = () => {
        if (finished) return;
        pending -= 1;
        if (pending <= 0) {
          finished = true;
          onComplete(stats);
        }
      };

      // 内容变化高亮
      for (const id of intent.changeIds) {
        const el = findByTodoId(id);
        if (el) {
          const tween = gsap.fromTo(
            el,
            { backgroundColor: 'rgba(102, 126, 234, 0.35)' },
            {
              backgroundColor: 'rgba(102, 126, 234, 0)',
              duration: 0.8,
              ease: 'power2.out',
              overwrite: 'auto',
              clearProps: 'backgroundColor',
            },
          );
          sideTweensRef.current.push(tween);
        }
      }

      // 离场/隐藏项：先从文档流摘出（绝对定位钉在原视觉位、锁定宽度），
      // 再淡出缩小。必须在 Flip.from 之前完成，让 Flip 测到收紧后的最终布局；
      // Flip targets 也排除这些项，避免 Flip 的还原逻辑覆盖离场终态。
      // exited 计数只含 exitIds（真移除）；hideIds 是筛选隐藏（节点保留，不计）
      const leavingIds = new Set([...intent.exitIds, ...intent.hideIds]);
      const leavingEls = [...leavingIds]
        .map(findByTodoId)
        .filter((el): el is HTMLElement => el !== null);

      if (leavingEls.length > 0) {
        const parent = leavingEls[0].parentElement as HTMLElement;
        const parentRect = parent.getBoundingClientRect();
        for (const el of leavingEls) {
          const rect = el.getBoundingClientRect();
          gsap.set(el, {
            position: 'absolute',
            top: rect.top - parentRect.top,
            left: rect.left - parentRect.left,
            width: rect.width,
            marginTop: 0,
            marginBottom: 0,
          });
        }
        pending += 1;
        const exitTween = gsap.to(leavingEls, {
          opacity: 0,
          scale: 0.85,
          duration: 0.3,
          ease: 'power2.in',
          overwrite: 'auto',
          onComplete: done,
        });
        sideTweensRef.current.push(exitTween);
      }

      // 位移 / 入场回放（targets 排除离场/隐藏项）
      const flipTargets =
        leavingEls.length > 0
          ? `${ITEM_SELECTOR}${[...leavingIds].map((id) => `:not([data-todo-id="${id}"])`).join('')}`
          : ITEM_SELECTOR;
      pending += 1;
      tlRef.current = Flip.from(state, {
        targets: flipTargets,
        duration: 0.4,
        ease: 'power2.inOut',
        absolute: true,
        onEnter: (els) =>
          gsap.fromTo(
            els,
            { opacity: 0, scale: 0.85, y: 24 },
            {
              opacity: 1,
              scale: 1,
              y: 0,
              duration: 0.4,
              ease: 'power2.out',
              clearProps: 'all',
            },
          ),
        onComplete: done,
      });

      // filter 恢复：清掉坍缩内联样式后展开入场
      for (const id of intent.enterIds) {
        const el = findByTodoId(id);
        if (el) {
          gsap.set(el, { clearProps: 'all' });
          const tween = gsap.from(el, {
            height: 0,
            opacity: 0,
            duration: 0.4,
            ease: 'power2.out',
            overwrite: 'auto',
            clearProps: 'height,opacity',
          });
          sideTweensRef.current.push(tween);
        }
      }

      return stats;
    },
    [],
  );

  return { capture, play };
}
