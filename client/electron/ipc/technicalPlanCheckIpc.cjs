const { ipcMain } = require('electron');

function registerTechnicalPlanCheckIpc({ technicalPlanCheckService }) {
  ipcMain.handle('technical-plan-check:load-state', () => technicalPlanCheckService.loadState());
  ipcMain.handle('technical-plan-check:select-input', (_event, role) => technicalPlanCheckService.selectInput(role));
  ipcMain.handle('technical-plan-check:select-output', () => technicalPlanCheckService.selectOutput());
  ipcMain.handle('technical-plan-check:open-report', async () => {
    try {
      return await technicalPlanCheckService.openReport();
    } catch (error) {
      return { success: false, message: error?.message || String(error) };
    }
  });
}

module.exports = { registerTechnicalPlanCheckIpc };
