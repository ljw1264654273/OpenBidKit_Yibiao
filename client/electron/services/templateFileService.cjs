const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE_FILE_FORMAT = 'yibiao-export-template';
const TEMPLATE_FILE_VERSION = 1;
const TEMPLATE_FILE_EXTENSION = '.yibiao-template.json';

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveTemplateName(value) {
  return String(value || '').trim() || '未命名模板';
}

function serializeTemplate(template) {
  const config = isRecord(template?.config) ? template.config : {};
  const templateName = resolveTemplateName(template?.template_name || config.template_name);

  return {
    format: TEMPLATE_FILE_FORMAT,
    version: TEMPLATE_FILE_VERSION,
    template_name: templateName,
    config: {
      ...config,
      template_name: templateName,
    },
  };
}

function parseTemplateFile(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ''));
  } catch (error) {
    throw new Error(`模板文件不是合法 JSON：${error?.message || String(error)}`);
  }

  if (!isRecord(parsed) || parsed.format !== TEMPLATE_FILE_FORMAT || parsed.version !== TEMPLATE_FILE_VERSION || !isRecord(parsed.config)) {
    throw new Error('模板文件格式不受支持，请选择易标导出的 .yibiao-template.json 文件');
  }

  const templateName = resolveTemplateName(parsed.template_name || parsed.config.template_name);
  return {
    ...parsed.config,
    template_name: templateName,
  };
}

function sanitizeFileName(value) {
  const name = resolveTemplateName(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return name || '未命名模板';
}

function createTemplateFileService({ app, dialog, templateStore }) {
  async function exportTemplateConfig(config) {
    const templateName = resolveTemplateName(config?.template_name);
    const downloadsDir = app?.getPath?.('downloads') || '';
    const defaultPath = path.join(downloadsDir, `${sanitizeFileName(templateName)}${TEMPLATE_FILE_EXTENSION}`);
    const result = await dialog.showSaveDialog({
      title: '导出模板',
      defaultPath,
      filters: [{ name: '易标模板（.yibiao-template.json）', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true, message: '已取消导出模板' };
    }

    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
    fs.writeFileSync(result.filePath, `${JSON.stringify(serializeTemplate({
      template_name: templateName,
      config,
    }), null, 2)}\n`, 'utf8');
    return { success: true, path: result.filePath, message: '模板已导出' };
  }

  async function importTemplate() {
    const result = await dialog.showOpenDialog({
      title: '导入模板',
      properties: ['openFile'],
      filters: [{ name: '易标模板（.yibiao-template.json）', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { success: false, canceled: true, message: '已取消导入模板' };
    }

    const sourcePath = result.filePaths[0];
    const config = parseTemplateFile(fs.readFileSync(sourcePath, 'utf8'));
    const template = templateStore.createTemplate(config);
    return { success: true, path: sourcePath, template, message: '模板已导入' };
  }

  return {
    exportTemplateConfig,
    importTemplate,
  };
}

module.exports = {
  TEMPLATE_FILE_FORMAT,
  TEMPLATE_FILE_VERSION,
  createTemplateFileService,
  parseTemplateFile,
  serializeTemplate,
};
