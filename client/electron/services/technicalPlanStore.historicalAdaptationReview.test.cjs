const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

function protocolInputsHash(inputsHash) {
  return crypto.createHash('sha256').update(JSON.stringify({
    inputsHash,
    rule_engine_version: 4,
    fact_schema_version: 2,
    repair_protocol_version: 1,
  }), 'utf8').digest('hex');
}

function currentCheck(context, factsHash = 'facts-v1') {
  return {
    status: 'success', stage: 'semantic', findings: [],
    checked_content_hash: context.contentHash, checked_inputs_hash: context.inputsHash,
    checked_facts_hash: factsHash, checked_protocol_inputs_hash: protocolInputsHash(context.inputsHash),
    rule_engine_version: 4, fact_schema_version: 2, repair_protocol_version: 1,
    auto_repaired_count: 0, manual_count: 0, repair_round: 0,
  };
}

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
        node_id: '1', status: 'success', blocked_terms: [], residuals: [], difference_ids: [],
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
        checked_facts_hash: 'facts-v1',
        checked_protocol_inputs_hash: protocolInputsHash(checkContext.inputsHash),
        rule_engine_version: 3,
        fact_schema_version: 1,
        repair_protocol_version: 1,
      },
    });

    assert.throws(() => store.runHistoricalAdaptationReview(), /阻断/, 'a forged successful check cannot bypass deterministic blockers');
    store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '本项目实施方案已明确。' });
    const validContext = store.getHistoricalAdaptationContentCheckContext();
    store.updateTechnicalPlan({ historicalAdaptationContentCheck: currentCheck(validContext) });
    store.confirmHistoricalAdaptationContent();
    store.updateTechnicalPlan({ historicalAdaptationReviewFindings: [
      { id: 'non-waivable', severity: 'P0', resolution: 'open' },
      { id: 'advice', severity: 'P1', resolution: 'open' },
    ] });
    for (const resolution of ['resolved', 'ignored']) {
      assert.throws(() => store.setHistoricalAdaptationReviewFinding({ findingId: 'non-waivable', resolution, resolutionNote: '备注不得代替正文整改' }), /P0|阻断/);
    }
    store.updateTechnicalPlan({ historicalAdaptationReviewFindings: [{ id: 'non-waivable', severity: 'P0', resolution: 'resolved' }] });
    assert.throws(() => store.confirmHistoricalAdaptationReview(), /P0/, 'legacy resolved P0 findings must still block acceptance');
    store.updateTechnicalPlan({ historicalAdaptationReviewFindings: [{ id: 'advice', severity: 'P1', resolution: 'open' }] });
    let state = store.setHistoricalAdaptationReviewFinding({ findingId: 'advice', resolution: 'resolved', resolutionNote: '已复核建议' });
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
