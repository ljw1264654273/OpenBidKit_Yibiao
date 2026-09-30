import type { OutlineItem } from '../../../shared/types';

export interface OutlineUiState {
  selectedItemId: string | null;
  expandedItems: Set<string>;
}

export function remapOutlineUiState(
  state: OutlineUiState,
  idMap: Record<string, string>,
  outline: OutlineItem[],
): OutlineUiState {
  const validIds = collectOutlineIds(outline);
  const selectedItemId = state.selectedItemId
    ? idMap[state.selectedItemId] || state.selectedItemId
    : null;
  return {
    selectedItemId: selectedItemId && validIds.has(selectedItemId) ? selectedItemId : null,
    expandedItems: new Set(
      [...state.expandedItems]
        .map((id) => idMap[id] || id)
        .filter((id) => validIds.has(id)),
    ),
  };
}

function collectOutlineIds(items: OutlineItem[], ids = new Set<string>()) {
  items.forEach((item) => {
    ids.add(item.id);
    if (item.children?.length) collectOutlineIds(item.children, ids);
  });
  return ids;
}
