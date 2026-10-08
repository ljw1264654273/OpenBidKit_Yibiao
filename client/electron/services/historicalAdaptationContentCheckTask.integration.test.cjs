const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const { runHistoricalAdaptationContentCheckTask } = require('./historicalAdaptationContentCheckTask.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-content-check-integration-'));
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const store = createTechnicalPlanStore({
      app, db: database.db, fileService: {},
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
      configStore: { load: () => ({}) },
    });
    store.updateTechnicalPlan({
      outlineData: { outline: [{ id: 'chapter-1', title: '普通章节', content: '普通正文' }] },
      historicalAdaptationContentItems: [{ node_id: 'chapter-1', status: 'success', confirmed_at: '2026-10-08T00:00:00.000Z', residuals: [] }],
    });
    let requests = 0;
    const task = {
      aiService: { requestJson: async (request) => {
        requests += 1;
        return request.response_format?.json_schema?.name === 'historical_adaptation_facts'
          ? { facts: [{ fact_id: 'service-1', kind: 'service', canonical_value: '普通正文',
            evidence: ['普通正文'], chapter_node_ids: ['chapter-1'], conflict: false }] }
          : { findings: [] };
      } },
      workspaceStore: store,
      checkpointTask: (_task, patch) => {
        if (patch?.historicalAdaptationContentCheck) store.updateTechnicalPlan(patch);
      },
    };
    await runHistoricalAdaptationContentCheckTask(task);
    const snapshot = store.getHistoricalAdaptationContentFacts();
    assert.equal(snapshot.ok, true, snapshot.message);
    assert.equal(snapshot.facts[0]?.canonical_value, '普通正文');
    assert.ok(requests > 0);

    requests = 0;
    await runHistoricalAdaptationContentCheckTask(task);
    assert.equal(requests, 0, 'complete fact snapshot should allow semantic cache reuse');
    assert.equal(store.getHistoricalAdaptationContentFacts().ok, true);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  runAssertions().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit(process.exitCode || 0));
} else {
  test('check task persists a readable fact snapshot and reuses it', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native check integration timed out');
  });
}
