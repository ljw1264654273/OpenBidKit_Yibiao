const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildHistoricalAdaptationDifferencePrompt,
  normalizeHistoricalAdaptationDifferences,
  runHistoricalAdaptationDifferenceTask,
} = require('./historicalAdaptationDifferenceTask.cjs');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');

test('差异分析提示词限定五类处理动作并排除字数扩写删减', () => {
  const prompt = buildHistoricalAdaptationDifferencePrompt('项目概述：横泾街道不动产登记服务');

  assert.match(prompt, /删除内容/);
  assert.match(prompt, /名称地点替换/);
  assert.match(prompt, /数据更新/);
  assert.match(prompt, /工期进度更新/);
  assert.match(prompt, /其他人工判断/);
  assert.match(prompt, /不得提出字数扩写、压缩、删减或篇幅调整/);
  assert.match(prompt, /location-target/);
  assert.match(prompt, /workload/);
  assert.match(prompt, /schedule/);
  assert.match(prompt, /content_change_scope/);
  assert.match(prompt, /difference_schema_version/);
  assert.match(prompt, /replacements/);
  assert.match(prompt, /target_action/);
  assert.match(prompt, /evidence_kind/);
  assert.match(prompt, /confidence/);
  assert.match(prompt, /old_content_evidence/);
});

test('地点、工作量和工期差异保留 schema v2 的确定性替换契约', () => {
  const cases = [
    ['location', '名称地点替换', 'location-target', '五峰村', '横泾街道'],
    ['workload', '数据更新', 'workload', '965宗', '3082宗'],
    ['schedule', '工期进度更新', 'schedule', '30日', '45日'],
  ];
  const differences = cases.map(([id, category, scope, oldValue, newValue]) => ({
    id,
    category,
    priority: 'high',
    title: `${oldValue}调整为${newValue}`,
    historical_location: '项目概况',
    historical_excerpt: oldValue,
    tender_requirement: newValue,
    action: `将${oldValue}替换为${newValue}`,
    decision: 'pending',
    content_change_scope: scope,
    difference_schema_version: 2,
    replacements: [{ old_value: oldValue, new_value: newValue }],
    target_action: 'replace',
    evidence_kind: 'exact-value',
    confidence: 'high',
    old_content_evidence: [oldValue],
  }));

  const normalized = normalizeHistoricalAdaptationDifferences({ differences });

  assert.deepEqual(normalized.map((item) => ({
    id: item.id,
    version: item.difference_schema_version,
    scope: item.content_change_scope,
    replacements: item.replacements,
    action: item.target_action,
    evidence: item.evidence_kind,
    confidence: item.confidence,
  })), cases.map(([id, , scope, oldValue, newValue]) => ({
    id,
    version: 2,
    scope,
    replacements: [{ old_value: oldValue, new_value: newValue }],
    action: 'replace',
    evidence: 'exact-value',
    confidence: 'high',
  })));
});

test('服务内容差异保留完整旧内容证据和明确目标动作', () => {
  const [difference] = normalizeHistoricalAdaptationDifferences({ differences: [{
    id: 'service-content',
    category: '删除内容',
    priority: 'high',
    title: '删除登记发证服务',
    historical_location: '第四章 服务内容',
    historical_excerpt: '完成数据建库、登记发证及成果移交。',
    tender_requirement: '新招标范围不包含登记发证服务。',
    action: '删除登记发证事项及其明确从属内容。',
    decision: 'pending',
    content_change_scope: 'none',
    difference_schema_version: 2,
    replacements: [],
    target_action: 'remove',
    evidence_kind: 'locked-range',
    confidence: 'high',
    old_content_evidence: ['登记发证', '完成数据建库、登记发证及成果移交。'],
  }] });

  assert.equal(difference.target_action, 'remove');
  assert.equal(difference.evidence_kind, 'locked-range');
  assert.deepEqual(difference.old_content_evidence, ['登记发证', '完成数据建库、登记发证及成果移交。']);
});

test('v2 可执行差异缺少结构化映射时不能保持已确认', () => {
  const [difference] = normalizeHistoricalAdaptationDifferences({ differences: [{
    id: 'incomplete-replace', category: '名称地点替换', priority: 'high', title: '地点替换',
    historical_location: '项目概况', historical_excerpt: '五峰村', tender_requirement: '横泾街道',
    action: '替换地点', decision: 'confirmed', content_change_scope: 'location-target',
    difference_schema_version: 2, replacements: [], target_action: 'replace',
    evidence_kind: 'exact-value', confidence: 'high', old_content_evidence: ['五峰村'],
  }] });

  assert.equal(difference.decision, 'pending');
  assert.equal(difference.content_change_scope, 'location-target');
});

test('拒绝非法动作与证据组合，并接受合法 v2 组合', () => {
  const base = {
    category: '其他人工判断', priority: 'medium', title: '结构化差异',
    historical_location: '服务内容', historical_excerpt: '旧事项', tender_requirement: '新要求',
    action: '按确认规则处理', decision: 'confirmed', content_change_scope: 'none',
    difference_schema_version: 2, confidence: 'high',
  };
  const invalid = normalizeHistoricalAdaptationDifferences({ differences: [
    { ...base, id: 'remove-exact', target_action: 'remove', evidence_kind: 'exact-value', old_content_evidence: ['旧事项'] },
    { ...base, id: 'remove-mapped', target_action: 'remove', evidence_kind: 'locked-range', old_content_evidence: ['旧事项'], replacements: [{ old_value: '旧', new_value: '新' }] },
    { ...base, id: 'rewrite-contextual', target_action: 'rewrite-fragment', evidence_kind: 'contextual', old_content_evidence: ['旧事项'] },
    { ...base, id: 'rewrite-mapped', target_action: 'rewrite-fragment', evidence_kind: 'locked-range', old_content_evidence: ['旧事项'], replacements: [{ old_value: '旧', new_value: '新' }] },
    { ...base, id: 'replace-empty', target_action: 'replace', evidence_kind: 'exact-value', replacements: [] },
    { ...base, id: 'review-mapped', target_action: 'review', evidence_kind: 'contextual', replacements: [{ old_value: '旧', new_value: '新' }], confidence: 'low' },
    { ...base, id: 'review-high', target_action: 'review', evidence_kind: 'contextual', replacements: [], confidence: 'high' },
  ] });

  for (const item of invalid) assert.equal(item.decision, 'pending', item.id);

  const valid = normalizeHistoricalAdaptationDifferences({ differences: [
    { ...base, id: 'replace-valid', target_action: 'replace', evidence_kind: 'exact-value', replacements: [{ old_value: '旧', new_value: '新' }] },
    { ...base, id: 'remove-valid', target_action: 'remove', evidence_kind: 'locked-range', old_content_evidence: ['完整旧事项'] },
    { ...base, id: 'rewrite-valid', target_action: 'rewrite-fragment', evidence_kind: 'locked-range', old_content_evidence: ['完整旧事项'] },
    { ...base, id: 'review-valid', target_action: 'review', evidence_kind: 'contextual', replacements: [], confidence: 'low' },
  ] });

  for (const item of valid) assert.equal(item.decision, 'confirmed', item.id);
  assert.equal(valid.find((item) => item.id === 'review-valid')?.content_change_scope, 'none');
});

test('review contextual 始终清除正文自动局改范围', () => {
  const [difference] = normalizeHistoricalAdaptationDifferences({ differences: [{
    id: 'review-scope', category: '其他人工判断', priority: 'medium', title: '服务内容待复核',
    historical_location: '服务章节', historical_excerpt: '旧事项', tender_requirement: '需人工判断',
    action: '人工复核', decision: 'confirmed', content_change_scope: 'workload',
    difference_schema_version: 2, replacements: [], target_action: 'review',
    evidence_kind: 'contextual', confidence: 'low', old_content_evidence: [],
  }] });

  assert.equal(difference.content_change_scope, 'none');
  assert.equal(difference.decision, 'confirmed');
});

test('remove 和 rewrite-fragment 始终清除正文自动局改范围', () => {
  const base = {
    category: '删除内容', priority: 'medium', historical_location: '服务章节',
    historical_excerpt: '旧事项', tender_requirement: '不再包含', action: '删除旧事项',
    decision: 'confirmed', difference_schema_version: 2, evidence_kind: 'locked-range',
    confidence: 'high', old_content_evidence: ['完整旧事项'], replacements: [],
    content_change_scope: 'workload',
  };
  const [remove, rewrite] = normalizeHistoricalAdaptationDifferences({ differences: [
    { ...base, id: 'remove-scope', title: '删除事项', target_action: 'remove' },
    { ...base, id: 'rewrite-scope', title: '局部改写', target_action: 'rewrite-fragment', action: '局部改写旧事项' },
  ] });

  assert.equal(remove.content_change_scope, 'none');
  assert.equal(remove.decision, 'pending');
  assert.equal(rewrite.content_change_scope, 'none');
  assert.equal(rewrite.decision, 'pending');
});

test('差异结果严格归一化自动局改范围且忽略项不触发局改', () => {
  const normalized = normalizeHistoricalAdaptationDifferences({
    differences: [
      {
        id: 'location', category: '名称地点替换', priority: 'high', title: '调整实施地点',
        historical_location: '全文', historical_excerpt: '五峰村', tender_requirement: '横泾街道',
        action: '替换地点和实施对象。', content_change_scope: 'location-target', decision: 'confirmed',
        difference_schema_version: 2, replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
        target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', old_content_evidence: ['五峰村'],
      },
      {
        id: 'workload', category: '数据更新', priority: 'medium', title: '调整工作量',
        historical_location: '第二章', historical_excerpt: '100 宗', tender_requirement: '200 宗',
        action: '按新工作量调整。', content_change_scope: 'workload', decision: 'confirmed',
        difference_schema_version: 2, replacements: [{ old_value: '100 宗', new_value: '200 宗' }],
        target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', old_content_evidence: ['100 宗'],
      },
      {
        id: 'schedule', category: '工期进度更新', priority: 'medium', title: '调整进度',
        historical_location: '进度章节', historical_excerpt: '30 日', tender_requirement: '45 日',
        action: '重新编排工期。', content_change_scope: 'schedule', decision: 'ignored',
        difference_schema_version: 2, replacements: [{ old_value: '30 日', new_value: '45 日' }],
        target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', old_content_evidence: ['30 日'],
      },
      {
        id: 'invalid', category: '数据更新', priority: 'low', title: '更新人员数量',
        historical_location: '人员章节', historical_excerpt: '5 人', tender_requirement: '8 人',
        action: '更新人员。', content_change_scope: 'people', decision: 'confirmed',
        difference_schema_version: 2, replacements: [{ old_value: '5 人', new_value: '8 人' }],
        target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', old_content_evidence: ['5 人'],
      },
      {
        id: 'legacy', category: '其他人工判断', priority: 'low', title: '人工判断',
        historical_location: '其他', historical_excerpt: '旧内容', tender_requirement: '新要求',
        action: '人工处理。', decision: 'confirmed',
        difference_schema_version: 2, replacements: [], target_action: 'review',
        evidence_kind: 'contextual', confidence: 'low', old_content_evidence: ['旧内容'],
      },
    ],
  });

  assert.deepEqual(normalized.map((item) => [item.id, item.content_change_scope]), [
    ['location', 'location-target'],
    ['workload', 'workload'],
    ['schedule', 'none'],
    ['invalid', 'none'],
    ['legacy', 'none'],
  ]);
});

test('旧记录缺少结构化契约时保持待确认且不从自然语言推断可执行范围', () => {
  const base = {
    category: '名称地点替换', priority: 'high', historical_location: '项目概况',
    historical_excerpt: '五峰村', tender_requirement: '横泾街道', action: '替换地点', decision: 'confirmed',
  };
  const normalized = normalizeHistoricalAdaptationDifferences([
    { ...base, id: 'legacy-location', title: '地点调整' },
    { ...base, id: 'legacy-workload', category: '数据更新', title: '工作量调整', historical_excerpt: '100宗', tender_requirement: '200宗', action: '更新工作量' },
    { ...base, id: 'legacy-schedule', category: '工期进度更新', title: '服务期调整', historical_excerpt: '服务期30日', tender_requirement: '服务期45日', action: '更新服务期限' },
    { ...base, id: 'explicit-none', title: '地点调整', content_change_scope: 'none' },
    { ...base, id: 'explicit-null', title: '地点调整', content_change_scope: null },
    { ...base, id: 'explicit-empty', title: '地点调整', content_change_scope: '' },
    { ...base, id: 'explicit-invalid', title: '地点调整', content_change_scope: 'location' },
    { ...base, id: 'project-name', title: '项目名称调整', historical_excerpt: '五峰村项目', tender_requirement: '横泾街道项目', action: '修改项目名称' },
    { ...base, id: 'staff', category: '数据更新', title: '人员数量调整', historical_excerpt: '10人', tender_requirement: '12人', action: '增加人员' },
    { ...base, id: 'equipment', category: '数据更新', title: '设备数量调整', historical_excerpt: '2台设备', tender_requirement: '3台设备', action: '增加设备' },
    { ...base, id: 'pending', title: '地点调整', decision: 'pending' },
    { ...base, id: 'ignored', title: '地点调整', decision: 'ignored' },
  ]);

  for (const item of normalized.filter((difference) => difference.id !== 'ignored')) {
    assert.equal(item.decision, 'pending', item.id);
    assert.equal(item.content_change_scope, 'none', item.id);
    assert.equal(item.target_action, 'review', item.id);
    assert.equal(item.evidence_kind, 'contextual', item.id);
    assert.equal(item.confidence, 'low', item.id);
    assert.deepEqual(item.replacements, [], item.id);
  }
  assert.equal(normalized.find((item) => item.id === 'ignored')?.decision, 'ignored');
});

test('差异结果过滤纯字数建议并保留同标识的人工确认', () => {
  const previous = [{
    id: 'stable-id',
    category: '名称地点替换',
    priority: 'high',
    title: '项目地点由五峰村调整为横泾街道',
    historical_location: '第一章 项目概况',
    historical_excerpt: '服务地点：五峰村',
    tender_requirement: '服务地点：横泾街道',
    action: '全文将五峰村替换为横泾街道，并检查村级表述。',
    note: '已核对招标文件',
    decision: 'confirmed',
    content_change_scope: 'location-target',
    difference_schema_version: 2,
    replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
    target_action: 'replace',
    evidence_kind: 'exact-value',
    confidence: 'high',
    old_content_evidence: ['五峰村'],
  }];
  const normalized = normalizeHistoricalAdaptationDifferences({
    differences: [
      {
        id: 'stable-id',
        category: '名称地点替换',
        priority: 'high',
        title: '项目地点由五峰村调整为横泾街道',
        historical_location: '第一章 项目概况',
        historical_excerpt: '服务地点：五峰村',
        tender_requirement: '服务地点：横泾街道',
        action: '全文替换项目地点。',
      },
      {
        category: '其他人工判断',
        priority: 'low',
        title: '将全文扩写到更多字数',
        historical_location: '全文',
        historical_excerpt: '篇幅较短',
        tender_requirement: '未要求字数',
        action: '增加字数并扩写内容。',
      },
    ],
  }, previous);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].decision, 'confirmed');
  assert.equal(normalized[0].note, '已核对招标文件');
  assert.equal(normalized[0].action, '全文将五峰村替换为横泾街道，并检查村级表述。');
  assert.equal(normalized[0].content_change_scope, 'location-target');
});

test('后台任务读取完整招标基线和历史标书并持久化差异', async () => {
  const bidAnalysisTasks = Object.fromEntries(getBidAnalysisTasks('full').map((definition) => [definition.id, {
    id: definition.id,
    label: definition.label,
    status: 'success',
    content: `${definition.label}：横泾街道要求`,
  }]));
  const checkpoints = [];
  const requests = [];

  await runHistoricalAdaptationDifferenceTask({
    aiService: {
      getConfig: () => ({}),
      requestJson: async (request) => {
        requests.push(request);
        return {
          differences: [{
            category: '删除内容',
            priority: 'high',
            title: '删除数据建库和登记发证',
            historical_location: '第四章',
            historical_excerpt: '4. 数据建库和登记发证',
            tender_requirement: '新招标范围未包含该工作',
            action: '删除整章及所有关联内容。',
          }],
        };
      },
    },
    workspaceStore: {
      loadTechnicalPlan: () => ({ bidAnalysisTasks, historicalAdaptationDifferences: [] }),
      readOriginalPlanMarkdown: () => '# 五峰村技术方案\n\n## 4. 数据建库和登记发证',
    },
    updateTask: () => {},
    checkpointTask: (...args) => checkpoints.push(args),
    payload: {},
  });

  assert.ok(requests.length >= 1);
  assert.match(JSON.stringify(requests[0]), /响应文件要求/);
  assert.match(JSON.stringify(requests[0]), /五峰村技术方案/);
  const finalCheckpoint = checkpoints.at(-1);
  assert.equal(finalCheckpoint[0].status, 'success');
  assert.equal(finalCheckpoint[1].historicalAdaptationDifferences.length, 1);
  assert.equal(finalCheckpoint[1].historicalAdaptationDifferences[0].category, '删除内容');
  assert.equal(finalCheckpoint[1].historicalAdaptationDifferenceConfirmedAt, null);
});
