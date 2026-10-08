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

    store.updateTechnicalPlan({ outlineData: { outline: [{ id: 'chapter-1', title: '概况', content: '项目名称：' }] } });
    task.aiService.requestJson = async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [] } : { findings: [] };
    await assert.rejects(runHistoricalAdaptationContentCheckTask(task), /缺少关键名称事实/);
    const failedSnapshot = store.getHistoricalAdaptationContentFacts();
    assert.equal(failedSnapshot.ok, false);
    const saved = store.saveHistoricalAdaptationContentFactOverrides({
      expectedContentHash: failedSnapshot.contentHash,
      expectedInputsHash: failedSnapshot.inputsHash,
      expectedProtocolHash: failedSnapshot.protocolHash,
      overrides: [{ fact_key: 'name:project_name:项目名称', kind: 'name', canonical_value: '人工确认项目', basis: 'manual', note: '人工确认' }],
    });
    assert.equal(saved.ok, true, saved.message);
    assert.equal(store.getHistoricalAdaptationContentFacts().overrides[0].canonical_value, '人工确认项目');
    await runHistoricalAdaptationContentCheckTask(task);
    const repairedSnapshot = store.getHistoricalAdaptationContentFacts();
    assert.equal(repairedSnapshot.ok, true, repairedSnapshot.message);
    assert.equal(repairedSnapshot.facts.find((fact) => fact.fact_key === 'name:project_name:项目名称')?.canonical_value, '人工确认项目');
    assert.equal(store.loadTechnicalPlan().historicalAdaptationContentCheck.status, 'success');

    const { createBidProjectStore } = require('./bidProjectStore.cjs');
    const projectIds = ['cache-project-甲', 'cache-project-乙'];
    const makeStore = (projectId) => createTechnicalPlanStore({
      app, db: database.db, projectId, fileService: {},
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
      configStore: { load: () => ({}) },
    });
    const outline = [
      { id: '1', title: '改写章', content: '甲方测绘' },
      { id: '2', title: '直迁章', content: '乙方制图' },
      { id: '3', title: '确认空章', content: '' },
    ];
    const items = outline.map((node) => ({ node_id: node.id, status: 'success',
      confirmed_at: '2026-10-08T00:00:00.000Z', residuals: [], reuse_original: node.id === '2' }));
    for (const projectId of projectIds) {
      createBidProjectStore({ app, db: database.db }).createProject({ projectId, projectName: projectId });
      makeStore(projectId).updateTechnicalPlan({ outlineData: { outline }, historicalAdaptationContentItems: items });
    }
    const calls = [];
    const runProjectCheck = (projectStore) => runHistoricalAdaptationContentCheckTask({
      workspaceStore: projectStore,
      checkpointTask: (_task, patch) => projectStore.updateTechnicalPlan(patch),
      aiService: { requestJson: async (request) => {
        calls.push(request);
        if (request.response_format.json_schema.name !== 'historical_adaptation_facts') return { findings: [], resolutions: [] };
        const chapters = JSON.parse(request.messages[0].content.split('当前章节正文：')[1]);
        return { candidates: chapters.filter((chapter) => chapter.content).map((chapter) => ({
          kind: 'service', slot: 'method', qualifier: `作业${chapter.node_id}`, node_id: chapter.node_id,
          value: chapter.content, evidence: chapter.content,
        })) };
      } },
    });
    const assertManifest = (projectStore) => {
      const snapshot = projectStore.getHistoricalAdaptationContentFacts();
      assert.equal(snapshot.ok, true, snapshot.message);
      const batches = projectStore.listHistoricalAdaptationContentCheckBatches({ checkRunId: snapshot.checkRunId });
      assert.deepEqual([...new Set(batches.flatMap((batch) => batch.node_ids))].sort(), ['1', '2', '3']);
      assert.ok(batches.every((batch, index) => batch.status === 'success' && batch.batch_index === index
        && batch.content_hash === snapshot.contentHash && batch.input_hash === snapshot.inputsHash
        && batch.protocol_hash === snapshot.protocolHash));
      return snapshot;
    };
    let projectStore = makeStore(projectIds[0]);
    await runProjectCheck(projectStore);
    const firstSnapshot = assertManifest(projectStore);
    assert.equal(calls.length, 2);
    const cacheRows = database.db.prepare('SELECT * FROM historical_adaptation_content_check_cache WHERE project_id = ?').all(projectIds[0]);
    assert.equal(cacheRows.filter((row) => row.phase === 'facts').length, 3, 'confirmed empty chapters also have reliable candidate caches');
    const secondStore = makeStore(projectIds[1]);
    for (const row of cacheRows) assert.equal(secondStore.getHistoricalAdaptationContentCheckCache({ phase: row.phase, cacheKey: row.cache_key }), undefined);

    database.close();
    database = createSqliteDatabase(app);
    projectStore = makeStore(projectIds[0]);
    for (const row of cacheRows) assert.deepEqual(projectStore.getHistoricalAdaptationContentCheckCache({ phase: row.phase, cacheKey: row.cache_key }), JSON.parse(row.result_json));
    // 改变策略指纹，要求建立新审计快照；正文和真实模型输入均不变。
    projectStore.updateTechnicalPlan({ historicalAdaptationContentItems: items.map((item) => ({ ...item, input_fingerprint: 'new-plan' })) });
    calls.length = 0;
    await runProjectCheck(projectStore);
    const reusedSnapshot = assertManifest(projectStore);
    assert.notEqual(reusedSnapshot.inputsHash, firstSnapshot.inputsHash);
    assert.equal(calls.length, 0, 'all-cache run must materialize a complete current manifest without AI calls');
    assert.notEqual(reusedSnapshot.facts.find((fact) => fact.chapter_node_ids.includes('2')).fact_id,
      firstSnapshot.facts.find((fact) => fact.chapter_node_ids.includes('2')).fact_id);

    projectStore.updateTechnicalPlan({ outlineData: { outline: outline.map((node) => node.id === '1' ? { ...node, content: '丙方测绘' } : node) } });
    calls.length = 0;
    await runProjectCheck(projectStore);
    const editedSnapshot = assertManifest(projectStore);
    const extractionCalls = calls.filter((request) => request.response_format.json_schema.name === 'historical_adaptation_facts');
    assert.deepEqual(extractionCalls.flatMap((request) => JSON.parse(request.messages[0].content.split('当前章节正文：')[1]).map((chapter) => chapter.node_id)), ['1']);
    assert.ok(editedSnapshot.facts.some((fact) => fact.canonical_value === '乙方制图'), 'unchanged direct chapter remains in the new snapshot');

    calls.length = 0;
    await runProjectCheck(makeStore(projectIds[1]));
    assert.equal(calls.length, 2, 'another project must check independently even with identical chapters');
    const countCache = (projectId) => database.db.prepare('SELECT COUNT(*) AS count FROM historical_adaptation_content_check_cache WHERE project_id = ?').get(projectId).count;
    projectStore.clearTechnicalPlan();
    assert.equal(countCache(projectIds[0]), 0);
    assert.ok(countCache(projectIds[1]) > 0, 'clearing one project preserves the other project cache');
    assert.equal(createBidProjectStore({ app, db: database.db }).deleteProject(projectIds[1]).success, true);
    assert.equal(countCache(projectIds[1]), 0);
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
