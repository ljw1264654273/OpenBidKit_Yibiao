const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-outline-store-'));
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const store = createTechnicalPlanStore({
      app,
      db: database.db,
      fileService: {},
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {} },
      configStore: { load: () => ({}) },
    });
    const originalOutline = {
      outline: [{ id: '1', title: '原项目概况', description: '原目录', content_mode: 'ai-generate' }],
    };
    const outlineData = {
      outline: [{ id: '1', title: '横泾街道项目概况', description: '适配目录', content_mode: 'ai-generate' }],
    };
    const changes = [{
      id: 'rename-1', change_type: 'renamed', original_path: '原项目概况',
      target_node_id: '1', target_title: '横泾街道项目概况', reason: '地点替换', difference_ids: ['replace-location'], reuse_original: false,
    }];

    store.updateTechnicalPlan({
      historicalAdaptationOriginalOutline: originalOutline,
      historicalAdaptationOutlineChanges: changes,
      historicalAdaptationOutlineConfirmedAt: '2026-10-01T09:00:00.000Z',
      historicalAdaptationContentItems: [{
        node_id: '1', source_path: '原项目概况', mode: 'direct', status: 'success', reason: '旧迁移结果',
        difference_ids: [], source_excerpt: '旧正文', blocked_terms: [], residuals: [], confirmed_at: '2026-10-01T10:00:00.000Z',
      }],
      historicalAdaptationContentConfirmedAt: '2026-10-01T10:10:00.000Z',
      outlineData,
    });
    let state = store.loadTechnicalPlan();
    assert.deepEqual(state.historicalAdaptationOriginalOutline, originalOutline);
    assert.deepEqual(state.historicalAdaptationOutlineChanges, changes);

    state = store.saveHistoricalAdaptationOutline({
      outlineData: { outline: [{ ...outlineData.outline[0], id: '1.1' }] },
      reason: 'sort', idMap: { '1': '1.1' },
      changes: [{ ...changes[0], target_node_id: '1.1' }],
    });
    assert.equal(state.historicalAdaptationOutlineChanges[0].target_node_id, '1.1');
    assert.equal(state.historicalAdaptationOutlineChanges[0].reuse_original, false);

    state = store.saveHistoricalAdaptationOutline({
      outlineData: {
        ...outlineData,
        outline: [{ ...outlineData.outline[0], title: '横泾街道项目总体概况' }],
      },
      reason: 'edit',
      affectedNodeIds: ['1'],
      changes: [{ ...changes[0], target_title: '横泾街道项目总体概况', reason: '人工调整标题' }],
    });
    assert.equal(state.outlineData.outline[0].title, '横泾街道项目总体概况');
    assert.equal(state.historicalAdaptationOutlineConfirmedAt, undefined);
    assert.equal(state.historicalAdaptationOutlineChanges[0].reason, '人工调整标题');
    assert.deepEqual(state.historicalAdaptationContentItems, []);
    assert.equal(state.historicalAdaptationContentConfirmedAt, undefined);

    store.updateTechnicalPlan({
      historicalAdaptationOutlineTask: {
        task_id: 'outline-running', type: 'historical-adaptation-outline', status: 'running', progress: 50, logs: [],
      },
    });
    assert.throws(() => store.saveHistoricalAdaptationOutline({
      outlineData: state.outlineData, reason: 'edit', affectedNodeIds: ['1'], changes,
    }), /目录适配任务正在运行/);
    assert.throws(() => store.confirmHistoricalAdaptationOutline(), /目录适配任务正在运行/);

    store.updateTechnicalPlan({
      historicalAdaptationOutlineTask: {
        task_id: 'outline-queued', type: 'historical-adaptation-outline', status: 'queued', progress: 0, logs: [],
      },
    });
    assert.throws(() => store.confirmHistoricalAdaptationOutline(), /目录适配任务正在运行/);

    store.updateTechnicalPlan({
      historicalAdaptationOutlineTask: {
        task_id: 'outline-success', type: 'historical-adaptation-outline', status: 'success', progress: 100, logs: [],
      },
    });
    state = store.confirmHistoricalAdaptationOutline();
    assert.equal(Boolean(state.historicalAdaptationOutlineConfirmedAt), true);

    state = store.saveHistoricalAdaptationOutline({
      outlineData: { outline: [{ id: '1', title: '横泾街道目标', children: [
        { id: '1.1', title: '保障群众合法权益', content_mode: 'ai-generate' },
      ] }] },
      reason: 'replace',
      changes: [{ id: 'source-1.1', change_type: 'unchanged', original_path: '五峰村目标 / 保障群众合法权益',
        target_node_id: '1.1', target_title: '保障群众合法权益', reason: '沿用历史章节', difference_ids: [] }],
    });
    assert.equal(state.historicalAdaptationOutlineChanges[0].original_path, '五峰村目标 / 保障群众合法权益');
    assert.equal(store.loadTechnicalPlan().historicalAdaptationOutlineChanges[0].change_type, 'unchanged');
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
  test('persists, edits and confirms historical adaptation outline with task locks', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
