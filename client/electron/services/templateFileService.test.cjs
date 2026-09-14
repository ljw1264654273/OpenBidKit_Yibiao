const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  TEMPLATE_FILE_FORMAT,
  createTemplateFileService,
  parseTemplateFile,
  serializeTemplate,
} = require('./templateFileService.cjs');

const sampleConfig = {
  template_name: '共享模板',
  page: { paper_size: 'a4', orientation: 'portrait' },
};

test('模板文件序列化后可以还原配置，并拒绝不支持的文件格式', () => {
  const payload = serializeTemplate({
    template_id: 'tpl-source',
    template_name: sampleConfig.template_name,
    config: sampleConfig,
  });

  assert.equal(payload.format, TEMPLATE_FILE_FORMAT);
  assert.deepEqual(parseTemplateFile(JSON.stringify(payload)), sampleConfig);
  assert.throws(() => parseTemplateFile(JSON.stringify({ format: 'other', config: sampleConfig })), /模板文件格式不受支持/);
});

test('导入模板始终调用 createTemplate 生成新记录，不按名称覆盖', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-template-test-'));
  const sourcePath = path.join(tempDir, 'shared.yibiao-template.json');
  fs.writeFileSync(sourcePath, JSON.stringify(serializeTemplate({
    template_id: 'tpl-source',
    template_name: sampleConfig.template_name,
    config: sampleConfig,
  })), 'utf8');

  const createdConfigs = [];
  const service = createTemplateFileService({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [sourcePath] }),
    },
    templateStore: {
      createTemplate: (config) => {
        createdConfigs.push(config);
        return { template_id: 'tpl-new', template_name: config.template_name, config };
      },
    },
  });

  const result = await service.importTemplate();

  assert.equal(result.success, true);
  assert.equal(result.template.template_id, 'tpl-new');
  assert.deepEqual(createdConfigs, [sampleConfig]);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('导出模板使用编辑器传入的当前配置，而不是读取模板列表', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-template-export-test-'));
  const targetPath = path.join(tempDir, '正在编辑.yibiao-template.json');
  const editingConfig = {
    template_name: '正在编辑',
    page: { paper_size: 'a3', orientation: 'landscape' },
  };
  const service = createTemplateFileService({
    app: {
      getPath: () => tempDir,
    },
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: targetPath }),
    },
    templateStore: {
      getTemplate: () => {
        throw new Error('导出编辑中模板时不应读取模板列表');
      },
    },
  });

  const result = await service.exportTemplateConfig(editingConfig);

  assert.equal(result.success, true);
  assert.deepEqual(parseTemplateFile(fs.readFileSync(targetPath, 'utf8')), editingConfig);
  fs.rmSync(tempDir, { recursive: true, force: true });
});
