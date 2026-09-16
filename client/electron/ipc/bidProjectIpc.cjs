const { compareBidContents, normalizeParagraph } = require('../services/bidContentDuplicateService.cjs');

function registerBidProjectIpc({
  ipcMain: ipc = require('electron').ipcMain,
  bidProjectManager,
  bidProjectImportService,
  technicalPlanStore,
  taskService,
  exportService,
  duplicateRewriteService,
}) {
  const projectStore = bidProjectManager.getProjectStore();
  ipc.handle('bid-project:list', (_event, filters) => projectStore.listProjects(filters));
  ipc.handle('bid-project:get', (_event, projectId) => projectStore.getProject(projectId));
  ipc.handle('bid-project:open', (_event, projectId) => bidProjectManager.openProject(projectId));
  ipc.handle('bid-project:close', (_event, projectId) => bidProjectManager.closeProject(projectId));
  ipc.handle('bid-project:create', (_event, options) => bidProjectManager.createProject(options));
  ipc.handle('bid-project:update', (_event, projectId, patch) => bidProjectManager.updateProject(projectId, patch));
  ipc.handle('bid-project:delete', async (_event, projectId) => {
    await taskService?.cancelProjectTasks?.(projectId);
    return bidProjectManager.deleteProject(projectId);
  });
  ipc.handle('bid-project:source-group', (_event, projectId) => projectStore.listSourceGroupProjects(projectId));
  ipc.handle('bid-project:prepare-import', (_event, filePaths) => bidProjectImportService.prepareImport(filePaths));
  ipc.handle('bid-project:confirm-import', (_event, token, options) => bidProjectImportService.confirmImport(token, options));
  ipc.handle('bid-project:discard-import', (_event, token) => bidProjectImportService.discardImport(token));
  ipc.handle('bid-project:read-content', (_event, projectId) => {
    const store = bidProjectManager.getTechnicalPlanStore(projectId) || technicalPlanStore;
    const state = store.loadTechnicalPlan();
    return { projectId, ...readProjectParagraphs(state) };
  });
  ipc.handle('bid-project:recent-duplicate-summaries', (_event, projectIds) => projectStore.listRecentDuplicateSummaries(projectIds));
  ipc.handle('bid-project:load-duplicate-result', (_event, resultId) => projectStore.loadDuplicateResult(resultId));
  ipc.handle('bid-project:load-latest-duplicate-result', (_event, projectId) => projectStore.loadLatestDuplicateResult(projectId));
  ipc.handle('bid-project:update-duplicate-match-decision', (_event, payload) => projectStore.updateDuplicateMatchDecision(payload));
  ipc.handle('bid-project:compare-content', async (_event, payload) => {
    const left = bidProjectManager.getTechnicalPlanStore(payload?.leftProjectId);
    const right = bidProjectManager.getTechnicalPlanStore(payload?.rightProjectId);
    if (!left || !right) throw new Error('请选择两份有效的标书项目');
    const leftState = left.loadTechnicalPlan();
    const rightState = right.loadTechnicalPlan();
    const leftContent = readProjectParagraphs(leftState);
    const rightContent = readProjectParagraphs(rightState);
    const result = compareBidContents({
      leftContent: leftContent.content,
      rightContent: rightContent.content,
      sensitivity: payload?.sensitivity || 'medium',
      exemptParagraphs: [
        ...await extractTenderParagraphs(left),
        ...await extractTenderParagraphs(right),
      ],
    });
    const matches = result.matches.map((match) => ({
      ...match,
      leftNodeId: leftContent.paragraphs[match.leftParagraph.index]?.nodeId,
      rightNodeId: rightContent.paragraphs[match.rightParagraph.index]?.nodeId,
    }));
    const savedResultId = bidProjectManager.getProjectStore().saveDuplicateResult({
      leftProjectId: payload.leftProjectId,
      rightProjectId: payload.rightProjectId,
      sensitivity: payload?.sensitivity || 'medium',
      summary: result.summary,
      threshold: result.threshold,
      matches,
    });
    return projectStore.loadDuplicateResult(savedResultId);
  });
  ipc.handle('bid-project:rewrite-duplicate-match', async (_event, payload) => {
    const result = projectStore.loadDuplicateResult(payload?.resultId);
    if (!result) throw new Error('未找到查重结果');
    const match = result.matches.find((item) => item.id === payload?.matchId);
    if (!match) throw new Error('未找到查重重复组');
    const targetSide = payload?.targetSide === 'left' ? 'left' : 'right';
    const targetProjectId = targetSide === 'left' ? result.leftProjectId : result.rightProjectId;
    const referenceProjectId = targetSide === 'left' ? result.rightProjectId : result.leftProjectId;
    if (payload?.leftProjectId !== result.leftProjectId || payload?.rightProjectId !== result.rightProjectId) {
      throw new Error('查重结果对应的项目已变化，请重新打开结果');
    }
    const targetProject = targetSide === 'left' ? result.leftProject : result.rightProject;
    const referenceProject = targetSide === 'left' ? result.rightProject : result.leftProject;
    return duplicateRewriteService.rewriteMatch({
      leftProjectName: result.leftProject?.projectName || '左侧标书',
      rightProjectName: result.rightProject?.projectName || '右侧标书',
      leftText: match.leftParagraph.text,
      rightText: match.rightParagraph.text,
      targetSide,
      targetProjectId,
      referenceProjectId,
      targetProjectName: targetProject?.projectName || '',
      referenceProjectName: referenceProject?.projectName || '',
    });
  });
  ipc.handle('bid-project:export-word', async (event, projectId, options = {}) => {
    const project = bidProjectManager.getProject(projectId);
    const store = bidProjectManager.getTechnicalPlanStore(projectId);
    if (!project || !store) throw new Error('未找到标书项目');
    const state = store.loadTechnicalPlan();
    const outline = state?.outlineData?.outline || [];
    if (!outline.length) throw new Error('当前项目还没有可导出的目录内容');
    const requestId = options.requestId || `project-export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sendProgress = (progress) => event.sender.send('export:word-progress', { requestId, ...progress });
    try {
      return await exportService.exportWord({
        requestId,
        project_name: project.projectName || state.outlineData?.project_name,
        outline,
        export_format: options.exportFormat || undefined,
      }, sendProgress);
    } catch (error) {
      sendProgress({ phase: 'error', progress: 100, message: error.message || '导出 Word 失败' });
      throw error;
    }
  });
  ipc.handle('bid-project:replace-content', (_event, projectId, payload) => {
    const store = bidProjectManager.getTechnicalPlanStore(projectId) || technicalPlanStore;
    const state = store.loadTechnicalPlan();
    const node = (function find(items) {
      for (const item of items || []) {
        if (item.id === payload?.nodeId) return item;
        const found = find(item.children);
        if (found) return found;
      }
      return null;
    }(state.outlineData?.outline || []));
    if (!node) throw new Error('未找到待替换的正文段落');
    const oldText = String(payload?.oldText || '');
    const content = String(node.content || '');
    const paragraphs = content.split(/\n\s*\n+/);
    const paragraphIndex = paragraphs.findIndex((paragraph) => normalizeParagraph(paragraph) === oldText);
    if (paragraphIndex < 0 && !content.includes(oldText)) throw new Error('原正文已发生变化，请重新查重');
    const nextContent = paragraphIndex >= 0
      ? paragraphs.map((paragraph, index) => index === paragraphIndex ? String(payload?.newText || '') : paragraph).join('\n\n')
      : content.replace(oldText, String(payload?.newText || ''));
    return store.saveChapterContent({
      nodeId: node.id,
      content: nextContent,
    });
  });
}

function readProjectParagraphs(state) {
    const paragraphs = [];
    const visit = (items) => (items || []).forEach((item) => {
      if (item?.children?.length) visit(item.children);
      else String(item?.content || '').split(/\n\s*\n+/).map((content) => content.trim()).filter(Boolean)
        .forEach((content) => paragraphs.push({ nodeId: item.id, title: item.title, content }));
  });
  visit(state?.outlineData?.outline || []);
  return { paragraphs, content: paragraphs.map((item) => item.content).join('\n\n') };
}

async function extractTenderParagraphs(store) {
  const markdown = String(await store.readTenderMarkdown?.() || '');
  return markdown ? markdown.split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean) : [];
}

module.exports = { registerBidProjectIpc };
