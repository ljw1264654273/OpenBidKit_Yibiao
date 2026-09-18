const {
  adjustMermaidReviewCode,
  buildIllustrationExecutionContexts,
} = require('./contentIllustrationGeneration.cjs');

const illustrationKindLabels = {
  ai: 'AI 配图',
  mermaid: '流程图',
  html: 'PPT 图',
};

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildIllustrationBlock(item) {
  const itemId = String(item?.item_id || '').trim();
  const caption = singleLine(item?.title);
  const assetUrl = String(item?.generation?.redraw_asset_url || '').trim();
  if (!itemId || !caption || !assetUrl) {
    throw new Error('图片重绘候选缺少有效资源');
  }
  return `<!-- yibiao-illustration:start id="${itemId}" -->\n![${caption}](${assetUrl})\n\n*<!-- yibiao-figure-caption -->${caption}*\n<!-- yibiao-illustration:end -->`;
}

function replaceIllustrationBlock(content, itemId, replacement) {
  const id = String(itemId || '').trim();
  if (!id) throw new Error('图片审核项 ID 不能为空');
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<!-- yibiao-illustration:start\\s+id="${escapedId}"\\s*-->[\\s\\S]*?<!-- yibiao-illustration:end\\s*-->`, 'i');
  if (!pattern.test(String(content || ''))) {
    throw new Error(`未找到正文图片块：${id}`);
  }
  return String(content || '').replace(pattern, String(replacement || '').trim());
}

function getIllustrationKindLabel(kind) {
  return illustrationKindLabels[kind] || '图片';
}

function getOutlineChildren(item) {
  return Array.isArray(item?.children) ? item.children : [];
}

function collectLeafContexts(items, parents = []) {
  const results = [];
  for (const item of items || []) {
    const children = getOutlineChildren(item);
    if (!children.length) {
      results.push({ item, parentChapters: parents, siblingChapters: items || [] });
      continue;
    }
    results.push(...collectLeafContexts(children, [...parents, item]));
  }
  return results;
}

function getIllustrationReviewContext(technicalPlanStore, payload) {
  const itemId = String(payload?.itemId || '').trim();
  if (!itemId) throw new Error('请选择需要审核的图片');
  const state = technicalPlanStore.loadTechnicalPlan();
  const item = state.contentIllustrationPlan?.items?.find((entry) => entry.item_id === itemId);
  if (!item) throw new Error('未找到图片审核项');
  return { state, item };
}

function previewIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.previewIllustrationReviewItem(payload);
}

function saveIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.saveIllustrationReviewItem(payload);
}

function confirmIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.confirmIllustrationReviewItem(payload);
}

function skipIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.skipIllustrationReviewItem(payload);
}

function adoptIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.adoptIllustrationReviewItem(payload);
}

async function adjustIllustrationReviewItem({ technicalPlanStore, aiService }, payload) {
  const { state, item } = getIllustrationReviewContext(technicalPlanStore, payload);
  if (item.kind !== 'mermaid') {
    return {
      ...technicalPlanStore.saveIllustrationReviewItem({ itemId: item.item_id }),
      instruction: String(payload?.instruction || ''),
    };
  }

  const leafContexts = collectLeafContexts(state.outlineData?.outline || []);
  const execution = buildIllustrationExecutionContexts({ items: [item] }, leafContexts, state.contentGenerationSections || {})[0];
  const adjustmentResult = await adjustMermaidReviewCode(aiService, {
    execution,
    currentCode: payload?.code,
    adjustment: payload?.instruction,
    referenceImages: payload?.referenceImages,
    referenceImagePath: payload?.referenceImagePath,
    referenceImageDataUrl: payload?.referenceImageDataUrl,
  });
  const patch = technicalPlanStore.saveIllustrationReviewItem({
    itemId: item.item_id,
    code: adjustmentResult.code,
  });
  return {
    ...patch,
    code: adjustmentResult.code,
  };
}

module.exports = {
  adjustIllustrationReviewItem,
  adoptIllustrationReviewItem,
  buildIllustrationBlock,
  collectLeafContexts,
  confirmIllustrationReviewItem,
  getIllustrationKindLabel,
  getIllustrationReviewContext,
  previewIllustrationReviewItem,
  replaceIllustrationBlock,
  saveIllustrationReviewItem,
  skipIllustrationReviewItem,
};
