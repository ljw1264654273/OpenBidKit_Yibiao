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
});

test('差异结果严格归一化自动局改范围且忽略项不触发局改', () => {
  const normalized = normalizeHistoricalAdaptationDifferences({
    differences: [
      {
        id: 'location', category: '名称地点替换', priority: 'high', title: '调整实施地点',
        historical_location: '全文', historical_excerpt: '五峰村', tender_requirement: '横泾街道',
        action: '替换地点和实施对象。', content_change_scope: 'location-target', decision: 'confirmed',
      },
      {
        id: 'workload', category: '数据更新', priority: 'medium', title: '调整工作量',
        historical_location: '第二章', historical_excerpt: '100 宗', tender_requirement: '200 宗',
        action: '按新工作量调整。', content_change_scope: 'workload', decision: 'confirmed',
      },
      {
        id: 'schedule', category: '工期进度更新', priority: 'medium', title: '调整进度',
        historical_location: '进度章节', historical_excerpt: '30 日', tender_requirement: '45 日',
        action: '重新编排工期。', content_change_scope: 'schedule', decision: 'ignored',
      },
      {
        id: 'invalid', category: '数据更新', priority: 'low', title: '更新人员数量',
        historical_location: '人员章节', historical_excerpt: '5 人', tender_requirement: '8 人',
        action: '更新人员。', content_change_scope: 'people', decision: 'confirmed',
      },
      {
        id: 'legacy', category: '其他人工判断', priority: 'low', title: '人工判断',
        historical_location: '其他', historical_excerpt: '旧内容', tender_requirement: '新要求',
        action: '人工处理。', decision: 'confirmed',
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

test('仅对持久化旧记录中真正缺失的 scope 做保守推断', () => {
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
  ], [], { inferLegacyScopes: true });

  assert.deepEqual(normalized.map((item) => [item.id, item.content_change_scope]), [
    ['legacy-location', 'location-target'],
    ['legacy-workload', 'workload'],
    ['legacy-schedule', 'schedule'],
    ['explicit-none', 'none'],
    ['explicit-null', 'none'],
    ['explicit-empty', 'none'],
    ['explicit-invalid', 'none'],
    ['project-name', 'none'],
    ['staff', 'none'],
    ['equipment', 'none'],
    ['pending', 'none'],
    ['ignored', 'none'],
  ]);
});

test('仅整批旧记录都被归一化成 none 时兼容推断明确范围', () => {
  const location = {
    id: 'legacy-location', category: '名称地点替换', priority: 'high', title: '服务主体由五峰村调整为横泾街道',
    historical_location: '项目概况', historical_excerpt: '五峰村需开展农村不动产登记工作', tender_requirement: '横泾街道开展登记服务',
    action: '将实施地点调整为横泾街道', decision: 'confirmed', content_change_scope: 'none',
  };
  const workload = {
    ...location, id: 'legacy-workload', category: '数据更新', title: '工作量由965宗更新为3082宗',
    historical_excerpt: '工作量约965宗', tender_requirement: '工作量约3082宗', action: '更新工作量',
  };
  const personnel = {
    ...location, id: 'personnel', category: '数据更新', title: '人员配备调整',
    historical_excerpt: '配置10人', tender_requirement: '配置12人', action: '人工核对人员配置',
  };
  const options = { inferLegacyScopes: true, inferLegacyAllNoneScopes: true };

  const legacyBatch = normalizeHistoricalAdaptationDifferences([location, workload, personnel], [], options);
  assert.deepEqual(legacyBatch.map((item) => [item.id, item.content_change_scope]), [
    ['legacy-location', 'location-target'],
    ['legacy-workload', 'workload'],
    ['personnel', 'none'],
  ]);

  const mixedBatch = normalizeHistoricalAdaptationDifferences([
    location,
    { ...workload, content_change_scope: 'workload' },
  ], [], options);
  assert.deepEqual(mixedBatch.map((item) => [item.id, item.content_change_scope]), [
    ['legacy-location', 'none'],
    ['legacy-workload', 'workload'],
  ]);
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
