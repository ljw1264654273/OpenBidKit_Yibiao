const { isDeepStrictEqual } = require('node:util');

function flattenOutline(outline) {
  const nodes = new Map();
  const visit = (items, parentOriginId = '') => {
    for (const node of items || []) {
      const originId = node?.origin_id;
      if (typeof originId !== 'string' || !originId || nodes.has(originId)) {
        throw new Error('目录节点身份 origin_id 缺失或重复');
      }
      const children = Array.isArray(node.children) ? node.children : [];
      nodes.set(originId, {
        id: node.id,
        parentOriginId,
        semantic: [node.title, node.description, node.attr, node.content_mode,
          node.content_mode_note, children.length > 0],
      });
      visit(children, originId);
    }
  };
  visit(outline?.outline);
  return nodes;
}

function validateOutlineOrigins({ before, after }) {
  const previous = flattenOutline(before);
  const next = flattenOutline(after);
  for (const originId of previous.keys()) {
    if (!/^existing-[1-9]\d*$/.test(originId)) {
      throw new Error(`输入节点身份 origin_id 无效：${originId}`);
    }
  }
  for (const originId of next.keys()) {
    if (previous.has(originId)) continue;
    if (!/^new-[1-9]\d*$/.test(originId)) {
      throw new Error(`新增节点身份 origin_id 无效：${originId}`);
    }
  }
  return { previous, next };
}

function buildOutlineAdjustmentSaveRequest({ before, after }) {
  const { previous, next } = validateOutlineOrigins({ before, after });
  const changedOrigins = new Set();
  const idMap = {};
  for (const [originId, oldNode] of previous) {
    const newNode = next.get(originId);
    if (newNode) idMap[oldNode.id] = newNode.id;
    if (!newNode || oldNode.parentOriginId !== newNode.parentOriginId
      || !isDeepStrictEqual(oldNode.semantic, newNode.semantic)) {
      changedOrigins.add(originId);
    }
  }
  const affectedNodeIds = [];
  for (const [originId, oldNode] of previous) {
    let ancestor = originId;
    while (ancestor) {
      if (changedOrigins.has(ancestor)) {
        affectedNodeIds.push(oldNode.id);
        break;
      }
      ancestor = previous.get(ancestor)?.parentOriginId;
    }
  }
  const newIds = Object.values(idMap);
  const isReorder = affectedNodeIds.length === 0 && previous.size === next.size
    && new Set(newIds).size === previous.size;
  return { reason: isReorder ? 'sort' : 'edit', idMap, affectedNodeIds };
}

module.exports = { buildOutlineAdjustmentSaveRequest, validateOutlineOrigins };
