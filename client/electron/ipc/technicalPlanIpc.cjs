const { ipcMain, shell } = require('electron');
const {
  adjustIllustrationReviewItem,
  confirmIllustrationReviewItem,
  previewIllustrationReviewItem,
  saveIllustrationReviewItem,
  skipIllustrationReviewItem,
} = require('../services/contentIllustrationReview.cjs');

function saveOutlineConfig({ technicalPlanStore, remoteKnowledgeService }, payload) {
  const currentFingerprint = remoteKnowledgeService.getEndpointFingerprint();
  const hasStaleScope = (Array.isArray(payload?.remoteKnowledgeScopes) ? payload.remoteKnowledgeScopes : [])
    .some((scope) => scope?.endpointFingerprint !== currentFingerprint);
  if (hasStaleScope) {
    throw new Error('远程知识服务地址已变更，请重新选择远程知识范围');
  }
  return technicalPlanStore.saveOutlineConfig(payload);
}

async function adjustMermaidReviewCodeForItem({ technicalPlanStore, aiService }, payload) {
  const compatStore = {
    ...technicalPlanStore,
    saveIllustrationReviewItem: (nextPayload) => technicalPlanStore.saveMermaidReviewCode(nextPayload),
  };
  return adjustIllustrationReviewItem({ technicalPlanStore: compatStore, aiService }, payload);
}

function registerTechnicalPlanIpc({ technicalPlanStore, bidProjectManager, taskService, remoteKnowledgeService, aiService }) {
  const resolveStore = (payload) => bidProjectManager?.getTechnicalPlanStore(payload?.projectId || payload?.project_id) || technicalPlanStore;
  ipcMain.handle('technical-plan:load-state', (_event, payload) => resolveStore(payload).loadTechnicalPlan());
  ipcMain.handle('technical-plan:import-tender-document', (_event, payload) => taskService.importTenderDocument(payload?.filePaths || payload, payload?.projectId));
  ipcMain.handle('technical-plan:remove-tender-document', (_event, payload) => taskService.removeTenderDocument(payload?.sourceId || payload, payload?.projectId));
  ipcMain.handle('technical-plan:import-original-plan-document', (_event, payload) => taskService.importOriginalPlanDocument(payload?.filePaths || payload, payload?.projectId));
  ipcMain.handle('technical-plan:check-bid-sections', (_event, payload) => resolveStore(payload).checkBidSections());
  ipcMain.handle('technical-plan:select-bid-section', (_event, payload) => resolveStore(payload).selectBidSection(payload?.selectedSection || payload));
  ipcMain.handle('technical-plan:read-tender-markdown', (_event, payload) => resolveStore(payload).readTenderMarkdown());
  ipcMain.handle('technical-plan:read-tender-source-markdown', (_event, payload) => resolveStore(payload).readTenderSourceMarkdown(payload?.sourceId || payload));
  ipcMain.handle('technical-plan:read-original-plan-markdown', (_event, payload) => resolveStore(payload).readOriginalPlanMarkdown());
  ipcMain.handle('technical-plan:update-step', (_event, payload) => resolveStore(payload).updateStep(payload?.step || payload));
  ipcMain.handle('technical-plan:set-workflow-kind', (_event, payload) => resolveStore(payload).setWorkflowKind(payload?.workflowKind || payload));
  ipcMain.handle('technical-plan:switch-workflow-kind', (_event, payload) => resolveStore(payload).switchWorkflowKind(payload?.workflowKind || payload));
  ipcMain.handle('technical-plan:save-bid-analysis-config', (_event, payload) => resolveStore(payload).saveBidAnalysisConfig(payload));
  ipcMain.handle('technical-plan:save-outline-config', (_event, payload) => saveOutlineConfig({ technicalPlanStore: resolveStore(payload), remoteKnowledgeService }, payload));
  ipcMain.handle('technical-plan:save-outline-selection', (_event, payload) => resolveStore(payload).saveOutlineSelection(payload));
  ipcMain.handle('technical-plan:save-outline', (_event, payload) => resolveStore(payload).saveOutline(payload?.outlineData || payload));
  ipcMain.handle('technical-plan:save-global-facts-config', (_event, payload) => resolveStore(payload).saveGlobalFactsConfig(payload));
  ipcMain.handle('technical-plan:save-global-facts', (_event, payload) => resolveStore(payload).saveGlobalFacts(payload?.globalFacts || payload));
  ipcMain.handle('technical-plan:save-content-generation-options', (_event, payload) => resolveStore(payload).saveContentGenerationOptions(payload?.options || payload));
  ipcMain.handle('technical-plan:save-chapter-content', (_event, payload) => resolveStore(payload).saveChapterContent(payload));
  ipcMain.handle('technical-plan:preview-illustration-review-item', (_event, payload) => previewIllustrationReviewItem({ technicalPlanStore: resolveStore(payload) }, payload));
  ipcMain.handle('technical-plan:save-illustration-review-item', (_event, payload) => saveIllustrationReviewItem({ technicalPlanStore: resolveStore(payload) }, payload));
  ipcMain.handle('technical-plan:adjust-illustration-review-item', (_event, payload) => adjustIllustrationReviewItem({ technicalPlanStore: resolveStore(payload), aiService }, payload));
  ipcMain.handle('technical-plan:confirm-illustration-review-item', (_event, payload) => confirmIllustrationReviewItem({ technicalPlanStore: resolveStore(payload) }, payload));
  ipcMain.handle('technical-plan:skip-illustration-review-item', (_event, payload) => skipIllustrationReviewItem({ technicalPlanStore: resolveStore(payload) }, payload));
  ipcMain.handle('technical-plan:preview-mermaid-review-item', (_event, payload) => resolveStore(payload).previewMermaidReviewItem(payload));
  ipcMain.handle('technical-plan:save-mermaid-review-code', (_event, payload) => resolveStore(payload).saveMermaidReviewCode(payload));
  ipcMain.handle('technical-plan:adjust-mermaid-review-code', (_event, payload) => adjustMermaidReviewCodeForItem({ technicalPlanStore: resolveStore(payload), aiService }, payload));
  ipcMain.handle('technical-plan:confirm-mermaid-review-item', (_event, payload) => resolveStore(payload).confirmMermaidReviewItem(payload));
  ipcMain.handle('technical-plan:skip-mermaid-review-item', (_event, payload) => resolveStore(payload).skipMermaidReviewItem(payload));
  ipcMain.handle('technical-plan:clear', (_event, payload) => taskService.resetTechnicalPlan(payload?.projectId || payload));
  ipcMain.handle('technical-plan:open-bid-template', async (_event, payload) => {
    const store = resolveStore(payload);
    const filePath = store.getBidTemplatePath?.();
    if (!filePath || !store.hasBidTemplate?.()) {
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
