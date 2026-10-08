const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-content-check-batches-'));
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    assert.equal(database.schemaVersion, 47);
    assert.ok(database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'historical_adaptation_content_check_batches'").get());
    const store = createTechnicalPlanStore({
      app,
      db: database.db,
      fileService: {},
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
      configStore: { load: () => ({}) },
    });

    store.updateTechnicalPlan({
      outlineData: { outline: [{ id: 'chapter-1', title: '第一章', content: '地点为甲地。' }] },
      bidAnalysisTasks: { project_name: { result: '示例项目' } },
    });
    store.saveGlobalFacts([{ id: 'location', title: '项目地点', content: '甲地' }]);
    const contextWithFacts = store.getHistoricalAdaptationContentCheckContext();
    assert.deepEqual(contextWithFacts.globalFacts.map((item) => item.content), ['甲地']);
    const firstHash = contextWithFacts.inputsHash;
    store.saveGlobalFacts([{ id: 'location', title: '项目地点', content: '乙地' }]);
    const contextWithChangedFacts = store.getHistoricalAdaptationContentCheckContext();
    assert.notEqual(contextWithChangedFacts.inputsHash, firstHash, 'global facts must participate in inputs hash');

    const checkRunId = 'check-1';
    const created = store.createHistoricalAdaptationContentCheckBatches({
      checkRunId,
      contentHash: contextWithChangedFacts.contentHash,
      inputHash: contextWithChangedFacts.inputsHash,
      factsHash: 'facts-1',
      protocolHash: 'protocol-1',
      batches: [
        { batchId: 'batch-1', batchIndex: 0, nodeIds: ['chapter-1'], requestSummary: { chars: 10 } },
        { batchId: 'batch-2', batchIndex: 1, nodeIds: ['chapter-2'] },
      ],
    });
    assert.equal(created.length, 2);
    assert.equal(created[0].status, 'pending');
    assert.deepEqual(store.listHistoricalAdaptationContentCheckBatches({ checkRunId }).map((item) => item.batch_id), ['batch-1', 'batch-2']);

    const running = store.updateHistoricalAdaptationContentCheckBatch({ checkRunId, batchId: 'batch-1', status: 'running', attemptCount: 1 });
    assert.equal(running.status, 'running');
    const saved = store.saveHistoricalAdaptationContentCheckBatchResult({
      checkRunId,
      batchId: 'batch-1',
      status: 'success',
      result: { candidates: [{ slot: 'project_location', value: '甲地' }] },
      requestSummary: { chars: 10, redacted: true },
    });
    assert.equal(saved.status, 'success');
    assert.deepEqual(saved.result, { candidates: [{ slot: 'project_location', value: '甲地' }] });
    assert.deepEqual(store.getReusableHistoricalAdaptationContentCheckBatches({
      checkRunId,
      contentHash: contextWithChangedFacts.contentHash,
      inputHash: contextWithChangedFacts.inputsHash,
      factsHash: 'facts-1',
      protocolHash: 'protocol-1',
    }).map((item) => item.batch_id), ['batch-1']);
    assert.deepEqual(store.getReusableHistoricalAdaptationContentCheckBatches({ checkRunId, inputHash: contextWithChangedFacts.inputsHash }).map((item) => item.batch_id), []);

    // A retry plan must not erase an already successful cache entry unless replace is explicit.
    store.createHistoricalAdaptationContentCheckBatches({
      checkRunId,
      inputHash: contextWithChangedFacts.inputsHash,
      factsHash: 'facts-1',
      protocolHash: 'protocol-1',
      batches: [{ batchId: 'batch-1', batchIndex: 0, status: 'pending' }],
    });
    assert.equal(store.getHistoricalAdaptationContentCheckBatch({ checkRunId, batchId: 'batch-1' }).status, 'success');

    store.invalidateHistoricalAdaptationContentCheckBatches({ checkRunId, inputHash: 'new-input' });
    assert.equal(store.getHistoricalAdaptationContentCheckBatch({ checkRunId, batchId: 'batch-1' }).status, 'stale');
    assert.equal(store.getHistoricalAdaptationContentCheckBatch({ checkRunId, batchId: 'batch-2' }).status, 'stale');

    // The atomic result path must roll back the batch update when the optional snapshot write fails.
    store.createHistoricalAdaptationContentCheckBatches({ checkRunId: 'check-2', batches: [{ batchId: 'batch-x', batchIndex: 0 }] });
    assert.throws(() => store.saveHistoricalAdaptationContentCheckBatchResult({
      checkRunId: 'check-2', batchId: 'batch-x', status: 'success', result: { ok: true },
      snapshot: { invalid: true },
    }), /snapshot|快照|unsupported/i);
    assert.equal(store.getHistoricalAdaptationContentCheckBatch({ checkRunId: 'check-2', batchId: 'batch-x' }).status, 'pending');

    store.createHistoricalAdaptationContentCheckBatches({ checkRunId: 'check-3', batches: [
      { batchId: 'batch-a', batchIndex: 0 }, { batchId: 'batch-b', batchIndex: 1 },
    ] });
    store.saveHistoricalAdaptationContentCheckBatchResult({ checkRunId: 'check-3', batchId: 'batch-a', result: { ok: true } });
    assert.throws(() => store.saveHistoricalAdaptationContentCheckBatchResult({
      checkRunId: 'check-3', batchId: 'batch-a', status: 'success',
      snapshot: { historicalAdaptationContentCheck: { status: 'success' } },
    }), /incomplete|批次/);
    assert.equal(store.getHistoricalAdaptationContentCheckBatch({ checkRunId: 'check-3', batchId: 'batch-a' }).status, 'success');
    store.saveHistoricalAdaptationContentCheckBatchResult({ checkRunId: 'check-3', batchId: 'batch-b', result: { ok: true } });
    store.saveHistoricalAdaptationContentCheckBatchResult({
      checkRunId: 'check-3', batchId: 'batch-b', status: 'success',
      snapshot: { historicalAdaptationContentCheck: { status: 'success', findings: [] } },
    });

    store.createHistoricalAdaptationContentCheckBatches({ checkRunId: 'check-4', batches: [{ batchId: 'batch-f' }] });
    store.saveHistoricalAdaptationContentCheckBatchResult({ checkRunId: 'check-4', batchId: 'batch-f', result: { ok: true } });
    store.updateTechnicalPlan({ globalFacts: [{ id: 'location', title: '项目地点', content: '丙地' }] });
    assert.equal(store.getHistoricalAdaptationContentCheckBatch({ checkRunId: 'check-4', batchId: 'batch-f' }).status, 'stale');

    store.updateTechnicalPlan({
      outlineData: { outline: [
        { id: 'chapter-1', title: '第一章', content: '项目名称为甲项目。' },
        { id: 'chapter-2', title: '第二章', content: '普通正文。' },
      ] },
      historicalAdaptationContentItems: [
        { node_id: 'chapter-1', status: 'success', residuals: [] },
        { node_id: 'chapter-2', status: 'success', residuals: [] },
      ],
    });
    const factContext = store.getHistoricalAdaptationContentCheckContext();
    const finalFactsHash = 'merged-facts-hash';
    store.upsertHistoricalAdaptationContentCheckRun({ checkRunId: 'check-facts', contentHash: factContext.contentHash,
      inputHash: factContext.inputsHash, factsHash: 'pre-extraction-hash', protocolHash: factContext.protocolHash,
      expectedBatchCount: 1, expectedNodeIds: ['chapter-1', 'chapter-2'] });
    store.createHistoricalAdaptationContentCheckBatches({ checkRunId: 'check-facts', contentHash: factContext.contentHash,
      inputHash: factContext.inputsHash, factsHash: 'pre-extraction-hash', protocolHash: factContext.protocolHash,
      batches: [{ batchId: 'fact-batch', batchIndex: 0, nodeIds: ['chapter-1', 'chapter-2'] }] });
    store.saveHistoricalAdaptationContentCheckBatchResult({ checkRunId: 'check-facts', batchId: 'fact-batch', status: 'success',
      result: { facts: [{ fact_key: 'name:project_name:项目名称', kind: 'name', canonical_value: '甲项目',
        normalized_value: '甲项目', normalized_values: ['甲项目', '乙项目'], conflict: true,
        chapter_node_ids: ['chapter-1'], evidence: ['项目名称为甲项目。', '项目名称为乙项目。'] }] } });
    store.upsertHistoricalAdaptationContentCheckRun({ checkRunId: 'check-facts', contentHash: factContext.contentHash,
      inputHash: factContext.inputsHash, factsHash: finalFactsHash, protocolHash: factContext.protocolHash,
      expectedBatchCount: 1, expectedNodeIds: ['chapter-1', 'chapter-2'], status: 'success' });
    store.updateTechnicalPlan({ historicalAdaptationContentCheck: { status: 'success', findings: [],
      checked_content_hash: factContext.contentHash, checked_inputs_hash: factContext.inputsHash,
      checked_facts_hash: finalFactsHash, checked_protocol_inputs_hash: factContext.protocolHash,
      rule_engine_version: 4, fact_schema_version: 2, repair_protocol_version: 1 } });
    const snapshot = store.getHistoricalAdaptationContentFacts();
    assert.equal(snapshot.ok, true, snapshot.message);
    assert.equal(snapshot.facts[0]?.canonical_value, '甲项目');
    assert.deepEqual(snapshot.facts[0]?.chapter_node_ids, ['chapter-1']);
    assert.deepEqual(snapshot.facts[0]?.normalized_values, ['甲项目', '乙项目']);
    assert.deepEqual(snapshot.facts[0]?.values, ['甲项目', '乙项目']);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('persists and reuses historical adaptation content check batches', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native batch store test timed out');
  });
}

