const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runAssertions() {
  const { createSqliteDatabase, createTechnicalPlanProjectSchema } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-project-content-'));
  const projectId = 'historical-project';
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    createTechnicalPlanProjectSchema(database.db, projectId);
    const createStore = () => createTechnicalPlanStore({
      app,
      db: database.db,
      fileService: {},
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
      configStore: { load: () => ({}) },
      projectId,
    });
    const store = createStore();
    store.updateTechnicalPlan({
      outlineData: { outline: [{ id: '1', title: '项目概况', content: '' }] },
    });
    store.updateTechnicalPlan({
      contentGenerationItem: {
        nodeId: '1',
        section: { status: 'success', content: '直接迁移后的正文。' },
      },
    });

    assert.equal(store.loadTechnicalPlan().outlineData.outline[0].content, '直接迁移后的正文。');
    database.close();
    database = createSqliteDatabase(app);
    const reopenedStore = createStore();
    assert.equal(reopenedStore.loadTechnicalPlan().outlineData.outline[0].content, '直接迁移后的正文。');
  } finally {
    database?.close();
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
  test('persists migrated content in project-scoped outline nodes across reopen', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
