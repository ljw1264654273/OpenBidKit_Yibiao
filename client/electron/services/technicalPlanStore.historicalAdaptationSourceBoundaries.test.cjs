const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function withStore(outline, originalPlan, assertions) {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-source-boundaries-'));
  const app = { getPath: () => directory, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const createStore = () => createTechnicalPlanStore({ app, db: database.db, fileService: {},
      agentService: { deletePersistentTask() {} }, taskLogStore: { list: () => [], sync() {} }, configStore: { load: () => ({}) } });
    const store = createStore();
    const originalPath = path.join(directory, 'workspace', 'technical-plan', 'original-plan.md');
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.writeFileSync(originalPath, originalPlan, 'utf8');
    database.db.prepare('UPDATE technical_plan_meta SET original_plan_markdown_path = ? WHERE id = 1').run('technical-plan/original-plan.md');
    store.updateTechnicalPlan({ outlineData: { outline },
      historicalAdaptationDifferenceConfirmedAt: '2026-10-01T08:00:00.000Z',
      historicalAdaptationOutlineConfirmedAt: '2026-10-01T09:00:00.000Z',
      bidAnalysisTasks: Object.fromEntries(getBidAnalysisTasks('full').map((item) => [item.id, { status: 'success', content: `${item.label}内容` }])),
      historicalAdaptationDifferences: [] });
    assertions({ store, createStore, db: database.db, directory, originalPath });
  } finally {
    database?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function saveCurrentCheck(store) {
  const context = store.getHistoricalAdaptationContentCheckContext();
  store.updateTechnicalPlan({ historicalAdaptationContentCheck: { status: 'success', findings: [],
    checked_content_hash: context.contentHash, checked_inputs_hash: context.inputsHash, rule_engine_version: 3 } });
}

function runAssertions() {
  const sourceIndexModule = require('./historicalSourceIndex.cjs');
  const originalBuilder = sourceIndexModule.buildHistoricalSourceIndex;
  let parses = 0;
  sourceIndexModule.buildHistoricalSourceIndex = (...args) => { parses += 1; return originalBuilder(...args); };
  try {
    const outline = Array.from({ length: 100 }, (_, index) => ({ id: String(index + 1), title: `章节${index + 1}` }));
    const originalPlan = outline.map((node) => `# ${node.title}\n${'正文'.repeat(600)}`).join('\n');
    assert.ok(originalPlan.length >= 120000);
    withStore(outline, originalPlan, ({ store }) => {
      store.prepareHistoricalAdaptationContentPlan();
      assert.equal(parses, 1, 'a cold 100-chapter plan must parse the full source exactly once');
      store.getHistoricalAdaptationContentCheckContext();
      assert.equal(parses, 1, 'check context must reuse the source index');
    });
  } finally {
    sourceIndexModule.buildHistoricalSourceIndex = originalBuilder;
  }

  for (const damage of ['corrupt-file', 'missing-file', 'missing-reference', 'corrupt-index', 'invalid-index-structure']) {
    withStore([{ id: '1', title: '章节' }], '# 章节\n真实历史来源。', ({ store, createStore, db, directory }) => {
      const item = store.prepareHistoricalAdaptationContentPlan().historicalAdaptationContentItems[0];
      store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '已人工核实的正文。' });
      saveCurrentCheck(store);
      assert.equal(store.getHistoricalAdaptationContentReadiness().ready, true);
      const reference = db.prepare('SELECT relative_path FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(item.source_version_hash);
      const archivePath = path.join(directory, 'workspace', reference.relative_path);
      if (damage === 'corrupt-file') fs.writeFileSync(archivePath, '损坏的来源档案', 'utf8');
      if (damage === 'missing-file') fs.unlinkSync(archivePath);
      if (damage === 'missing-reference') db.prepare('DELETE FROM technical_plan_historical_source_versions WHERE source_hash = ?').run(item.source_version_hash);
      if (damage === 'corrupt-index') db.prepare('UPDATE technical_plan_historical_source_versions SET index_json = ? WHERE source_hash = ?').run('{broken', item.source_version_hash);
      if (damage === 'invalid-index-structure') db.prepare('UPDATE technical_plan_historical_source_versions SET index_json = ? WHERE source_hash = ?').run('{"version":2,"sections":{}}', item.source_version_hash);
      assert.equal(store.getHistoricalAdaptationContentReadiness().ready, false, damage);
      const context = store.getHistoricalAdaptationContentCheckContext();
      assert.equal(context.sourceAvailability.find((source) => source.node_id === '1').available, false, damage);
      const readiness = store.getHistoricalAdaptationContentReadiness();
      assert.equal(readiness.ready, false, damage);
      assert.ok(readiness.findings.some((finding) => finding.code === 'source-stale' && finding.node_ids[0] === '1'), damage);
      const coldStore = createStore();
      assert.equal(coldStore.getHistoricalAdaptationContentReadiness().ready, false, `cold: ${damage}`);
      assert.equal(coldStore.getHistoricalAdaptationContentCheckContext().sourceAvailability[0].available, false, `cold: ${damage}`);
      if (damage === 'corrupt-file') assert.equal(fs.readFileSync(archivePath, 'utf8'), '损坏的来源档案', 'read-only checks must not repair archives');
      if (damage === 'missing-file') assert.equal(fs.existsSync(archivePath), false, 'read-only checks must not recreate archives');
      if (damage === 'missing-reference') assert.equal(db.prepare('SELECT source_hash FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(item.source_version_hash), undefined);
      if (damage === 'corrupt-index') assert.equal(db.prepare('SELECT index_json FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(item.source_version_hash).index_json, '{broken');
    });
  }

  withStore([{ id: '1', title: '新增章节' }], '# 旧章节\n历史正文。', ({ store }) => {
    store.updateTechnicalPlan({ historicalAdaptationOutlineChanges: [{ id: 'added', change_type: 'added', target_node_id: '1', target_title: '新增章节', reason: '人工补写', difference_ids: [] }] });
    store.prepareHistoricalAdaptationContentPlan();
    store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '人工补写并核实的正文。' });
    saveCurrentCheck(store);
    assert.equal(store.getHistoricalAdaptationContentReadiness().ready, true, 'manual content without any historical source remains allowed');
  });

  withStore([{ id: '1', title: '章节' }], '# 旧来源\n实际迁移使用的历史正文。', ({ store, originalPath }) => {
    store.updateTechnicalPlan({ historicalAdaptationOutlineChanges: [{ id: 'renamed', change_type: 'renamed', target_node_id: '1', target_title: '章节', original_path: '旧来源', reason: '调整目录名称', difference_ids: [] }] });
    const previous = store.prepareHistoricalAdaptationContentPlan().historicalAdaptationContentItems[0];
    assert.equal(store.getHistoricalAdaptationSourceSection({ nodeId: '1' }).content, '实际迁移使用的历史正文。');
    store.saveHistoricalAdaptationChapterContent({ nodeId: '1', content: '基于旧来源人工修改的正文。' });
    fs.writeFileSync(originalPath, '# 新来源\n新导入的历史正文。', 'utf8');
    store.updateTechnicalPlan({ historicalAdaptationOutlineChanges: [{ id: 'renamed', change_type: 'renamed', target_node_id: '1', target_title: '章节', original_path: '新来源', reason: '调整历史来源', difference_ids: [] }] });
    for (const state of [store.prepareHistoricalAdaptationContentPlan(), store.resetHistoricalAdaptationContentStrategies()]) {
      const item = state.historicalAdaptationContentItems[0];
      for (const key of ['source_path', 'source_locator', 'source_hash', 'source_version_hash', 'source_content_hash', 'source_section_id']) assert.equal(item[key], previous[key], key);
      assert.equal(item.content_origin, 'manual');
      const source = store.getHistoricalAdaptationSourceSection({ nodeId: '1' });
      assert.equal(source.available, true, source.error);
      assert.equal(source.content, '实际迁移使用的历史正文。');
      assert.equal(state.outlineData.outline[0].content, '基于旧来源人工修改的正文。');
    }
  });
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('historical source readiness, immutable manual provenance and cold-plan parsing', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native source test timed out');
  });
}
