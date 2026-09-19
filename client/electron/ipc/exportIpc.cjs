const { ipcMain: defaultIpcMain, shell } = require('electron');
const { getBidProjectTechnicalPlanDir } = require('../utils/paths.cjs');

function resolveProjectId(payload) {
  return String(
    payload?.projectId
      || payload?.project_id
      || payload?.workflow_analytics?.projectId
      || '',
  ).trim();
}

function enrichExportPayload(payload, app) {
  if (payload?.project_technical_plan_dir || payload?.projectTechnicalPlanDir || !app) {
    return payload;
  }

  const projectId = resolveProjectId(payload);
  if (!projectId) return payload;

  return {
    ...payload,
    project_technical_plan_dir: getBidProjectTechnicalPlanDir(app, projectId),
  };
}

function registerExportIpc({ app, ipcMain = defaultIpcMain, exportService }) {
  ipcMain.handle('export:word', async (event, payload = {}) => {
    const requestId = payload.requestId || payload.request_id;
    const sendProgress = (progress) => {
      event.sender.send('export:word-progress', { requestId, ...progress });
    };

    try {
      return await exportService.exportWord(enrichExportPayload(payload, app), sendProgress);
    } catch (error) {
      sendProgress({
        phase: 'error',
        progress: 100,
        message: error.message || '导出 Word 失败',
      });
      throw error;
    }
  });

  ipcMain.handle('export:open-file', async (_event, filePath) => {
    const targetPath = String(filePath || '').trim();
    if (!targetPath) {
      throw new Error('缺少要打开的文件路径');
    }

    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(`打开文件失败：${errorMessage}`);
    }

    return { success: true };
  });
}

module.exports = {
  registerExportIpc,
};
