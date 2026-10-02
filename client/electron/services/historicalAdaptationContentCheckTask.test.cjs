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

const {
  buildSemanticCheckPrompt,
  collectDeterministicFindings,
  normalizeHistoricalAdaptationContentFindings,
  runHistoricalAdaptationContentCheckTask,
} = require('./historicalAdaptationContentCheckTask.cjs');

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
    aiService: { requestJson: async () => ({ findings: [{ code: 'obsolete-service', category: 'service-content', severity: 'P0', blocking: true,
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
  assert.match(globalCall, /跨批次事实证据/);
  assert.match(globalCall, /批次1证据/);
  assert.match(globalCall, new RegExp(`批次${calls.length - 1}证据`));
  for (const node of outline) assert.ok(calls.slice(0, -1).some((request) => request.messages[0].content.includes(`唯一章${node.id}`)), 'every chapter is checked');
  assert.ok(calls.slice(0, -1).every((request) => request.messages[0].content.length < 30000));
  assert.equal(patches.at(-1).historicalAdaptationContentCheck.findings[0].code, 'cross-batch');
});

test('相同正文、输入和规则版本复用语义检查缓存', async () => {
  let calls = 0;
  const cached = { status: 'success', findings: [], checked_content_hash: 'content', checked_inputs_hash: 'inputs', rule_engine_version: 2 };
  const patches = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => { calls++; return { findings: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content', inputsHash: 'inputs', check: cached,
      outlineData: { outline: [{ id: '1', title: '章节', content: '正文' }] }, items: [{ node_id: '1', status: 'success' }],
    }) }, checkpointTask: (_task, patch) => patches.push(patch),
  });
  assert.equal(calls, 0);
  assert.equal(patches.at(-1).historicalAdaptationContentCheck.rule_engine_version, 2);
});

test('旧规则版本的检查缓存不得复用', async () => {
  let calls = 0;
  await runHistoricalAdaptationContentCheckTask({
    aiService: { requestJson: async () => { calls++; return { findings: [] }; } },
    workspaceStore: { getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content', inputsHash: 'inputs',
      check: { status: 'success', findings: [], checked_content_hash: 'content', checked_inputs_hash: 'inputs', rule_engine_version: 1 },
      outlineData: { outline: [{ id: '1', title: '章节', content: '正文' }] }, items: [{ node_id: '1', status: 'success' }],
    }) }, checkpointTask() {},
  });
  assert.equal(calls, 1);
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
  assert.equal(findings.every((item) => item.blocking), true);
});

test('语义问题归一化为受控 finding schema', () => {
  const findings = normalizeHistoricalAdaptationContentFindings([
    { code: 'workload-conflict', category: 'workload', severity: 'P0', blocking: true, node_ids: ['1'], message: '工作量冲突', evidence: '100宗与200宗' },
    { code: 'invalid', category: 'other', severity: 'unknown', node_ids: ['2'], message: '' },
  ]);
  assert.deepEqual(findings.map((item) => item.code), ['workload-conflict']);
  assert.equal(findings[0].id.length > 0, true);
});

test('一致性检查合并本地和语义问题并保存最新哈希', async () => {
  const checkpoints = [];
  await runHistoricalAdaptationContentCheckTask({
    aiService: {
      requestJson: async () => ({ findings: [{
        code: 'schedule-conflict', category: 'schedule', severity: 'P0', blocking: true,
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
  }), /一致性检查结果/);
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
  }), /一致性检查结果/);
});
