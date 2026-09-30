function getIllustrationTargetNodeId(item) {
  return item.kind === 'html' && item.placement === 'before'
    ? item.section_ids?.[0]
    : item.section_ids?.at(-1);
}

function outlinePositions(outline) {
  const positions = new Map();
  const visit = (items, parentId = '') => {
    (items || []).forEach((node, index) => {
      positions.set(String(node.id), { parentId, index });
      visit(node.children, String(node.id));
    });
  };
  visit(outline?.outline);
  return positions;
}

function isContiguousSiblings(ids, positions) {
  const entries = ids.map((id) => positions.get(id));
  return entries.every((entry) => entry && entry.parentId === entries[0]?.parentId)
    && entries.every((entry, index) => index === 0 || entry.index === entries[index - 1].index + 1);
}

function reconcileIllustrationItems({ items, previousOutline, nextOutline, idMap, affectedIds }) {
  const previous = outlinePositions(previousOutline);
  const next = outlinePositions(nextOutline);
  const mappedId = (id) => idMap instanceof Map ? idMap.get(id) : idMap?.[id];
  const keptItems = [];
  const droppedItems = [];
  for (const item of items || []) {
    const ids = item.section_ids || [];
    const mapped = ids.map(mappedId);
    let valid = ids.length > 0 && ids.every((id, index) => previous.has(id)
      && !affectedIds.has(id) && mapped[index] && next.has(mapped[index]));
    if (valid && ids.length === 1) {
      valid = item.placement === 'after';
    } else if (valid) {
      valid = item.kind === 'html' && isContiguousSiblings(ids, previous)
        && isContiguousSiblings(mapped, next)
        && mappedId(previous.get(ids[0]).parentId) === next.get(mapped[0]).parentId
        && mappedId(getIllustrationTargetNodeId(item)) === (item.placement === 'before' ? mapped[0] : mapped.at(-1));
    }
    if (valid) keptItems.push({ ...item, section_ids: mapped });
    else droppedItems.push(item);
  }
  return { keptItems, droppedItems };
}

function removeIllustrationBlock(content, itemId) {
  const text = String(content || '');
  const escapedId = String(itemId || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<!-- yibiao-illustration:start\\s+id="${escapedId}"\\s*-->[\\s\\S]*?<!-- yibiao-illustration:end\\s*-->`, 'i');
  if (!pattern.test(text)) return text;
  return text.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { reconcileIllustrationItems, removeIllustrationBlock, getIllustrationTargetNodeId };
