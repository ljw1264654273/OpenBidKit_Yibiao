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
    task.aiService.requestJson = async () => { throw new Error('模拟模型连接失败'); };
    await assert.rejects(runHistoricalAdaptationContentCheckTask(task), /模型连接失败/);
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
    task.aiService.requestJson = async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [] } : { findings: [] };
    await runHistoricalAdaptationContentCheckTask(task);
    const repairedSnapshot = store.getHistoricalAdaptationContentFacts();
    assert.equal(repairedSnapshot.ok, true, repairedSnapshot.message);
    assert.equal(repairedSnapshot.facts.find((fact) => fact.fact_key === 'name:project_name:项目名称')?.canonical_value, '人工确认项目');
    assert.equal(store.loadTechnicalPlan().historicalAdaptationContentCheck.status, 'success');

    // 使用真实迁移与 SQLite 修复事务，覆盖协议哈希、来源指纹和终审放行的完整链路。
    store.clearTechnicalPlan();
    const sourceDir = path.join(userDataPath, 'workspace', 'technical-plan');
    fs.mkdirSync(sourceDir, { recursive: true });
    const construction = '本工程竣工后提高城市功能。';
    const normalText = '合同约定服务五峰村。保留正常的技术措施和质量管理。';
    fs.writeFileSync(path.join(sourceDir, 'original-plan.md'), `# 实施方案\n${construction}${normalText}`, 'utf8');
    fs.writeFileSync(path.join(sourceDir, 'tender.md'), '本项目为地籍调查和测绘服务，合同约定服务五峰村。', 'utf8');
    database.db.prepare('UPDATE technical_plan_meta SET original_plan_markdown_path = ?, tender_markdown_path = ? WHERE id = 1')
      .run('technical-plan/original-plan.md', 'technical-plan/tender.md');
    const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
    const { runHistoricalAdaptationContentTask } = require('./historicalAdaptationContentTask.cjs');
    store.updateTechnicalPlan({
      outlineData: { outline: [{ id: 'semantic-1', title: '实施方案', content: '' }] },
      historicalAdaptationDifferenceConfirmedAt: '2026-10-08T00:00:00.000Z',
      historicalAdaptationOutlineConfirmedAt: '2026-10-08T00:00:00.000Z',
      historicalAdaptationDifferences: [],
      bidAnalysisTasks: Object.fromEntries(getBidAnalysisTasks('full').map(({ id, label }) =>
        [id, { id, label, status: 'success', content: '本项目为地籍调查和测绘服务。' }])),
    });
    store.prepareHistoricalAdaptationContentPlan();
    const checkpointTask = (_task, patch) => store.updateTechnicalPlan(patch);
    await runHistoricalAdaptationContentTask({ workspaceStore: store, checkpointTask, updateTask() {},
      aiService: { requestJson: async () => { throw new Error('直接迁移不应调用模型'); } } });
    assert.equal(store.loadTechnicalPlan().outlineData.outline[0].content, construction + normalText);
    let repairRequests = 0;
    await runHistoricalAdaptationContentCheckTask({ workspaceStore: store, checkpointTask,
      aiService: { requestJson: async (request) => {
        const name = request.response_format.json_schema.name;
        if (name === 'historical_adaptation_facts') return { candidates: [] };
        if (name === 'historical_adaptation_content_check') return { findings:
          store.loadTechnicalPlan().outlineData.outline[0].content.includes(construction) ? [{
            code: 'construction', category: 'service-content', severity: 'P0', blocking: true,
            node_ids: ['semantic-1'], message: '施工项目承诺与测绘服务矛盾',
            evidence: `${construction}；招标原文要求地籍调查和测绘服务。`,
          }] : [], resolutions: [] };
        repairRequests++;
        const prompt = request.messages[0].content;
        const facts = JSON.parse(prompt.split('统一事实表：')[1].split('\n语义问题：')[0]);
        const [chapter] = JSON.parse(prompt.split('当前章节：')[1].split('\nexpected_content_hash=')[0]);
        const context = store.getHistoricalAdaptationContentCheckContext();
        return { repair_groups: [{ group_id: 'semantic-repair', fact_id: facts[0].fact_id,
          confidence: 'high', rationale: '依据招标原文修正施工残留',
          expected_content_hash: context.contentHash, expected_inputs_hash: context.inputsHash,
          expected_facts_hash: prompt.split('expected_facts_hash=')[1],
          chapters: [{ node_id: chapter.node_id, expected_node_content_hash: chapter.expected_node_content_hash,
            expected_item_fingerprint: chapter.item_fingerprint, old_text: construction,
            new_text: '本项目完成地籍调查和测绘服务。', evidence: ['招标原文：地籍调查和测绘服务。'] }] }] };
      } } });
    const semanticState = store.loadTechnicalPlan();
    assert.equal(repairRequests, 1);
    assert.equal(semanticState.outlineData.outline[0].content, '本项目完成地籍调查和测绘服务。' + normalText);
    assert.equal(semanticState.historicalAdaptationContentItems[0].content_origin, 'ai-repair');
    assert.equal(semanticState.historicalAdaptationContentCheck.status, 'success');
    assert.equal(semanticState.historicalAdaptationContentCheck.auto_repaired_count, 1);
    assert.equal(store.getHistoricalAdaptationContentFacts().ok, true);
    assert.equal(store.getHistoricalAdaptationContentReadiness().ready, true, JSON.stringify(store.getHistoricalAdaptationContentReadiness()));
    store.confirmHistoricalAdaptationContent();
    assert.equal(store.runHistoricalAdaptationReview().historicalAdaptationReviewFindings.some((finding) => finding.severity === 'P0'), false);

    // 模型结合招标文件放行旧地名；验收和终审不能再按字面残留阻断。
    store.updateTechnicalPlan({
      historicalAdaptationContentItems: [{ ...semanticState.historicalAdaptationContentItems[0],
        status: 'review', residuals: ['五峰村'], blocked_terms: ['五峰村'] }],
    });
    await runHistoricalAdaptationContentCheckTask({ workspaceStore: store, checkpointTask,
      aiService: { requestJson: async (request) => request.response_format.json_schema.name === 'historical_adaptation_facts'
        ? { candidates: [] } : { findings: [], resolutions: [] } } });
    assert.equal(store.getHistoricalAdaptationContentReadiness().ready, true, JSON.stringify(store.getHistoricalAdaptationContentReadiness()));
    store.confirmHistoricalAdaptationContent();
    assert.equal(store.runHistoricalAdaptationReview().historicalAdaptationReviewFindings.some((finding) => finding.severity === 'P0'), false);
    store.saveHistoricalAdaptationChapterContent({ nodeId: 'semantic-1', content: '服务范围变更。' });
    assert.equal(store.getHistoricalAdaptationContentReadiness().ready, false);
    assert.throws(() => store.runHistoricalAdaptationReview(), /正文迁移|一致性检查/);

    // 整段迁移的新版本必须进入真实语义检查；失败底稿不能阻断其他章节检查。
    for (const failRewrite of [false, true]) {
      store.clearTechnicalPlan();
      const oldParagraph = '五峰村行政归属为木渎镇，人口1000人，调查965宗。采用现场核查和质量复核。';
      fs.writeFileSync(path.join(sourceDir, 'original-plan.md'), `# 项目概况\n${oldParagraph}\n\n# 服务保障\n保留质量保障措施。`, 'utf8');
      fs.writeFileSync(path.join(sourceDir, 'tender.md'), '横泾街道调查3082宗，采用现场核查和质量复核。', 'utf8');
      database.db.prepare('UPDATE technical_plan_meta SET original_plan_markdown_path = ?, tender_markdown_path = ? WHERE id = 1')
        .run('technical-plan/original-plan.md', 'technical-plan/tender.md');
      store.updateTechnicalPlan({
        outlineData: { outline: [{ id: 'paragraph-1', title: '项目概况', content: '' }, { id: 'paragraph-2', title: '服务保障', content: '' }] },
        historicalAdaptationContentItems: [],
        historicalAdaptationDifferenceConfirmedAt: '2026-10-09T00:00:00.000Z',
        historicalAdaptationOutlineConfirmedAt: '2026-10-09T00:00:00.000Z',
        historicalAdaptationOutlineChanges: [{ id: 'paragraph-location', change_type: 'renamed',
          original_path: '项目概况', target_node_id: 'paragraph-1', target_title: '项目概况', difference_ids: ['location'] },
          { id: 'paragraph-retained', change_type: 'retained', original_path: '服务保障', target_node_id: 'paragraph-2', target_title: '服务保障', difference_ids: [] }],
        historicalAdaptationDifferences: [{ id: 'location', difference_schema_version: 2, decision: 'confirmed',
          category: '名称地点替换', priority: 'high', title: '地点变更', content_change_scope: 'location-target',
          old_content_evidence: ['五峰村'], target_action: 'replace', auto_apply_policy: 'must-replace',
          evidence_kind: 'exact-value', confidence: 'high', historical_location: '项目概况', historical_excerpt: '五峰村',
          replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
          action: '删除旧行政和人口，按招标文件重写完整段落', tender_requirement: '横泾街道调查3082宗。' }],
        bidAnalysisTasks: Object.fromEntries(getBidAnalysisTasks('full').map(({ id, label }) =>
          [id, { id, label, status: 'success', content: '横泾街道调查3082宗，采用现场核查和质量复核。' }])),
      });
      store.prepareHistoricalAdaptationContentPlan();
      const result = await runHistoricalAdaptationContentTask({ workspaceStore: store, checkpointTask, updateTask() {},
        aiService: { requestJson: async () => {
          if (failRewrite) throw new Error('模拟段落改写失败');
          return { content: '横泾街道调查3082宗。采用现场核查和质量复核。' };
        } } });
      assert.equal(result.needsConsistencyCheck, true, JSON.stringify(store.loadTechnicalPlan().historicalAdaptationContentItems));
      const migrated = store.loadTechnicalPlan();
      const firstItem = migrated.historicalAdaptationContentItems.find((item) => item.node_id === 'paragraph-1');
      assert.equal(firstItem.rule_engine_version, 3);
      assert.equal(firstItem.status, failRewrite ? 'review' : 'success');
      const checkRequests = [];
      await runHistoricalAdaptationContentCheckTask({ workspaceStore: store, checkpointTask,
        aiService: { requestJson: async (request) => {
          checkRequests.push(request);
          return request.response_format.json_schema.name === 'historical_adaptation_facts'
            ? { candidates: [] } : { findings: [], resolutions: [] };
        } } });
      const checked = store.loadTechnicalPlan();
      assert.equal(checked.historicalAdaptationContentCheck.stage, 'semantic');
      assert.equal(checked.historicalAdaptationContentCheck.findings.some((finding) => finding.code === 'plan-stale'), false);
      const semanticRequests = checkRequests.filter((request) => request.response_format.json_schema.name === 'historical_adaptation_content_check');
      assert.ok(semanticRequests.length);
      const prompts = semanticRequests.map((request) => request.messages[0].content).join('\n');
      assert.match(prompts, /paragraph-1/);
      assert.match(prompts, /paragraph-2/);
      if (failRewrite) {
        assert.equal(checked.outlineData.outline[0].content, oldParagraph);
        assert.match(checked.historicalAdaptationContentItems.find((item) => item.node_id === 'paragraph-1').error, /模拟段落改写失败/);
        assert.ok(checked.historicalAdaptationContentCheck.findings.some((finding) => finding.code === 'migration-needs-review' && finding.blocking));
        assert.equal(checked.historicalAdaptationContentCheck.manual_count, 1);
        assert.equal(store.getHistoricalAdaptationContentReadiness().ready, false);
      } else assert.equal(store.getHistoricalAdaptationContentReadiness().ready, true);
    }

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
