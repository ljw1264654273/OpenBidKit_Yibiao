const { ipcMain, shell } = require('electron');
const {
  adjustMermaidReviewCode,
  buildIllustrationExecutionContexts,
} = require('../services/contentIllustrationGeneration.cjs');

function saveOutlineConfig({ technicalPlanStore, remoteKnowledgeService }, payload) {
  const currentFingerprint = remoteKnowledgeService.getEndpointFingerprint();
  const hasStaleScope = (Array.isArray(payload?.remoteKnowledgeScopes) ? payload.remoteKnowledgeScopes : [])
    .some((scope) => scope?.endpointFingerprint !== currentFingerprint);
  if (hasStaleScope) {
    throw new Error('远程知识服务地址已变更，请重新选择远程知识范围');
  }
  return technicalPlanStore.saveOutlineConfig(payload);
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

async function adjustMermaidReviewCodeForItem({ technicalPlanStore, aiService }, payload) {
  const itemId = String(payload?.itemId || '').trim();
  if (!itemId) throw new Error('请选择需要调整的 Mermaid 图');
  const state = technicalPlanStore.loadTechnicalPlan();
  const plan = state.contentIllustrationPlan;
  const planItem = plan?.items?.find((item) => item.item_id === itemId);
  if (!planItem) throw new Error('未找到 Mermaid 审核项');
  if (planItem.kind !== 'mermaid') throw new Error('当前图片项不是 Mermaid 图');

  const leafContexts = collectLeafContexts(state.outlineData?.outline || []);
  const execution = buildIllustrationExecutionContexts({ items: [planItem] }, leafContexts, state.contentGenerationSections || {})[0];
  const adjustmentResult = await adjustMermaidReviewCode(aiService, {
    execution,
    currentCode: payload?.code,
    adjustment: payload?.instruction,
  });
  const patch = technicalPlanStore.saveMermaidReviewCode({
    itemId,
    code: adjustmentResult.code,
  });
  return {
    ...patch,
    code: adjustmentResult.code,
  };
}

function registerTechnicalPlanIpc({ technicalPlanStore, taskService, remoteKnowledgeService, aiService }) {
  ipcMain.handle('technical-plan:load-state', () => technicalPlanStore.loadTechnicalPlan());
  ipcMain.handle('technical-plan:import-tender-document', (_event, filePaths) => taskService.importTenderDocument(filePaths));
  ipcMain.handle('technical-plan:remove-tender-document', (_event, sourceId) => taskService.removeTenderDocument(sourceId));
  ipcMain.handle('technical-plan:import-original-plan-document', (_event, filePaths) => taskService.importOriginalPlanDocument(filePaths));
  ipcMain.handle('technical-plan:check-bid-sections', () => technicalPlanStore.checkBidSections());
  ipcMain.handle('technical-plan:select-bid-section', (_event, selectedSection) => technicalPlanStore.selectBidSection(selectedSection));
  ipcMain.handle('technical-plan:read-tender-markdown', () => technicalPlanStore.readTenderMarkdown());
  ipcMain.handle('technical-plan:read-tender-source-markdown', (_event, sourceId) => technicalPlanStore.readTenderSourceMarkdown(sourceId));
  ipcMain.handle('technical-plan:read-original-plan-markdown', () => technicalPlanStore.readOriginalPlanMarkdown());
  ipcMain.handle('technical-plan:update-step', (_event, step) => technicalPlanStore.updateStep(step));
  ipcMain.handle('technical-plan:set-workflow-kind', (_event, workflowKind) => technicalPlanStore.setWorkflowKind(workflowKind));
  ipcMain.handle('technical-plan:switch-workflow-kind', (_event, workflowKind) => technicalPlanStore.switchWorkflowKind(workflowKind));
  ipcMain.handle('technical-plan:save-bid-analysis-config', (_event, payload) => technicalPlanStore.saveBidAnalysisConfig(payload));
  ipcMain.handle('technical-plan:save-outline-config', (_event, payload) => saveOutlineConfig({ technicalPlanStore, remoteKnowledgeService }, payload));
  ipcMain.handle('technical-plan:save-outline-selection', (_event, payload) => technicalPlanStore.saveOutlineSelection(payload));
  ipcMain.handle('technical-plan:save-outline', (_event, outlineData) => technicalPlanStore.saveOutline(outlineData));
  ipcMain.handle('technical-plan:save-global-facts-config', (_event, payload) => technicalPlanStore.saveGlobalFactsConfig(payload));
  ipcMain.handle('technical-plan:save-global-facts', (_event, globalFacts) => technicalPlanStore.saveGlobalFacts(globalFacts));
  ipcMain.handle('technical-plan:save-content-generation-options', (_event, options) => technicalPlanStore.saveContentGenerationOptions(options));
  ipcMain.handle('technical-plan:save-chapter-content', (_event, payload) => technicalPlanStore.saveChapterContent(payload));
  ipcMain.handle('technical-plan:preview-mermaid-review-item', (_event, payload) => technicalPlanStore.previewMermaidReviewItem(payload));
  ipcMain.handle('technical-plan:save-mermaid-review-code', (_event, payload) => technicalPlanStore.saveMermaidReviewCode(payload));
  ipcMain.handle('technical-plan:adjust-mermaid-review-code', (_event, payload) => adjustMermaidReviewCodeForItem({ technicalPlanStore, aiService }, payload));
  ipcMain.handle('technical-plan:confirm-mermaid-review-item', (_event, payload) => technicalPlanStore.confirmMermaidReviewItem(payload));
  ipcMain.handle('technical-plan:skip-mermaid-review-item', (_event, payload) => technicalPlanStore.skipMermaidReviewItem(payload));
  ipcMain.handle('technical-plan:clear', () => taskService.resetTechnicalPlan());
  ipcMain.handle('technical-plan:open-bid-template', async () => {
    const filePath = technicalPlanStore.getBidTemplatePath?.();
    if (!filePath || !technicalPlanStore.hasBidTemplate?.()) {
      return { success: false, message: '还没有投标模版，请先确认一级目录' };
    }
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      return { success: false, message: errorMessage };
    }
    return { success: true };
  });
}

module.exports = {
  adjustMermaidReviewCodeForItem,
  registerTechnicalPlanIpc,
  saveOutlineConfig,
};
