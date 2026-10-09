const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticCheckPrompt, buildRepairPrompt, runHistoricalAdaptationContentCheckTask } = require('./historicalAdaptationContentCheckTask.cjs');
const repair = require('./historicalAdaptationConsistencyRepair.cjs');

function fixture(contents = ['保密员登记收发，秘密文件单独保管。']) {
  const context = { contentHash: 'content', inputsHash: 'inputs',
    baseline: { servicePeriod: { id: 'servicePeriod', label: '服务期限', status: 'success', content: '本项目服务期限为三年。' } },
    outlineData: { outline: contents.map((content, i) => ({ id: String(i + 1), title: '实施方案', content })) },
    items: contents.map((_, i) => ({ node_id: String(i + 1), status: 'success', item_fingerprint: `fp${i}` })) };
  const requests = [], patches = [];
  const store = { getHistoricalAdaptationContentCheckContext: () => context };
  const task = { workspaceStore: store, checkpointTask: (_, patch) => patches.push(patch),
    aiService: { requestJson: async (request) => {
      requests.push(request);
      return request.response_format.json_schema.name === 'historical_adaptation_facts'
        ? { candidates: [
          { node_id: '1', kind: 'service', slot: 'method', qualifier: '保密制度', value: '保密员登记收发', evidence: contents[0] },
          { node_id: '1', kind: 'service', slot: 'method', qualifier: '保密制度', value: '秘密文件单独保管', evidence: contents[0] },
        ] } : { findings: [], resolutions: [] };
    } } };
  return { context, requests, patches, task, store };
}

test('真实招标分析对象的期限及相关招标原文进入语义提示词', () => {
  const f = fixture();
  f.context.tenderMarkdown = '合同约定：成果包括地籍调查表、数据库、不动产证书。';
  const prompt = buildSemanticCheckPrompt(f.context);
  assert.match(prompt, /本项目服务期限为三年/);
  assert.match(prompt, /地籍调查表/);
  assert.match(prompt, /同一对象.*同一条件/);
});

test('优先提供本章精确历史来源，避免被全书高频措辞挤出证据', () => {
  const f = fixture(['资料齐全后六个月发证。']);
  f.context.originalPlanMarkdown = '服务期限和采购需求：无关章节的服务说明。\n'.repeat(200);
  f.context.sourceAvailability = [{ node_id: '1', available: true, content: '本章历史原文：资料齐全后启动发证流程，六个月内完成。' }];
  const prompt = buildSemanticCheckPrompt(f.context);
  assert.match(prompt, /本章历史原文/);
  assert.doesNotMatch(prompt, /无关章节的服务说明/);
});

test('互补的制度条款由模型裁决通过，文字差异不产生程序阻断', async () => {
  const f = fixture();
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.status, 'success');
  assert.deepEqual(f.patches.at(-1).historicalAdaptationContentCheck.findings, []);
});

test('招标原文同样出现的历史地名只作为候选，不能预检短路', async () => {
  const f = fixture(['合同约定服务五峰村。']);
  f.context.items[0].blocked_terms = ['五峰村'];
  f.context.items[0].residuals = ['五峰村'];
  f.context.items[0].status = 'review';
  f.store.readTenderMarkdown = () => '合同项目概述：服务五峰村。';
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.ok(f.requests.some((request) => request.response_format.json_schema.name === 'historical_adaptation_content_check'));
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.findings.some((finding) => finding.blocking), false);
});

test('一般服务进度描述无需凑齐所有事实类型', async () => {
  const f = fixture(['服务对象的工作量及进度管理应符合实际。']);
  f.task.aiService.requestJson = async (request) => request.response_format.json_schema.name === 'historical_adaptation_facts'
    ? { candidates: [] } : { findings: [], resolutions: [] };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.status, 'success');
});

test('空项目名称标签由正文模型检查，不因摘要缺字段转人工', async () => {
  const f = fixture(['项目名称：']);
  f.context.baseline = {};
  f.task.aiService.requestJson = async (request) => {
    f.requests.push(request);
    return request.response_format.json_schema.name === 'historical_adaptation_facts'
      ? { candidates: [] } : { findings: [], resolutions: [] };
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(f.requests.length, 2);
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.status, 'success');
});

test('模型格式校验接入现有服务的自动纠正，软件失败不冒充内容阻断', async () => {
  const f = fixture();
  f.task.aiService.requestJson = async (request) => {
    assert.equal(typeof request.validator, 'function');
    assert.equal(typeof request.repairMessagesBuilder, 'function');
    const messages = request.repairMessagesBuilder({ invalidContent: '{}', issues: '缺字段' });
    assert.match(JSON.stringify(messages), /candidates/);
    throw new Error('格式重试失败');
  };
  await assert.rejects(runHistoricalAdaptationContentCheckTask(f.task), /格式重试失败/);
  const check = f.patches.at(-1).historicalAdaptationContentCheck;
  assert.equal(check.status, 'error');
  assert.equal(check.manual_count, 0);
  assert.deepEqual(check.findings, []);
});

test('修复提示词只发送问题相关章节且包含完整返回 DTO', () => {
  const f = fixture(['当前章节工期为两年。其他说明。', '无关正文'.repeat(15000)]);
  const context = { ...f.context, expectedContentHash: 'c', expectedInputsHash: 'i', expectedFactsHash: 'f' };
  const findings = [{ node_ids: ['1'], message: '期限不符', evidence: '两年与三年不符' }];
  const prompt = buildRepairPrompt(context, [], findings);
  assert.doesNotMatch(prompt, /无关正文/);
  assert.match(prompt, /"repair_groups"/);
  assert.match(prompt, /expected_node_content_hash/);
  assert.match(prompt, /本项目服务期限为三年/);
  assert.ok(prompt.length < 12000);
});

test('没有可精确替换的标量事实时仍可按两份文件自动修复语义矛盾', async () => {
  const f = fixture(['本工程竣工后提高城市功能。保留这段正常描述。']);
  let repaired = false, repairCalls = 0;
  f.store.readTenderMarkdown = () => '本项目为地籍调查和测绘服务。';
  f.store.applyHistoricalAdaptationConsistencyRepairs = ({ repairs, repairMode }) => {
    assert.equal(repairMode, 'semantic');
    assert.equal(repairs.length, 1);
    f.context.outlineData.outline[0].content = '本项目完成地籍调查和测绘服务。保留这段正常描述。';
    f.context.contentHash = 'updated';
    repaired = true;
  };
  f.task.aiService.requestJson = async (request) => {
    const name = request.response_format.json_schema.name;
    if (name === 'historical_adaptation_facts') return { candidates: [] };
    if (name === 'historical_adaptation_content_check') return { findings: repaired ? [] : [
      { code: 'construction', category: 'service-content', severity: 'P0', blocking: true, node_ids: ['1'], message: '当前测绘服务仍使用施工项目承诺', evidence: '本工程竣工后提高城市功能；招标要求地籍调查和测绘服务' },
      { code: 'construction-object', category: 'cross-chapter', severity: 'P0', blocking: true, node_ids: ['1'], message: '城市工程的目标与测绘服务不同', evidence: '城市功能与测绘服务' },
    ], resolutions: [] };
    repairCalls++;
    const prompt = request.messages[0].content;
    const facts = JSON.parse(prompt.split('统一事实表：')[1].split('\n语义问题：')[0]);
    return { repair_groups: [{ group_id: 'fix', fact_id: facts[0].fact_id, confidence: 'high', rationale: '按招标原文修正施工残留',
      expected_content_hash: f.context.contentHash, expected_inputs_hash: f.context.inputsHash, expected_facts_hash: prompt.split('expected_facts_hash=')[1],
      chapters: [{ node_id: '1', expected_node_content_hash: repair.hashContent(f.context.outlineData.outline[0].content), expected_item_fingerprint: 'fp0',
        old_text: '本工程竣工后提高城市功能。', new_text: '本项目完成地籍调查和测绘服务。', evidence: ['本项目为地籍调查和测绘服务。'] }] }] };
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(repaired, true);
  assert.equal(repairCalls, 1, '同一章节的问题应合并一次局部修复请求');
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.status, 'success');
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.auto_repaired_count, 1);
});

test('一个问题关联多章时分批局部修复，请求有界且每章只发送一次', async () => {
  const f = fixture(Array.from({ length: 12 }, (_, i) => `本工程竣工后提高城市功能。章节${i}的正常说明。${'正常技术措施。'.repeat(600)}`));
  const sent = [];
  let repaired = false;
  f.store.readTenderMarkdown = () => '本项目为地籍调查和测绘服务。';
  f.store.applyHistoricalAdaptationConsistencyRepairs = ({ repairs }) => {
    assert.equal(repairs.flatMap((group) => group.chapters).length, 12);
    for (const node of f.context.outlineData.outline) node.content = node.content.replace('本工程竣工后提高城市功能。', '本项目完成地籍调查和测绘服务。');
    f.context.contentHash = 'updated';
    repaired = true;
  };
  f.task.aiService.requestJson = async (request) => {
    const name = request.response_format.json_schema.name;
    if (name === 'historical_adaptation_facts') return { candidates: [] };
    if (name === 'historical_adaptation_content_check') return { findings: repaired ? [] : [{
      code: 'construction', category: 'service-content', severity: 'P0', blocking: true,
      node_ids: f.context.items.map((item) => item.node_id), message: '当前测绘服务仍使用施工项目承诺', evidence: '本工程竣工后提高城市功能；招标要求地籍调查和测绘服务',
    }], resolutions: [] };
    const prompt = request.messages[0].content;
    assert.ok(prompt.length <= 24000, `修复请求不应超过24000字符，实际${prompt.length}`);
    const chapters = JSON.parse(prompt.split('当前章节：')[1].split('\nexpected_content_hash=')[0]);
    sent.push(...chapters.map((chapter) => chapter.node_id));
    const facts = JSON.parse(prompt.split('统一事实表：')[1].split('\n语义问题：')[0]);
    return { repair_groups: [{ group_id: `fix-${sent.length}`, fact_id: facts[0].fact_id, confidence: 'high', rationale: '按招标原文修正施工残留',
      expected_content_hash: f.context.contentHash, expected_inputs_hash: f.context.inputsHash, expected_facts_hash: prompt.split('expected_facts_hash=')[1],
      chapters: chapters.map((chapter) => ({ node_id: chapter.node_id, expected_node_content_hash: chapter.expected_node_content_hash,
        expected_item_fingerprint: chapter.item_fingerprint, old_text: '本工程竣工后提高城市功能。', new_text: '本项目完成地籍调查和测绘服务。', evidence: ['本项目为地籍调查和测绘服务。'] })) }] };
  };
  await runHistoricalAdaptationContentCheckTask(f.task);
  assert.equal(new Set(sent).size, 12);
  assert.equal(sent.length, 12);
  assert.equal(f.patches.at(-1).historicalAdaptationContentCheck.status, 'success');
});
