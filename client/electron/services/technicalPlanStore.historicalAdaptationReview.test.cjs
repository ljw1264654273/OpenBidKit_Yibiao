const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-review-store-'));
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
    store.updateTechnicalPlan({
      workflowKind: 'technical-plan',
      outlineData: { outline: [{ id: '1', title: '项目实施', content: '本项目仍有【待核实】事项。', content_mode: 'ai-generate' }] },
      historicalAdaptationDifferences: [],
      historicalAdaptationContentItems: [{
        node_id: '1', status: 'success', confirmed_at: '2026-10-01T00:00:00.000Z', blocked_terms: [], residuals: [], difference_ids: [],
      }],
      historicalAdaptationContentConfirmedAt: '2026-10-01T00:00:00.000Z',
    });

    assert.throws(() => store.runHistoricalAdaptationReview(), /一致性检查/);
    const checkContext = store.getHistoricalAdaptationContentCheckContext();
    store.updateTechnicalPlan({
      historicalAdaptationContentCheck: {
        status: 'success',
        findings: [],
        checked_content_hash: checkContext.contentHash,
        checked_inputs_hash: checkContext.inputsHash,
        checked_at: '2026-10-01T00:05:00.000Z',
      },
    });

    let state = store.runHistoricalAdaptationReview();
    assert.equal(state.historicalAdaptationReviewFindings[0].severity, 'P0');
    assert.throws(() => store.confirmHistoricalAdaptationReview(), /P0/);
    assert.throws(() => store.assertHistoricalAdaptationExportAllowed(), /P0/);

    const finding = state.historicalAdaptationReviewFindings[0];
    state = store.setHistoricalAdaptationReviewFinding({ findingId: finding.id, resolution: 'resolved', resolutionNote: '已整改并补充明确表述' });
    assert.equal(state.historicalAdaptationReviewFindings[0].resolution, 'resolved');
    state = store.confirmHistoricalAdaptationReview();
    assert.ok(state.historicalAdaptationReviewConfirmedAt);
    assert.doesNotThrow(() => store.assertHistoricalAdaptationExportAllowed());

    store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '服务范围为横泾街道。' });
    state = store.loadTechnicalPlan();
    assert.equal(state.historicalAdaptationReviewFindings.length, 0);
    assert.equal(state.historicalAdaptationReviewConfirmedAt, undefined);
    assert.throws(() => store.assertHistoricalAdaptationExportAllowed(), /正文迁移/);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('persists review findings, enforces acceptance/export gate and invalidates on content edits', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native review store test timed out');
  });
}
