const { ipcMain } = require('electron');
const { compareBidContents, normalizeParagraph } = require('../services/bidContentDuplicateService.cjs');

function registerBidProjectIpc({ bidProjectManager, bidProjectImportService, technicalPlanStore, taskService, exportService }) {
  const projectStore = bidProjectManager.getProjectStore();
  ipcMain.handle('bid-project:list', (_event, filters) => projectStore.listProjects(filters));
  ipcMain.handle('bid-project:get', (_event, projectId) => projectStore.getProject(projectId));
  ipcMain.handle('bid-project:open', (_event, projectId) => bidProjectManager.openProject(projectId));
  ipcMain.handle('bid-project:close', (_event, projectId) => bidProjectManager.closeProject(projectId));
  ipcMain.handle('bid-project:create', (_event, options) => bidProjectManager.createProject(options));
  ipcMain.handle('bid-project:update', (_event, projectId, patch) => bidProjectManager.updateProject(projectId, patch));
  ipcMain.handle('bid-project:delete', async (_event, projectId) => {
    await taskService?.cancelProjectTasks?.(projectId);
    return bidProjectManager.deleteProject(projectId);
  });
  ipcMain.handle('bid-project:source-group', (_event, projectId) => projectStore.listSourceGroupProjects(projectId));
  ipcMain.handle('bid-project:prepare-import', (_event, filePaths) => bidProjectImportService.prepareImport(filePaths));
  ipcMain.handle('bid-project:confirm-import', (_event, token, options) => bidProjectImportService.confirmImport(token, options));
  ipcMain.handle('bid-project:discard-import', (_event, token) => bidProjectImportService.discardImport(token));
  ipcMain.handle('bid-project:read-content', (_event, projectId) => {
    const store = bidProjectManager.getTechnicalPlanStore(projectId) || technicalPlanStore;
    const state = store.loadTechnicalPlan();
    return { projectId, ...readProjectParagraphs(state) };
  });
  ipcMain.handle('bid-project:compare-content', async (_event, payload) => {
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
      matches,
    });
    return {
      resultId: savedResultId,
      ...result,
      matches,
    };
  });
  ipcMain.handle('bid-project:export-word', async (event, projectId, options = {}) => {
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
  ipcMain.handle('bid-project:replace-content', (_event, projectId, payload) => {
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
