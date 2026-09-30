import type { OutlineItem } from '../../../shared/types/outline';
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { MAX_OUTLINE_DEPTH, outlineDepth } from './outlineDepth.ts';

function getSubtreeMaxDepth(item: OutlineItem): number {
  return (item.children || []).reduce(
    (maximum, child) => Math.max(maximum, getSubtreeMaxDepth(child)),
    outlineDepth(item.id),
  );
}

export function getOutlineSubtreeMaxDepth(item: OutlineItem) {
  return getSubtreeMaxDepth(item);
}

export function canAddOutlineParent(item: OutlineItem) {
  return getOutlineSubtreeMaxDepth(item) < MAX_OUTLINE_DEPTH;
}

export function insertOutlineParent(
  items: OutlineItem[],
  itemId: string,
  parent: Omit<OutlineItem, 'children'>,
): OutlineItem[] | null {
  let found = false;
  const visit = (nodes: OutlineItem[]): OutlineItem[] => nodes.map((item) => {
    if (item.id === itemId) {
      found = true;
      return { ...parent, children: [item] };
    }
    if (!item.children?.length) return item;
    return { ...item, children: visit(item.children) };
  });

  const result = visit(items);
  return found ? result : null;
}
