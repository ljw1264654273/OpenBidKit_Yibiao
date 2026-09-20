const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createBidProjectImportService } = require('./bidProjectImportService.cjs');
const { createBidProjectManager } = require('./bidProjectManager.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function createFileService(document) {
  return {
    async importDocument({ filePaths }) {
      const documents = (filePaths || []).map((filePath) => ({
        source_path: filePath,
        file_name: document.file_name,
        file_content: document.file_content,
        parser_label: '测试解析器',
      }));
      return {
        success: true,
        file_content: document.file_content,
        file_name: document.file_name,
        documents,
      };
    },
  };
}

function createManager(app, db, fileService) {
  return createBidProjectManager({
    app,
    db,
    fileService,
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

test('creates independent projects when the same tender document is imported twice', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-bid-import-'));
  const sourcePath = path.join(userDataPath, '招标文件.md');
  const document = {
    file_name: '招标文件.md',
    file_content: '# 招标文件\n\n项目范围与技术要求。',
  };
  fs.writeFileSync(sourcePath, document.file_content, 'utf8');
  const app = createApp(userDataPath);
  const db = new Database(':memory:');
  const fileService = createFileService(document);
  const manager = createManager(app, db, fileService);
  const workflowCalls = [];
  const workflowAnalytics = {
    startOperation(payload) {
      workflowCalls.push({ type: 'started', payload });
      return { operationId: 'operation-1' };
    },
    finishOperation(operation, status, details) {
      workflowCalls.push({ type: 'finished', operation, status, details });
    },
  };
  const importService = createBidProjectImportService({ app, fileService, bidProjectManager: manager, workflowAnalytics });

  try {
    const firstPreview = await importService.prepareImport([sourcePath]);
    const first = await importService.confirmImport(firstPreview.token, { projectName: '项目方案' });
    const secondPreview = await importService.prepareImport([sourcePath]);
    const second = await importService.confirmImport(secondPreview.token, { projectName: '项目方案' });

    assert.equal(first.sourceSequence, 1);
    assert.equal(second.sourceSequence, 2);
    assert.equal(second.projectName, '项目方案 - 第 2 份');

    const rows = db.prepare(`
      SELECT project_id, source_id
      FROM bid_project_source_files
      WHERE project_id IN (?, ?)
      ORDER BY project_id
    `).all(first.projectId, second.projectId);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].source_id, rows[1].source_id);
    assert.deepEqual(workflowCalls.map((call) => [call.type, call.status]), [
      ['started', undefined],
      ['finished', 'succeeded'],
      ['started', undefined],
      ['finished', 'succeeded'],
    ]);
    assert.deepEqual(workflowCalls[0].payload.sourceFileNames, ['招标文件.md']);
  } finally {
    db.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('does not fail staged import cleanup when Windows first reports EPERM', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-bid-import-cleanup-'));
  const sourcePath = path.join(userDataPath, '招标文件.md');
  const document = {
    file_name: '招标文件.md',
    file_content: '# 招标文件\n\n项目范围与技术要求。',
  };
  fs.writeFileSync(sourcePath, document.file_content, 'utf8');
  const app = createApp(userDataPath);
  const fileService = createFileService(document);
  const bidProjectManager = {
    getSourceMatches: () => [],
  };
  const importService = createBidProjectImportService({ app, fileService, bidProjectManager });
  const originalRmSync = fs.rmSync;
  let simulatedFailure = false;

  try {
    const preview = await importService.prepareImport([sourcePath]);
    const importDir = path.join(userDataPath, 'workspace', 'bid-project-imports', preview.token);
    fs.rmSync = (targetPath, options) => {
      if (targetPath === importDir && !simulatedFailure) {
        simulatedFailure = true;
        const error = new Error(`EPERM: permission denied, rm '${targetPath}'`);
        error.code = 'EPERM';
        error.path = targetPath;
        throw error;
      }
      return originalRmSync(targetPath, options);
    };

    assert.deepEqual(importService.discardImport(preview.token), { success: true });
    assert.equal(fs.existsSync(importDir), false);
  } finally {
    fs.rmSync = originalRmSync;
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test.after(() => {
  if (process.versions.electron) {
    require('electron').app.quit();
  }
});
