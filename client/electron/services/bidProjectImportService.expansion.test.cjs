const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createBidProjectImportService } = require('./bidProjectImportService.cjs');
const { createBidProjectManager } = require('./bidProjectManager.cjs');
const { createTaskService } = require('./taskService.cjs');
const { getTechnicalPlanProjectTablePrefix } = require('./sqliteDatabase.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createFixture(options = {}) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-expansion-import-'));
  const paths = {
    tenderA: path.join(userDataPath, '招标文件-A.md'),
    tenderB: path.join(userDataPath, '招标文件-B.md'),
    originalPlan: path.join(userDataPath, '原方案.docx'),
  };
  fs.writeFileSync(paths.tenderA, '# 招标文件 A\n\n技术要求 A。', 'utf8');
  fs.writeFileSync(paths.tenderB, '# 招标文件 B\n\n技术要求 B。', 'utf8');
  fs.writeFileSync(paths.originalPlan, '# 原方案\n\n已有方案正文。', 'utf8');

  const calls = [];
  const app = createApp(userDataPath);
  const db = new Database(':memory:');
  const behavior = options.behavior || {};
  let confirmTenderStarted;
  let resolveConfirmTenderStarted;
  if (behavior.delayConfirmTender) {
    confirmTenderStarted = new Promise((resolve) => {
      resolveConfirmTenderStarted = resolve;
    });
  }

  const fileService = {
    async importDocument({ multiple, filePaths }) {
      const requestedPaths = Array.isArray(filePaths) ? [...filePaths] : [];
      calls.push({ method: 'importDocument', multiple, filePaths: requestedPaths });
      const role = multiple ? 'tender' : 'original';
      if (behavior.prepareFailureOn === role) {
        return { success: false, message: '解析失败', documents: [] };
      }
      if (behavior.cancelOn === role) {
        return { success: false, message: '已取消选择', documents: [] };
      }
      if (!requestedPaths.length) {
        return { success: false, message: '未选择文件', documents: [] };
      }
      if (behavior.failTenderConfirm && multiple && requestedPaths[0].includes('bid-project-imports')) {
        return { success: false, message: '招标文件确认导入失败', documents: [] };
      }
      if (behavior.delayConfirmTender && multiple && requestedPaths[0].includes('bid-project-imports')) {
        resolveConfirmTenderStarted();
        await behavior.delayConfirmTender.promise;
      }

      const documents = requestedPaths
        .filter((filePath) => !(behavior.partialTender && multiple && filePath === paths.tenderB))
        .map((filePath) => ({
          source_path: filePath,
          file_name: path.basename(filePath),
          file_content: fs.readFileSync(filePath, 'utf8'),
          parser_label: '测试解析器',
        }));
      const errors = behavior.partialTender && multiple
        ? [`${path.basename(paths.tenderB)}：解析失败`]
        : [];
      return {
        success: true,
        message: errors.length ? '文件解析完成，失败 1 份' : '文件解析完成',
        file_content: documents[0]?.file_content,
        file_name: documents[0]?.file_name,
        parser_label: documents[0]?.parser_label,
        documents,
        errors,
      };
    },
    async importTechnicalPlanDocument(_label, { filePaths }) {
      calls.push({ method: 'importTechnicalPlanDocument', filePaths: [...(filePaths || [])] });
      if (behavior.failOriginalConfirm) {
        return { success: false, message: '原方案确认导入失败', documents: [] };
      }
      const filePath = filePaths?.[0];
      return {
        success: true,
        message: '原方案已解析',
        file_name: path.basename(filePath),
        file_content: fs.readFileSync(filePath, 'utf8'),
        parser_label: '测试解析器',
      };
    },
  };
  const manager = createBidProjectManager({
    app,
    db,
    fileService,
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
  const workflowCalls = [];
  const workflowAnalytics = {
    startOperation(payload) {
      workflowCalls.push({ type: 'started', payload });
      return { operationId: `operation-${workflowCalls.length}` };
    },
    finishOperation(operation, status, details) {
      workflowCalls.push({ type: 'finished', operation, status, details });
    },
  };
  const importService = createBidProjectImportService({
    app,
    fileService,
    bidProjectManager: manager,
    workflowAnalytics,
  });

  return {
    app,
    db,
    fileService,
    manager,
    importService,
    paths,
    calls,
    userDataPath,
    workflowCalls,
    confirmTenderStarted,
    cleanup() {
      db.close();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    },
  };
}

function importRoot(userDataPath) {
  return path.join(userDataPath, 'workspace', 'bid-project-imports');
}

function importDir(userDataPath, token) {
  return path.join(importRoot(userDataPath), token);
}

function readStagedMetadata(userDataPath, token) {
  return JSON.parse(fs.readFileSync(path.join(importDir(userDataPath, token), 'metadata.json'), 'utf8'));
}

function writeStagedMetadata(userDataPath, token, metadata) {
  fs.writeFileSync(
    path.join(importDir(userDataPath, token), 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );
}

function listProjectSchemaTables(db, projectId) {
  const prefix = getTechnicalPlanProjectTablePrefix(projectId);
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND substr(name, 1, ?) = ?
    ORDER BY name
  `).all(prefix.length, prefix).map((row) => row.name);
}

function createTaskScopeFixture() {
  const projectIds = ['project-a', 'project-b'];
  let currentProjectId = 'project-a';
  const stores = new Map(projectIds.map((projectId) => [projectId, {
    loadTechnicalPlan() {
      return { workflowKind: 'technical-plan' };
    },
    updateTechnicalPlanWithoutReload() {},
    clearBidTemplate() {},
  }]));
  const manager = {
    getCurrentProjectId() {
      return currentProjectId;
    },
    getTechnicalPlanStore(projectId) {
      return stores.get(String(projectId || '')) || null;
    },
    listProjects() {
      return projectIds.map((projectId) => ({ projectId }));
    },
    updateProject() {},
  };
  const service = createTaskService({
    aiService: {
      withQueueScope(_scopeId, _signal) {
        return this;
      },
      resumeQueueScope() {},
    },
    agentService: {
      bindTaskContext() {
        return {};
      },
      deletePersistentTask() {},
      isPrimarySession() {
        return false;
      },
    },
    autoConfirmationService: {
      register() {},
      unregister() {},
      suppress() {},
    },
    technicalPlanStore: stores.get('project-a'),
    bidProjectManager: manager,
    rejectionCheckStore: {
      loadRejectionCheck() {
        return {};
      },
      updateRejectionCheckWithoutReload() {},
    },
    duplicateCheckStore: {
      loadDuplicateCheck() {
        return {};
      },
      updateDuplicateCheckWithoutReload() {},
    },
    feasibilityReportStore: {
      loadFeasibilityReport() {
        return {};
      },
      updateFeasibilityReportWithoutReload() {},
    },
    taskRunners: {
      outlineGeneration: ({ taskControl }) => new Promise((resolve, reject) => {
        if (taskControl.signal.aborted) {
          reject(taskControl.signal.reason);
          return;
        }
        taskControl.signal.addEventListener('abort', () => reject(taskControl.signal.reason), { once: true });
      }),
    },
    openXmlHelperService: {
      close: async () => {},
    },
  });
  return {
    service,
    setCurrentProjectId(projectId) {
      currentProjectId = projectId;
    },
  };
}

test('requires one or more tender paths and exactly one original plan without opening a dialog', async () => {
  const fixture = createFixture();
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [],
      originalPlanFilePaths: [],
    });

    assert.equal(preview.success, false);
    assert.equal(preview.canceled, false);
    assert.equal(preview.token, null);
    assert.equal(preview.tender.requestedCount, 0);
    assert.deepEqual(preview.tender.documents, []);
    assert.equal(preview.originalPlan.success, false);
    assert.equal(fixture.calls.length, 0);

    const tooManyOriginalPlans = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan, fixture.paths.tenderB],
    });
    assert.equal(tooManyOriginalPlans.success, false);
    assert.equal(tooManyOriginalPlans.canceled, false);
    assert.equal(tooManyOriginalPlans.token, null);
    assert.match(tooManyOriginalPlans.originalPlan.message, /恰好一个|一份/);
    assert.equal(fixture.calls.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('prepares complete tender and original-plan previews in an expansion staging directory', async () => {
  const fixture = createFixture();
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA, fixture.paths.tenderB],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });

    assert.equal(preview.success, true);
    assert.equal(preview.canceled, false);
    assert.match(preview.token, /^[0-9a-f-]{36}$/);
    assert.equal(preview.tender.success, true);
    assert.equal(preview.tender.requestedCount, 2);
    assert.equal(preview.tender.documents.length, 2);
    assert.equal(preview.tender.errors.length, 0);
    assert.equal(preview.originalPlan.success, true);
    for (const document of [...preview.tender.documents, preview.originalPlan]) {
      assert.ok(document.fileName);
      assert.equal(document.parserLabel, '测试解析器');
      assert.match(document.fileHash, /^[0-9a-f]{64}$/);
      assert.match(document.contentHash, /^[0-9a-f]{64}$/);
      assert.ok(document.contentPreview);
      assert.ok(document.markdownChars > 0);
      assert.ok(document.size > 0);
      assert.ok(document.modifiedAt);
    }
    assert.deepEqual(fixture.calls.map((call) => [call.method, call.multiple]), [
      ['importDocument', true],
      ['importDocument', false],
    ]);

    const metadata = JSON.parse(fs.readFileSync(path.join(importDir(fixture.userDataPath, preview.token), 'metadata.json'), 'utf8'));
    assert.equal(metadata.kind, 'existing-plan-expansion');
    assert.equal(metadata.status, 'ready');
    assert.ok(metadata.createdAt);
    assert.ok(metadata.expiresAt);
    assert.equal(metadata.tenderDocuments.length, 2);
    assert.equal(metadata.originalPlanDocument.fileName, path.basename(fixture.paths.originalPlan));
    assert.ok(fs.existsSync(metadata.tenderDocuments[0].stagedPath));
    assert.ok(fs.existsSync(metadata.originalPlanDocument.stagedPath));
  } finally {
    fixture.cleanup();
  }
});

test('returns cancellation separately from empty paths and never creates a token', async () => {
  const fixture = createFixture({ behavior: { cancelOn: 'original' } });
  try {
    const rawCancellation = await fixture.fileService.importDocument({
      multiple: false,
      filePaths: [fixture.paths.originalPlan],
    });
    assert.equal(rawCancellation.success, false);
    assert.equal(rawCancellation.message, '已取消选择');
    assert.equal(Object.prototype.hasOwnProperty.call(rawCancellation, 'canceled'), false);

    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });

    assert.equal(preview.success, false);
    assert.equal(preview.canceled, true);
    assert.equal(preview.token, null);
    assert.equal(preview.originalPlan.success, false);
    assert.equal(fixture.manager.listProjects().length, 0);
    assert.equal(fs.readdirSync(importRoot(fixture.userDataPath)).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('keeps ordinary parse failures separate from cancellation when the result has no canceled field', async () => {
  const fixture = createFixture({ behavior: { prepareFailureOn: 'original' } });
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });

    assert.equal(preview.success, false);
    assert.equal(preview.canceled, false);
    assert.equal(preview.token, null);
    assert.match(preview.message, /解析失败/);
    assert.equal(fixture.manager.listProjects().length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('keeps partial tender errors visible but does not issue a confirmable token', async () => {
  const fixture = createFixture({ behavior: { partialTender: true } });
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA, fixture.paths.tenderB],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });

    assert.equal(preview.success, false);
    assert.equal(preview.canceled, false);
    assert.equal(preview.token, null);
    assert.equal(preview.tender.success, false);
    assert.equal(preview.tender.requestedCount, 2);
    assert.equal(preview.tender.documents.length, 1);
    assert.equal(preview.tender.errors.length, 1);
    assert.equal(preview.originalPlan.success, true);
    assert.equal(fs.readdirSync(importRoot(fixture.userDataPath)).length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('removes expansion staging when metadata is missing, mismatched, malformed, or internally inconsistent', async () => {
  const corruptions = [
    ['metadata token mismatch', (metadata) => { metadata.token = crypto.randomUUID(); }],
    ['invalid createdAt', (metadata) => { metadata.createdAt = 'not-a-date'; }],
    ['invalid expiresAt', (metadata) => { metadata.expiresAt = 'not-a-date'; }],
    ['expired expiresAt', (metadata) => { metadata.expiresAt = new Date(Date.now() - 1000).toISOString(); }],
    ['empty tender documents', (metadata) => { metadata.tenderDocuments = []; }],
    ['missing tender fileName', (metadata) => { delete metadata.tenderDocuments[0].fileName; }],
    ['invalid tender parserLabel', (metadata) => { metadata.tenderDocuments[0].parserLabel = 42; }],
    ['inconsistent tender fileHash', (metadata) => { metadata.tenderDocuments[0].fileHash = '0'.repeat(64); }],
    ['inconsistent tender contentHash', (metadata) => { metadata.tenderDocuments[0].contentHash = '0'.repeat(64); }],
    ['inconsistent tender contentPreview', (metadata) => { metadata.tenderDocuments[0].contentPreview = 'changed'; }],
    ['inconsistent tender markdownChars', (metadata) => { metadata.tenderDocuments[0].markdownChars += 1; }],
    ['invalid tender size', (metadata) => { metadata.tenderDocuments[0].size = 'large'; }],
    ['invalid tender modifiedAt', (metadata) => { metadata.tenderDocuments[0].modifiedAt = 'not-a-date'; }],
    ['invalid tender content', (metadata) => { metadata.tenderDocuments[0].content = null; }],
    ['invalid tender stagedPath', (metadata) => { metadata.tenderDocuments[0].stagedPath = path.join(os.tmpdir(), 'outside-expansion-staged.md'); }],
    ['invalid original-plan content', (metadata) => { metadata.originalPlanDocument.content = 42; }],
    ['missing original-plan stagedPath', (metadata) => { delete metadata.originalPlanDocument.stagedPath; }],
  ];

  for (const [label, corrupt] of corruptions) {
    const fixture = createFixture();
    try {
      const preview = await fixture.importService.prepareExpansionImport({
        tenderFilePaths: [fixture.paths.tenderA],
        originalPlanFilePaths: [fixture.paths.originalPlan],
      });
      const metadata = readStagedMetadata(fixture.userDataPath, preview.token);
      corrupt(metadata);
      writeStagedMetadata(fixture.userDataPath, preview.token, metadata);

      createBidProjectImportService({
        app: fixture.app,
        fileService: fixture.fileService,
        bidProjectManager: fixture.manager,
      });

      assert.equal(
        fs.existsSync(importDir(fixture.userDataPath, preview.token)),
        false,
        label,
      );
      await assert.rejects(
        fixture.importService.confirmExpansionImport(preview.token),
        /失效|损坏|过期|无效/,
        label,
      );
      assert.equal(fixture.manager.listProjects().length, 0, label);
    } finally {
      fixture.cleanup();
    }
  }
});

test('rejects ordinary and expired tokens before creating an expansion project', async () => {
  const fixture = createFixture();
  try {
    const ordinary = await fixture.importService.prepareImport([fixture.paths.tenderA]);
    await assert.rejects(
      fixture.importService.confirmExpansionImport(ordinary.token),
      /扩写|类型|暂存/,
    );

    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const metadataPath = path.join(importDir(fixture.userDataPath, preview.token), 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    await assert.rejects(
      fixture.importService.confirmExpansionImport(preview.token),
      /过期|失效/,
    );
    assert.equal(fixture.manager.listProjects().length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('creates an isolated expansion project and corrects workflow metadata on open', async () => {
  const fixture = createFixture();
  try {
    const ordinary = fixture.manager.createProject({
      projectName: '普通技术方案',
      projectType: 'technical-plan',
      sourceFile: {
        fileName: '普通招标文件.md',
        fileHash: 'ordinary-file-hash',
        contentHash: 'ordinary-content-hash',
        size: 10,
        modifiedAt: new Date().toISOString(),
      },
    });
    await fixture.manager.getTechnicalPlanStore(ordinary.projectId).importTenderDocument([fixture.paths.tenderA]);

    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA, fixture.paths.tenderB],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const expansion = await fixture.importService.confirmExpansionImport(preview.token, {
      projectName: '已有方案扩写',
    });

    assert.equal(expansion.projectType, 'existing-plan-expansion');
    assert.equal(fixture.manager.getProject(expansion.projectId).projectType, 'existing-plan-expansion');
    const expansionState = fixture.manager.getTechnicalPlanStore(expansion.projectId).loadTechnicalPlan();
    assert.equal(expansionState.workflowKind, 'existing-plan-expansion');
    assert.equal(expansionState.tenderFiles.length, 2);
    assert.equal(expansionState.originalPlanFile.fileName, path.basename(fixture.paths.originalPlan));
    assert.match(fixture.manager.getTechnicalPlanStore(expansion.projectId).readOriginalPlanMarkdown(), /已有方案正文/);

    const sourceRows = fixture.db.prepare(`
      SELECT file_name
      FROM bid_project_source_files
      WHERE project_id = ?
      ORDER BY file_name
    `).all(expansion.projectId);
    assert.deepEqual(sourceRows.map((row) => row.file_name), [
      path.basename(fixture.paths.tenderA),
      path.basename(fixture.paths.tenderB),
    ]);

    fixture.manager.getTechnicalPlanStore(expansion.projectId).setWorkflowKind('technical-plan');
    fixture.manager.openProject(expansion.projectId);
    const correctedState = fixture.manager.getTechnicalPlanStore(expansion.projectId).loadTechnicalPlan();
    assert.equal(correctedState.workflowKind, 'existing-plan-expansion');
    assert.equal(correctedState.tenderFiles.length, 2);
    assert.ok(correctedState.originalPlanFile);

    assert.equal(fixture.manager.getProject(ordinary.projectId).projectType, 'technical-plan');
    assert.equal(fixture.manager.getTechnicalPlanStore(ordinary.projectId).loadTechnicalPlan().tenderFile.fileName, path.basename(fixture.paths.tenderA));
    assert.deepEqual(fixture.workflowCalls.map((call) => [call.type, call.status]), [
      ['started', undefined],
      ['finished', 'succeeded'],
    ]);
    assert.equal(fixture.workflowCalls[0].payload.workflowKind, 'existing-plan-expansion');
  } finally {
    fixture.cleanup();
  }
});

test('does not create a project when original-plan confirmation fails', async () => {
  const fixture = createFixture({ behavior: { failOriginalConfirm: true } });
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });

    await assert.rejects(
      fixture.importService.confirmExpansionImport(preview.token),
      /原方案确认导入失败|未导入/,
    );
    assert.equal(fixture.manager.listProjects().length, 0);
    assert.equal(fs.readdirSync(importRoot(fixture.userDataPath)).length, 0);
    assert.equal(fixture.workflowCalls.at(-1).status, 'failed');
  } finally {
    fixture.cleanup();
  }
});

test('cleans the project record, directory, and staging directory after a confirm failure', async () => {
  const fixture = createFixture({ behavior: { failTenderConfirm: true } });
  try {
    const ordinary = fixture.manager.createProject({
      projectName: '保留的普通项目',
      projectType: 'technical-plan',
      sourceFile: {
        fileName: '普通招标文件.md',
        fileHash: 'ordinary-file-hash',
        contentHash: 'ordinary-content-hash',
        size: 10,
        modifiedAt: new Date().toISOString(),
      },
    });
    fixture.manager.getTechnicalPlanStore(ordinary.projectId).loadTechnicalPlan();
    const ordinaryTables = listProjectSchemaTables(fixture.db, ordinary.projectId);
    assert.ok(ordinaryTables.length > 0);

    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const stagedDirectory = importDir(fixture.userDataPath, preview.token);

    await assert.rejects(fixture.importService.confirmExpansionImport(preview.token), /招标文件确认导入失败|未导入/);
    assert.equal(fixture.manager.listProjects().length, 1);
    assert.equal(fs.existsSync(stagedDirectory), false);
    assert.equal(fs.readdirSync(path.join(fixture.userDataPath, 'workspace', 'bid-projects')).length, 1);
    const failedProjectId = fixture.workflowCalls.find((call) => call.type === 'started').payload.projectId;
    assert.equal(listProjectSchemaTables(fixture.db, failedProjectId).length, 0);
    assert.deepEqual(listProjectSchemaTables(fixture.db, ordinary.projectId), ordinaryTables);
  } finally {
    fixture.cleanup();
  }
});

test('marks a token consuming before an asynchronous confirm can be repeated', async () => {
  const delay = createDeferred();
  const fixture = createFixture({ behavior: { delayConfirmTender: delay } });
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const firstConfirm = fixture.importService.confirmExpansionImport(preview.token);
    await fixture.confirmTenderStarted;

    await assert.rejects(
      fixture.importService.confirmExpansionImport(preview.token),
      /处理中|消费|失效|暂存/,
    );
    const discardResult = fixture.importService.discardExpansionImport(preview.token);
    assert.equal(discardResult.success, false);
    assert.match(discardResult.message, /处理中|消费|失效/);
    assert.equal(fs.existsSync(importDir(fixture.userDataPath, preview.token)), true);
    delay.resolve();
    await firstConfirm;
    assert.equal(fixture.manager.listProjects().length, 1);
  } finally {
    fixture.cleanup();
  }
});

test('does not let expansion discard remove an ordinary import token', async () => {
  const fixture = createFixture();
  try {
    const ordinary = await fixture.importService.prepareImport([fixture.paths.tenderA]);
    const ordinaryDirectory = importDir(fixture.userDataPath, ordinary.token);
    const result = fixture.importService.discardExpansionImport(ordinary.token);

    assert.equal(result.success, false);
    assert.match(result.message, /扩写|类型/);
    assert.equal(fs.existsSync(ordinaryDirectory), true);
    fixture.importService.discardImport(ordinary.token);
  } finally {
    fixture.cleanup();
  }
});

test('rejects project-scoped import cancellation without projectId instead of cancelling another project', async () => {
  const fixture = createTaskScopeFixture();
  try {
    fixture.service.startOutlineGeneration({ projectId: 'project-b' });
    await assert.rejects(
      fixture.service.importTenderDocument([], undefined),
      /projectId|项目|标书/,
    );
    assert.equal(fixture.service.getActiveTasks().length, 1);
    assert.equal(fixture.service.getActiveTasks()[0].projectId, 'project-b');

    await fixture.service.cancelProjectTasks('project-b');
    assert.equal(fixture.service.getActiveTasks().length, 0);
  } finally {
    fixture.setCurrentProjectId('project-a');
  }
});

test('fails and cleans the project when a staged file is replaced after preparation', async () => {
  const fixture = createFixture();
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const metadata = readStagedMetadata(fixture.userDataPath, preview.token);
    fs.writeFileSync(metadata.tenderDocuments[0].stagedPath, '被替换的内容', 'utf8');

    await assert.rejects(
      fixture.importService.confirmExpansionImport(preview.token),
      /损坏|失效|文件|hash|哈希/i,
    );
    assert.equal(fixture.manager.listProjects().length, 0);
    assert.equal(fs.existsSync(importDir(fixture.userDataPath, preview.token)), false);
  } finally {
    fixture.cleanup();
  }
});

test('returns a committed project even when staged-directory cleanup fails', async () => {
  const fixture = createFixture();
  const originalRmSync = fs.rmSync;
  let cleanupFailureEnabled = true;
  try {
    const preview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const stagedDirectory = importDir(fixture.userDataPath, preview.token);
    fs.rmSync = (targetPath, options) => {
      if (cleanupFailureEnabled && targetPath === stagedDirectory) {
        const error = new Error('模拟暂存清理失败');
        error.code = 'EIO';
        throw error;
      }
      return originalRmSync(targetPath, options);
    };

    const project = await fixture.importService.confirmExpansionImport(preview.token);
    cleanupFailureEnabled = false;

    assert.equal(project.projectType, 'existing-plan-expansion');
    assert.equal(fixture.manager.listProjects().length, 1);
    assert.equal(fixture.workflowCalls.at(-1).status, 'succeeded');
    assert.equal(fs.existsSync(stagedDirectory), true);
  } finally {
    cleanupFailureEnabled = false;
    fs.rmSync = originalRmSync;
    fixture.cleanup();
  }
});

test('discard is idempotent and startup removes expired or corrupt expansion staging directories', async () => {
  const fixture = createFixture();
  try {
    const expiredPreview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    const expiredMetadataPath = path.join(importDir(fixture.userDataPath, expiredPreview.token), 'metadata.json');
    const expiredMetadata = JSON.parse(fs.readFileSync(expiredMetadataPath, 'utf8'));
    expiredMetadata.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(expiredMetadataPath, JSON.stringify(expiredMetadata, null, 2), 'utf8');

    const corruptToken = crypto.randomUUID();
    const corruptDirectory = importDir(fixture.userDataPath, corruptToken);
    fs.mkdirSync(corruptDirectory, { recursive: true });
    fs.writeFileSync(path.join(corruptDirectory, 'metadata.json'), '{broken', 'utf8');

    createBidProjectImportService({
      app: fixture.app,
      fileService: fixture.fileService,
      bidProjectManager: fixture.manager,
    });
    assert.equal(fs.existsSync(importDir(fixture.userDataPath, expiredPreview.token)), false);
    assert.equal(fs.existsSync(corruptDirectory), false);

    const validPreview = await fixture.importService.prepareExpansionImport({
      tenderFilePaths: [fixture.paths.tenderA],
      originalPlanFilePaths: [fixture.paths.originalPlan],
    });
    assert.deepEqual(fixture.importService.discardExpansionImport(validPreview.token), { success: true });
    assert.deepEqual(fixture.importService.discardExpansionImport(validPreview.token), { success: true });
    assert.equal(fs.existsSync(importDir(fixture.userDataPath, validPreview.token)), false);
  } finally {
    fixture.cleanup();
  }
});

test.after(() => {
  if (process.versions.electron) {
    require('electron').app.quit();
  }
});
