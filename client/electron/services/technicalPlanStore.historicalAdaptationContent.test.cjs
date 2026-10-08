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
    fact_schema_version: 1,
    repair_protocol_version: 1,
  }), 'utf8').digest('hex');
}

function currentCheck(context, factsHash = 'facts-v1') {
  return {
    status: 'success', stage: 'semantic', findings: [],
    checked_content_hash: context.contentHash, checked_inputs_hash: context.inputsHash,
    checked_facts_hash: factsHash, checked_protocol_inputs_hash: protocolInputsHash(context.inputsHash),
    rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1,
    auto_repaired_count: 0, manual_count: 0, repair_round: 0,
  };
}

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-content-store-'));
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
      outlineData: { outline: [{ id: '1', title: '项目概况', content_mode: 'ai-generate' }] },
      historicalAdaptationContentItems: [{
        node_id: '1', source_path: '项目概况', recommended_mode: 'local-rewrite', status: 'success', reason: '地点替换',
        difference_ids: ['location'], source_excerpt: '五峰村原文', blocked_terms: ['五峰村'], residuals: [],
      }],
    });
    const authority = database.db.prepare('SELECT item_json FROM technical_plan_historical_content_items WHERE project_id = ? AND node_id = ?').get('', '1');
    assert.ok(authority, 'content items must be persisted in the chapter table');
    database.db.prepare('UPDATE technical_plan_meta SET historical_adaptation_content_items_json = ? WHERE id = 1').run(JSON.stringify([{ node_id: 'obsolete' }]));
    assert.equal(store.loadTechnicalPlan().historicalAdaptationContentItems[0].node_id, '1');
    store.updateTechnicalPlan({ historicalAdaptationContentItem: { ...store.loadTechnicalPlan().historicalAdaptationContentItems[0], reason: '逐章更新' } });
    assert.equal(store.loadTechnicalPlan().historicalAdaptationContentItems[0].reason, '逐章更新');

    let state = store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '仍写五峰村。' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'review');
    assert.deepEqual(state.historicalAdaptationContentItems[0].residuals, ['五峰村']);
    state = store.confirmHistoricalAdaptationContentItem({ nodeId: '1' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'success');
    assert.ok(state.historicalAdaptationContentItems[0].confirmed_at);

    state = store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'review');
    state = store.confirmHistoricalAdaptationContentItem({ nodeId: '1' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'success');

    state = store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '服务对象为【待补充】。' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'success');
    assert.equal(state.historicalAdaptationContentItems[0].error, undefined);
    state = store.confirmHistoricalAdaptationContentItem({ nodeId: '1' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'success');

    state = store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '服务地点为横泾街道。' });
    assert.equal(state.historicalAdaptationContentItems[0].status, 'success');
    assert.equal(state.historicalAdaptationContentItems[0].content_origin, 'manual');
    assert.equal(state.historicalAdaptationContentCheck.status, 'stale');

    state = store.saveHistoricalAdaptationContentStrategy({ nodeId: '1', mode: 'rewrite', instruction: '突出新项目执行要求' });
    assert.equal(state.historicalAdaptationContentItems[0].manual_mode, 'rewrite');
    assert.equal(state.historicalAdaptationContentItems[0].manual_instruction, '突出新项目执行要求');
    assert.equal(state.historicalAdaptationContentItems[0].status, 'stale');
    for (const mode of ['supplement', 'review']) {
      assert.throws(() => store.saveHistoricalAdaptationContentStrategy({ nodeId: '1', mode }), /有效的正文迁移方式/);
    }

    store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '服务地点为横泾街道。' });
    const context = store.getHistoricalAdaptationContentCheckContext();
    store.updateTechnicalPlan({ historicalAdaptationContentCheck: {
      status: 'success', findings: [], checked_content_hash: context.contentHash,
      checked_inputs_hash: context.inputsHash, checked_facts_hash: 'facts-v1',
      checked_protocol_inputs_hash: protocolInputsHash(context.inputsHash),
      rule_engine_version: 3, fact_schema_version: 1, repair_protocol_version: 1,
    } });
    assert.equal(store.getHistoricalAdaptationContentReadiness().ready, false, 'v3 cache must be stale');
    store.updateTechnicalPlan({
      historicalAdaptationContentCheck: { ...currentCheck(context), checked_at: '2026-10-01T10:00:00.000Z' },
    });
    const readiness = store.getHistoricalAdaptationContentReadiness();
    assert.equal(readiness.ready, true);
    const manualItem = store.loadTechnicalPlan().historicalAdaptationContentItems[0];
    state = store.confirmHistoricalAdaptationContentItem({ nodeId: '1' });
    assert.equal(state.historicalAdaptationContentCheck.status, 'stale', 'chapter confirmation must invalidate the prior check result');
    store.updateTechnicalPlan({ historicalAdaptationContentItem: manualItem, historicalAdaptationContentCheck: currentCheck(context) });
    store.updateTechnicalPlan({ historicalAdaptationContentItem: { ...manualItem, content_origin: 'migrated' } });
    assert.equal(store.getHistoricalAdaptationContentReadiness().ready, false,
      'old automatic success without a current source/plan/output fingerprint cannot pass readiness');
    store.updateTechnicalPlan({ historicalAdaptationContentItem: manualItem });
    state = store.confirmHistoricalAdaptationContent();
    assert.equal(Boolean(state.historicalAdaptationContentConfirmedAt), true);
    assert.equal(state.historicalAdaptationContentItems[0].confirmed_at, undefined);

    store.updateTechnicalPlan({
      historicalAdaptationContentTask: {
        task_id: 'content-running', type: 'historical-adaptation-content', status: 'running', progress: 50, logs: [],
      },
    });
    assert.throws(() => store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '修改' }), /正文任务正在运行/);

    store.updateTechnicalPlan({ historicalAdaptationContentTask: undefined });
    store.updateTechnicalPlan({
      historicalAdaptationContentCheckTask: {
        task_id: 'check-paused', type: 'historical-adaptation-content-check', status: 'paused', progress: 50, logs: [],
      },
    });
    assert.throws(() => store.saveHistoricalAdaptationContentStrategy({ nodeId: '1', mode: 'direct' }), /正文任务|一致性检查/);
    store.updateTechnicalPlan({ historicalAdaptationContentCheckTask: undefined });
    const beforeMissingSource = store.loadTechnicalPlan();
    store.updateTechnicalPlan({
      historicalAdaptationContentItems: beforeMissingSource.historicalAdaptationContentItems.map((item) => ({
        ...item, source_path: '', source_excerpt: '', recommended_mode: null, manual_mode: undefined, manual_instruction: '', status: 'review',
      })),
    });
    for (const mode of ['direct', 'local-rewrite']) {
      assert.throws(() => store.saveHistoricalAdaptationContentStrategy({ nodeId: '1', mode }), /没有可靠历史正文/);
    }
    assert.throws(() => store.saveHistoricalAdaptationContentStrategy({ nodeId: '1', mode: 'rewrite' }), /填写定向改写要求/);
    state = store.saveHistoricalAdaptationContentStrategy({ nodeId: '1', mode: 'rewrite', instruction: '补充横泾响应流程' });
    assert.equal(state.historicalAdaptationContentItems[0].manual_mode, 'rewrite');
    assert.equal(state.historicalAdaptationContentItems[0].manual_instruction, '补充横泾响应流程');
    assert.equal(state.outlineData.outline[0].content, beforeMissingSource.outlineData.outline[0].content);

    // 恢复默认必须重新计算推荐，不能将重点章节批量改为直迁。
    const originalPlanDir = path.join(userDataPath, 'workspace', 'technical-plan');
    fs.mkdirSync(originalPlanDir, { recursive: true });
    fs.writeFileSync(path.join(originalPlanDir, 'original-plan.md'), '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n建立响应机制。\n\n# 人工章节\n原人工章节。', 'utf8');
    database.db.prepare('UPDATE technical_plan_meta SET original_plan_markdown_path = ? WHERE id = 1').run('technical-plan/original-plan.md');
    store.updateTechnicalPlan({
      outlineData: { outline: [
        { id: '1', title: '项目概况', content: '已生成概况。' },
        { id: '2', title: '服务保障', content: '已生成保障。' },
        { id: '3', title: '人工章节', content: '人工修改正文。' },
        { id: '4', title: '新增章节', content: '' },
      ] },
      historicalAdaptationDifferenceConfirmedAt: '2026-10-01T09:00:00.000Z',
      historicalAdaptationOutlineConfirmedAt: '2026-10-01T10:00:00.000Z',
      historicalAdaptationDifferences: [{
        id: 'location', category: '名称地点替换', priority: 'high', title: '地点变更',
        historical_excerpt: '五峰村', tender_requirement: '横泾街道', action: '替换地点', decision: 'confirmed', content_change_scope: 'location-target',
        difference_schema_version: 2, replacements: [{ old_value: '五峰村', new_value: '横泾街道' }], target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', old_content_evidence: [],
      }],
      historicalAdaptationContentItems: ['1', '2', '3', '4'].map((node_id) => ({
        node_id, source_path: node_id === '4' ? '' : '旧来源', source_excerpt: node_id === '4' ? '' : '旧来源正文',
        recommended_mode: 'direct', manual_mode: 'rewrite', manual_instruction: '人工要求',
        status: node_id === '4' ? 'review' : 'success', content_origin: node_id === '3' ? 'manual' : 'ai-rewrite',
        difference_ids: [], blocked_terms: [], residuals: [],
      })),
      historicalAdaptationContentConfirmedAt: '2026-10-01T11:00:00.000Z',
    });
    const beforeReset = store.loadTechnicalPlan();
    state = store.resetHistoricalAdaptationContentStrategies();
    assert.deepEqual(state.historicalAdaptationContentItems.map((item) => item.recommended_mode), ['local-rewrite', 'direct', 'direct', null]);
    assert.ok(state.historicalAdaptationContentItems.every((item) => !item.manual_mode && !item.manual_instruction));
    assert.deepEqual(state.historicalAdaptationContentItems.map((item) => item.status), ['stale', 'stale', 'success', 'review']);
    assert.equal(state.historicalAdaptationContentItems[2].content_origin, 'manual');
    assert.deepEqual(state.outlineData, beforeReset.outlineData);
    assert.equal(state.historicalAdaptationContentCheck.status, 'stale');
    assert.equal(state.historicalAdaptationContentConfirmedAt, undefined);
    assert.deepEqual(store.loadTechnicalPlan().historicalAdaptationContentItems, state.historicalAdaptationContentItems);
    store.prepareHistoricalAdaptationContentPlan();
    const source = store.getHistoricalAdaptationSourceSection({ nodeId: '1' });
    assert.equal(source.available, true);
    assert.equal(source.content, '五峰村原项目概况。');
    assert.equal(store.loadTechnicalPlan().historicalAdaptationContentItems[0].source_excerpt, '');
    const prepared = store.loadTechnicalPlan();
    const preparedContext = store.getHistoricalAdaptationContentCheckContext();
    store.updateTechnicalPlan({ historicalAdaptationContentCheck: currentCheck(preparedContext) });
    const rebuilt = store.prepareHistoricalAdaptationContentPlan();
    const cachedIndex = store.getHistoricalAdaptationSourceIndex(fs.readFileSync(path.join(originalPlanDir, 'original-plan.md'), 'utf8'));
    assert.equal(cachedIndex, store.getHistoricalAdaptationSourceIndex(fs.readFileSync(path.join(originalPlanDir, 'original-plan.md'), 'utf8')),
      'the same source hash must reuse the parsed index');
    assert.equal(rebuilt.historicalAdaptationContentItems[0].plan_id, prepared.historicalAdaptationContentItems[0].plan_id,
      'same inputs must preserve the plan identity');
    assert.equal(rebuilt.historicalAdaptationContentCheck.status, 'success', 'unchanged plan must preserve check cache');
    assert.equal(rebuilt.historicalAdaptationContentCheck.rule_engine_version, 4);
    const sourceItem = rebuilt.historicalAdaptationContentItems[0];
    store.updateTechnicalPlan({ historicalAdaptationContentItem: { ...sourceItem, source_locator: 'display path changed' } });
    assert.equal(store.getHistoricalAdaptationSourceSection({ nodeId: '1' }).content, '五峰村原项目概况。',
      'immutable section ID, not display path, selects the source');
    store.updateTechnicalPlan({ historicalAdaptationContentItem: sourceItem });
    const rolledBackSource = '# 回滚来源\n事务失败后也能重新建立索引。';
    const { sourceHash } = require('./historicalSourceArchive.cjs');
    assert.throws(database.db.transaction(() => {
      store.getHistoricalAdaptationSourceIndex(rolledBackSource);
      throw new Error('模拟方案事务失败');
    }), /模拟方案事务失败/);
    store.getHistoricalAdaptationSourceIndex(rolledBackSource);
    assert.ok(database.db.prepare('SELECT source_hash FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(sourceHash(rolledBackSource)),
      'a rolled-back in-memory index must not skip persisting its source reference');
    const archiveRow = database.db.prepare('SELECT relative_path FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(sourceItem.source_version_hash);
    const archivePath = path.join(userDataPath, 'workspace', archiveRow.relative_path);
    const originalRead = fs.readFileSync;
    const originalArchive = originalRead(archivePath, 'utf8');
    let archiveReads = 0;
    fs.readFileSync = function(file, ...args) {
      if (file === archivePath) archiveReads += 1;
      return originalRead.call(this, file, ...args);
    };
    try {
      for (let index = 0; index < 100; index += 1) assert.equal(store.getHistoricalAdaptationSourceSection({ nodeId: '1' }).available, true);
      assert.ok(archiveReads <= 1, `100 section reads must reuse one verified archive, got ${archiveReads}`);
      fs.writeFileSync(archivePath, '损坏后的来源快照', 'utf8');
      assert.equal(store.getHistoricalAdaptationSourceSection({ nodeId: '1' }).available, false,
        'changed archives must be revalidated, not silently served from memory');
    } finally {
      fs.readFileSync = originalRead;
      fs.writeFileSync(archivePath, originalArchive, 'utf8');
    }
    state = store.loadTechnicalPlan();
    store.updateTechnicalPlan({ historicalAdaptationOutlineChanges: [...state.historicalAdaptationOutlineChanges, {
      id: 'added-4', target_node_id: '4', target_title: '新增章节', change_type: 'added', original_path: '', reason: '新增保障', difference_ids: [], reuse_original: false,
    }] });
    state = store.prepareHistoricalAdaptationContentPlan();
    const added = state.historicalAdaptationContentItems.find((item) => item.node_id === '4');
    store.updateTechnicalPlan({ historicalAdaptationContentItem: { ...added, recommended_instruction: '1. 服务响应\n2. 质量保障' } });
    state = store.prepareHistoricalAdaptationContentPlan();
    assert.equal(state.historicalAdaptationContentItems.find((item) => item.node_id === '4').recommended_instruction, '1. 服务响应\n2. 质量保障');
    store.saveHistoricalAdaptationContentStrategy({ nodeId: '4', mode: 'rewrite', instruction: '校核后仅写质量保障' });
    state = store.prepareHistoricalAdaptationContentPlan();
    assert.equal(state.historicalAdaptationContentItems.find((item) => item.node_id === '4').manual_instruction, '校核后仅写质量保障');
    state = store.resetHistoricalAdaptationContentStrategies();
    const resetAdded = state.historicalAdaptationContentItems.find((item) => item.node_id === '4');
    assert.equal(resetAdded.recommended_mode, 'rewrite');
    assert.equal(resetAdded.recommended_instruction, '1. 服务响应\n2. 质量保障');
    assert.equal(resetAdded.manual_instruction, '');
    assert.equal(resetAdded.status, 'review');
    state = store.saveHistoricalAdaptationContentStrategy({ nodeId: '4', mode: 'rewrite', instruction: '校核后仅写质量保障' });
    store.updateTechnicalPlan({ historicalAdaptationContentTask: { task_id: 'reset-running', type: 'historical-adaptation-content', status: 'running', progress: 0, logs: [] } });
    assert.throws(() => store.resetHistoricalAdaptationContentStrategies(), /正文任务正在运行/);
    store.updateTechnicalPlan({ historicalAdaptationContentTask: undefined });
    database.close();
    database = createSqliteDatabase(app);
    const reopenedStore = createTechnicalPlanStore({
      app, db: database.db, fileService: {}, agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {} }, configStore: { load: () => ({}) },
    });
    const reopenedState = reopenedStore.loadTechnicalPlan();
    assert.deepEqual(reopenedState.historicalAdaptationContentItems, state.historicalAdaptationContentItems);
    assert.deepEqual(reopenedState.outlineData, beforeReset.outlineData);
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('persists, reviews and confirms historical adaptation content', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
