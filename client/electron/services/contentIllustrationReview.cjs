const {
  adjustMermaidReviewCode,
  buildIllustrationExecutionContexts,
  generateAiRedrawCandidate,
  generateHtmlRedrawCandidate,
  generateMermaidRedrawCandidateFromCode,
} = require('./contentIllustrationGeneration.cjs');

const illustrationKindLabels = {
  ai: 'AI 配图',
  mermaid: '流程图',
  html: 'PPT 图',
};

function singleLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildIllustrationBlock(item, assetUrl = item?.generation?.redraw_asset_url) {
  const itemId = String(item?.item_id || '').trim();
  const caption = singleLine(item?.title);
  const resolvedAssetUrl = String(assetUrl || '').trim();
  if (!itemId || !caption || !resolvedAssetUrl) {
    throw new Error('图片重绘候选缺少有效资源');
  }
  return `<!-- yibiao-illustration:start id="${itemId}" -->\n![${caption}](${resolvedAssetUrl})\n\n*<!-- yibiao-figure-caption -->${caption}*\n<!-- yibiao-illustration:end -->`;
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

function resetIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.resetIllustrationReviewItem(payload);
}

function skipIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.skipIllustrationReviewItem(payload);
}

function adoptIllustrationReviewItem({ technicalPlanStore }, payload) {
  return technicalPlanStore.adoptIllustrationReviewItem(payload);
}

async function convertMermaidIllustrationReviewItem({ technicalPlanStore, aiService }, payload) {
  const { state, item } = getIllustrationReviewContext(technicalPlanStore, payload);
  if (item.kind !== 'mermaid') {
    throw new Error('当前图片项不是流程图');
  }
  if (item.generation?.review_status !== 'confirmed') {
    throw new Error('请先确认流程图结构');
  }

  const code = String(item.generation?.code || item.generation?.draft_code || '').trim();
  if (!code) {
    throw new Error('当前流程图没有可图片化的 Mermaid 代码');
  }

  const leafContexts = collectLeafContexts(state.outlineData?.outline || []);
  const execution = buildIllustrationExecutionContexts({ items: [item] }, leafContexts, state.contentGenerationSections || {})[0];
  if (!execution) {
    throw new Error('未找到图片对应的正文上下文');
  }

  const instruction = singleLine(payload?.instruction);
  const attempts = Number(item.generation?.redraw_attempts || 0) + 1;
  const saveCandidate = (generation) => technicalPlanStore.saveIllustrationRedrawCandidate({
    itemId: item.item_id,
    generation,
  });

  saveCandidate({
    redraw_status: 'running',
    redraw_asset_url: undefined,
    redraw_source_path: undefined,
    redraw_error: undefined,
    redraw_attempts: attempts,
  });

  try {
    const result = await generateMermaidRedrawCandidateFromCode(
      aiService,
      execution,
      code,
      undefined,
      attempts,
      instruction,
    );
    return saveCandidate(result);
  } catch (error) {
    saveCandidate({
      redraw_status: 'error',
      redraw_error: singleLine(error?.message || error || 'AI 图片生成失败'),
      redraw_attempts: attempts,
    });
    throw error;
  }
}

async function adjustIllustrationReviewItem({ technicalPlanStore, aiService }, payload) {
  const { state, item } = getIllustrationReviewContext(technicalPlanStore, payload);
  const instruction = singleLine(payload?.instruction);
  if (!instruction) {
    throw new Error('请输入 AI 重绘要求');
  }

  if (!payload?.legacyCodeOnly && item.kind === 'mermaid') {
    return convertMermaidIllustrationReviewItem({ technicalPlanStore, aiService }, payload);
  }

  const leafContexts = collectLeafContexts(state.outlineData?.outline || []);
  const execution = buildIllustrationExecutionContexts({ items: [item] }, leafContexts, state.contentGenerationSections || {})[0];
  if (!execution) {
    throw new Error('未找到图片对应的正文上下文');
  }

  if (payload?.legacyCodeOnly) {
    const adjustmentResult = await adjustMermaidReviewCode(aiService, {
      execution,
      currentCode: payload?.code,
      adjustment: instruction,
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

  const saveCandidate = (generation) => technicalPlanStore.saveIllustrationRedrawCandidate({
    itemId: item.item_id,
    generation,
  });

  saveCandidate({
    redraw_status: 'running',
    redraw_asset_url: undefined,
    redraw_source_path: undefined,
    redraw_error: undefined,
  });

  try {
    let result;
    if (item.kind === 'ai') {
      result = await generateAiRedrawCandidate(aiService, execution, { instruction });
    } else {
      result = await generateHtmlRedrawCandidate({
        aiService,
        execution,
        plan: state.contentIllustrationPlan,
        workspaceStore: technicalPlanStore,
        instruction,
        onSourceSaved: (source) => saveCandidate(source),
      });
    }
    return saveCandidate(result);
  } catch (error) {
    saveCandidate({
      redraw_status: 'error',
      redraw_error: singleLine(error?.message || error || 'AI 重绘失败'),
      redraw_attempts: Number(item.generation?.redraw_attempts || 0) + 1,
    });
    throw error;
  }
}

module.exports = {
  adjustIllustrationReviewItem,
  adoptIllustrationReviewItem,
  buildIllustrationBlock,
  collectLeafContexts,
  confirmIllustrationReviewItem,
  convertMermaidIllustrationReviewItem,
  getIllustrationKindLabel,
  getIllustrationReviewContext,
  previewIllustrationReviewItem,
  replaceIllustrationBlock,
  resetIllustrationReviewItem,
  saveIllustrationReviewItem,
  skipIllustrationReviewItem,
};
