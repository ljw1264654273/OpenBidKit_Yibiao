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
