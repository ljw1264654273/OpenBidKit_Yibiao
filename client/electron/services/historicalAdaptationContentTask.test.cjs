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

test('重建人工正文方案保留实际迁移来源，而显式覆盖切换到当前来源', () => {
  const state = baseState();
  const oldSource = '# 项目概况\n五峰村旧来源。\n# 服务保障\n旧保障。';
  const newSource = '# 新概况\n五峰村新来源。\n# 服务保障\n新保障。';
  const [previous] = buildHistoricalContentItems({ state, originalPlan: oldSource });
  state.historicalAdaptationContentItems = [{ ...previous, status: 'success', content_origin: 'manual' }];
  state.historicalAdaptationOutlineChanges[0].original_path = '新概况';
  const [updated] = buildHistoricalContentItems({ state, originalPlan: newSource });
  for (const key of ['source_path', 'source_locator', 'source_hash', 'source_version_hash', 'source_content_hash', 'source_section_id']) {
    assert.equal(updated[key], previous[key], `manual provenance must retain ${key}`);
  }
  assert.equal(updated.recommended_mode, 'local-rewrite');
  const [overwritten] = buildHistoricalContentItems({ state, originalPlan: newSource, overwriteManualNodeIds: ['1'] });
  assert.equal(overwritten.source_path, '新概况');
  assert.notEqual(overwritten.source_version_hash, previous.source_version_hash);
  assert.equal(overwritten.source_content, '五峰村新来源。');
});

test('沿用历史原文以历史正文为底稿并保留推荐局部改写，关闭复用不会直接迁移', () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村正文。\n# 服务保障\n保障正文。';
  state.historicalAdaptationOutlineChanges[0].reuse_original = true;
  const reused = buildHistoricalContentItems({ state, originalPlan })[0];
  assert.equal(reused.recommended_mode, 'local-rewrite');
  assert.equal(reused.reuse_original, true);
  assert.equal(getEffectiveMode(reused), 'local-rewrite');

  state.historicalAdaptationOutlineChanges[0].reuse_original = false;
  const optedOut = buildHistoricalContentItems({ state, originalPlan })[0];
  assert.equal(optedOut.reuse_original, false);
  assert.notEqual(getEffectiveMode(optedOut), 'direct');
  assert.equal(getEffectiveMode(optedOut), 'local-rewrite');
});

test('来源路径带虚拟历史标书根节点时仍定位历史正文并执行复用迁移', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  state.historicalAdaptationOutlineChanges[0] = {
    ...state.historicalAdaptationOutlineChanges[0],
    original_path: '历史标书 / 项目概况',
    reuse_original: true,
  };
  const [item] = buildHistoricalContentItems({
    state,
    originalPlan: '# 项目概况\n历史正文。',
  });
  assert.equal(item.source_path, '项目概况');
  assert.equal(item.source_content, '历史正文。');
  assert.equal(item.recommended_mode, 'direct');
  assert.equal(getEffectiveMode(item), 'direct');
});

test('默认沿用历史原文时仍自动应用已确认的内容调整', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges[0].reuse_original = true;
  const originalPlan = '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n原保障内容。';
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ edits: [{ old_text: '五峰村', new_text: '横泾街道' }] }) },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });
  const rewritten = patches.find((patch) => patch.contentGenerationItem?.nodeId === '1')?.contentGenerationItem.section.content;
  assert.equal(rewritten, '横泾街道原项目概况。');
});

test('缺少复用决定时保留历史推荐模式，不推断复用字段', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 项目概况\n五峰村正文。' });
  assert.equal(item.recommended_mode, 'direct');
  assert.equal(item.reuse_original, undefined);
  assert.equal(getEffectiveMode(item), 'direct');
});

test('复用决定要求可靠来源，新增节点不得伪造 direct', () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges = [{ ...state.historicalAdaptationOutlineChanges[0], change_type: 'added', original_path: '', reuse_original: false }];
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 项目概况\n五峰村正文。' });
  assert.equal(item.reuse_original, false);
  assert.equal(item.source_content_hash, '');
  assert.equal(item.recommended_mode, 'rewrite');
  assert.equal(getEffectiveMode(item), 'rewrite');
});

test('关闭复用会清除历史 direct 人工选择', () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村正文。';
  const previous = buildHistoricalContentItems({ state, originalPlan })[0];
  state.historicalAdaptationContentItems = [{ ...previous, manual_mode: 'direct', status: 'success' }];
  state.historicalAdaptationOutlineChanges[0].reuse_original = false;
  const [rebuilt] = buildHistoricalContentItems({ state, originalPlan });
  assert.equal(rebuilt.manual_mode, undefined);
  assert.notEqual(getEffectiveMode(rebuilt), 'direct');
});

test('单章确认覆盖人工正文使用当前来源正文与同一版本 provenance', async () => {
  const state = baseState();
  const oldSource = '# 项目概况\n五峰村旧来源。\n# 服务保障\n旧保障。';
  const originalPlan = '# 项目概况\n五峰村新来源。\n# 服务保障\n新保障。';
  const [previous] = buildHistoricalContentItems({ state, originalPlan: oldSource });
  state.historicalAdaptationContentItems = [{ ...previous, status: 'success', content_origin: 'manual' }];
  const expected = buildHistoricalContentItems({ state: { ...state, historicalAdaptationContentItems: [] }, originalPlan })[0];
  const patches = [];
  await runHistoricalAdaptationContentTask({ aiService: {},
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan,
      getHistoricalAdaptationSourceSection: ({ sourceItem: item }) => {
        return { available: true, content: item.source_version_hash === previous.source_version_hash ? '五峰村旧来源。' : '五峰村新来源。' };
      } },
    payload: { nodeId: '1', forceOverwriteManual: true }, updateTask() {},
    checkpointTask(_task, patch) {
      patches.push(patch);
      if (patch?.historicalAdaptationContentItem) state.historicalAdaptationContentItems = [patch.historicalAdaptationContentItem];
    } });
  const output = patches.find((patch) => patch?.contentGenerationItem);
  assert.equal(output.contentGenerationItem.section.content, '横泾街道新来源。');
  assert.equal(output.historicalAdaptationContentItem.source_version_hash, expected.source_version_hash);
  assert.equal(output.historicalAdaptationContentItem.source_content_hash, expected.source_content_hash);
  assert.equal(output.historicalAdaptationContentItem.source_section_id, expected.source_section_id);
});

for (const failure of ['模型失败', '任务取消']) {
  test(`覆盖人工正文${failure}时所有 checkpoint 保留原实际来源`, async () => {
    const state = baseState();
    const oldSource = '# 项目概况\n五峰村旧来源。\n# 服务保障\n旧保障。';
    const originalPlan = '# 项目概况\n五峰村新来源。\n# 服务保障\n新保障。';
    const [previous] = buildHistoricalContentItems({ state, originalPlan: oldSource });
    state.outlineData.outline[0].content = '旧人工正文。';
    state.historicalAdaptationContentItems = [{ ...previous, status: 'success', content_origin: 'manual',
      manual_mode: 'rewrite', manual_instruction: '按新来源更新' }];
    let bodyWrites = 0;
    let cancelled = false;
    const provenanceKeys = ['source_path', 'source_locator', 'source_hash', 'source_version_hash', 'source_content_hash', 'source_section_id'];
    const patches = [];
    const run = runHistoricalAdaptationContentTask({
      aiService: { requestJson: async () => { cancelled = failure === '任务取消'; throw new Error(failure); } },
      workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
      payload: { nodeId: '1', forceOverwriteManual: true }, updateTask() {},
      checkpointTask(_task, patch) {
        if (cancelled) throw new Error('任务取消');
        if (patch?.historicalAdaptationContentItem?.node_id === '1') {
          patches.push(patch.historicalAdaptationContentItem);
          state.historicalAdaptationContentItems = [patch.historicalAdaptationContentItem];
        }
        if (patch?.contentGenerationItem) bodyWrites += 1;
      },
    });
    if (failure === '任务取消') await assert.rejects(run, /任务取消/);
    else await run;
    assert.equal(bodyWrites, 0);
    assert.equal(state.outlineData.outline[0].content, '旧人工正文。');
    for (const item of patches) {
      assert.equal(item.content_origin, 'manual');
      for (const key of provenanceKeys) assert.equal(item[key], previous[key], `${failure}: ${key}`);
    }
    const rebuilt = buildHistoricalContentItems({ state, originalPlan })[0];
    for (const key of provenanceKeys) assert.equal(rebuilt[key], previous[key], `rebuild: ${key}`);
  });
}

test('输入未变且成功章节不再产生初始化逐章 checkpoint', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村正文。\n# 服务保障\n保障正文。';
  state.historicalAdaptationContentItems = buildHistoricalContentItems({ state, originalPlan }).map((item) => ({
    ...item, status: 'success', content_origin: 'migrated', plan_id: 'same-plan',
  }));
  const patches = [];
  await runHistoricalAdaptationContentTask({ aiService: {},
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask() {}, checkpointTask: (_task, patch) => patches.push(patch) });
  assert.equal(patches.filter((patch) => patch?.historicalAdaptationContentItem).length, 0);
});

test('100 章 checkpoint 只传单章 patch 且小于 64 KiB', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges = [];
  state.outlineData.outline = Array.from({ length: 100 }, (_, index) => ({ id: String(index), title: `章节${index}` }));
  const originalPlan = state.outlineData.outline.map((leaf, index) => `# ${leaf.title}\n${index % 2 ? '开展农村、展农村、村辖区。' : '五峰村与五峰村。'}${'正文。'.repeat(395)}`).join('\n');
  const items = buildHistoricalContentItems({ state, originalPlan });
  assert.deepEqual(items.map((item) => item.recommended_mode), items.map((_, index) => index % 2 ? 'direct' : 'local-rewrite'));
  const events = [];
  await runHistoricalAdaptationContentTask({ aiService: { requestJson() { throw new Error('not needed'); } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    checkpointTask: (_task, patch, event) => events.push({ patch, event }), updateTask() {}, payload: {} });
  for (const event of events) {
    assert.equal(event.patch?.historicalAdaptationContentItems, undefined);
    assert.equal(event.event?.technicalPlanPatch?.outlineData, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(event), 'utf8') <= 65536);
  }
});

function baseState() {
  return {
    bidAnalysisTasks: completeBaseline,
    historicalAdaptationDifferenceConfirmedAt: '2026-10-01T08:00:00.000Z',
    historicalAdaptationOutlineConfirmedAt: '2026-10-01T09:00:00.000Z',
    historicalAdaptationDifferences: [{
      id: 'location', category: '名称地点替换', priority: 'high', title: '地点变更',
      historical_location: '项目概况', historical_excerpt: '五峰村', tender_requirement: '服务范围为横泾街道',
      action: '将五峰村统一改为横泾街道', note: '', decision: 'confirmed', content_change_scope: 'location-target',
      difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high',
      replacements: [{ old_value: '五峰村', new_value: '横泾街道' }], old_content_evidence: ['五峰村'],
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

function useLockedFragment(state, evidence = '五峰村') {
  Object.assign(state.historicalAdaptationDifferences[0], {
    target_action: 'rewrite-fragment', evidence_kind: 'locked-range', confidence: 'high',
    content_change_scope: 'none', replacements: [], old_content_evidence: [evidence],
  });
  return state;
}

test('重建同一输入保留待执行状态、计划 ID 和成功结果指纹', () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村正文。\n# 服务保障\n保障正文。';
  state.historicalAdaptationContentItems = buildHistoricalContentItems({ state, originalPlan }).map((item, index) => ({
    ...item, plan_id: 'original-plan', status: index ? 'success' : 'idle',
    content_origin: index ? 'migrated' : undefined, migration_output_hash: index ? 'output-hash' : '',
  }));
  const rebuilt = buildHistoricalContentItems({ state, originalPlan });
  assert.equal(rebuilt[0].status, 'idle');
  assert.equal(rebuilt[0].plan_id, 'original-plan');
  assert.equal(rebuilt[1].status, 'success');
  assert.equal(rebuilt[1].content_origin, 'migrated');
  assert.equal(rebuilt[1].migration_output_hash, 'output-hash');
});

test('低置信规则命中超过三成章节时在正文提交前阻断，高置信旧值不阻断', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村正文。\n# 服务保障\n五峰村保障。';
  state.historicalAdaptationDifferences[0].confidence = 'low';
  const patches = [];
  const options = { aiService: {}, workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    checkpointTask: (_task, patch) => patches.push(patch), updateTask() {} };
  await assert.rejects(runHistoricalAdaptationContentTask(options), /低置信/);
  assert.equal(patches.some((patch) => patch?.contentGenerationItem), false);
  state.historicalAdaptationDifferences[0].confidence = 'high';
  await runHistoricalAdaptationContentTask(options);
  assert.equal(patches.filter((patch) => patch?.contentGenerationItem).length, 2);
});

test('重试只处理原计划可重试章节，不重复成功或人工章节', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村正文。\n# 服务保障\n保障正文。';
  state.historicalAdaptationContentItems = buildHistoricalContentItems({ state, originalPlan }).map((item, index) => ({
    ...item, plan_id: 'retry-plan', status: index ? 'success' : 'error', error_code: index ? undefined : 'model-temporary',
  }));
  const patches = [];
  await runHistoricalAdaptationContentTask({ aiService: {}, workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: { retry: true }, checkpointTask: (_task, patch) => patches.push(patch), updateTask() {} });
  const outputs = patches.filter((patch) => patch?.contentGenerationItem);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].historicalAdaptationContentItem.plan_id, 'retry-plan');
  state.historicalAdaptationDifferences[0].replacements[0].new_value = '新街道';
  patches.length = 0;
  await runHistoricalAdaptationContentTask({ aiService: {}, workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: { retry: true }, checkpointTask: (_task, patch) => patches.push(patch), updateTask() {} });
  assert.equal(patches.some((patch) => patch?.contentGenerationItem), false);
  assert.equal(patches.find((patch) => patch?.historicalAdaptationContentItem?.node_id === '1').historicalAdaptationContentItem.status, 'stale');
});

test('只按完整旧值命中并直接迁移无关短语章节', () => {
  const state = baseState();
  state.outlineData.outline = [
    { id: '1', title: '项目概况' }, { id: '2', title: '服务保障' }, { id: '3', title: '工作安排' },
  ];
  const items = buildHistoricalContentItems({ state,
    originalPlan: '# 项目概况\n五峰村与五峰村。\n# 服务保障\n开展农村工作。\n# 工作安排\n村辖区服务。' });
  assert.deepEqual(items.map((item) => item.recommended_mode), ['local-rewrite', 'direct', 'direct']);
  assert.deepEqual(items[0].authorized_ranges.map((range) => range.occurrence), [1, 2]);
  assert.deepEqual(items[1].blocked_terms, []);
});

test('同章两处五峰村一键确定性替换且不调用 AI', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村与五峰村。开展农村服务。\n# 服务保障\n常态化响应。';
  const patches = [];
  let aiCount = 0;
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => { aiCount += 1; throw new Error('精确替换不应调用 AI'); } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });
  const content = patches.find((patch) => patch.contentGenerationItem?.nodeId === '1')?.contentGenerationItem.section.content;
  assert.equal(content, '横泾街道与横泾街道。开展农村服务。');
  assert.equal(aiCount, 0);
});

test('没有 v2 完整映射时不从旧地点描述猜测局改', () => {
  const state = baseState();
  delete state.historicalAdaptationDifferences[0].difference_schema_version;
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 项目概况\n五峰村原项目概况。' });
  assert.notEqual(item.recommended_mode, 'local-rewrite');
});

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

test('已确认旧值即使 scope 为 none 也按结构化映射局改', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村共100宗，计划2026年6月启动。\n\n# 服务保障\n建立常态化响应机制。';
  state.historicalAdaptationDifferences = [
    { ...state.historicalAdaptationDifferences[0], content_change_scope: 'location-target' },
    { ...state.historicalAdaptationDifferences[0], id: 'workload', category: '数据更新', title: '工作量调整', historical_excerpt: '100宗', tender_requirement: '200宗', action: '以新清单200宗为准', content_change_scope: 'workload', replacements: [{ old_value: '100宗', new_value: '200宗' }], old_content_evidence: ['100宗'] },
    { ...state.historicalAdaptationDifferences[0], id: 'schedule', category: '工期进度更新', title: '启动时间调整', historical_excerpt: '2026年6月启动', tender_requirement: '2026年10月启动', action: '重新编排启动时间', content_change_scope: 'schedule', replacements: [{ old_value: '2026年6月', new_value: '2026年10月' }], old_content_evidence: ['2026年6月'] },
  ];
  state.historicalAdaptationOutlineChanges[0].difference_ids = ['location', 'workload', 'schedule'];
  const oldState = { ...state, historicalAdaptationDifferences: state.historicalAdaptationDifferences.map((item) => ({ ...item, content_change_scope: 'none' })) };
  const oldPlan = buildHistoricalContentItems({ state: oldState, originalPlan });
  assert.equal(oldPlan[0].recommended_mode, 'local-rewrite');
  // Persisted direct-migration plans from the old release have already completed.
  state.historicalAdaptationContentItems = oldPlan.map(({ source_content: _sourceContent, ...item }) => ({
    ...item, recommended_mode: 'direct', status: 'success', content_origin: 'migrated',
  }));
  const refreshed = buildHistoricalContentItems({ state, originalPlan });
  assert.equal(refreshed[0].recommended_mode, 'local-rewrite');
  assert.notEqual(refreshed[0].input_fingerprint, oldPlan[0].input_fingerprint);
  assert.notEqual(refreshed[0].status, 'success');
  assert.equal(refreshed[1].recommended_mode, 'direct');

  const requests = [];
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => {
      requests.push(request);
      return { edits: [
        { old_text: '五峰村', new_text: '横泾街道' },
        { old_text: '100宗', new_text: '200宗' },
        { old_text: '2026年6月', new_text: '2026年10月' },
      ] };
    } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });
  assert.equal(requests.length, 0);
  const rewritten = patches.find((patch) => patch.contentGenerationItem?.nodeId === '1')?.contentGenerationItem.section.content;
  assert.match(rewritten, /横泾街道共200宗，计划2026年10月启动/);
  assert.equal(patches.findLast((patch) => patch.historicalAdaptationContentItem?.node_id === '1')?.historicalAdaptationContentItem.content_origin, 'local-rewrite');
});

test('旧方案已应用的人工迁移方式在自动范围兼容升级后仍保留', () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村原项目概况。';
  const legacyState = { ...state, historicalAdaptationDifferences: state.historicalAdaptationDifferences.map((item) => ({ ...item, content_change_scope: 'none' })) };
  const oldItem = buildHistoricalContentItems({ state: legacyState, originalPlan })[0];
  state.historicalAdaptationContentItems = [{
    ...oldItem, manual_mode: 'direct', status: 'success', content_origin: 'migrated',
  }];
  const updated = buildHistoricalContentItems({ state, originalPlan })[0];
  assert.equal(updated.recommended_mode, 'local-rewrite');
  assert.equal(updated.manual_mode, 'direct');
  assert.equal(updated.status, 'success');
});

test('scope 升级保留人工局改和定向改写选择但要求重新执行', () => {
  const originalPlan = '# 项目概况\n五峰村原项目概况。';
  for (const manualMode of ['local-rewrite', 'rewrite']) {
    const state = baseState();
    const legacyState = { ...state, historicalAdaptationDifferences: state.historicalAdaptationDifferences.map((item) => ({ ...item, content_change_scope: 'none' })) };
    const oldItem = buildHistoricalContentItems({ state: legacyState, originalPlan })[0];
    state.historicalAdaptationContentItems = [{
      ...oldItem,
      manual_mode: manualMode,
      manual_instruction: manualMode === 'rewrite' ? '按人工要求调整' : '',
      status: 'success',
      content_origin: manualMode === 'rewrite' ? 'ai-rewrite' : 'local-rewrite',
    }];
    const updated = buildHistoricalContentItems({ state, originalPlan })[0];
    assert.equal(updated.manual_mode, manualMode);
    assert.notEqual(updated.status, 'success');
  }
});

test('人工直迁来源未变时保留成功结果，来源变更则必须重迁', () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村原项目概况。';
  const item = buildHistoricalContentItems({ state, originalPlan })[0];
  state.historicalAdaptationContentItems = [{ ...item, manual_mode: 'direct', status: 'success', content_origin: 'migrated' }];
  state.bidAnalysisTasks = { ...state.bidAnalysisTasks, changed: { status: 'success', content: '新基线' } };
  const updated = buildHistoricalContentItems({ state, originalPlan })[0];
  assert.equal(updated.manual_mode, 'direct');
  assert.equal(updated.status, 'success');
  assert.notEqual(updated.input_fingerprint, item.input_fingerprint);
  const changedSource = buildHistoricalContentItems({ state, originalPlan: '# 项目概况\n新来源正文。' })[0];
  assert.equal(changedSource.status, 'stale');
});

test('金额人员设备和无明确地点证据的旧 none 差异不触发自动改写', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [
    { ...state.historicalAdaptationDifferences[0], id: 'name', title: '项目名称更新', historical_excerpt: '旧项目名称', action: '变更项目名称', content_change_scope: 'none' },
    { ...state.historicalAdaptationDifferences[0], id: 'staff', category: '数据更新', title: '人员配备', historical_excerpt: '10人', tender_requirement: '12人', action: '增加人员', content_change_scope: 'none' },
    { ...state.historicalAdaptationDifferences[0], id: 'amount', category: '数据更新', title: '预算金额', historical_excerpt: '10万元', tender_requirement: '12万元', action: '调整金额', content_change_scope: 'none' },
  ];
  state.historicalAdaptationOutlineChanges[0].difference_ids = ['name', 'staff', 'amount'];
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 项目概况\n旧项目名称需10人，费用10万元。' });
  assert.equal(item.recommended_mode, 'direct');
});

test('显式 none 即使文本像工作量也保持直接迁移且不调用 AI', async () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [{
    ...state.historicalAdaptationDifferences[0], category: '数据更新', title: '工作量调整',
    historical_excerpt: '原有100宗', tender_requirement: '按新清单200宗执行',
    action: '调整工作量，人员和设备另行确认', content_change_scope: 'none',
  }];
  const originalPlan = '# 项目概况\n原有100宗。';
  const [item] = buildHistoricalContentItems({ state, originalPlan });
  assert.equal(item.recommended_mode, 'direct');
  let requestCount = 0;
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => { requestCount += 1; return { edits: [] }; } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: {}, updateTask: () => {}, checkpointTask: () => {},
  });
  assert.equal(requestCount, 0);
});

test('显式 none 的高置信完整旧值仍全局精确传播', () => {
  const state = baseState();
  state.historicalAdaptationDifferences[0].content_change_scope = 'none';
  state.historicalAdaptationOutlineChanges[0].difference_ids = [];
  const items = buildHistoricalContentItems({
    state,
    originalPlan: '# 项目概况\n五峰村需开展农村不动产登记工作。\n\n# 服务保障\n建立常态化响应机制。',
  });
  assert.equal(items[0].recommended_mode, 'local-rewrite');
  assert.deepEqual(items[0].difference_ids, ['location']);
  assert.equal(items[1].recommended_mode, 'direct');
});

test('历史残留扫描识别旧地点并忽略已替换内容', () => {
  const item = { blocked_terms: ['五峰村', '村级'] };
  assert.deepEqual(scanHistoricalResiduals('服务地点为五峰村，由村级人员协调。', item), ['五峰村', '村级']);
  assert.deepEqual(scanHistoricalResiduals('服务地点为横泾街道。', item), []);
});

test('长差异摘录仍提取具体旧地点而不吞并后续村级表述', () => {
  const state = baseState();
  state.historicalAdaptationDifferences[0] = {
    ...state.historicalAdaptationDifferences[0],
    historical_excerpt: '“五峰村需开展农村不动产登记颁证工作”“五峰村开展农房不动产测绘和登记颁证”“在五峰村村级公告栏张贴领证公告”',
  };
  const [item] = buildHistoricalContentItems({
    state,
    originalPlan: '# 项目概况\n完成登记后，五峰村农民可以依法办理产权流转。',
  });

  assert.equal(item.blocked_terms.includes('五峰村'), true);
  assert.deepEqual(scanHistoricalResiduals('完成登记后，五峰村农民可以依法办理产权流转。', item), ['五峰村']);
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
    difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high',
    replacements: [{ old_value: '2026年6月', new_value: '2026年10月' }],
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
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 项目进度\n## 实施阶段\n2026年6月启动，服务期三年。' });
  assert.equal(item.recommended_mode, 'local-rewrite');
  assert.deepEqual(item.difference_ids, ['schedule']);
  assert.deepEqual(item.blocked_terms, ['2026年6月']);
});

test('旧目录仅父标题改名时按父节点原路径迁移子节点', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  state.historicalAdaptationOutlineChanges = [{
    id: 'parent', change_type: 'renamed', original_path: '五峰村目标', target_node_id: '1',
    target_title: '横泾街道目标', reason: '地点变化', difference_ids: [],
  }];
  state.outlineData = { outline: [{ id: '1', title: '横泾街道目标', children: [
    { id: '1.1', title: '保障群众合法权益', content_mode: 'ai-generate' },
  ] }] };
  const [item] = buildHistoricalContentItems({ state,
    originalPlan: '# 五峰村目标\n## 保障群众合法权益\n应保障合法权益。' });
  assert.equal(item.source_path, '五峰村目标 / 保障群众合法权益');
  assert.equal(item.source_content, '应保障合法权益。');
  assert.equal(item.recommended_mode, 'direct');
});

test('多个历史来源候选或重复路径不自动绑定子节点正文', () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  state.outlineData = { outline: [{ id: '1', title: '新目标', children: [
    { id: '1.1', title: '保障措施', content_mode: 'ai-generate' },
  ] }] };
  state.historicalAdaptationOutlineChanges = [{
    id: 'parent', change_type: 'renamed', original_path: '原目标甲；原目标乙', target_node_id: '1',
    target_title: '新目标', reason: '整合目录', difference_ids: [],
  }];
  const [item] = buildHistoricalContentItems({ state, originalPlan:
    '# 原目标甲\n## 保障措施\n甲正文。\n# 原目标乙\n## 保障措施\n乙正文。' });
  assert.equal(item.recommended_mode, null);
  assert.equal(item.source_content, '');
  assert.equal(item.source_path, '');
});

test('旧日期和旧工作量会在所有历史正文中全局阻断', () => {
  const state = baseState();
  state.historicalAdaptationDifferences.push(
    {
      id: 'schedule', category: '工期进度更新', priority: 'high', title: '进度更新',
      historical_location: '实施计划', historical_excerpt: '2026年6月启动',
      tender_requirement: '2026年10月启动', action: '更新启动时间', note: '', decision: 'confirmed', content_change_scope: 'schedule',
      difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high',
      replacements: [{ old_value: '2026年6月', new_value: '2026年10月' }],
    },
    {
      id: 'workload', category: '数据更新', priority: 'high', title: '工作量更新',
      historical_location: '工作量统计', historical_excerpt: '预计办理1500户',
      tender_requirement: '以横泾街道实际清单为准', action: '更新工作量', note: '', decision: 'confirmed', content_change_scope: 'workload',
      difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high',
      replacements: [{ old_value: '1500户', new_value: '实际清单' }],
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

test('新增父目录下的同名叶子章节默认定向改写而不复用历史正文', () => {
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

  assert.equal(item.recommended_mode, 'rewrite');
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

  assert.equal(aiCalls.length, 0);
  const contentUpdates = patches.filter((patch) => patch.contentGenerationItem?.section?.content);
  assert.equal(contentUpdates.length, 2);
  assert.match(contentUpdates.find((patch) => patch.contentGenerationItem.nodeId === '1').contentGenerationItem.section.content, /横泾街道/);
  assert.match(contentUpdates.find((patch) => patch.contentGenerationItem.nodeId === '2').contentGenerationItem.section.content, /常态化响应机制/);
  assert.equal(eventPatches.some((patch) => patch.outlineContentPatch?.nodeId === '1' && patch.outlineContentPatch?.content?.includes('横泾街道')), true);
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

test('重建方案时输入指纹变化保留人工策略与正文但标记待复核', () => {
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

  assert.equal(rebuilt[0].manual_mode, 'rewrite');
  assert.equal(rebuilt[0].manual_instruction, '只修改服务对象说明');
  assert.equal(rebuilt[0].content_origin, 'manual');
  assert.equal(rebuilt[0].status, 'review');
});

test('无可证明结构化规则的已确认差异不能直接迁移关联章节', () => {
  const state = baseState();
  delete state.historicalAdaptationDifferences[0].difference_schema_version;
  const [item] = buildHistoricalContentItems({ state, originalPlan: '# 项目概况\n五峰村原项目概况。' });
  assert.equal(item.recommended_mode, null);
  assert.equal(item.status, 'review');
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
  const completed = patches.filter((patch) => patch.historicalAdaptationContentItem?.status === 'success').map((patch) => patch.historicalAdaptationContentItem);
  assert.deepEqual(completed.map((item) => item.content_origin), ['ai-rewrite', 'ai-rewrite']);
  assert.match(aiCalls[0].messages[0].content, /按人工要求定向改写/);
  assert.match(aiCalls[1].messages[0].content, /依据招标基线和人工要求补充正文/);
  assert.match(aiCalls[1].messages[0].content, /补充横泾服务保障机制/);
});

test('一键建立只纳入当前刚应用的 stale 定向改写，不自动覆盖其他待手工章节', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n原项目概况。\n\n# 服务保障\n原保障内容。';
  state.historicalAdaptationContentItems = buildHistoricalContentItems({ state, originalPlan })
    .map(({ source_content: _sourceContent, ...item }) => ({ ...item, manual_mode: 'rewrite', manual_instruction: '按当前招标要求改写', status: 'stale' }));
  const completed = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ content: '已按要求改写。' }) },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: { includeNodeId: '1' }, updateTask() {},
    checkpointTask(_task, patch) {
      if (patch?.historicalAdaptationContentItem?.status === 'success') completed.push(patch.historicalAdaptationContentItem.node_id);
    },
  });
  assert.deepEqual(completed, ['1']);
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

test('新增章节自动推荐提纲但不生成正文，人工定向改写缺少要求时拒绝执行', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added' });
  const originalPlan = '# 项目概况\n原项目概况。\n\n# 服务保障\n原保障内容。';
  let planned = buildHistoricalContentItems({ state, originalPlan });
  const aiCalls = [];
  const options = {
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { instruction: '1. 服务流程\n2. 保障措施' }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '2' }, updateTask: () => {}, checkpointTask: () => {},
  };
  await runHistoricalAdaptationContentTask(options);
  assert.equal(aiCalls.length, 1);
  planned = planned.map((item) => item.node_id === '2' ? { ...item, manual_mode: 'rewrite', manual_instruction: '' } : item);
  await assert.rejects(runHistoricalAdaptationContentTask(options), /缺少人工定向改写要求/);
  assert.equal(aiCalls.length, 1);
});

test('指定空历史正文章节只生成定向改写提纲，不处理其他章节或生成正文', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n\n# 服务保障\n历史保障正文。';
  const planned = buildHistoricalContentItems({ state, originalPlan });
  const aiCalls = [];
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { instruction: '1. 补充项目概况响应边界\n2. 说明实施流程与保障机制' }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { recommendationsOnly: true, includeNodeId: '1' }, updateTask() {},
    checkpointTask(_task, patch) { if (patch) patches.push(patch); },
  });
  assert.equal(aiCalls.length, 1);
  const saved = patches.find((patch) => patch.historicalAdaptationContentItem?.node_id === '1')?.historicalAdaptationContentItem;
  assert.equal(saved.recommended_instruction, '1. 补充项目概况响应边界\n2. 说明实施流程与保障机制');
  assert.equal(saved.status, 'review');
  assert.equal(patches.some((patch) => patch.contentGenerationItem), false);
  assert.equal(patches.some((patch) => patch.historicalAdaptationContentItem?.node_id === '2'), false);
});

test('推荐模式使用章节说明、基线和已确认差异生成提纲，并同步迁移可自动处理正文', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added', reason: '新增保障内容', difference_ids: ['location'] });
  state.outlineData.outline[1].description = '明确响应流程和质量保障';
  const patches = [];
  const aiCalls = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { instruction: '1. 服务响应流程\n2. 质量保障措施' }; } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => '# 项目概况\n旧正文。' },
    payload: { recommendationsOnly: true }, updateTask() {}, checkpointTask(_task, patch) { if (patch) patches.push(patch); },
  });
  assert.ok(aiCalls.length >= 1);
  assert.match(aiCalls[0].messages[0].content, /服务保障/);
  assert.match(aiCalls[0].messages[0].content, /明确响应流程和质量保障/);
  assert.match(aiCalls[0].messages[0].content, /横泾街道/);
  assert.match(aiCalls[0].messages[0].content, /projectOverview|项目概况/);
  const saved = patches.find((patch) => patch.historicalAdaptationContentItem?.recommended_instruction)?.historicalAdaptationContentItem;
  assert.equal(saved.recommended_instruction, '1. 服务响应流程\n2. 质量保障措施');
  assert.equal(saved.recommended_mode, 'rewrite');
  assert.equal(saved.manual_mode, undefined);
  assert.equal(saved.manual_instruction, '');
  assert.equal(saved.status, 'review');
  assert.ok(patches.some((patch) => patch.contentGenerationItem?.nodeId === '1'));
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.nodeId === '2'), false);
});

test('自动准备新增章节提纲时同时迁移可直接迁移的既有章节', async () => {
  const state = baseState();
  state.historicalAdaptationDifferences = [];
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added', reason: '新增保障内容' });
  const originalPlan = '# 项目概况\n历史项目概况。';
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ instruction: '1. 服务响应流程' }) },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: { recommendationsOnly: true }, updateTask() {}, checkpointTask(_task, patch) { if (patch) patches.push(patch); },
  });
  assert.equal(patches.find((patch) => patch.contentGenerationItem?.nodeId === '1')?.contentGenerationItem.section.content, '历史项目概况。');
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.nodeId === '2'), false);
});

test('自动准备新增章节提纲时同时执行既有章节局部改写', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added', reason: '新增保障内容' });
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ instruction: '1. 服务响应流程' }) },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => '# 项目概况\n五峰村历史项目概况。' },
    payload: { recommendationsOnly: true }, updateTask() {}, checkpointTask(_task, patch) { if (patch) patches.push(patch); },
  });
  assert.equal(patches.find((patch) => patch.contentGenerationItem?.nodeId === '1')?.contentGenerationItem.section.content, '横泾街道历史项目概况。');
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.nodeId === '2'), false);
});

test('重建保留推荐提纲且人工要求优先，再次批量建立不重新推荐或覆盖人工正文', async () => {
  const state = baseState();
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added' });
  const originalPlan = '# 项目概况\n原正文。';
  state.historicalAdaptationContentItems = buildHistoricalContentItems({ state, originalPlan }).map((item) => ({
    ...item, status: item.node_id === '1' ? 'success' : item.status,
    recommended_instruction: item.node_id === '2' ? '1. 推荐保障提纲' : '',
  }));
  const [_, added] = buildHistoricalContentItems({ state, originalPlan });
  assert.equal(added.recommended_instruction, '1. 推荐保障提纲');
  assert.equal(normalizeHistoricalAdaptationContentItems([added])[0].recommended_instruction, added.recommended_instruction);
  const patches = [];
  await runHistoricalAdaptationContentTask({ aiService: { requestJson: async () => { assert.fail('已有提纲不应重复调用模型'); } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => originalPlan },
    payload: { recommendationsOnly: true }, updateTask() {}, checkpointTask(_task, patch) { if (patch) patches.push(patch); },
  });
  assert.ok(patches.every((patch) => !patch.contentGenerationItem));
  state.historicalAdaptationContentItems[1] = { ...added, manual_mode: 'rewrite', manual_instruction: '校核后仅写响应机制', status: 'success', content_origin: 'manual' };
  state.outlineData.outline[1].description = '目录说明调整';
  const rebuilt = buildHistoricalContentItems({ state, originalPlan })[1];
  assert.equal(rebuilt.manual_instruction, '校核后仅写响应机制');
  assert.equal(rebuilt.content_origin, 'manual');
});

test('推荐失败保留待处理状态且后续建立可重试，忽略差异不进入推荐依据', async () => {
  const state = baseState();
  state.historicalAdaptationDifferences.push({ id: 'ignored', decision: 'ignored', action: '不得进入推荐的差异' });
  state.historicalAdaptationOutlineChanges.push({ target_node_id: '2', change_type: 'added', difference_ids: ['location', 'ignored'] });
  let fail = true;
  const options = {
    aiService: { requestJson: async (request) => {
      assert.doesNotMatch(request.messages[0].content, /不得进入推荐的差异/);
      if (fail) throw new Error('模型暂时不可用');
      return { instruction: '1. 保障机制' };
    } },
    workspaceStore: { loadTechnicalPlan: () => state, readOriginalPlanMarkdown: () => '# 项目概况\n旧正文。' },
    payload: { recommendationsOnly: true }, updateTask() {},
    checkpointTask(_task, patch) {
      if (patch?.historicalAdaptationContentItem) {
        const item = patch.historicalAdaptationContentItem;
        state.historicalAdaptationContentItems = [...(state.historicalAdaptationContentItems || []).filter((entry) => entry.node_id !== item.node_id), item];
      }
      assert.ok(!patch?.contentGenerationItem);
    },
  };
  await runHistoricalAdaptationContentTask(options);
  let added = state.historicalAdaptationContentItems.find((item) => item.node_id === '2');
  assert.equal(added.status, 'review');
  assert.match(added.error, /提纲.*模型暂时不可用/);
  fail = false;
  await runHistoricalAdaptationContentTask(options);
  added = state.historicalAdaptationContentItems.find((item) => item.node_id === '2');
  assert.equal(added.recommended_instruction, '1. 保障机制');
  assert.equal(added.error, undefined);
  assert.equal(added.error_code, undefined);
});

test('局部改写任一替换不唯一时不应用任何编辑并进入待复核', async () => {
  const state = useLockedFragment(baseState());
  const originalPlan = '# 项目概况\n五峰村与五峰村均为旧地点。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const patches = [];
  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ edits: [{ old_text: '五峰村', new_text: '横泾街道' }] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch, eventPatch) => { if (patch) patches.push({ ...patch, ...eventPatch }); },
  });
  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.match(completed.error, /multiple|多处|唯一/u);
  assert.equal(completed.content_origin, 'migrated');
  const fallback = patches.findLast((patch) => patch.contentGenerationItem?.nodeId === '1');
  assert.equal(fallback.contentGenerationItem.section.content, '五峰村与五峰村均为旧地点。');
  assert.equal(fallback.outlineContentPatch.content, '五峰村与五峰村均为旧地点。');
});

test('局部改写片段首次未命中时带校验错误重试并应用修正结果', async () => {
  const state = useLockedFragment(baseState(), '旧服务方式');
  const originalPlan = '# 项目概况\n旧服务方式原项目概况。保留既有工作流程和服务保障措施。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const aiCalls = [];
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => {
      aiCalls.push(request);
      return aiCalls.length === 1
        ? { edits: [{ old_text: '不存在的服务方式', new_text: '新服务方式' }] }
        : { edits: [{ old_text: '旧服务方式', new_text: '新服务方式' }] };
    } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  assert.equal(aiCalls.length, 2);
  assert.match(aiCalls[1].messages[0].content, /上次返回的替换未通过校验/u);
  assert.match(aiCalls[1].messages[0].content, /Could not find oldText/u);
  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'success');
  assert.equal(completed.content_origin, 'local-rewrite');
  assert.match(patches.find((patch) => patch.contentGenerationItem)?.contentGenerationItem.section.content, /新服务方式原项目概况/u);
});

test('局部改写请求校验模型必须返回非空 edits 数组', async () => {
  const state = useLockedFragment(baseState(), '旧服务方式');
  const originalPlan = '# 项目概况\n旧服务方式原项目概况。保留既有工作流程和服务保障措施。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  let localRewriteRequest;

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { localRewriteRequest = request; const response = { edits: [{ old_text: '旧服务方式', new_text: '新服务方式' }] }; request.validator(response); return response; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: () => {},
  });

  assert.throws(() => localRewriteRequest.validator({ content: '横泾街道' }), /edits/u);
  assert.doesNotThrow(() => localRewriteRequest.validator({ edits: [{ old_text: '旧服务方式', new_text: '新服务方式' }] }));
});

test('局部改写返回其他合法 JSON 时会要求模型纠正结构', async () => {
  const state = useLockedFragment(baseState(), '旧服务方式');
  const originalPlan = '# 项目概况\n旧服务方式原项目概况。保留既有工作流程和服务保障措施。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const aiCalls = [];
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => {
      aiCalls.push(request);
      const response = aiCalls.length === 1
        ? { content: '新服务方式原项目概况。' }
        : { edits: [{ old_text: '旧服务方式', new_text: '新服务方式' }] };
      request.validator(response);
      return response;
    } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  assert.equal(aiCalls.length, 2);
  assert.match(aiCalls[1].messages[0].content, /非空 edits 数组/u);
  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'success');
});

test('局部改写兼容 replacements 和 oldText/newText 别名', async () => {
  const state = baseState();
  const originalPlan = '# 项目概况\n五峰村原项目概况。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ replacements: [{ oldText: '五峰村', newText: '横泾街道' }] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'success');
  assert.equal(completed.content_origin, 'local-rewrite');
  assert.match(patches.find((patch) => patch.contentGenerationItem)?.contentGenerationItem.section.content, /横泾街道原项目概况/u);
});

test('局部改写模型误返完整正文时保留来源正文并进入待复核', async () => {
  const state = useLockedFragment(baseState());
  state.historicalAdaptationOriginalOutline = state.outlineData;
  const originalPlan = '# 项目概况\n五峰村原项目概况。\n服务地点仍需明确。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const aiCalls = [];
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { content: '横泾街道原项目概况。\n服务地点改为横泾街道。' }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  assert.equal(aiCalls.length, 2);
  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.equal(completed.content_origin, 'migrated');
  assert.match(completed.error, /edits|局部替换/u);
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.section?.content === '五峰村原项目概况。\n服务地点仍需明确。'), true);
});

test('局部改写拒绝用单个 edit 替换整个来源正文', async () => {
  const state = useLockedFragment(baseState());
  state.historicalAdaptationOriginalOutline = state.outlineData;
  const sourceContent = '五峰村原项目概况。\n保留既有服务流程和保障措施。';
  const originalPlan = `# 项目概况\n${sourceContent}\n\n# 服务保障\n原保障内容。`;
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ edits: [{ old_text: sourceContent, new_text: '横泾街道全新项目概况。' }] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.match(completed.error, /non-local-edit/u);
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.section?.content === sourceContent), true);
});

test('地点局改拒绝夹带工作量人员设备和金额事实变化', async () => {
  const state = useLockedFragment(baseState());
  state.historicalAdaptationOriginalOutline = state.outlineData;
  const changedParagraph = '五峰村项目共100宗，配置10人、2台设备，预算20万元。';
  state.historicalAdaptationDifferences[0].old_content_evidence = [changedParagraph];
  const sourceContent = `${changedParagraph}\n${'既有服务流程保持不变。'.repeat(30)}`;
  const originalPlan = `# 项目概况\n${sourceContent}\n\n# 服务保障\n原保障内容。`;
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const patches = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async () => ({ edits: [{
      old_text: changedParagraph,
      new_text: '横泾街道项目共200宗，配置12人、3台设备，预算30万元。',
    }] }) },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: (_task, patch) => { if (patch) patches.push(patch); },
  });

  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.match(completed.error, /100宗|10人|2台|20万元|事实/u);
  assert.equal(patches.some((patch) => patch.contentGenerationItem?.section?.content === sourceContent), true);
});

test('局部改写修复提示包含来源正文允许差异和校验错误', async () => {
  const state = useLockedFragment(baseState());
  const sourceContent = '五峰村原项目概况。';
  const originalPlan = `# 项目概况\n${sourceContent}\n\n# 服务保障\n原保障内容。`;
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  let localRewriteRequest;

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { localRewriteRequest ||= request; return { edits: [{ old_text: '五峰村', new_text: '横泾街道' }] }; } },
    workspaceStore: { loadTechnicalPlan: () => ({ ...state, historicalAdaptationContentItems: planned }), readOriginalPlanMarkdown: () => originalPlan },
    payload: { nodeId: '1' }, updateTask: () => {}, checkpointTask: () => {},
  });

  const messages = localRewriteRequest.repairMessagesBuilder({
    invalidContent: '{"content":"横泾街道原项目概况。"}',
    issues: ['返回结果必须包含非空 edits 数组'],
    progressLabel: '局部改写结果',
  });
  const repairPrompt = messages.map((message) => message.content).join('\n');
  assert.match(repairPrompt, /历史正文：\n五峰村\n/u);
  assert.doesNotMatch(repairPrompt, /历史正文：\n五峰村原项目概况/u);
  assert.match(repairPrompt, /地点变更/u);
  assert.match(repairPrompt, /返回结果必须包含非空 edits 数组/u);
  assert.match(repairPrompt, /横泾街道原项目概况/u);
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
  const state = useLockedFragment(baseState(), '旧服务方式');
  state.historicalAdaptationDifferences.push({
    id: 'manual-only', category: '其他人工判断', priority: 'high', title: '不得自动处理的人员配置',
    historical_location: '项目概况', historical_excerpt: '原人员配置', tender_requirement: '需人工判断',
    action: '仅人工决定是否改写', note: '', decision: 'ignored', content_change_scope: 'none',
  });
  state.historicalAdaptationOutlineChanges[0].difference_ids = ['location', 'manual-only'];
  const originalPlan = '# 项目概况\n旧服务方式原项目概况，原人员配置保持不变。保留既有工作流程和服务保障措施。\n\n# 服务保障\n原保障内容。';
  const planned = buildHistoricalContentItems({ state, originalPlan }).map(({ source_content: _sourceContent, ...item }) => item);
  const aiCalls = [];

  await runHistoricalAdaptationContentTask({
    aiService: { requestJson: async (request) => { aiCalls.push(request); return { edits: [{ old_text: '旧服务方式', new_text: '新服务方式' }] }; } },
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

  const completed = patches.findLast((patch) => patch.historicalAdaptationContentItem)?.historicalAdaptationContentItem;
  assert.equal(completed.status, 'review');
  assert.match(completed.error, /待核实|待补充/);
});
