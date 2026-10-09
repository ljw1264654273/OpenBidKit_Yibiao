const assert = require('node:assert/strict');
const test = require('node:test');
const { runHistoricalAdaptationContentCheckTask, buildFactsPrompt } = require('./historicalAdaptationContentCheckTask.cjs');

function fixture(contents = ['甲方测绘', '乙方制图']) {
  const context = {
    contentHash: 'first', inputsHash: 'first-input',
    outlineData: { outline: contents.map((content, index) => ({ id: String(index + 1), title: `章节${index + 1}`, content })) },
    items: contents.map((_, index) => ({ node_id: String(index + 1), status: 'success', confirmed_at: 'confirmed', reuse_original: index === 1 })),
  };
  const cache = new Map();
  const checkpoints = [];
  const requests = [];
  const batches = [];
  const store = {
    getHistoricalAdaptationContentCheckContext: () => context,
    getHistoricalAdaptationContentCheckCache: ({ phase, cacheKey }) => cache.get(`${phase}:${cacheKey}`),
    saveHistoricalAdaptationContentCheckCache: ({ phase, cacheKey, result }) => cache.set(`${phase}:${cacheKey}`, structuredClone(result)),
    createHistoricalAdaptationContentCheckBatches: ({ batches: descriptors }) => batches.push(...descriptors),
    saveHistoricalAdaptationContentCheckBatchResult: (batch) => batches.push({ ...batches.findLast((item) => item.batchId === batch.batchId && !item.result), ...batch }),
  };
  const task = {
    workspaceStore: store,
    checkpointTask: (task, patch) => checkpoints.push({ task, patch }),
    aiService: { requestJson: async (request) => {
      requests.push(request);
      if (request.response_format.json_schema.name !== 'historical_adaptation_facts') return { findings: [], resolutions: [] };
      const chapters = JSON.parse(request.messages[0].content.split('当前章节正文：')[1]);
      return { candidates: chapters.filter((chapter) => chapter.content).map((chapter) => ({
        kind: 'service', slot: 'method', qualifier: `作业${chapter.node_id}`, value: chapter.content,
        evidence: chapter.content, node_id: chapter.node_id,
      })) };
    } },
  };
  return { context, cache, checkpoints, requests, batches, task };
}

const factRequests = (requests) => requests.filter((request) => request.response_format.json_schema.name === 'historical_adaptation_facts');

test('事实示例和约束要求候选包含输入章节 ID', () => {
  const prompt = buildFactsPrompt({}, [{ node_id: '1', content: '正文' }]);
  assert.match(prompt.split('本批相关')[0], /"node_id"/);
  assert.match(prompt, /每条.*node_id/);
});

test('单章编辑只提取变更章，直迁章候选仍进入完整当前批次', async () => {
  const f = fixture();
  await runHistoricalAdaptationContentCheckTask(f.task);
  const initialCalls = f.requests.length;
  f.requests.length = 0;
  f.context.contentHash = 'second';
  f.context.inputsHash = 'second-input';
  f.context.outlineData.outline[0].content = '丙方测绘';
  await runHistoricalAdaptationContentCheckTask(f.task);
  const requested = factRequests(f.requests).flatMap((request) => JSON.parse(request.messages[0].content.split('当前章节正文：')[1]));
  assert.deepEqual(requested.map((chapter) => chapter.node_id), ['1']);
  const current = f.batches.filter((batch) => batch.contentHash === 'second' && batch.result);
  assert.deepEqual([...new Set(current.flatMap((batch) => batch.result.facts.flatMap((fact) => fact.chapter_node_ids)))].sort(), ['1', '2']);
  assert.ok(current.flatMap((batch) => batch.result.facts).some((fact) => fact.canonical_value === '乙方制图'));
  const oldId = f.batches.find((batch) => batch.contentHash === 'first' && batch.result).result.facts.find((fact) => fact.chapter_node_ids.includes('2')).fact_id;
  const newId = current.flatMap((batch) => batch.result.facts).find((fact) => fact.chapter_node_ids.includes('2')).fact_id;
  assert.notEqual(oldId, newId, 'reused candidates regenerate IDs from current inputs');
  assert.equal(initialCalls, 2);
  assert.match(f.checkpoints.map(({ task }) => task.logs?.join(' ')).join(' '), /复用.*1.*章/);
});

test('全部候选缓存命中仍物化完整新快照，相同语义输入无需模型请求', async () => {
  const f = fixture();
  await runHistoricalAdaptationContentCheckTask(f.task);
  f.requests.length = 0;
  f.context.inputsHash = 'new-plan-input';
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.requests.length, 0);
  assert.ok(f.batches.some((batch) => batch.inputHash === 'new-plan-input' && batch.result?.facts.length === 2));
});

for (const field of ['baseline', 'globalFacts', 'differences']) {
  test(`${field} 变化使候选缓存失效`, async () => {
    const f = fixture();
    await runHistoricalAdaptationContentCheckTask(f.task);
    f.requests.length = 0;
    f.context[field] = [{ title: '当前输入', content: '已变化' }];
    f.context.inputsHash = 'changed';
    await runHistoricalAdaptationContentCheckTask(f.task);
    const ids = factRequests(f.requests).flatMap((request) => JSON.parse(request.messages[0].content.split('当前章节正文：')[1]).map((chapter) => chapter.node_id));
    assert.deepEqual(ids, ['1', '2']);
  });
}

test('人工覆盖不污染原始候选，删除覆盖后恢复原文事实', async () => {
  const f = fixture();
  await runHistoricalAdaptationContentCheckTask(f.task);
  f.context.factOverrides = [{ fact_key: 'service:method:作业1', kind: 'service', canonical_value: '人工作业' }];
  f.context.inputsHash = 'manual';
  f.requests.length = 0;
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(factRequests(f.requests).length, 0);
  f.context.factOverrides = [];
  f.context.inputsHash = 'deleted';
  await runHistoricalAdaptationContentCheckTask(f.task);
  const last = f.batches.filter((batch) => batch.inputHash === 'deleted' && batch.result).at(-1);
  assert.equal(last.result.facts.find((fact) => fact.fact_key === 'service:method:作业1').canonical_value, '甲方测绘');
});

test('确认空章与非空章共同覆盖当前事实快照', async () => {
  const f = fixture(['正文', '']);
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.deepEqual([...new Set(f.batches.filter((batch) => batch.result).flatMap((batch) => batch.nodeIds || []))].sort(), ['1', '2']);
});

test('请求等待前显示批次，兼容逐章补提有即时日志', async () => {
  const f = fixture();
  let calls = 0;
  f.task.aiService.requestJson = async (request) => {
    assert.match(f.checkpoints.at(-1).task.logs.join(' '), /第.*批|补提/);
    if (request.response_format.json_schema.name !== 'historical_adaptation_facts') return { findings: [], resolutions: [] };
    const chapters = JSON.parse(request.messages[0].content.split('当前章节正文：')[1]);
    calls++;
    return { candidates: chapters.map((chapter) => ({ kind: 'service', slot: 'method', qualifier: chapter.node_id, value: chapter.content, evidence: chapter.content })) };
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(calls, 3);
  assert.match(f.checkpoints.map(({ task }) => task.logs.join(' ')).join(' '), /补提.*1\/2/);
  assert.ok(f.checkpoints.every((entry, index) => !index || entry.task.progress >= f.checkpoints[index - 1].task.progress));
});

test('移动章节路径只使该章候选失效', async () => {
  const f = fixture();
  await runHistoricalAdaptationContentCheckTask(f.task);
  f.requests.length = 0;
  f.context.outlineData.outline[0].title = '新路径';
  f.context.inputsHash = 'moved';
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.deepEqual(factRequests(f.requests).flatMap((request) => JSON.parse(request.messages[0].content.split('当前章节正文：')[1]).map((chapter) => chapter.node_id)), ['1']);
});

test('删除章节后不把旧缓存候选带入当前事实表', async () => {
  const f = fixture();
  await runHistoricalAdaptationContentCheckTask(f.task);
  f.context.outlineData.outline.pop();
  f.context.items.pop();
  f.context.contentHash = 'deleted-node';
  f.context.inputsHash = 'deleted-node-input';
  f.requests.length = 0;
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(factRequests(f.requests).length, 0);
  const facts = f.batches.filter((batch) => batch.inputHash === 'deleted-node-input' && batch.result).flatMap((batch) => batch.result.facts);
  assert.deepEqual([...new Set(facts.flatMap((fact) => fact.chapter_node_ids))], ['1']);
  assert.ok(facts.every((fact) => fact.canonical_value !== '乙方制图'));
});

test('改写章与直迁章文字差异不阻断，复用候选保留逐章原值和证据', async () => {
  const f = fixture();
  const original = f.task.aiService.requestJson;
  f.task.aiService.requestJson = async (request) => {
    const response = await original(request);
    for (const candidate of response.candidates || []) candidate.qualifier = '共同作业';
    return response;
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.checkpoints.at(-1).task.status, 'success');
  f.requests.length = 0;
  f.context.inputsHash = 'rerun';
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(factRequests(f.requests).length, 0);
  assert.equal(f.checkpoints.at(-1).patch.historicalAdaptationContentCheck.findings.length, 0);
  const conflict = f.batches.filter((batch) => batch.inputHash === 'rerun' && batch.result).flatMap((batch) => batch.result.facts).find((fact) => fact.conflict);
  assert.deepEqual(conflict.chapter_node_ids.sort(), ['1', '2']);
  assert.match(conflict.evidence.join('；'), /甲方测绘/);
  assert.match(conflict.evidence.join('；'), /乙方制图/);
  const raw = [...f.cache.entries()].filter(([key]) => key.startsWith('facts:')).flatMap(([, value]) => value.candidates);
  assert.deepEqual(raw.map((candidate) => candidate.value), ['甲方测绘', '乙方制图']);
});

test('相同语义阻断响应可复用，复用仍不能变为检查通过', async () => {
  const f = fixture();
  const original = f.task.aiService.requestJson;
  f.task.aiService.requestJson = async (request) => request.response_format.json_schema.name === 'historical_adaptation_facts' ? original(request) : {
    findings: [{ code: 'scope', category: 'service-content', severity: 'P0', blocking: true, node_ids: ['2'], message: '服务内容不符', evidence: '直迁章与基线不符' }], resolutions: [],
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  f.requests.length = 0;
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.requests.length, 0);
  assert.equal(f.checkpoints.at(-1).task.status, 'error');
  assert.ok(f.checkpoints.at(-1).patch.historicalAdaptationContentCheck.findings.some((finding) => finding.blocking));
});

test('未知章节归属候选不进入章节缓存，下次仍需提取', async () => {
  const f = fixture();
  const original = f.task.aiService.requestJson;
  f.task.aiService.requestJson = async (request) => {
    const response = await original(request);
    if (response.candidates) response.candidates[0].node_id = 'unknown';
    return response;
  };
  await assert.rejects(runHistoricalAdaptationContentCheckTask(f.task), /章节归属/);
  assert.equal([...f.cache.keys()].filter((key) => key.startsWith('facts:')).length, 0);
  f.requests.length = 0;
  await assert.rejects(runHistoricalAdaptationContentCheckTask(f.task), /章节归属/);
  assert.equal(factRequests(f.requests).length, 1);
  assert.equal(f.checkpoints.at(-1).task.status, 'error');
});

test('跨章节归属不明确的候选兼容检查但不进入章节缓存', async () => {
  const f = fixture();
  const original = f.task.aiService.requestJson;
  f.task.aiService.requestJson = async (request) => {
    const response = await original(request);
    for (const candidate of response.candidates || []) {
      delete candidate.node_id;
      candidate.chapter_node_ids = ['1', '2'];
    }
    return response;
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal([...f.cache.keys()].filter((key) => key.startsWith('facts:')).length, 0);
});

test('无依据的单值裁决不改事实，也不生成伪内容阻断', async () => {
  const f = fixture();
  const original = f.task.aiService.requestJson;
  f.task.aiService.requestJson = async (request) => request.response_format.json_schema.name === 'historical_adaptation_facts'
    ? original(request) : { findings: [], resolutions: [{ fact_key: 'service:method:作业1', canonical_value: '无依据的新值', basis: 'manual-fact-exact-match' }] };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.ok([...f.cache.keys()].some((key) => key.startsWith('semantic:')));
  f.requests.length = 0;
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.requests.length, 0);
  assert.equal(f.checkpoints.at(-1).task.status, 'success');
  assert.deepEqual(f.checkpoints.at(-1).patch.historicalAdaptationContentCheck.findings, []);
  assert.equal(f.batches.filter((batch) => batch.result).at(-1).result.facts[0].canonical_value, '甲方测绘');
});

test('单章修复后只提取修复章，完整检查进度不回退', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  const f = fixture(['工法：旧方法。', '乙方制图']);
  delete f.context.items[0].confirmed_at;
  f.context.items[0].item_fingerprint = 'chapter-fingerprint';
  let repaired = false;
  const original = f.task.aiService.requestJson;
  f.task.workspaceStore.applyHistoricalAdaptationConsistencyRepairs = () => {
    repaired = true;
    f.context.outlineData.outline[0].content = '工法：新方法。';
    f.context.contentHash = 'repaired';
    f.context.inputsHash = 'repaired-input';
  };
  f.task.aiService.requestJson = async (request) => {
    if (request.response_format.json_schema.name === 'historical_adaptation_repair') {
      const prompt = request.messages[0].content;
      const facts = JSON.parse(prompt.split('统一事实表：')[1].split('\n语义问题：')[0]);
      return { repair_groups: [{ group_id: 'method-fix', fact_id: facts.find((fact) => fact.chapter_node_ids.includes('1')).fact_id,
        confidence: 'high', rationale: '按已确认工法修复', expected_content_hash: f.context.contentHash, expected_inputs_hash: f.context.inputsHash,
        expected_facts_hash: prompt.split('expected_facts_hash=')[1], chapters: [{ node_id: '1', expected_node_content_hash: repair.hashContent(f.context.outlineData.outline[0].content), expected_item_fingerprint: 'chapter-fingerprint', old_text: '旧方法', new_text: '新方法', evidence: ['新方法'] }] }] };
    }
    const response = await original(request);
    if (response.candidates) {
      for (const candidate of response.candidates) if (candidate.node_id === '1') { candidate.value = '新方法'; candidate.evidence = '已确认工法为新方法'; }
    } else if (!repaired) response.findings.push({ code: 'method', category: 'service-content', severity: 'P0', blocking: true, node_ids: ['1'], message: '工法不符', evidence: '新方法' });
    return response;
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  const extracted = factRequests(f.requests).map((request) => JSON.parse(request.messages[0].content.split('当前章节正文：')[1]).map((chapter) => chapter.node_id));
  assert.deepEqual(extracted, [['1', '2'], ['1']]);
  assert.equal(f.checkpoints.at(-1).task.status, 'success');
  assert.ok(f.checkpoints.every((entry, index) => !index || entry.task.progress >= f.checkpoints[index - 1].task.progress));
});

test('长章任一分片失败不留下已完成章节缓存', async () => {
  const f = fixture(['甲'.repeat(90)]);
  f.context.contextLengthLimit = 100;
  let calls = 0;
  const original = f.task.aiService.requestJson;
  f.task.aiService.requestJson = async (request) => {
    if (++calls === 2) throw new Error('中断');
    return original(request);
  };
  await assert.rejects(runHistoricalAdaptationContentCheckTask(f.task), /中断/);
  assert.equal([...f.cache.keys()].filter((key) => key.startsWith('facts:')).length, 0);
});
