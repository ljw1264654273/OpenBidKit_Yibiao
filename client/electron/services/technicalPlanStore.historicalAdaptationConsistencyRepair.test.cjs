const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

function hash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-repair-store-'));
  const app = { getPath: () => userDataPath, once() {} };
  let changed = 0;
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
      onContentChanged: () => { changed += 1; },
    });
    const oldContents = {
      '1': '实施地点为旧地点，项目区域为旧区域。',
      '2': '项目地点：旧地点。',
    };
    const items = Object.entries(oldContents).map(([node_id, content], index) => ({
      node_id,
      source_path: `来源/${node_id}`,
      source_hash: `source-${node_id}`,
      source_version_hash: `version-${node_id}`,
      source_content_hash: `source-content-${node_id}`,
      recommended_mode: 'local-rewrite',
      manual_mode: '',
      manual_instruction: '',
      plan_id: `plan-${node_id}`,
      input_fingerprint: `fingerprint-${node_id}`,
      status: 'success',
      content_origin: 'ai-rewrite',
      migration_output_hash: `old-output-${node_id}`,
      residuals: [],
      blocked_terms: ['旧地点'],
      difference_ids: ['location-1'],
      updated_at: `2026-10-07T10:0${index}:00.000Z`,
    }));
    store.updateTechnicalPlan({
      outlineData: { outline: Object.entries(oldContents).map(([id, content]) => ({ id, title: `章节${id}`, content })) },
      historicalAdaptationContentItems: items,
      historicalAdaptationContentConfirmedAt: '2026-10-07T11:00:00.000Z',
      historicalAdaptationContentCheck: {
        status: 'success', stage: 'semantic', findings: [{ id: 'old', blocking: false }],
        checked_content_hash: 'old-content-hash', checked_inputs_hash: 'old-inputs-hash',
        checked_facts_hash: 'facts-v1', checked_protocol_inputs_hash: 'old-protocol-hash',
        rule_engine_version: 3, fact_schema_version: 1, repair_protocol_version: 1,
        auto_repaired_count: 0, manual_count: 1, repair_round: 0,
      },
      historicalAdaptationReviewFindings: [{ id: 'review', severity: 'P1' }],
      historicalAdaptationReviewConfirmedAt: '2026-10-07T12:00:00.000Z',
      contentGenerationSections: {
        '1': { status: 'error', error: '旧错误', content: oldContents['1'] },
        '2': { status: 'running', error: '旧运行', content: oldContents['2'] },
      },
      contentIllustrationPlan: { revision: 'before', items: [{ item_id: 'illustration-1', kind: 'mermaid', section_ids: ['1'] }] },
    });
    const context = store.getHistoricalAdaptationContentCheckContext();
    const facts = [{ fact_id: 'location-1', kind: 'location', canonical_value: '新地点' }];
    const expectedFactsHash = hash(facts);
    const checkedProtocolInputsHash = hash({
      inputsHash: context.inputsHash,
      rule_engine_version: 4,
      fact_schema_version: 1,
      repair_protocol_version: 1,
    });
    store.updateTechnicalPlan({ historicalAdaptationContentCheck: {
      status: 'success', stage: 'semantic', findings: [{ id: 'old', blocking: false }],
      checked_content_hash: context.contentHash, checked_inputs_hash: context.inputsHash,
      checked_facts_hash: expectedFactsHash, checked_protocol_inputs_hash: checkedProtocolInputsHash,
      rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1,
      auto_repaired_count: 0, manual_count: 0, repair_round: 0,
    } });
    const chapters = Object.entries(oldContents).map(([node_id, content]) => ({
      node_id,
      expected_node_content_hash: hash(content),
      expected_item_fingerprint: `fingerprint-${node_id}`,
      old_text: '旧地点',
      new_text: '新地点',
      evidence: ['招标文件：新地点'],
    }));
    const repairs = [{
      group_id: 'location-1', fact_id: 'location-1', confidence: 'high', rationale: '统一地点口径',
      expected_content_hash: context.contentHash,
      expected_inputs_hash: context.inputsHash,
      expected_facts_hash: expectedFactsHash,
      chapters,
    }, {
      group_id: 'region-1', fact_id: 'region-1', confidence: 'high', rationale: '统一区域口径',
      expected_content_hash: context.contentHash,
      expected_inputs_hash: context.inputsHash,
      expected_facts_hash: expectedFactsHash,
      chapters: [{ ...chapters[0], old_text: '旧区域', new_text: '新区域' }],
    }];

    assert.equal(typeof store.applyHistoricalAdaptationConsistencyRepairs, 'function');
    const result = store.applyHistoricalAdaptationConsistencyRepairs({
      expectedContentHash: context.contentHash,
      expectedInputsHash: context.inputsHash,
      expectedFactsHash,
      repairs,
    });
    assert.equal(result.appliedCount, 2);
    const state = store.loadTechnicalPlan();
    assert.equal(state.outlineData.outline[0].content, '实施地点为新地点，项目区域为新区域。');
    assert.equal(state.outlineData.outline[1].content, '项目地点：新地点。');
    assert.deepEqual(state.historicalAdaptationContentItems.map((item) => item.content_origin), ['ai-repair', 'ai-repair']);
    assert.deepEqual(state.historicalAdaptationContentItems.map((item) => item.status), ['success', 'success']);
    assert.equal(state.historicalAdaptationContentConfirmedAt, undefined);
    assert.deepEqual(state.historicalAdaptationReviewFindings, []);
    assert.equal(state.historicalAdaptationReviewConfirmedAt, undefined);
    assert.equal(state.historicalAdaptationContentCheck.status, 'idle');
    assert.equal(state.contentGenerationSections['1'].status, 'success');
    assert.equal(state.contentGenerationSections['1'].error, undefined);
    assert.equal(state.contentGenerationSections['2'].status, 'success');
    assert.equal(state.contentGenerationSections['2'].error, undefined);
    assert.equal(state.contentIllustrationPlan, undefined);
    assert.equal(changed, 1);
    for (const [nodeId, content] of Object.entries({ '1': '实施地点为新地点，项目区域为新区域。', '2': '项目地点：新地点。' })) {
      const item = state.historicalAdaptationContentItems.find((candidate) => candidate.node_id === nodeId);
      const mode = item.manual_mode || item.recommended_mode;
      assert.equal(item.migration_output_hash, hash(JSON.stringify([
        item.source_hash, item.input_fingerprint, mode, item.manual_instruction, content,
      ])));
      assert.equal(item.confirmed_at, undefined);
    }

    const before = store.loadTechnicalPlan();
    const beforeRows = database.db.prepare('SELECT node_id, content FROM technical_plan_outline_nodes ORDER BY node_id').all();
    const beforeItems = database.db.prepare('SELECT node_id, item_json FROM technical_plan_historical_content_items ORDER BY node_id').all();
    const failures = [
      ['content hash', { expectedContentHash: hash('stale') }],
      ['input hash', { expectedInputsHash: hash('stale') }],
      ['facts hash', { expectedFactsHash: hash('stale') }],
      ['node hash', { repairs: [{ ...repairs[0], chapters: [{ ...chapters[0], expected_node_content_hash: hash('stale') }, chapters[1]] }] }],
      ['item fingerprint', { repairs: [{ ...repairs[0], chapters: [{ ...chapters[0], expected_item_fingerprint: 'stale' }, chapters[1]] }] }],
      ['invalid node', { repairs: [{ ...repairs[0], chapters: [{ ...chapters[0], node_id: 'missing' }, chapters[1]] }] }],
    ];
    for (const [label, override] of failures) {
      const current = store.getHistoricalAdaptationContentCheckContext();
      store.updateTechnicalPlan({ historicalAdaptationContentCheck: {
        status: 'success', stage: 'semantic', findings: [], checked_content_hash: current.contentHash,
        checked_inputs_hash: current.inputsHash, checked_facts_hash: expectedFactsHash,
        checked_protocol_inputs_hash: hash({ inputsHash: current.inputsHash, rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 }),
        rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1,
      } });
      const request = {
        expectedContentHash: current.contentHash,
        expectedInputsHash: current.inputsHash,
        expectedFactsHash,
        repairs: [{ ...repairs[0], expected_content_hash: current.contentHash, expected_inputs_hash: current.inputsHash, chapters: repairs[0].chapters.map((chapter) => ({ ...chapter })) }],
        ...override,
      };
      if (!['content hash', 'input hash', 'facts hash'].includes(label)) {
        request.repairs = request.repairs.map((group) => ({
          ...group,
          expected_content_hash: current.contentHash,
          expected_inputs_hash: current.inputsHash,
          expected_facts_hash: expectedFactsHash,
        }));
      }
      const expectedError = label === 'node hash' ? /node.*hash/i : new RegExp(label, 'i');
      assert.throws(() => store.applyHistoricalAdaptationConsistencyRepairs(request), expectedError, label);
      assert.deepEqual(database.db.prepare('SELECT node_id, content FROM technical_plan_outline_nodes ORDER BY node_id').all(), beforeRows, `${label} must roll back nodes`);
      assert.deepEqual(database.db.prepare('SELECT node_id, item_json FROM technical_plan_historical_content_items ORDER BY node_id').all(), beforeItems, `${label} must roll back items`);
      assert.deepEqual(store.loadTechnicalPlan().outlineData, before.outlineData, `${label} must roll back state`);
    }

    for (const [label, field, value, errorPattern] of [
      ['check content hash', 'checked_content_hash', 'stale-content', /check content hash/i],
      ['check input hash', 'checked_inputs_hash', 'stale-inputs', /check input hash/i],
      ['check protocol hash', 'checked_protocol_inputs_hash', 'stale-protocol', /check protocol inputs hash/i],
      ['check rule version', 'rule_engine_version', 3, /check rule engine version/i],
      ['check fact schema version', 'fact_schema_version', 2, /check fact schema version/i],
      ['check repair protocol version', 'repair_protocol_version', 2, /check repair protocol version/i],
    ]) {
      const current = store.getHistoricalAdaptationContentCheckContext();
      const validCheck = {
        status: 'success', stage: 'semantic', findings: [], checked_content_hash: current.contentHash,
        checked_inputs_hash: current.inputsHash, checked_facts_hash: expectedFactsHash,
        checked_protocol_inputs_hash: hash({ inputsHash: current.inputsHash, rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 }),
        rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1,
      };
      store.updateTechnicalPlan({ historicalAdaptationContentCheck: { ...validCheck, [field]: value } });
      const request = {
        expectedContentHash: current.contentHash, expectedInputsHash: current.inputsHash, expectedFactsHash,
        repairs: [{ ...repairs[0], expected_content_hash: current.contentHash, expected_inputs_hash: current.inputsHash, expected_facts_hash: expectedFactsHash, chapters: repairs[0].chapters.map((chapter) => ({ ...chapter })) }],
      };
      assert.throws(() => store.applyHistoricalAdaptationConsistencyRepairs(request), errorPattern, label);
      assert.deepEqual(database.db.prepare('SELECT node_id, content FROM technical_plan_outline_nodes ORDER BY node_id').all(), beforeRows, `${label} must roll back nodes`);
      assert.deepEqual(database.db.prepare('SELECT node_id, item_json FROM technical_plan_historical_content_items ORDER BY node_id').all(), beforeItems, `${label} must roll back items`);
    }

    const restoredContext = store.getHistoricalAdaptationContentCheckContext();
    store.updateTechnicalPlan({ historicalAdaptationContentCheck: {
      status: 'success', stage: 'semantic', findings: [], checked_content_hash: restoredContext.contentHash,
      checked_inputs_hash: restoredContext.inputsHash, checked_facts_hash: expectedFactsHash,
      checked_protocol_inputs_hash: hash({ inputsHash: restoredContext.inputsHash, rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 }),
      rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1,
    } });
    const manualState = store.loadTechnicalPlan();
    store.updateTechnicalPlan({ historicalAdaptationContentItem: { ...manualState.historicalAdaptationContentItems[0], content_origin: 'manual' } });
    const manualContext = store.getHistoricalAdaptationContentCheckContext();
    assert.throws(() => store.applyHistoricalAdaptationConsistencyRepairs({
      expectedContentHash: manualContext.contentHash, expectedInputsHash: manualContext.inputsHash, expectedFactsHash,
      repairs: [{ ...repairs[0], expected_content_hash: manualContext.contentHash, expected_inputs_hash: manualContext.inputsHash }],
    }), /manual/i);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('atomically applies multi-chapter historical adaptation consistency repairs', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native Store test timed out');
  });
}
