const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildHistoricalOutlineTree,
  normalizeAdaptedOutlineResult,
  runHistoricalAdaptationOutlineTask,
} = require('./historicalAdaptationOutlineTask.cjs');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');

test('历史目录路径归一化为稳定编号的树结构', () => {
  const result = buildHistoricalOutlineTree([
    { path: ['项目概况'] },
    { path: ['服务方案', '数据建库和登记发证'] },
    { path: ['服务方案', '进度安排'] },
    { path: ['服务方案', '进度安排'] },
  ]);

  assert.deepEqual(result.outline.map((item) => [item.id, item.title]), [
    ['1', '项目概况'],
    ['2', '服务方案'],
  ]);
  assert.deepEqual(result.outline[1].children.map((item) => [item.id, item.title]), [
    ['2.1', '数据建库和登记发证'],
    ['2.2', '进度安排'],
  ]);
  assert.equal(result.outline[1].children[0].content_mode, 'ai-generate');
});

test('适配结果生成目录节点和可追溯变更记录', () => {
  const result = normalizeAdaptedOutlineResult({
    outline: [{
      title: '横泾街道项目概况',
      description: '说明项目范围和服务对象。',
      attr: '技术',
      source_paths: ['项目概况'],
      change_type: 'renamed',
      change_reason: '行政层级由村调整为街道',
      difference_ids: ['replace-location'],
      children: [{
        title: '三年实施进度',
        description: '按新开标时间重排阶段节点。',
        source_paths: ['服务方案 / 进度安排'],
        change_type: 'updated',
        change_reason: '工期进度更新',
        difference_ids: ['update-schedule'],
      }],
    }],
    deleted: [{
      original_path: '服务方案 / 数据建库和登记发证',
      reason: '新招标范围不包含该工作',
      difference_ids: ['delete-registration-database'],
    }],
  }, '横泾街道历史标书适配');

  assert.equal(result.outlineData.outline[0].id, '1');
  assert.equal(result.outlineData.outline[0].children[0].id, '1.1');
  assert.equal(result.outlineData.outline[0].children[0].content_mode, 'ai-generate');
  assert.equal(result.changes.length, 3);
  assert.equal(result.changes.find((item) => item.change_type === 'deleted').target_node_id, '');
  assert.deepEqual(result.changes.find((item) => item.change_type === 'renamed').difference_ids, ['replace-location']);
});

test('未变化的子节点仍保存历史来源路径供正文迁移', () => {
  const result = normalizeAdaptedOutlineResult({ outline: [{
    title: '横泾街道目标', source_paths: ['五峰村目标'], change_type: 'renamed',
    change_reason: '地点变化', children: [{
      title: '保障群众合法权益', source_paths: ['五峰村目标 / 保障群众合法权益'], change_type: 'unchanged',
    }],
  }] });
  assert.deepEqual(result.changes.find((item) => item.target_node_id === '1.1'), {
    id: result.changes.find((item) => item.target_node_id === '1.1').id,
    change_type: 'unchanged', original_path: '五峰村目标 / 保障群众合法权益',
    target_node_id: '1.1', target_title: '保障群众合法权益', reason: '沿用历史章节', difference_ids: [], reuse_original: true,
  });
});

test('目录变更默认历史节点复用、新增节点不复用并保留显式选择', () => {
  const result = normalizeAdaptedOutlineResult({ outline: [
    { title: '沿用', source_paths: ['原沿用'], change_type: 'unchanged' },
    { title: '调整', source_paths: ['原调整'], change_type: 'renamed' },
    { title: '新增', change_type: 'added', change_reason: '招标基线新增' },
    { title: '明确关闭', source_paths: ['原关闭'], change_type: 'updated', reuse_original: false },
  ] });
  assert.equal(result.changes.find((item) => item.target_title === '沿用').reuse_original, true);
  assert.equal(result.changes.find((item) => item.target_title === '调整').reuse_original, true);
  assert.equal(result.changes.find((item) => item.target_title === '新增').reuse_original, false);
  assert.equal(result.changes.find((item) => item.target_title === '明确关闭').reuse_original, false);
});

test('目录变更兼容归一化会推断缺失的复用字段', () => {
  const changes = require('./historicalAdaptationOutlineTask.cjs').normalizeHistoricalAdaptationOutlineChanges([
    { id: 'legacy', change_type: 'moved', original_path: '原', target_node_id: '1', target_title: '现', reason: '移动', difference_ids: [] },
    { id: 'added', change_type: 'added', original_path: '', target_node_id: '2', target_title: '新增', reason: '新增', difference_ids: [] },
  ]);
  assert.equal(changes[0].reuse_original, true);
  assert.equal(changes[1].reuse_original, false);
});

test('后台任务读取完整基线和已确认差异并原子保存目录结果', async () => {
  const bidAnalysisTasks = Object.fromEntries(getBidAnalysisTasks('full').map((definition) => [definition.id, {
    id: definition.id,
    label: definition.label,
    status: 'success',
    content: `${definition.label}：横泾街道要求`,
  }]));
  const checkpoints = [];
  const requests = [];
  let extractionRequestCount = 0;

  await runHistoricalAdaptationOutlineTask({
    aiService: {
      getConfig: () => ({ context_length_limit: 80 }),
      requestJson: async (request) => {
        requests.push(request);
        if (String(request.logTitle).includes('历史目录提取')) {
          extractionRequestCount += 1;
          return extractionRequestCount === 1
            ? { items: [{ path: ['项目概况'] }, { path: ['服务方案', '数据建库和登记发证'] }] }
            : { items: [{ path: ['服务方案', '进度安排'] }] };
        }
        return {
          outline: [{
            title: '横泾街道项目概况',
            description: '项目总体说明。',
            attr: '技术',
            source_paths: ['项目概况'],
            change_type: 'renamed',
            change_reason: '名称地点替换',
            difference_ids: ['replace-location'],
          }],
          deleted: [{
            original_path: '服务方案 / 数据建库和登记发证',
            reason: '删除已确认的不适用工作',
            difference_ids: ['delete-registration-database'],
          }],
        };
      },
    },
    workspaceStore: {
      loadTechnicalPlan: () => ({
        bidAnalysisTasks,
        historicalAdaptationDifferenceConfirmedAt: '2026-10-01T08:00:00.000Z',
        historicalAdaptationDifferences: [
          {
            id: 'replace-location', category: '名称地点替换', priority: 'high', title: '替换地点',
            historical_location: '全文', historical_excerpt: '五峰村', tender_requirement: '横泾街道',
            action: '替换为横泾街道', note: '', decision: 'confirmed',
          },
          {
            id: 'delete-registration-database', category: '删除内容', priority: 'high', title: '删除登记发证',
            historical_location: '第四章', historical_excerpt: '数据建库和登记发证', tender_requirement: '不在范围内',
            action: '删除相关目录', note: '', decision: 'confirmed',
          },
          {
            id: 'ignored-workload', category: '数据更新', priority: 'low', title: '工作量',
            historical_location: '概况', historical_excerpt: '原数量', tender_requirement: '新数量',
            action: '不处理', note: '', decision: 'ignored',
          },
        ],
      }),
      readOriginalPlanMarkdown: () => '# 项目概况\n'.repeat(60) + '# 服务方案\n'.repeat(60),
    },
    updateTask: () => {},
    checkpointTask: (...args) => checkpoints.push(args),
    payload: { projectId: 'historical-project', projectName: '横泾街道历史标书适配' },
  });

  assert.ok(extractionRequestCount > 1, '长历史标书应分片提取目录');
  const adaptationRequest = requests.find((request) => String(request.logTitle).includes('目录适配'));
  const adaptationText = JSON.stringify(adaptationRequest);
  assert.match(adaptationText, /replace-location/);
  assert.doesNotMatch(adaptationText, /ignored-workload/);
  const finalPatch = checkpoints.at(-1)[1];
  assert.equal(finalPatch.outlineData.outline[0].title, '横泾街道项目概况');
  assert.equal(finalPatch.historicalAdaptationOriginalOutline.outline.length > 0, true);
  assert.equal(finalPatch.historicalAdaptationOutlineChanges.length, 2);
  assert.equal(finalPatch.historicalAdaptationOutlineConfirmedAt, null);
  assert.equal(finalPatch.invalidateContentGeneration, true);
  assert.deepEqual(finalPatch.contentGenerationSections, {});
  assert.deepEqual(finalPatch.contentGenerationPlans, {});
});
