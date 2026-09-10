export const MAX_OUTLINE_DEPTH = 7;

export function outlineDepth(itemId: string) {
  return String(itemId || '').split('.').filter(Boolean).length;
}

export function canAddOutlineChild(itemId: string) {
  return outlineDepth(itemId) < MAX_OUTLINE_DEPTH;
}
