import type { OutlineItem } from '../../../shared/types/outline';

/** Remove one node while promoting its direct children to the same sibling level. */
export function deleteOutlineOnly(items: OutlineItem[], itemId: string): OutlineItem[] | null {
  let found = false;
  const visit = (nodes: OutlineItem[]): OutlineItem[] => nodes.flatMap((item) => {
    if (item.id === itemId) {
      found = true;
      return item.children || [];
    }
    if (!item.children?.length) return [item];
    return [{ ...item, children: visit(item.children) }];
  });

  const result = visit(items);
  return found ? result : null;
}
