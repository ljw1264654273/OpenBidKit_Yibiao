const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildHistoricalContentItems,
  getEffectiveMode,
  normalizeHistoricalAdaptationContentItems,
  scanHistoricalResiduals,
  runHistoricalAdaptationContentTask,
} = require('./historicalAdaptationContentTask.cjs');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');

const completeBaseline = Object.fromEntries(getBidAnalysisTasks('full').map((item) => [item.id, {
  status: 'success', content: `${item.label}内容`,
}]));

function baseState() {
  return {
    bidAnalysisTasks: completeBaseline,
    historicalAdaptationDifferenceConfirmedAt: '2026-10-01T08:00:00.000Z',
    historicalAdaptationOutlineConfirmedAt: '2026-10-01T09:00:00.000Z',
    historicalAdaptationDifferences: [{
      id: 'location', category: '名称地点替换', priority: 'high', title: '地点变更',
      historical_location: '项目概况', historical_excerpt: '五峰村', tender_requirement: '服务范围为横泾街道',
      action: '将五峰村统一改为横泾街道', note: '', decision: 'confirmed', content_change_scope: 'location-target',
    }],
    historicalAdaptationOutlineChanges: [{
      id: 'renamed', change_type: 'renamed', original_path: '项目概况', target_node_id: '1',
      target_title: '项目概况', reason: '地点替换', difference_ids: ['location'],
    }],
    outlineData: {
      outline: [
        { id: '1', title: '项目概况', description: '项目总体情况', content_mode: 'ai-generate' },
        { id: '2', title: '服务保障', description: '保障措施', content_mode: 'ai-generate' },
      ],
    },
  };
}

test('正文迁移规划默认直迁并仅对明确 scope 推荐局部改写', () => {
  const state = baseState();
  const items = buildHistoricalContentItems({
    state,
    originalPlan: '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n建立常态化响应机制。',
  });
  assert.equal(items[0].recommended_mode, 'local-rewrite');
  assert.equal(getEffectiveMode(items[0]), 'local-rewrite');
  assert.deepEqual(items[0].difference_ids, ['location']);
  assert.equal(items[0].blocked_terms.includes('五峰村'), true);
  assert.equal(items[1].recommended_mode, 'direct');
  assert.match(items[1].source_excerpt, /常态化响应机制/);
});

test('历史残留扫描识别旧地点并忽略已替换内容', () => {
  const item = { blocked_terms: ['五峰村', '村级'] };
  assert.deepEqual(scanHistoricalResiduals('服务地点为五峰村，由村级人员协调。', item), ['五峰村', '村级']);
  assert.deepEqual(scanHistoricalResiduals('服务地点为横泾街道。', item), []);
});

test('迁移对比保留超过五千字的完整历史来源及尾部表格', () => {
  const content = '常态化响应机制。'.repeat(700) + '\n\n<table><tr><td>尾部工作量120户</td></tr></table>';
  const items = buildHistoricalContentItems({ state: baseState(), originalPlan: `# 服务保障\n${content}` });
  assert.equal(items[1].source_excerpt, items[1].source_content);
  assert.ok(items[1].source_excerpt.length > 5000);
  assert.match(items[1].source_excerpt, /尾部工作量120户/);
});

test('父目录关联差异会传递到其下正文章节', () => {
  const state = baseState();
  state.historicalAdaptationDifferences.push({
    id: 'schedule', category: '工期进度更新', priority: 'high', title: '进度更新',
    historical_location: '项目进度', historical_excerpt: '2026年6月启动，服务期三年。',
    tender_requirement: '2026年10月启动，服务期三年。', action: '重排节点', note: '', decision: 'confirmed', content_change_scope: 'schedule',
  });
  state.historicalAdaptationOutlineChanges = [{
    id: 'schedule-parent', change_type: 'updated', original_path: '项目进度', target_node_id: '1',
    target_title: '项目进度', reason: '按新工期调整', difference_ids: ['schedule'],
  }];
  state.outlineData = { outline: [{
    id: '1', title: '项目进度', children: [{ id: '1.1', title: '实施阶段', content_mode: 'ai-generate' }],
  }] };
  state.historicalAdaptationOriginalOutline = { outline: [{
    id: '1', title: '项目进度', children: [{ id: '1.1', title: '实施阶段', content_mode: 'ai-generate' }],
  }] };
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 实施阶段\n2026年6月启动，服务期三年。' });
  assert.equal(item.recommended_mode, 'local-rewrite');
  assert.deepEqual(item.difference_ids, ['schedule']);
  assert.deepEqual(item.blocked_terms, ['2026年6月']);
});

test('旧日期和旧工作量会在所有历史正文中全局阻断', () => {
  const state = baseState();
  state.historicalAdaptationDifferences.push(
    {
      id: 'schedule', category: '工期进度更新', priority: 'high', title: '进度更新',
      historical_location: '实施计划', historical_excerpt: '2026年6月启动',
      tender_requirement: '2026年10月启动', action: '更新启动时间', note: '', decision: 'confirmed', content_change_scope: 'schedule',
    },
    {
      id: 'workload', category: '数据更新', priority: 'high', title: '工作量更新',
      historical_location: '工作量统计', historical_excerpt: '预计办理1500户',
      tender_requirement: '以横泾街道实际清单为准', action: '更新工作量', note: '', decision: 'confirmed', content_change_scope: 'workload',
    },
  );
  state.historicalAdaptationOutlineChanges = [{
    id: 'other-node', change_type: 'updated', original_path: '服务保障', target_node_id: '2',
    target_title: '服务保障', reason: '更新工期和工作量', difference_ids: ['schedule', 'workload'],
  }];

  const items = buildHistoricalContentItems({
    state,
    originalPlan: '# 项目概况\n项目计划于2026年6月启动，预计办理1500户。\n\n# 服务保障\n建立常态化响应机制。',
  });

  assert.equal(items[0].recommended_mode, 'local-rewrite');
  assert.deepEqual(items[0].difference_ids, ['schedule', 'workload']);
  assert.deepEqual(items[0].blocked_terms, ['2026年6月', '1500户']);
});

test('新增父目录下的同名叶子章节默认待核实而不自动补写', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  state.historicalAdaptationOutlineChanges = [{
    id: 'added-parent', change_type: 'added', original_path: '', target_node_id: '1',
    target_title: '新增服务', reason: '招标文件新增服务内容', difference_ids: [],
  }];
  state.historicalAdaptationOriginalOutline = {
    outline: [{ id: '9', title: '其他服务', children: [{ id: '9.1', title: '保障措施' }] }],
  };
  state.outlineData = {
    outline: [{ id: '1', title: '新增服务', children: [{ id: '1.1', title: '保障措施', content_mode: 'ai-generate' }] }],
  };

  const [item] = buildHistoricalContentItems({
    state,
    originalPlan: '# 保障措施\n这是其他历史分支中的旧正文。',
  });

  assert.equal(item.recommended_mode, null);
  assert.equal(item.status, 'review');
  assert.equal(item.source_path, '');
  assert.equal(item.source_excerpt, '');
});

test('正文迁移逐章 checkpoint，直接迁移原文并原子局改受影响章节', async () => {
  const state = baseState();
  const patches = [];
  const eventPatches = [];
  const taskPatches = [];
  const aiCalls = [];
  const longHistoricalBody = `五峰村原项目概况。${'历史方法。'.repeat(900)}尾部迁移标记。`;
  const workspaceStore = {
    loadTechnicalPlan: () => ({
      ...state,
      historicalAdaptationContentItems: buildHistoricalContentItems({
        state,
        originalPlan: `# 项目概况\n${longHistoricalBody}\n\n# 服务保障\n建立常态化响应机制。`,
      }).map(({ source_content: _sourceContent, ...item }) => item),
    }),
    readOriginalPlanMarkdown: () => `# 项目概况\n${longHistoricalBody}\n\n# 服务保障\n建立常态化响应机制。`,
  };
  const aiService = {
    requestJson: async (request) => {
      aiCalls.push(request);
      return { edits: [{ old_text: '五峰村', new_text: '横泾街道' }] };
    },
  };

  await runHistoricalAdaptationContentTask({
    aiService,
    workspaceStore,
    payload: {},
    updateTask: (patch) => taskPatches.push(patch),
    checkpointTask: (taskPatch, workspacePatch, eventPatch) => {
      taskPatches.push(taskPatch);
      if (workspacePatch) patches.push(workspacePatch);
      if (eventPatch) eventPatches.push(eventPatch);
    },
  });

  assert.equal(aiCalls.length, 1);
  assert.match(aiCalls[0].messages[0].content, /五峰村原项目概况/);
  const contentUpdates = patches.filter((patch) => patch.contentGenerationItem?.section?.content);
  assert.equal(contentUpdates.length, 2);
  assert.match(contentUpdates.find((patch) => patch.contentGenerationItem.nodeId === '1').contentGenerationItem.section.content, /横泾街道/);
  assert.match(contentUpdates.find((patch) => patch.contentGenerationItem.nodeId === '2').contentGenerationItem.section.content, /常态化响应机制/);
  assert.equal(eventPatches.some((patch) => patch.technicalPlanPatch?.outlineData?.outline?.[0]?.content?.includes('横泾街道')), true);
  assert.equal(taskPatches.at(-1).status, 'success');
});

test('一般目录变化不自动改写且三类 scope 都推荐局部改写', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [
    { ...state.historicalAdaptationDifferences[0], id: 'location', content_change_scope: 'location-target' },
    { ...state.historicalAdaptationDifferences[0], id: 'workload', category: '数据更新', content_change_scope: 'workload', historical_excerpt: '100宗', tender_requirement: '200宗' },
    { ...state.historicalAdaptationDifferences[0], id: 'schedule', category: '工期进度更新', content_change_scope: 'schedule', historical_excerpt: '30日', tender_requirement: '45日' },
    { ...state.historicalAdaptationDifferences[0], id: 'other', category: '其他人工判断', content_change_scope: 'none' },
  ];
  state.historicalAdaptationOutlineChanges = [{
    id: 'updated', change_type: 'updated', original_path: '项目概况', target_node_id: '1',
    target_title: '项目概况', reason: '目录说明调整', difference_ids: ['location', 'workload', 'schedule', 'other'],
  }];
  const items = buildHistoricalContentItems({
    state,
    originalPlan: '# 项目概况\n五峰村共100宗，工期30日。\n\n# 服务保障\n原保障内容。',
  });
  assert.equal(items[0].recommended_mode, 'local-rewrite');
  assert.equal(items[1].recommended_mode, 'direct');
});

test('旧自动重写和补写不会升级为新的人工授权', () => {
  const normalized = normalizeHistoricalAdaptationContentItems([
    { node_id: '1', mode: 'direct', status: 'success' },
    { node_id: '2', mode: 'rewrite', status: 'success' },
    { node_id: '3', mode: 'supplement', status: 'success' },
  ]);
  assert.equal(normalized[0].recommended_mode, 'direct');
  assert.equal(normalized[1].recommended_mode, null);
  assert.equal(normalized[1].status, 'stale');
  assert.equal(normalized[2].recommended_mode, null);
  assert.equal(normalized[2].status, 'stale');
});

test('重建方案时输入指纹变化会清除旧人工策略', () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n原保障内容。';
  const firstPlan = buildHistoricalContentItems({ state, originalPlan });
  state.historicalAdaptationContentItems = firstPlan.map(({ source_content: _sourceContent, ...item }) => ({
    ...item,
    manual_mode: item.node_id === '1' ? 'rewrite' : undefined,
    manual_instruction: item.node_id === '1' ? '只修改服务对象说明' : '',
    content_origin: item.node_id === '1' ? 'manual' : item.content_origin,
    status: item.node_id === '1' ? 'success' : item.status,
  }));
  state.historicalAdaptationDifferences = state.historicalAdaptationDifferences.map((difference) => ({
    ...difference,
    tender_requirement: '服务范围更新为横泾街道全域',
  }));

  const rebuilt = buildHistoricalContentItems({ state, originalPlan });

  assert.equal(rebuilt[0].manual_mode, undefined);
  assert.equal(rebuilt[0].manual_instruction, '');
  assert.equal(rebuilt[0].content_origin, 'manual');
  assert.equal(rebuilt[0].status, 'review');
});

test('定向改写统一执行有来源改写与无来源补充，两者都需要人工要求', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added', reason: '新增保障内容' });
  const originalPlan = '# 项目概况\n原项目概况。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  planned[0] = { ...planned[0], recommended_mode: 'direct', manual_mode: 'rewrite', manual_instruction: '重写为新的项目概况' };
  planned[1] = { ...planned[1], manual_mode: 'rewrite', manual_instruction: '补充横泾服务保障机制' };
  const aiCalls = [];
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { content: aiCalls.length === 1 ? '人工定向改写结果。' : '人工补写结果。' }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });
  assert.equal(aiCalls.length, 2);
  const completed = patches.filter((patch) => patch.historicalAdaptationContentItem).map((patch) => patch.historicalAdaptationContentItem);
  assert.deepEqual(completed.map((item) => item.content_origin), ['ai-rewrite', 'ai-rewrite']);
  assert.match(aiCalls[0].messages[0].content, /按人工要求定向改写/);
  assert.match(aiCalls[1].messages[0].content, /依据招标基线和人工要求补充正文/);
  assert.match(aiCalls[1].messages[0].content, /补充横泾服务保障机制/);
});

test('旧人工补写有要求时合并为定向改写，无要求时等待人工选择', () => {
  const normalized = normalizeHistoricalAdaptationContentItems([
    { node_id: '1', recommended_mode: 'review', manual_mode: 'supplement', manual_instruction: '补充响应流程', status: 'success' },
    { node_id: '2', recommended_mode: 'review', manual_mode: 'supplement', status: 'success' },
  ]);
  assert.equal(normalized[0].recommended_mode, null);
  assert.equal(normalized[0].manual_mode, 'rewrite');
  assert.equal(normalized[0].manual_instruction, '补充响应流程');
  assert.equal(normalized[1].manual_mode, undefined);
  assert.equal(normalized[1].status, 'review');
});

test('未选择方式的新增章节批量跳过，定向改写缺少要求时拒绝执行', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added' });
  const originalPlan = '# 项目概况\n原项目概况。\n\n# 服务保障\n原保障内容。';
  let planned = buildHistoricalContentItems({ state, originalPlan });
  const aiCalls = [];
  const options = {
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { content: '新正文' }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '2' }, updateTask: () => {}, checkpointTask: () => {},
  };
  await runHistoricalAdaptationContentTask(options);
  assert.equal(aiCalls.length, 0);
  planned = planned.map((item) => item.node_id === '2' ? { ...item, manual_mode: 'rewrite', manual_instruction: '' } : item);
  await assert.rejects(runHistoricalAdaptationContentTask(options), /缺少人工定向改写要求/);
  assert.equal(aiCalls.length, 0);
});

test('局部改写任一替换不唯一时不应用任何编辑并进入待复核', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村与五峰村均为旧地点。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ edits: [{ old_text: '五峰村', new_text: '横泾街道' }] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });
  const completed = patches.find((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.match(completed.error, /multiple|多处|唯一/u);
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.section?.content?.includes('横泾街道')), false);
});

test('人工保存正文没有显式覆盖标记时拒绝重新迁移', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  planned[0] = { ...planned[0], status: 'success', content_origin: 'manual' };
  await assert.rejects(runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ edits: [] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: () => {},
  }), /人工正文|确认覆盖/);
});

test('局部改写只向模型提供允许自动处理的三类差异', async () => {
  const state = baseState();
  state.historicalAdaptationDifferences.push({
    id: 'manual-only', category: '其他人工判断', priority: 'high', title: '不得自动处理的人员配置',
    historical_location: '项目概况', historical_excerpt: '原人员配置', tender_requirement: '需人工判断',
    action: '仅人工决定是否改写', note: '', decision: 'confirmed', content_change_scope: 'none',
  });
  state.historicalAdaptationOutlineChanges[0].difference_ids = ['location', 'manual-only'];
  const originalPlan = '# 项目概况\n五峰村原项目概况，原人员配置保持不变。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const aiCalls = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { edits: [{ old_text: '五峰村', new_text: '横泾街道' }] }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: () => {},
  });

  assert.equal(aiCalls.length, 1);
  assert.match(aiCalls[0].messages[0].content, /地点变更/);
  assert.doesNotMatch(aiCalls[0].messages[0].content, /不得自动处理的人员配置/);
});

test('批量执行待处理迁移不会覆盖需要复核的人工正文', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  planned[0] = { ...planned[0], status: 'review', content_origin: 'manual' };
  const patches = [];
  const aiCalls = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { edits: [{ old_text: '五峰村', new_text: '横泾街道' }] }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  assert.equal(aiCalls.length, 0);
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.nodeId === '1'), false);
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.nodeId === '2'), true);
});

test('迁移正文含待核实占位符时立即进入待人工处理', async () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  state.historicalAdaptationOutlineChanges = [];
  const originalPlan = '# 项目概况\n服务对象为【待核实】。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ findings: [] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  const completed = patches.find((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.match(completed.error, /待核实|待补充/);
});
