const { ipcMain } = require('electron');

function registerTemplateIpc({ templateStore, templateFileService }) {
  ipcMain.handle('templates:list', () => templateStore.listTemplates());
  ipcMain.handle('templates:get', (_event, templateId) => templateStore.getTemplate(templateId));
  ipcMain.handle('templates:create', (_event, config) => templateStore.createTemplate(config));
  ipcMain.handle('templates:update', (_event, templateId, config) => templateStore.updateTemplate(templateId, config));
  ipcMain.handle('templates:delete', (_event, templateId) => templateStore.deleteTemplate(templateId));
  ipcMain.handle('templates:import', () => templateFileService.importTemplate());
  ipcMain.handle('templates:export', (_event, config) => templateFileService.exportTemplateConfig(config));
}

module.exports = {
  registerTemplateIpc,
};
