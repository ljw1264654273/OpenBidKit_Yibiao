const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectDeterministicFindings,
  normalizeHistoricalAdaptationContentFindings,
  runHistoricalAdaptationContentCheckTask,
} = require('./historicalAdaptationContentCheckTask.cjs');

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
