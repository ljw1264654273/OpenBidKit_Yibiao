const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function runAssertions() {
  const { createBidProjectManager } = require('./bidProjectManager.cjs');
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-openxml-paths-'));
  const app = { getPath: () => userDataPath, once() {} };
  const database = createSqliteDatabase(app);
  const db = database.db;
  const manager = createBidProjectManager({
    app,
    db,
    fileService: {},
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
    configStore: { load: () => ({}) },
  });

  try {
    const project = manager.createProject({ projectName: 'Open XML 路径测试' });
    const store = manager.getTechnicalPlanStore(project.projectId);
    const sourcePath = path.join(userDataPath, '招标原件.docx');
    fs.writeFileSync(sourcePath, 'fixture');
    store.importVariantSeed({
      tenderFiles: [{
        id: 'tender-1',
        fileName: '招标原件.docx',
        markdown: '# 招标原文',
        sourceDocxPath: sourcePath,
      }],
      workingMarkdown: '# 招标原文',
      originalMarkdown: '# 招标原文',
    });

    const prefix = `bid-projects/${project.projectId}/technical-plan`;
    assert.deepEqual(store.listTenderSourceDocxRelativePaths(), [`${prefix}/tender-originals/tender-1.docx`]);
    assert.equal(store.getBidTemplateSourceRelativePath(), `${prefix}/bid-template-source.docx`);
    assert.equal(store.getBidTemplateRelativePath(), `${prefix}/bid-template.docx`);
    assert.equal(store.getBidTemplateFieldsRelativePath(), `${prefix}/bid-template-fields.json`);
    assert.deepEqual(
      store.resolveTenderSourceDocxPath(`${prefix}/tender-originals/tender-1.docx`),
      [`${prefix}/tender-originals/tender-1.docx`],
    );
  } finally {
    database.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try {
    runAssertions();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
} else {
  test('project store exposes Open XML paths relative to the global workspace', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native Open XML path test timed out');
  });
}
