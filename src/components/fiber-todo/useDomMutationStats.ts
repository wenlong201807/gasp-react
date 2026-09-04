import { useCallback, useEffect, useRef } from 'react';

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
 * 统计按 .fiber-todo-item 收口，占位节点等杂散 DOM 变更不入账。
 *
 * 时序契约：MutationObserver 回调是微任务，关窗必须晚于 commit 后的微任务投递。
 * 页面层在动画 onComplete + 2 rAF 后关窗，天然满足；style 属性已被
 * attributeFilter 排除，GSAP 动画期间的 inline style 写入不会污染统计。
 */
export function useDomMutationStats(containerRef: React.RefObject<HTMLElement>) {
  const currentRef = useRef<MutationWindow | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof MutationObserver === 'undefined') return;

    const isItem = (node: Node): boolean =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node as Element).classList.contains('fiber-todo-item');

    const observer = new MutationObserver((records) => {
      const win = currentRef.current;
      if (!win) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (isItem(node)) win.added.add(node);
        }
        for (const node of record.removedNodes) {
          if (!isItem(node)) continue;
          if (win.added.has(node)) {
            win.added.delete(node);
          } else {
            win.removed.add(node);
          }
        }
        if (record.type === 'characterData') {
          if ((record.target as Node).parentElement?.classList.contains('fiber-todo-item')) {
            win.textUpdated += 1;
          }
        }
        if (record.type === 'attributes') {
          if (isItem(record.target as Node)) win.attrUpdated += 1;
        }
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'data-todo-id'],
    });

    return () => observer.disconnect();
  }, [containerRef]);

  const open = useCallback(() => {
    currentRef.current = { added: new Set(), removed: new Set(), textUpdated: 0, attrUpdated: 0 };
  }, []);

  const close = useCallback((): MutationWindowResult | null => {
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
  }, []);

  return { open, close, supported: typeof MutationObserver !== 'undefined' };
}
