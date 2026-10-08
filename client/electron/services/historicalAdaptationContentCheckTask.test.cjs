const assert = require('node:assert/strict');
const test = require('node:test');

test('确定性 blocker 阻断语义检查且重新扫描当前正文旧值', async () => {
  const { runHistoricalAdaptationContentCheckTask } = require('./historicalAdaptationContentCheckTask.cjs');
  let calls = 0;
  const patches = [];
  await runHistoricalAdaptationContentCheckTask({ aiService: { requestJson: async () => { calls++; return { findings: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'content', inputsHash: 'input',
      outlineData: { outline: [{ id: '1', title: '章节', content: '五峰村。' }] },
      items: [{ node_id: '1', status: 'success', residuals: [], blocked_terms: ['五峰村'] }] }) },
    checkpointTask: (_task, patch) => patches.push(patch) });
  assert.equal(calls, 0);
  assert.ok(patches.at(-1).historicalAdaptationContentCheck.findings.some((finding) => finding.category === 'residual'));
});

test('来源失效或空正文等结构性阻断不调用任何 AI 阶段', async () => {
  let calls = 0;
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => { calls += 1; return { facts: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content', inputsHash: 'inputs',
      outlineData: { outline: [{ id: '1', title: '来源', content: '正文' }, { id: '2', title: '空章', content: '' }] },
      items: [{ node_id: '1', status: 'success', source_section_id: 'source', source_content_hash: 'hash' }, { node_id: '2', status: 'success' }],
      sourceAvailability: [{ node_id: '1', available: false, error: '来源损坏' }],
    }) }, checkpointTask: (...args) => checkpoints.push(args),
  });
  assert.equal(calls, 0);
  assert.ok(checkpoints.at(-1)[1].historicalAdaptationContentCheck.findings.some((item) => item.code === 'source-stale'));
  assert.ok(checkpoints.at(-1)[1].historicalAdaptationContentCheck.findings.some((item) => item.code === 'empty-content'));
});

const {
  buildSemanticCheckPrompt,
  buildSemanticBatches,
  buildFactsPrompt,
  getBatchBudgetChars,
  normalizeCandidateFactsResponse,
  validateFactResolutions,
  collectDeterministicFindings,
  extractDeterministicAmountFacts,
  extractDeterministicNameFacts,
  normalizeHistoricalAdaptationContentFindings,
  runHistoricalAdaptationContentCheckTask,
} = require('./historicalAdaptationContentCheckTask.cjs');

test('候选事实协议接受数组和代码围栏并按固定 fact_key 合并', () => {
  const result = normalizeCandidateFactsResponse('```json\n[{"kind":"schedule","slot":"contract_duration","qualifier":"服务期限","value":"三年","evidence":"正文三年"}]\n```', { nodeIds: ['1'], currentNodeIds: ['1'] });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].fact_key, 'schedule:contract_duration:服务期限');
  assert.equal(result.facts[0].normalized_value, '3年');
});

test('动态批次按 context_length_limit 预算切分且不携带完整基线', () => {
  const outline = [{ id: '1', title: '章节', content: '甲'.repeat(500) }];
  const batches = buildSemanticBatches(outline, { contextLengthLimit: 100 });
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.reduce((sum, item) => sum + item.content.length, 0) <= 160));
});

test('事实冲突 resolution 只接受基线或全局事实精确归一值', () => {
  const facts = [{ fact_key: 'schedule:contract_duration:服务期限', fact_id: 'f1', kind: 'schedule', slot: 'contract_duration', normalized_value: '2年', canonical_value: '2年', conflict: true, evidence: ['正文2年'], chapter_node_ids: ['1'] }];
  const accepted = validateFactResolutions(facts, [{ fact_key: facts[0].fact_key, canonical_value: '三年', basis: 'baseline-exact-match' }], { baseline: '服务期限为三年', globalFacts: [] });
  assert.equal(accepted.facts[0].conflict, false);
  const rejected = validateFactResolutions(facts, [{ fact_key: facts[0].fact_key, canonical_value: '1年', basis: 'baseline-exact-match' }], { baseline: '服务期限为三年', globalFacts: [] });
  assert.equal(rejected.facts[0].conflict, true);
});

test('deterministic-normalization 不能裁掉真实冲突且旧 facts 不得伪装为确定归一', () => {
  const conflicted = [{ fact_key: 'schedule:contract_duration:服务期限', fact_id: 'f1', kind: 'schedule', normalized_value: '2年', normalized_values: ['2年', '3年'], canonical_value: '2年', conflict: true, evidence: ['正文2年', '正文三年'], chapter_node_ids: ['1', '2'] }];
  const rejected = validateFactResolutions(conflicted, [{ fact_key: conflicted[0].fact_key, canonical_value: '2年', basis: 'deterministic-normalization' }], {});
  assert.equal(rejected.accepted.length, 0);
  assert.equal(rejected.facts[0].conflict, true);
  const legacy = [{ fact_key: 'schedule:contract_duration:服务期限', fact_id: 'legacy', kind: 'schedule', normalized_value: '2年', canonical_value: '2年', conflict: true, evidence: ['正文2年'], chapter_node_ids: ['1'] }];
  const legacyResult = validateFactResolutions(legacy, [{ fact_key: legacy[0].fact_key, canonical_value: '2年', basis: 'deterministic-normalization' }], {});
  assert.equal(legacyResult.accepted.length, 0);
  assert.equal(legacyResult.facts[0].conflict, true);
});

test('低 context 的批次预算包含 prompt 与输出 reserve，不被 Math.max(128) 撑大', () => {
  const budget = getBatchBudgetChars({ config: { context_length_limit: 100 } }, { baseline: '基线'.repeat(100) });
  assert.ok(budget >= 32);
  assert.ok(budget < 128);
});

test('事实与语义 prompt 只携带本地解析字段，不重复发送完整 baseline', () => {
  const context = { baseline: '完整基线项目名称甲项目，合同金额100万元，实施地点新地点。' };
  const factsPrompt = buildFactsPrompt(context, [{ node_id: '1', path: '章节', content: '正文' }]);
  const semanticPrompt = buildSemanticCheckPrompt(context, { chapters: [{ node_id: '1', path: '章节', content: '正文' }] });
  assert.doesNotMatch(factsPrompt, /完整基线项目名称甲项目/);
  assert.doesNotMatch(semanticPrompt, /完整基线项目名称甲项目/);
  assert.ok(factsPrompt.length < 5000);
  assert.match(factsPrompt, /project_name|项目名称/);
  assert.match(factsPrompt, /service_scope/);
  assert.match(factsPrompt, /staffing/);
});

test('多章节候选缺 node_id 时按单章节重试并安全归属', async () => {
  const calls = [];
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      calls.push(request);
      if (request.response_format?.json_schema?.name === 'historical_adaptation_facts') {
        return { candidates: [{ kind: 'service', slot: 'service_scope', qualifier: '服务范围', value: '服务内容', evidence: '服务内容' }] };
      }
      return { findings: [] };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'c', inputsHash: 'i', outlineData: { outline: [
        { id: '1', title: '章一', content: '服务内容甲' },
        { id: '2', title: '章二', content: '服务内容乙' },
      ] }, items: [{ node_id: '1', status: 'success' }, { node_id: '2', status: 'success' }],
    }) },
    checkpointTask: (_task, patch) => checkpoints.push(patch),
  });
  const factCalls = calls.filter((request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts');
  assert.ok(factCalls.length >= 3, '缺少 node_id 的多章节批次应触发逐章节重试');
  assert.equal(checkpoints.at(-1).historicalAdaptationContentCheck.status, 'success');
});

test('facts 数组返回候选事实时不应误判为无效全文事实表', async () => {
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      if (request.response_format?.json_schema?.name === 'historical_adaptation_facts') {
        return { facts: [{ kind: 'service', slot: 'service_scope', qualifier: '服务范围', value: '服务内容', evidence: '正文服务内容' }] };
      }
      return { findings: [] };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'facts-candidate-content', inputsHash: 'facts-candidate-input',
      outlineData: { outline: [{ id: '1', title: '服务章节', content: '服务内容' }] },
      items: [{ node_id: '1', status: 'success' }],
    }) },
    checkpointTask: (_task, patch) => checkpoints.push(patch),
  });
  assert.equal(checkpoints.at(-1).historicalAdaptationContentCheck.status, 'success');
});

test('真实来源不可用时阻断人工正文，无历史来源的人工补写不阻断', () => {
  const context = {
    outlineData: { outline: [{ id: '1', title: '章节', content: '人工正文' }] },
    items: [{ node_id: '1', status: 'success', content_origin: 'manual', source_version_hash: 'version',
      source_content_hash: 'hash', source_section_id: 'section' }],
    sourceAvailability: [{ node_id: '1', available: false, error: '来源快照损坏' }],
  };
  const findings = collectDeterministicFindings(context);
  assert.ok(findings.some((finding) => finding.code === 'source-stale' && finding.blocking && finding.node_ids[0] === '1'));
  context.items[0] = { node_id: '1', status: 'success', content_origin: 'manual', source_version_hash: 'version' };
  assert.equal(collectDeterministicFindings(context).length, 0);
  context.items[0] = { node_id: '1', status: 'success', content_origin: 'ai-rewrite', manual_mode: 'rewrite', manual_instruction: '人工补写要求' };
  assert.equal(collectDeterministicFindings(context).length, 0);
});

test('语义检查包含服务内容并接收对应发现', async () => {
  assert.match(buildSemanticCheckPrompt({}), /服务内容/);
  const patches = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [{ fact_id: 'service-1', kind: 'service', canonical_value: '旧服务', evidence: ['旧服务内容'], chapter_node_ids: ['1'], conflict: false }] } : ({ findings: [{ code: 'obsolete-service', category: 'service-content', severity: 'P0', blocking: true,
      node_ids: ['1'], message: '保留了不适用的旧服务', evidence: '旧服务与当前基线不符' }] }) },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i',
      outlineData: { outline: [{ id: '1', title: '服务', content: '旧服务内容。' }] }, items: [{ node_id: '1', status: 'success' }] }) },
    checkpointTask: (_task, patch) => patches.push(patch),
  });
  assert.equal(patches.at(-1).historicalAdaptationContentCheck.findings[0].category, 'service-content');
});

test('长正文分批检查并从各批事实证据保留跨章节冲突检查', async () => {
  const calls = [];
  const patches = [];
  const outline = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), title: `章节${index + 1}`, content: `唯一章${index + 1}：${'正文。'.repeat(4000)}` }));
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      calls.push(request);
      if (request.response_format?.json_schema?.name === 'historical_adaptation_facts') return { facts: request.messages[0].content.includes('当前章节ID')
        ? Array.from({ length: 6 }, (_, index) => ({ fact_id: `batch-${index + 1}`, kind: 'service', canonical_value: '正文', evidence: ['正文'], chapter_node_ids: outline.map((node) => node.id), conflict: false }))
        : [{ fact_id: `batch-${calls.length}`, kind: 'service', canonical_value: '正文', evidence: ['正文'], chapter_node_ids: ['1'], conflict: false }] };
      return request.messages[0].content.includes('跨批次事实证据') ? { findings: [{
        code: 'cross-batch', category: 'cross-chapter', severity: 'P0', blocking: true, node_ids: ['1', '6'], message: '跨批次事实冲突', evidence: '第一章100宗，第六章200宗',
      }] } : { findings: [], fact_summary: `批次${calls.length}证据：第一章100宗/第六章200宗` };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i',
      outlineData: { outline }, items: outline.map((node) => ({ node_id: node.id, status: 'success' })) }) },
    checkpointTask: (_task, patch) => patches.push(patch),
  });
  assert.ok(calls.length > 2, 'long content must not be one oversized model request');
  const globalCall = calls.at(-1).messages[0].content;
  assert.match(globalCall, /统一事实表/);
  for (const node of outline) assert.ok(calls.slice(0, -1).some((request) => request.messages[0].content.includes(`唯一章${node.id}`)), 'every chapter is checked');
  assert.ok(calls.slice(0, -1).every((request) => request.messages[0].content.length < 30000));
  assert.ok(patches.at(-1).historicalAdaptationContentCheck);
});

test('相同正文、输入和当前协议版本复用语义检查缓存', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  let calls = 0;
  const cached = { status: 'success', findings: [], checked_content_hash: 'content', checked_inputs_hash: 'inputs', checked_facts_hash: 'facts-v2', checked_protocol_inputs_hash: repair.stableHash({ inputsHash: 'inputs', rule_engine_version: 4, fact_schema_version: 2, repair_protocol_version: 1, optimization_version: 1 }), rule_engine_version: 4, fact_schema_version: 2, repair_protocol_version: 1 };
  const patches = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => { calls++; return request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [{ fact_id: 'generic', kind: 'service', canonical_value: '正文', evidence: ['正文'], chapter_node_ids: ['1'], conflict: false }] } : { findings: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content', inputsHash: 'inputs', check: cached,
      outlineData: { outline: [{ id: '1', title: '章节', content: '正文' }] }, items: [{ node_id: '1', status: 'success' }],
    }) }, checkpointTask: (_task, patch) => patches.push(patch),
  });
  assert.equal(calls, 0);
  assert.equal(patches.at(-1).historicalAdaptationContentCheck.rule_engine_version, 4);
  assert.equal(patches.at(-1).historicalAdaptationContentCheck.fact_schema_version, 2);
});

test('旧成功检查没有可用事实快照时重新提取事实', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  let calls = 0;
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      calls += 1;
      return request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [] } : { findings: [] };
    } },
    workspaceStore: {
      getHistoricalAdaptationContentFacts: () => ({ ok: false, code: 'unavailable' }),
      getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i',
        check: { status: 'success', findings: [], checked_content_hash: 'c', checked_inputs_hash: 'i', checked_facts_hash: 'old-facts',
          checked_protocol_inputs_hash: repair.stableHash({ inputsHash: 'i', rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 }),
          rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 },
        outlineData: { outline: [{ id: '1', title: '普通章节', content: '普通正文' }] }, items: [{ node_id: '1', status: 'success' }],
      }),
    }, checkpointTask() {},
  });
  assert.ok(calls > 0);
});

test('缺少事实哈希的 v4 成功缓存不得复用', async () => {
  let calls = 0;
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => { calls += 1; return request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [{ fact_id: 'generic', kind: 'service', canonical_value: '正文', evidence: ['正文'], chapter_node_ids: ['1'], conflict: false }] } : { findings: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content', inputsHash: 'inputs',
      check: { status: 'success', findings: [], checked_content_hash: 'content', checked_inputs_hash: 'inputs', checked_facts_hash: '', checked_protocol_inputs_hash: require('./historicalAdaptationConsistencyRepair.cjs').stableHash({ inputsHash: 'inputs', rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 }), rule_engine_version: 4, fact_schema_version: 1, repair_protocol_version: 1 },
      outlineData: { outline: [{ id: '1', title: '章节', content: '正文' }] }, items: [{ node_id: '1', status: 'success' }],
    }) }, checkpointTask() {},
  });
  assert.ok(calls > 0);
});

test('旧规则版本的检查缓存不得复用', async () => {
  let calls = 0;
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => { calls++; return request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [{ fact_id: 'generic', kind: 'service', canonical_value: '正文', evidence: ['正文'], chapter_node_ids: ['1'], conflict: false }] } : { findings: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content', inputsHash: 'inputs',
      check: { status: 'success', findings: [], checked_content_hash: 'content', checked_inputs_hash: 'inputs', rule_engine_version: 1 },
      outlineData: { outline: [{ id: '1', title: '章节', content: '正文' }] }, items: [{ node_id: '1', status: 'success' }],
    }) }, checkpointTask() {},
  });
  assert.equal(calls, 2);
});

test('确定性检查识别空正文、待复核状态、占位符和历史残留', () => {
  const findings = collectDeterministicFindings({
    outlineData: { outline: [
      { id: '1', title: '项目概况', content: '服务地点仍为五峰村。【待核实】' },
      { id: '2', title: '进度计划', content: '' },
    ] },
    items: [
      { node_id: '1', status: 'review', residuals: ['五峰村'] },
      { node_id: '2', status: 'success', residuals: [] },
    ],
  });
  assert.equal(findings.some((item) => item.category === 'residual' && item.node_ids[0] === '1'), true);
  assert.equal(findings.some((item) => item.category === 'placeholder' && item.node_ids[0] === '1'), true);
  assert.equal(findings.some((item) => item.category === 'empty' && item.node_ids[0] === '2'), true);
  assert.equal(findings.some((item) => item.category === 'placeholder' && !item.blocking && item.severity === 'P1'), true);
  assert.equal(findings.filter((item) => item.category !== 'placeholder').every((item) => item.blocking), true);
});

test('待核实和待补充占位符不阻断正文迁移阶段确认', () => {
  const findings = collectDeterministicFindings({
    outlineData: { outline: [{ id: '1', title: '实施范围', content: '服务地点为【待核实】，联系人为【待补充】。', children: [] }] },
    items: [{ node_id: '1', status: 'success', residuals: [], blocked_terms: [], content_origin: 'manual' }],
    differences: [],
  });

  assert.deepEqual(findings.map(({ code, blocking, severity }) => [code, blocking, severity]), [
    ['unresolved-placeholder', false, 'P1'],
  ]);
});

test('已有 review 状态但正文仅含占位符时不再生成章节阻断项', () => {
  const findings = collectDeterministicFindings({
    outlineData: { outline: [{ id: '1', title: '实施范围', content: '服务地点为【待核实】。', children: [] }] },
    items: [{ node_id: '1', status: 'review', residuals: [], blocked_terms: [] }],
    differences: [],
  });

  assert.deepEqual(findings.map(({ code, blocking }) => [code, blocking]), [['unresolved-placeholder', false]]);
});

test('人工确认的空历史来源和空正文保留提示但不阻断', () => {
  const findings = collectDeterministicFindings({
    outlineData: { outline: [{ id: '1', title: '实施范围', content: '' }, { id: '2', title: '服务地点', content: '仍为五峰村。' }] },
    items: [
      { node_id: '1', status: 'success', confirmed_at: '2026-10-07T00:00:00.000Z', source_section_id: 'section-1', residuals: [], blocked_terms: [] },
      { node_id: '2', status: 'success', confirmed_at: '2026-10-07T00:00:00.000Z', residuals: ['五峰村'], blocked_terms: ['五峰村'] },
    ],
    sourceAvailability: [{ node_id: '1', available: false, error: '章节历史原文为空，请选择定向改写或人工补写' }],
    differences: [],
  });

  assert.deepEqual(findings.map(({ code, blocking }) => [code, blocking]), [['empty-source', false], ['empty-content', false]]);
  assert.ok(findings.every((finding) => finding.severity !== 'P0'));
});

test('指纹异常说明具体变化并给出保留正文的处理方向', () => {
  const findings = collectDeterministicFindings({
    outlineData: { outline: [{ id: '1', title: '作业流程', content: '已写正文' }] },
    items: [{ node_id: '1', status: 'success', plan_id: 'plan', rule_engine_version: 2, content_plan_version: 2,
      source_version_hash: 'source-version', input_fingerprint: 'old-input', source_content_hash: 'source', migration_output_hash: 'old-output' }],
    expectedItems: [{ node_id: '1', input_fingerprint: 'new-input', source_content_hash: 'source' }],
  });
  const finding = findings.find((item) => item.code === 'plan-stale');
  assert.ok(finding);
  assert.match(finding.message, /迁移输入已变化/);
  assert.match(finding.evidence, /重新迁移|确认本章已处理/);
  assert.doesNotMatch(finding.evidence, /old-input|old-output/);
});

test('预检阻断明确说明尚未提取全文事实', async () => {
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => { throw new Error('不应调用模型'); } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i',
      outlineData: { outline: [{ id: '1', title: '空章', content: '' }] }, items: [{ node_id: '1', status: 'success' }],
    }) }, checkpointTask: (...args) => checkpoints.push(args),
  });
  assert.match(checkpoints.at(-1)[0].logs.join(' '), /尚未提取全文事实/);
});

test('全文事实运行清单使用章节 ID 数组交给 Store', async () => {
  let manifestWrites = 0;
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts'
      ? { facts: [] } : { findings: [] } },
    workspaceStore: {
      getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i',
        outlineData: { outline: [{ id: '1', title: '普通章节', content: '普通正文' }] },
        items: [{ node_id: '1', status: 'success' }],
      }),
      upsertHistoricalAdaptationContentCheckRun: ({ expectedNodeIds }) => {
        assert.deepEqual(expectedNodeIds, ['1']);
        manifestWrites += 1;
      },
      getHistoricalAdaptationContentCheckRun: () => ({ expected_batch_count: 1, expected_node_ids: ['1'] }),
    }, checkpointTask() {},
  });
  assert.ok(manifestWrites >= 2);
});

test('语义问题归一化为受控 finding schema', () => {
  const findings = normalizeHistoricalAdaptationContentFindings([
    { code: 'workload-conflict', category: 'workload', severity: 'P0', blocking: true, node_ids: ['1'], message: '工作量冲突', evidence: '100宗与200宗' },
    { code: 'invalid', category: 'other', severity: 'unknown', node_ids: ['2'], message: '' },
  ]);
  assert.deepEqual(findings.map((item) => item.code), ['workload-conflict']);
  assert.equal(findings[0].id.length > 0, true);
});

test('同 fact_id 跨批次口径冲突被归一为 conflict', () => {
  const { normalizeFactsResponse } = require('./historicalAdaptationContentCheckTask.cjs');
  const facts = normalizeFactsResponse({ facts: [
    { fact_id: 'amount-1', kind: 'amount', canonical_value: '100万元', evidence: ['第一批100万元'], chapter_node_ids: ['1'], conflict: false },
    { fact_id: 'amount-1', kind: 'amount', canonical_value: '200万元', evidence: ['第二批200万元'], chapter_node_ids: ['2'], conflict: false },
  ] });
  assert.equal(facts[0].conflict, true);
  assert.deepEqual(facts[0].chapter_node_ids.sort(), ['1', '2']);
});

test('全文事实表拒绝不存在的章节 ID', async () => {
  await assert.rejects(runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts'
      ? { facts: [{ fact_id: 'location-1', kind: 'location', canonical_value: '新地点', evidence: ['证据'], chapter_node_ids: ['missing'], conflict: false }] }
      : { findings: [] } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i', outlineData: { outline: [{ id: '1', title: '章节', content: '正文' }] }, items: [{ node_id: '1', status: 'success' }] }) },
    checkpointTask: () => {},
  }), /未知章节/);
});

test('无事实响应在正文包含关键口径时转人工', async () => {
  await assert.rejects(runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [] } : { findings: [] } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({ contentHash: 'c', inputsHash: 'i', outlineData: { outline: [{ id: '1', title: '地点', content: '服务地点为新地点。' }] }, items: [{ node_id: '1', status: 'success' }] }) },
    checkpointTask: () => {},
  }), /缺少.*事实/);
});

for (const [kind, slot, content, value] of [
  ['name', 'project_name', '项目名称：', '人工确认项目'],
  ['location', 'project_location', '地点为甲地。', '甲地'],
  ['object', 'service_object', '对象为甲方。', '甲方'],
  ['workload', 'service_quantity', '数量为十份。', '十份'],
  ['schedule', 'completion_deadline', '日期为明年。', '明年'],
  ['service', 'service_scope', '范围为测绘。', '测绘'],
]) {
  test(`人工补录 ${kind} 在必需事实校验前生效并继续检查`, async () => {
    const patches = [];
    const semanticPrompts = [];
    await runHistoricalAdaptationContentCheckTask({
      aiService: { requestJson: async (request) => {
        if (request.response_format?.json_schema?.name === 'historical_adaptation_facts') return { facts: [] };
        semanticPrompts.push(request.messages[0].content);
        return { findings: [] };
      } },
      workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
        contentHash: 'manual-content', inputsHash: 'manual-inputs',
        outlineData: { outline: [{ id: '1', title: '概况', content }] },
        items: [{ node_id: '1', status: 'success', confirmed_at: '2026-10-08T00:00:00.000Z' }],
        factOverrides: [{ fact_key: `${kind}:${slot}:人工补录`, kind, canonical_value: value, note: '人工确认' }],
      }) },
      checkpointTask: (_task, patch) => patches.push(patch),
    });
    assert.equal(patches.at(-1).historicalAdaptationContentCheck.status, 'success');
    assert.deepEqual(patches.at(-1).historicalAdaptationContentCheck.findings, []);
    assert.ok(semanticPrompts.some((prompt) => prompt.includes(`${kind}:${slot}:人工补录`) && prompt.includes(value)), '人工确认值必须参与实际语义检查');
  });
}

test('模型未返回金额事实时从正文金额建立确定性事实并继续检查', async () => {
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [] } : { findings: [] } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'amount-content', inputsHash: 'amount-inputs',
      outlineData: { outline: [{ id: '1', title: '报价说明', content: '本项目合同金额为100万元。' }] },
      items: [{ node_id: '1', status: 'success' }],
    }) },
    checkpointTask: (...args) => checkpoints.push(args),
  });
  const final = checkpoints.at(-1);
  assert.equal(final[0].status, 'success');
  assert.equal(final[1].historicalAdaptationContentCheck.status, 'success');
  assert.equal(final[1].historicalAdaptationContentCheck.findings.some((finding) => finding.code === 'manual-review-required'), false);
});

test('模型漏掉显式项目名称时从正文建立名称事实并继续检查', async () => {
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts'
      ? { candidates: [
        { kind: 'schedule', slot: 'contract_duration', qualifier: '服务期限', value: '合同签订生效之日起3年', evidence: '服务期限为合同签订生效之日起3年。' },
        { kind: 'service', slot: 'service_scope', qualifier: '服务内容', value: '不动产登记服务', evidence: '横泾街道房地一体农村不动产登记服务' },
      ] }
      : { findings: [] } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'name-content', inputsHash: 'name-inputs',
      outlineData: { outline: [{ id: '1.2.7', title: '人员配备要求', content: '项目名称：横泾街道房地一体农村不动产登记服务\n服务期限为合同签订生效之日起3年。' }] },
      items: [{ node_id: '1.2.7', status: 'success' }],
    }) },
    checkpointTask: (...args) => checkpoints.push(args),
  });
  const final = checkpoints.at(-1);
  assert.equal(final[0].status, 'success');
  assert.equal(final[1].historicalAdaptationContentCheck.status, 'success');
  assert.equal(final[1].historicalAdaptationContentCheck.findings.some((finding) => finding.code === 'manual-review-required'), false);
});

test('显式名称字段按事实槽位提取并保留章节证据', () => {
  const facts = extractDeterministicNameFacts([
    { node_id: '1.2.7', content: '**项目名称**：横泾街道房地一体农村不动产登记服务 **采购人名称**：横泾街道办事处' },
    { node_id: '1.2.8', content: '| 单位名称 | 乙方测绘公司' },
  ], 'name-inputs');
  assert.deepEqual(facts.map((fact) => [fact.kind, fact.slot, fact.canonical_value, fact.chapter_node_ids]), [
    ['name', 'project_name', '横泾街道房地一体农村不动产登记服务', ['1.2.7']],
    ['name', 'client_name', '横泾街道办事处', ['1.2.7']],
    ['name', 'provider_name', '乙方测绘公司', ['1.2.8']],
  ]);
});

test('模型已有其他名称事实时仍补齐项目名称并写入批次快照', async () => {
  const savedResults = [];
  const context = {
    contentHash: 'mixed-name-content', inputsHash: 'mixed-name-inputs',
    outlineData: { outline: [{ id: '1', title: '项目概况', content: '项目名称：甲公司\n采购人名称：甲公司' }] },
    items: [{ node_id: '1', status: 'success' }],
  };
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts'
      ? { facts: [{ fact_id: 'legacy-client-name', kind: 'name', canonical_value: '甲公司', evidence: ['采购人名称：甲公司'], chapter_node_ids: ['1'], conflict: false }] }
      : { findings: [] } },
    workspaceStore: {
      getHistoricalAdaptationContentCheckContext: () => context,
      getReusableHistoricalAdaptationContentCheckBatches: () => [],
      upsertHistoricalAdaptationContentCheckRun() {},
      createHistoricalAdaptationContentCheckBatches() {},
      saveHistoricalAdaptationContentCheckBatchResult: ({ result }) => savedResults.push(result),
      getHistoricalAdaptationContentCheckRun: () => ({ expected_batch_count: 1, expected_node_ids: ['1'] }),
    },
    checkpointTask() {},
  });
  const savedFacts = savedResults.flatMap((result) => result?.facts || []);
  assert.ok(savedFacts.some((fact) => fact.fact_key === 'name:project_name:项目名称' && fact.canonical_value === '甲公司'));
  assert.ok(savedFacts.some((fact) => fact.fact_key === 'name:client_name:采购人名称' && fact.canonical_value === '甲公司'));
});

test('模型名称与正文显式名称不一致时保留冲突证据', async () => {
  let semanticPrompt = '';
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      if (request.response_format?.json_schema?.name === 'historical_adaptation_facts') {
        return { candidates: [{ kind: 'name', slot: 'project_name', qualifier: '项目名称', value: '模型错误项目', evidence: '项目名称：模型错误项目' }] };
      }
      semanticPrompt = request.messages[0].content;
      return { findings: [] };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'name-conflict-content', inputsHash: 'name-conflict-inputs',
      outlineData: { outline: [{ id: '1', title: '项目概况', content: '项目名称：正文正确项目' }] },
      items: [{ node_id: '1', status: 'success' }],
    }) },
    checkpointTask() {},
  });
  assert.match(semanticPrompt, /模型错误项目/);
  assert.match(semanticPrompt, /正文正确项目/);
  assert.doesNotMatch(semanticPrompt, /模型错误项目,项目名称：正文正确项目/);
});

test('旧协议名称与正文显式名称不一致时合并为冲突事实', async () => {
  let semanticPrompt = '';
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      if (request.response_format?.json_schema?.name === 'historical_adaptation_facts') {
        return { facts: [{ fact_id: 'legacy-project-name', kind: 'name', canonical_value: '模型错误项目', evidence: ['项目名称：模型错误项目'], chapter_node_ids: ['1'], conflict: false }] };
      }
      semanticPrompt = request.messages[0].content;
      return { findings: [] };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'legacy-name-conflict-content', inputsHash: 'legacy-name-conflict-inputs',
      outlineData: { outline: [{ id: '1', title: '项目概况', content: '项目名称：正文正确项目' }] },
      items: [{ node_id: '1', status: 'success' }],
    }) },
    checkpointTask() {},
  });
  assert.match(semanticPrompt, /模型错误项目/);
  assert.match(semanticPrompt, /正文正确项目/);
  assert.match(semanticPrompt, /统一事实表的冲突证据包/);
});

test('同一长章节分片中的不同金额保持独立事实', () => {
  const facts = extractDeterministicAmountFacts([
    { node_id: '1', content: '项目预算为100万元。' },
    { node_id: '1', content: '其中设备投入50万元。' },
  ], 'amount-inputs');
  assert.equal(facts.length, 2);
  assert.ok(facts.every((fact) => fact.conflict === false));
});

test('一致性检查合并本地和语义问题并保存最新哈希', async () => {
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: {
      requestJson: async (request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts' ? { facts: [{ fact_id: 'schedule-1', kind: 'schedule', canonical_value: '45日', evidence: ['基线45日'], chapter_node_ids: ['1'], conflict: false }] } : ({ findings: [{
        code: 'schedule-conflict', category: 'schedule', severity: 'P0', blocking: false,
        node_ids: ['1'], message: '工期与招标基线不一致', evidence: '正文30日，基线45日',
      }] }),
    },
    workspaceStore: {
      getHistoricalAdaptationContentCheckContext: () => ({
        contentHash: 'content-hash', inputsHash: 'inputs-hash',
        outlineData: { outline: [{ id: '1', title: '进度计划', content: '工期30日。' }] },
        items: [{ node_id: '1', status: 'success', residuals: [] }],
        baseline: '工期45日。',
      }),
    },
    checkpointTask: (...args) => checkpoints.push(args),
    updateTask: () => {},
  });
  const final = checkpoints.at(-1);
  assert.equal(final[0].status, 'success');
  assert.equal(final[1].historicalAdaptationContentCheck.status, 'success');
  assert.equal(final[1].historicalAdaptationContentCheck.checked_content_hash, 'content-hash');
  assert.equal(final[1].historicalAdaptationContentCheck.checked_inputs_hash, 'inputs-hash');
  assert.equal(final[1].historicalAdaptationContentCheck.findings[0].category, 'schedule');
});

test('语义检查失败时不写入成功快照', async () => {
  const checkpoints = [];
  await assert.rejects(runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => { throw new Error('模型不可用'); } },
    workspaceStore: {
      getHistoricalAdaptationContentCheckContext: () => ({
        contentHash: 'content-hash', inputsHash: 'inputs-hash',
        outlineData: { outline: [{ id: '1', title: '项目概况', content: '正文' }] },
        items: [{ node_id: '1', status: 'success', residuals: [] }], baseline: '基线',
      }),
    },
    checkpointTask: (...args) => checkpoints.push(args), updateTask: () => {},
  }), /模型不可用/);
  assert.equal(checkpoints.some((entry) => entry[1]?.historicalAdaptationContentCheck?.status === 'success'), false);
  assert.equal(checkpoints.at(-1)[0].status, 'error');
  assert.equal(checkpoints.at(-1)[1].historicalAdaptationContentCheck.status, 'error');
  assert.match(checkpoints.at(-1)[1].historicalAdaptationContentCheck.error, /模型不可用/);
});

test('语义检查拒绝缺少 findings 数组的畸形响应', async () => {
  const checkpoints = [];
  await assert.rejects(runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => ({ findings: 'bad' }) },
    workspaceStore: {
      getHistoricalAdaptationContentCheckContext: () => ({
        contentHash: 'content-hash', inputsHash: 'inputs-hash',
        outlineData: { outline: [{ id: '1', title: '项目概况', content: '正文' }] },
        items: [{ node_id: '1', status: 'success', residuals: [] }], baseline: '基线',
      }),
    },
    checkpointTask: (...args) => checkpoints.push(args), updateTask: () => {},
  }), /全文事实表|一致性检查结果/);
  assert.equal(checkpoints.at(-1)[1].historicalAdaptationContentCheck.status, 'error');
});

test('语义检查拒绝字段缺失或类型错误的 finding', async () => {
  await assert.rejects(runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => ({ findings: [{
      code: 'workload-conflict', category: 'workload', severity: 'P0', blocking: 'true', message: '工作量冲突',
    }] }) },
    workspaceStore: {
      getHistoricalAdaptationContentCheckContext: () => ({
        contentHash: 'content-hash', inputsHash: 'inputs-hash',
        outlineData: { outline: [{ id: '1', title: '项目概况', content: '正文' }] },
        items: [{ node_id: '1', status: 'success', residuals: [] }], baseline: '基线',
      }),
    },
    checkpointTask: () => {}, updateTask: () => {},
  }), /全文事实表|一致性检查结果/);
});

test('全文事实、语义、修复和复查按阶段编排并原子应用两章', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  const chapters = [
    { node_id: '1', content: '项目名称：甲项目，合同金额100万元，实施地点旧地点。', content_origin: 'ai' },
    { node_id: '2', content: '项目名称：甲项目，合同金额100万元，实施地点旧地点。', content_origin: 'ai' },
  ].map((item) => ({ ...item, item_fingerprint: repair.stableHash({ node_id: item.node_id, content: item.content }) }));
  const facts = [
    { fact_id: 'name-1', kind: 'name', canonical_value: '甲项目', evidence: ['项目名称：甲项目'], chapter_node_ids: ['1', '2'], conflict: false },
    { fact_id: 'amount-1', kind: 'amount', canonical_value: '100万元', evidence: ['合同金额100万元'], chapter_node_ids: ['1', '2'], conflict: false },
    { fact_id: 'location-1', kind: 'location', canonical_value: '新地点', evidence: ['招标文件：新地点'], chapter_node_ids: ['1', '2'], conflict: false },
  ];
  const context = {
    contentHash: repair.stableHash(chapters.map(({ node_id, content }) => ({ node_id, content }))),
    inputsHash: repair.stableHash(chapters.map(({ node_id, item_fingerprint }) => ({ node_id, item_fingerprint }))),
    outlineData: { outline: chapters.map((item) => ({ id: item.node_id, title: `章节${item.node_id}`, content: item.content })) },
    items: chapters.map(({ node_id, item_fingerprint, content_origin }) => ({ node_id, status: 'success', item_fingerprint, content_origin })),
    baseline: '项目名称甲项目，合同金额100万元，实施地点新地点。',
  };
  const calls = [];
  const stages = [];
  let applied = 0;
  const workspaceStore = {
    getHistoricalAdaptationContentCheckContext: () => context,
    applyHistoricalAdaptationConsistencyRepairs: ({ repairs }) => {
      applied += repairs.length;
      for (const group of repairs) for (const edit of group.chapters) {
        const leaf = context.outlineData.outline.find((item) => item.id === edit.node_id);
        leaf.content = leaf.content.replace(edit.old_text, edit.new_text);
      }
      context.contentHash = repair.stableHash(context.outlineData.outline.map((item) => ({ node_id: item.id, content: item.content })));
      context.items = context.items.map((item) => ({ ...item, item_fingerprint: repair.stableHash({ node_id: item.node_id, content: context.outlineData.outline.find((leaf) => leaf.id === item.node_id).content }) }));
      context.inputsHash = repair.stableHash(context.items.map(({ node_id, item_fingerprint }) => ({ node_id, item_fingerprint })));
    },
  };
  const hashes = (request) => ({
    expected_content_hash: context.contentHash,
    expected_inputs_hash: context.inputsHash,
    expected_facts_hash: /expected_facts_hash=([a-f0-9]+)/u.exec(request.messages[0].content)?.[1],
  });
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      calls.push(request);
      const name = request.response_format?.json_schema?.name;
      if (name === 'historical_adaptation_facts') return { facts };
      if (name === 'historical_adaptation_repair') return { repair_groups: [{
        group_id: 'location-fix', fact_id: 'location-1', confidence: 'high', rationale: '统一地点', ...hashes(request), chapters: chapters.map((chapter) => ({ node_id: chapter.node_id,
          expected_node_content_hash: repair.hashContent(context.outlineData.outline.find((leaf) => leaf.id === chapter.node_id).content),
          expected_item_fingerprint: context.items.find((item) => item.node_id === chapter.node_id).item_fingerprint,
          old_text: '旧地点', new_text: '新地点', evidence: ['招标文件：新地点'] })) } ] };
      return { findings: calls.length < 3 ? [{ code: 'location-conflict', category: 'cross-chapter', severity: 'P0', blocking: true, node_ids: ['1', '2'], message: '地点口径冲突', evidence: '旧地点与基线新地点不一致' }] : [] };
    } },
    workspaceStore,
    checkpointTask: (_task, patch) => { const value = patch?.historicalAdaptationContentCheck; if (value?.stage) stages.push(value.stage); },
  });
  assert.equal(applied, 1);
  assert.deepEqual(stages.filter((stage, index) => index === 0 || stage !== stages[index - 1]), ['facts', 'semantic', 'repair', 'recheck', 'facts', 'semantic', 'recheck']);
  assert.ok(calls.some((request) => request.response_format?.json_schema?.name === 'historical_adaptation_facts'));
  assert.ok(calls.some((request) => request.response_format?.json_schema?.name === 'historical_adaptation_repair'));
});

test('人工章节参与语义检查但不得进入修复组', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  const context = { contentHash: 'content', inputsHash: 'inputs', outlineData: { outline: [{ id: '1', title: '人工', content: '人工地点旧地点。' }, { id: '2', title: 'AI', content: 'AI地点旧地点。' }] },
    items: [{ node_id: '1', status: 'success', content_origin: 'manual' }, { node_id: '2', status: 'success', content_origin: 'ai' }] };
  const facts = [{ fact_id: 'location-1', kind: 'location', canonical_value: '新地点', evidence: ['基线新地点'], chapter_node_ids: ['1', '2'], conflict: false }];
  const calls = [];
  await assert.rejects(runHistoricalAdaptationContentCheckTask({ aiService: { requestJson: async (request) => { calls.push(request); const name = request.response_format?.json_schema?.name; if (name === 'historical_adaptation_facts') return { facts }; if (name === 'historical_adaptation_repair') return { repair_groups: [] }; return { findings: [{ code: 'location', category: 'cross-chapter', severity: 'P0', blocking: true, node_ids: ['1', '2'], message: '冲突', evidence: '旧地点' }] }; } }, workspaceStore: { getHistoricalAdaptationContentCheckContext: () => context, applyHistoricalAdaptationConsistencyRepairs: () => { throw new Error('must not apply'); } }, checkpointTask: () => {} }), /人工|repair|修复/i);
  const repairPrompt = calls.find((request) => request.response_format?.json_schema?.name === 'historical_adaptation_repair')?.messages?.[0]?.content || '';
  assert.doesNotMatch(repairPrompt, /人工地点旧地点/);
});

test('复查持续冲突时最多发起两轮修复请求', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  const chapters = [{ node_id: '1', content: '地点旧地点。', content_origin: 'ai' }, { node_id: '2', content: '地点旧地点。', content_origin: 'ai' }]
    .map((item) => ({ ...item, item_fingerprint: repair.stableHash({ node_id: item.node_id, content: item.content }) }));
  const facts = [{ fact_id: 'location-1', kind: 'location', canonical_value: '新地点', evidence: ['基线新地点'], chapter_node_ids: ['1', '2'], conflict: false }];
  const context = { contentHash: 'content', inputsHash: 'inputs', outlineData: { outline: chapters.map((item) => ({ id: item.node_id, title: item.node_id, content: item.content })) }, items: chapters.map((item) => ({ node_id: item.node_id, status: 'success', content_origin: 'ai', item_fingerprint: item.item_fingerprint })) };
  let repairCalls = 0;
  let applies = 0;
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      const name = request.response_format?.json_schema?.name;
      if (name === 'historical_adaptation_facts') return { facts };
      if (name === 'historical_adaptation_repair') {
        repairCalls += 1;
        return { repair_groups: [{ group_id: `g${repairCalls}`, fact_id: 'location-1', confidence: 'high', rationale: '统一地点', expected_content_hash: 'content', expected_inputs_hash: 'inputs', expected_facts_hash: repair.stableHash(facts), chapters: chapters.map((chapter) => ({ node_id: chapter.node_id, expected_node_content_hash: repair.hashContent(chapter.content), expected_item_fingerprint: chapter.item_fingerprint, old_text: '旧地点', new_text: '新地点', evidence: ['基线新地点'] })) }] };
      }
      return { findings: [{ code: 'location-conflict', category: 'cross-chapter', severity: 'P0', blocking: true, node_ids: ['1', '2'], message: '仍冲突', evidence: '旧地点' }] };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => context, applyHistoricalAdaptationConsistencyRepairs: () => { applies += 1; } },
    checkpointTask: (...args) => checkpoints.push(args),
  });
  assert.equal(repairCalls, 2);
  assert.equal(applies, 2);
  assert.equal(checkpoints.at(-1)[1].historicalAdaptationContentCheck.status, 'error');
  assert.equal(checkpoints.at(-1)[1].historicalAdaptationContentCheck.repair_round, 2);
  assert.ok(checkpoints.every((entry, index) => !index || entry[0].progress >= checkpoints[index - 1][0].progress), 'three check rounds and two repair rounds must never move progress backwards');
});

test('过期内容哈希的自动修复候选被拒绝且不写入正文', async () => {
  const repair = require('./historicalAdaptationConsistencyRepair.cjs');
  const chapter = { node_id: '1', content: '地点旧地点。', content_origin: 'ai', item_fingerprint: repair.stableHash({ node_id: '1', content: '地点旧地点。' }) };
  const facts = [{ fact_id: 'location-1', kind: 'location', canonical_value: '新地点', evidence: ['基线新地点'], chapter_node_ids: ['1'], conflict: false }];
  const context = { contentHash: 'content', inputsHash: 'inputs', outlineData: { outline: [{ id: '1', title: '地点', content: chapter.content }] }, items: [{ node_id: '1', status: 'success', content_origin: 'ai', item_fingerprint: chapter.item_fingerprint }] };
  let applies = 0;
  await assert.rejects(runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async (request) => {
      const name = request.response_format?.json_schema?.name;
      if (name === 'historical_adaptation_facts') return { facts };
      if (name === 'historical_adaptation_repair') return { repair_groups: [{ group_id: 'g1', fact_id: 'location-1', confidence: 'high', rationale: '统一地点', expected_content_hash: 'stale-content', expected_inputs_hash: 'inputs', expected_facts_hash: repair.stableHash(facts), chapters: [{ node_id: '1', expected_node_content_hash: repair.hashContent(chapter.content), expected_item_fingerprint: chapter.item_fingerprint, old_text: '旧地点', new_text: '新地点', evidence: ['基线新地点'] }] }] };
      return { findings: [{ code: 'location-conflict', category: 'cross-chapter', severity: 'P0', blocking: true, node_ids: ['1'], message: '冲突', evidence: '旧地点' }] };
    } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => context, applyHistoricalAdaptationConsistencyRepairs: () => { applies += 1; } }, checkpointTask: () => {},
  }), /自动修复候选|hash/i);
  assert.equal(applies, 0);
  assert.equal(context.outlineData.outline[0].content, '地点旧地点。');
});
