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
      content_change_scope: 'location-target',
      difference_schema_version: 2,
      replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
      target_action: 'replace',
      evidence_kind: 'exact-value',
      confidence: 'high',
      old_content_evidence: ['五峰村'],
    };

    store.updateTechnicalPlan({
      historicalAdaptationDifferences: [difference],
      historicalAdaptationDifferenceConfirmedAt: null,
    });
    assert.deepEqual(store.loadTechnicalPlan().historicalAdaptationDifferences, [difference]);
    assert.deepEqual(store.loadTechnicalPlan().historicalAdaptationDifferences[0].replacements, difference.replacements);
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferences[0].target_action, 'replace');
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferences[0].evidence_kind, 'exact-value');
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferences[0].confidence, 'high');
    assert.deepEqual(store.loadTechnicalPlan().historicalAdaptationDifferences[0].old_content_evidence, ['五峰村']);
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferenceConfirmedAt, undefined);

    const next = store.saveHistoricalAdaptationDifferences({
      differences: [{ ...difference, note: '人工复核完成', decision: 'confirmed' }],
    });
    assert.equal(next.historicalAdaptationDifferences[0].decision, 'confirmed');
    assert.deepEqual(next.historicalAdaptationDifferences[0].replacements, difference.replacements);
    assert.equal(next.historicalAdaptationDifferences[0].difference_schema_version, 2);
    assert.equal(next.historicalAdaptationDifferenceConfirmedAt.length > 0, true);
    assert.equal(store.loadTechnicalPlan().historicalAdaptationDifferenceConfirmedAt, next.historicalAdaptationDifferenceConfirmedAt);

    store.updateTechnicalPlan({
      outlineData: { outline: [{ id: 'manual-node', title: '人工章节', content: '用户人工正文。' }] },
      historicalAdaptationContentItems: [{
        node_id: 'manual-node', source_path: '人工章节', status: 'success', content_origin: 'manual',
        difference_ids: ['location'], source_excerpt: '历史正文', blocked_terms: [], residuals: [],
      }],
      historicalAdaptationContentConfirmedAt: '2026-10-01T10:00:00.000Z',
    });
    const savedWithManualContent = store.saveHistoricalAdaptationDifferences({
      differences: [{ ...difference, note: '仅补充复核备注', decision: 'confirmed' }],
    });
    assert.equal(savedWithManualContent.outlineData.outline[0].content, '用户人工正文。');
    assert.equal(savedWithManualContent.historicalAdaptationContentItems[0].content_origin, 'manual');
    assert.equal(savedWithManualContent.historicalAdaptationContentItems[0].status, 'success');

    const legacyDifference = {
      id: 'legacy-location', category: '名称地点替换', priority: 'high', title: '替换项目地点',
      historical_location: '项目概况', historical_excerpt: '五峰村', tender_requirement: '横泾街道',
      action: '全文替换并检查村级表述', note: '', decision: 'confirmed',
    };
    database.db.prepare('UPDATE technical_plan_meta SET historical_adaptation_differences_json = ?')
      .run(JSON.stringify([legacyDifference]));
    const [legacy] = store.loadTechnicalPlan().historicalAdaptationDifferences;
    assert.equal(legacy.content_change_scope, 'none');
    assert.equal(legacy.decision, 'pending');
    assert.equal(legacy.target_action, 'review');
    assert.equal(legacy.evidence_kind, 'contextual');
    assert.equal(legacy.confidence, 'low');
    assert.deepEqual(legacy.replacements, []);
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
