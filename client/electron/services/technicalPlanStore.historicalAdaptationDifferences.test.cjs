const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function createApp(userDataPath) {
  return { getPath: () => userDataPath, once() {} };
}

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-differences-store-'));
  let database;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const store = createTechnicalPlanStore({
      app,
      db: database.db,
      fileService: {},
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {} },
      configStore: { load: () => ({}) },
    });
    const difference = {
      id: 'location-change',
      category: '名称地点替换',
      priority: 'high',
      title: '替换项目地点',
      historical_location: '项目概况',
      historical_excerpt: '五峰村',
      tender_requirement: '横泾街道',
      action: '全文替换并检查村级表述',
      note: '',
      decision: 'pending',
    };

    store.updateTechnicalPlan({
      historicalAdaptationDifferences: [difference],
      historicalAdaptationDifferenceConfirmedAt: null,
    });
    assert.deepEqual(store.loadTechnicalPlan().historicalAdaptationDifferences, [difference]);
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferenceConfirmedAt, undefined);

    const next = store.saveHistoricalAdaptationDifferences({
      differences: [{ ...difference, note: '人工复核完成', decision: 'confirmed' }],
    });
    assert.equal(next.historicalAdaptationDifferences[0].decision, 'confirmed');
    assert.equal(next.historicalAdaptationDifferenceConfirmedAt.length > 0, true);
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferenceConfirmedAt, next.historicalAdaptationDifferenceConfirmedAt);
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
  test('persists historical adaptation differences and completion timestamp', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
