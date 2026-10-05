const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskService } = require('./taskService.cjs');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');

const completeBaseline = Object.fromEntries(getBidAnalysisTasks('full').map((item) => [item.id, {
  status: 'success', content: `${item.label}内容`,
}]));

async function waitUntil(predicate, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('等待异步任务状态超时');
}

function makeHarness({ projectType = 'historical-bid-adaptation', initialState = {}, holdOutline = false, holdContent = false, holdContentAfterChapter = false, holdContentCheck = false, terminalContentStatus } = {}) {
  let state = {
    workflowKind: 'existing-plan-expansion',
    bidAnalysisTasks: completeBaseline,
    historicalAdaptationDifferences: [{ id: 'difference-1', decision: 'confirmed' }],
    historicalAdaptationDifferenceConfirmedAt: '2026-09-30T08:00:00.000Z',
    historicalAdaptationDifferenceTask: {
      task_id: 'difference-complete',
      type: 'historical-adaptation-difference',
      status: 'success',
      progress: 100,
      logs: [],
    },
    historicalAdaptationOutlineConfirmedAt: '2026-10-01T09:00:00.000Z',
    outlineData: { outline: [{ id: '1', title: '适配目录', content_mode: 'ai-generate' }] },
    ...initialState,
  };
  let project = {
    projectId: 'historical-project',
    projectName: '横泾街道历史标书适配',
    projectType,
    status: 'incomplete',
  };
  const updates = [];
  const savedDifferences = [];
  const events = [];
  const runnerCalls = { bidAnalysis: [], difference: [], outline: [], content: [], contentCheck: [] };
  const preparations = [];
  const heldRuns = [];
  const holdRun = (taskControl) => new Promise((resolve) => {
    heldRuns.push({ signal: taskControl.signal, release: resolve });
  });
  const store = {
    loadTechnicalPlan: () => state,
    readOriginalPlanMarkdown: () => initialState.originalPlanMarkdown === '' ? '' : '# 历史标书\n## 原目录',
    updateTechnicalPlanWithoutReload(patch) {
      updates.push(patch);
      state = { ...state, ...patch };
      delete state.historicalAdaptationContentItem;
      delete state.contentGenerationItem;
      if (patch.historicalAdaptationContentItem) {
        const item = patch.historicalAdaptationContentItem;
        state.historicalAdaptationContentItems = [
          ...(state.historicalAdaptationContentItems || []).filter((candidate) => candidate.node_id !== item.node_id), item,
        ];
      }
      if (patch.contentGenerationItem) {
        const { nodeId, section } = patch.contentGenerationItem;
        const updateNodes = (nodes) => nodes.map((node) => ({
          ...node,
          ...(node.id === nodeId ? { content: section.content } : {}),
          ...(node.children ? { children: updateNodes(node.children) } : {}),
        }));
        state.outlineData = { ...state.outlineData, outline: updateNodes(state.outlineData.outline) };
      }
    },
    saveHistoricalAdaptationDifferences(payload) {
      savedDifferences.push(payload.differences);
      state = { ...state, historicalAdaptationDifferences: payload.differences };
      return state;
    },
    saveHistoricalAdaptationOutline(payload) {
      state = { ...state, outlineData: payload.outlineData };
      return state;
    },
    prepareHistoricalAdaptationContentPlan() {
      preparations.push(true);
      state = { ...state, historicalAdaptationContentItems: [{ node_id: '1', recommended_mode: 'direct', status: 'idle' }] };
      return state;
    },
    getHistoricalAdaptationContentCheckContext: () => ({
      contentHash: 'content-hash', inputsHash: 'inputs-hash', baseline: '当前招标基线',
      outlineData: state.outlineData,
      items: state.historicalAdaptationContentItems || [],
    }),
  };
  const bidProjectManager = {
    listProjects: () => [project],
    getCurrentProjectId: () => project.projectId,
    getProject: (projectId) => (projectId === project.projectId ? project : null),
    getTechnicalPlanStore: () => store,
    updateProject(projectId, patch) {
      assert.equal(projectId, project.projectId);
      project = { ...project, ...patch };
      return project;
    },
    getProjectStore: () => ({ listPendingAutomaticUniquenessProjects: () => [] }),
  };
  const service = createTaskService({
    aiService: {},
    agentService: {
      bindTaskContext: () => ({}),
      isPrimarySession: () => false,
      deletePersistentTask() {},
      loadPersistentTask: () => null,
      hasPersistentTaskSession: () => false,
    },
    autoConfirmationService: { register() {}, unregister() {}, suppress() {} },
    technicalPlanStore: store,
    bidProjectManager,
    rejectionCheckStore: { loadRejectionCheck: () => ({}) },
    duplicateCheckStore: { loadDuplicateCheck: () => ({}) },
    feasibilityReportStore: { loadFeasibilityReport: () => ({}) },
    knowledgeBaseService: {},
    remoteKnowledgeDecisionService: { onDecision: () => () => {} },
    duplicateCheckService: {},
    openXmlHelperService: {},
    taskRunners: {
      bidAnalysis: async ({ payload, checkpointTask }) => {
        runnerCalls.bidAnalysis.push(payload);
        checkpointTask({ status: 'success', progress: 100, logs: [] });
      },
      historicalAdaptationDifference: async ({ payload, checkpointTask }) => {
        runnerCalls.difference.push(payload);
        checkpointTask(
          { status: 'success', progress: 100, logs: [] },
          {
            historicalAdaptationDifferences: [{ id: 'difference-new', decision: 'pending' }],
            historicalAdaptationDifferenceConfirmedAt: undefined,
          },
        );
      },
      historicalAdaptationOutline: async ({ payload, checkpointTask, taskControl }) => {
        runnerCalls.outline.push(payload);
        if (holdOutline) {
          await new Promise((resolve, reject) => {
            taskControl.signal.addEventListener('abort', () => reject(taskControl.signal.reason), { once: true });
          });
        }
        checkpointTask(
          { status: 'success', progress: 100, logs: [] },
          {
            historicalAdaptationOriginalOutline: { outline: [{ id: '1', title: '原目录' }] },
            historicalAdaptationOutlineChanges: [{
              id: 'rename-1', change_type: 'renamed', original_path: '原目录', target_node_id: '1',
              target_title: '新目录', reason: '按差异修改', difference_ids: ['difference-1'],
            }],
            historicalAdaptationOutlineConfirmedAt: null,
            outlineData: { outline: [{ id: '1', title: '新目录' }] },
          },
        );
      },
      historicalAdaptationContent: async ({ payload, checkpointTask, taskControl }) => {
        runnerCalls.content.push(payload);
        if (terminalContentStatus) {
          if (runnerCalls.content.length === 1) {
            checkpointTask({ status: terminalContentStatus, progress: 100, logs: [] });
            await holdRun(taskControl);
            return;
          }
          await holdRun(taskControl);
        }
        if (holdContent && runnerCalls.content.length === 1) await holdRun(taskControl);
        checkpointTask({ status: holdContentAfterChapter ? 'running' : 'success', progress: 100, logs: [] }, {
          historicalAdaptationContentItem: {
            node_id: '1', source_path: '适配目录', mode: 'direct', status: 'success', reason: '直接迁移',
            difference_ids: [], source_excerpt: '历史正文', blocked_terms: [], residuals: [],
          },
          contentGenerationItem: { nodeId: '1', section: { status: 'success', content: '迁移正文' } },
          historicalAdaptationContentConfirmedAt: null,
        }, {
          outlineContentPatch: { nodeId: '1', content: '迁移正文' },
        });
        if (holdContentAfterChapter) {
          await holdRun(taskControl);
          checkpointTask({ status: 'success', progress: 100 });
        }
      },
      historicalAdaptationContentCheck: async ({ payload, checkpointTask, taskControl }) => {
        runnerCalls.contentCheck.push({ ...payload, checkCache: state.historicalAdaptationContentCheck });
        if (holdContentCheck) await holdRun(taskControl);
        checkpointTask({ status: 'success', progress: 100, logs: [] }, {
          historicalAdaptationContentCheck: {
            status: 'success', findings: [], checked_content_hash: 'content-hash', checked_inputs_hash: 'inputs-hash',
          },
        });
      },
    },
  });
  service.subscribeCallback((event) => events.push(event));
  return {
    service,
    updates,
    events,
    runnerCalls,
    savedDifferences,
    preparations,
    heldRuns,
    getState: () => state,
    getProject: () => project,
  };
}

test('历史适配项目重新提取招标基线时清空旧差异结果', async () => {
  const harness = makeHarness();

  harness.service.startBidAnalysis({
    projectId: 'historical-project',
    mode: 'key',
    task_ids: ['projectOverview'],
  });

  await waitUntil(() => harness.runnerCalls.bidAnalysis.length === 1 && harness.service.getActiveTasks().length === 0);
  const resetPatch = harness.updates.find((patch) => (
    Array.isArray(patch.historicalAdaptationDifferences)
    && patch.historicalAdaptationDifferences.length === 0
  ));
  assert.ok(resetPatch);
  assert.equal(Object.hasOwn(resetPatch, 'historicalAdaptationDifferenceTask'), true);
  assert.equal(resetPatch.historicalAdaptationDifferenceTask, undefined);
  assert.equal(Object.hasOwn(resetPatch, 'historicalAdaptationDifferenceConfirmedAt'), true);
  assert.equal(resetPatch.historicalAdaptationDifferenceConfirmedAt, undefined);
});

test('普通技术方案重新提取招标基线时不写入历史适配差异字段', async () => {
  const harness = makeHarness({ projectType: 'technical-plan' });

  harness.service.startBidAnalysis({ projectId: 'historical-project', mode: 'key' });

  await waitUntil(() => harness.runnerCalls.bidAnalysis.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.equal(harness.updates.some((patch) => Object.hasOwn(patch, 'historicalAdaptationDifferences')), false);
});

test('差异分析仅允许历史适配项目启动并回传项目级差异快照', async () => {
  const harness = makeHarness();

  const task = harness.service.startHistoricalAdaptationDifference({ projectId: 'historical-project' });
  assert.equal(task.project_id, 'historical-project');

  await waitUntil(() => harness.runnerCalls.difference.length === 1 && harness.service.getActiveTasks().length === 0);
  const completedEvent = harness.events.find((event) => (
    event.task.type === 'historical-adaptation-difference'
    && event.task.status === 'success'
    && event.technicalPlanPatch?.historicalAdaptationDifferences?.[0]?.id === 'difference-new'
  ));
  assert.ok(completedEvent);
  assert.equal(completedEvent.task.project_id, 'historical-project');

  const ordinaryHarness = makeHarness({ projectType: 'technical-plan' });
  assert.throws(
    () => ordinaryHarness.service.startHistoricalAdaptationDifference({ projectId: 'historical-project' }),
    /不是历史标书适配项目/,
  );
});

test('启动恢复将未完成的差异分析标记为可重试错误', () => {
  const harness = makeHarness({
    initialState: {
      historicalAdaptationDifferenceTask: {
        task_id: 'difference-running',
        type: 'historical-adaptation-difference',
        status: 'running',
        progress: 48,
        logs: [],
      },
    },
  });

  assert.equal(harness.getState().historicalAdaptationDifferenceTask.status, 'error');
  assert.match(harness.getState().historicalAdaptationDifferenceTask.error, /重新分析/);
  assert.equal(harness.getState().historicalAdaptationDifferenceTask.progress, 48);
});

test('目录适配启动前强制检查项目类型、完整基线、差异确认和历史原文', () => {
  assert.throws(
    () => makeHarness({ projectType: 'technical-plan' }).service.startHistoricalAdaptationOutline({ projectId: 'historical-project' }),
    /不是历史标书适配项目/,
  );
  assert.throws(
    () => makeHarness({ initialState: { bidAnalysisTasks: {} } }).service.startHistoricalAdaptationOutline({ projectId: 'historical-project' }),
    /全部招标基线/,
  );
  assert.throws(
    () => makeHarness({ initialState: { historicalAdaptationDifferenceConfirmedAt: undefined } }).service.startHistoricalAdaptationOutline({ projectId: 'historical-project' }),
    /确认全部差异项/,
  );
  assert.throws(
    () => makeHarness({ initialState: { historicalAdaptationDifferences: [{ id: 'pending', decision: 'pending' }] } }).service.startHistoricalAdaptationOutline({ projectId: 'historical-project' }),
    /差异待确认/,
  );
  assert.throws(
    () => makeHarness({ initialState: { originalPlanMarkdown: '' } }).service.startHistoricalAdaptationOutline({ projectId: 'historical-project' }),
    /历史标书原文/,
  );
});

test('目录适配按项目启动并回传目录快照，开始时仅清确认时间', async () => {
  const harness = makeHarness({ initialState: {
    outlineData: { outline: [{ id: 'old', title: '旧目录' }] },
    historicalAdaptationOutlineConfirmedAt: '2026-10-01T08:00:00.000Z',
  } });
  const task = harness.service.startHistoricalAdaptationOutline({ projectId: 'historical-project' });
  assert.equal(task.project_id, 'historical-project');
  const initialPatch = harness.updates.find((patch) => patch.historicalAdaptationOutlineTask?.status);
  assert.equal(initialPatch.historicalAdaptationOutlineConfirmedAt, undefined);
  assert.equal(Object.hasOwn(initialPatch, 'outlineData'), false);

  await waitUntil(() => harness.runnerCalls.outline.length === 1 && harness.service.getActiveTasks().length === 0);
  const completedEvent = harness.events.find((event) => (
    event.task.type === 'historical-adaptation-outline'
    && event.task.status === 'success'
    && event.technicalPlanPatch?.outlineData?.outline?.[0]?.title === '新目录'
  ));
  assert.ok(completedEvent);
  assert.equal(completedEvent.task.project_id, 'historical-project');
});

test('启动恢复将未完成的目录适配标记为错误并保留旧目录', () => {
  const oldOutline = { outline: [{ id: 'old', title: '旧目录' }] };
  const harness = makeHarness({ initialState: {
    outlineData: oldOutline,
    historicalAdaptationOutlineTask: {
      task_id: 'outline-running', type: 'historical-adaptation-outline', status: 'running', progress: 61, logs: [],
    },
  } });
  assert.equal(harness.getState().historicalAdaptationOutlineTask.status, 'error');
  assert.match(harness.getState().historicalAdaptationOutlineTask.error, /重新生成/);
  assert.deepEqual(harness.getState().outlineData, oldOutline);
});

test('修改差异前取消并等待正在运行的目录适配任务', async () => {
  const harness = makeHarness({ holdOutline: true });
  harness.service.startHistoricalAdaptationOutline({ projectId: 'historical-project' });
  await waitUntil(() => harness.runnerCalls.outline.length === 1);

  const differences = [{ id: 'difference-updated', decision: 'confirmed' }];
  await harness.service.saveHistoricalAdaptationDifferences({ projectId: 'historical-project', differences });

  assert.deepEqual(harness.savedDifferences, [differences]);
  assert.equal(harness.service.getActiveTasks().length, 0);
});

test('正文迁移启动前检查项目类型、完整基线、差异和目录确认', () => {
  assert.throws(
    () => makeHarness({ projectType: 'technical-plan' }).service.startHistoricalAdaptationContent({ projectId: 'historical-project' }),
    /不是历史标书适配项目/,
  );
  assert.throws(
    () => makeHarness({ initialState: { bidAnalysisTasks: {} } }).service.startHistoricalAdaptationContent({ projectId: 'historical-project' }),
    /全部招标基线/,
  );
  assert.throws(
    () => makeHarness({ initialState: { historicalAdaptationOutlineConfirmedAt: undefined } }).service.startHistoricalAdaptationContent({ projectId: 'historical-project' }),
    /确认适配目录/,
  );
  assert.throws(
    () => makeHarness({ initialState: { outlineData: null } }).service.startHistoricalAdaptationContent({ projectId: 'historical-project' }),
    /适配目录/,
  );
});

test('建立正文迁移方案检查项目类型并自动启动正文任务', async () => {
  const harness = makeHarness();
  const state = await harness.service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' });
  assert.equal(state.historicalAdaptationContentItems[0].recommended_mode, 'direct');
  assert.equal(state.historicalAdaptationContentTask.type, 'historical-adaptation-content');
  assert.equal(state.historicalAdaptationContentTask.project_id, 'historical-project');
  await waitUntil(() => harness.runnerCalls.content.length === 1 && harness.service.getActiveTasks().length === 0);

  await assert.rejects(
    () => makeHarness({ projectType: 'technical-plan' }).service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' }),
    /不是历史标书适配项目/,
  );
});

test('一键建立方案透传当前新选择的章节以便本次执行', async () => {
  const harness = makeHarness();
  await harness.service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project', includeNodeId: '1' });
  await waitUntil(() => harness.runnerCalls.content.length === 1);
  assert.equal(harness.runnerCalls.content[0].includeNodeId, '1');
});

for (const taskType of ['content', 'contentCheck']) {
  test(`重新建立正文方案等待旧 ${taskType} runner 结束后才准备并启动正文`, async () => {
    const harness = makeHarness({
      holdContent: taskType === 'content', holdContentCheck: taskType === 'contentCheck',
      initialState: { historicalAdaptationContentItems: [{ node_id: '1', status: 'idle' }] },
    });
    if (taskType === 'content') harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project' });
    else harness.service.startHistoricalAdaptationContentCheck({ projectId: 'historical-project' });
    await waitUntil(() => harness.heldRuns.length === 1);
    const result = harness.service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.heldRuns[0].signal.aborted, true);
    assert.equal(harness.preparations.length, 0);
    harness.heldRuns[0].release();
    const state = await result;
    assert.equal(harness.preparations.length, 1);
    assert.equal(state.historicalAdaptationContentTask.type, 'historical-adaptation-content');
    await waitUntil(() => harness.service.getActiveTasks().length === 0);
    assert.equal(harness.runnerCalls.content.length, taskType === 'content' ? 2 : 1);
  });
}

test('重试正文调用同一 Runner 且明确设置 retry，不重建方案', async () => {
  const harness = makeHarness();
  const task = harness.service.retryHistoricalAdaptationContent({ projectId: 'historical-project' });
  assert.equal(task.type, 'historical-adaptation-content');
  await waitUntil(() => harness.service.getActiveTasks().length === 0);
  assert.equal(harness.runnerCalls.content[0].retry, true);
  assert.equal(harness.preparations.length, 0);
});

for (const terminalContentStatus of ['success', 'error']) {
  test(`终态 ${terminalContentStatus} 事件触发重新准备时仍等待旧 runner settled`, async () => {
    const harness = makeHarness({ terminalContentStatus });
    let preparation;
    harness.service.subscribeCallback((event) => {
      if (!preparation && event.task.type === 'historical-adaptation-content' && event.task.status === terminalContentStatus) {
        preparation = harness.service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' });
      }
    });
    harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project' });
    await waitUntil(() => harness.heldRuns.length >= 1);
    try {
      assert.equal(harness.heldRuns[0].signal.aborted, true);
      assert.equal(harness.preparations.length, 0);
      assert.equal(harness.runnerCalls.content.length, 1);
      harness.heldRuns[0].release();
      const snapshot = await preparation;
      await waitUntil(() => harness.heldRuns.length === 2);
      assert.equal(harness.preparations.length, 1);
      assert.equal(harness.service.getActiveTasks()[0]?.task_id, snapshot.historicalAdaptationContentTask.task_id);
      assert.equal(harness.service.getActiveTasks()[0]?.status, 'running');
    } finally {
      for (const heldRun of harness.heldRuns) heldRun.release();
    }
    await waitUntil(() => harness.service.getActiveTasks().length === 0);
  });
}

test('终态事件直接启动同类新任务后，旧 finally 不删除新任务和 control', async () => {
  const harness = makeHarness({ terminalContentStatus: 'success' });
  let replacement;
  harness.service.subscribeCallback((event) => {
    if (!replacement && event.task.type === 'historical-adaptation-content' && event.task.status === 'success') {
      replacement = harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project' });
    }
  });
  harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project' });
  await waitUntil(() => harness.heldRuns.length === 2);
  try {
    assert.equal(harness.getProject().status, 'generating');
    assert.equal(harness.getProject().lastTaskStatus, 'running');
    harness.heldRuns[0].release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.service.getActiveTasks()[0]?.task_id, replacement.task_id);
    assert.equal(harness.getProject().status, 'generating');
    assert.equal(harness.getProject().lastTaskType, 'historical-adaptation-content');
    assert.equal(harness.getProject().lastTaskStatus, 'running');
    const preparation = harness.service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.heldRuns[1].signal.aborted, true);
    assert.equal(harness.preparations.length, 0);
    harness.heldRuns[1].release();
    await preparation;
    await waitUntil(() => harness.heldRuns.length === 3);
  } finally {
    for (const heldRun of harness.heldRuns) heldRun.release();
  }
  await waitUntil(() => harness.service.getActiveTasks().length === 0);
});

test('正文迁移按项目启动并回传逐章迁移状态', async () => {
  const harness = makeHarness({ initialState: {
    historicalAdaptationContentItems: [{
      node_id: '1', source_path: '适配目录', mode: 'direct', status: 'success', reason: '旧结果',
      difference_ids: [], source_excerpt: '历史正文', blocked_terms: [], residuals: [], confirmed_at: '2026-10-01T10:00:00.000Z',
    }],
    historicalAdaptationContentConfirmedAt: '2026-10-01T10:10:00.000Z',
    historicalAdaptationReviewFindings: [{ id: 'old-review', severity: 'P2', resolution: 'resolved' }],
    historicalAdaptationReviewConfirmedAt: '2026-10-01T10:20:00.000Z',
  } });
  const task = harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project', nodeId: '1' });
  assert.equal(task.project_id, 'historical-project');
  const initialPatch = harness.updates.find((patch) => patch.historicalAdaptationContentTask?.status);
  assert.equal(initialPatch.historicalAdaptationContentConfirmedAt, undefined);
  assert.equal(Object.hasOwn(initialPatch, 'historicalAdaptationContentItems'), false);
  assert.deepEqual(initialPatch.historicalAdaptationReviewFindings, []);
  assert.equal(initialPatch.historicalAdaptationReviewConfirmedAt, undefined);

  await waitUntil(() => harness.runnerCalls.content.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.ok(harness.events.find((event) => (
    event.task.type === 'historical-adaptation-content'
    && event.task.status === 'success'
    && event.contentItemPatch?.node_id === '1'
    && event.outlineContentPatch?.nodeId === '1'
  )));
  assert.equal(harness.events.some((event) => Object.hasOwn(event.technicalPlanPatch || {}, 'historicalAdaptationContentItems')), false);
  assert.equal(harness.events.some((event) => Object.hasOwn(event.technicalPlanPatch || {}, 'outlineData')), false);
});

test('同一窗口重复订阅只注册一个销毁监听器且每次回放当前正文', async () => {
  const harness = makeHarness({ holdContent: true });
  harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project' });
  await waitUntil(() => harness.heldRuns.length === 1);
  let registrations = 0;
  let cleanup;
  const replay = [];
  const webContents = {
    isDestroyed: () => false,
    send(_channel, event) { replay.push(event); },
    once(event, callback) {
      assert.equal(event, 'destroyed');
      registrations += 1;
      cleanup = callback;
    },
  };
  try {
    for (let index = 0; index < 12; index += 1) harness.service.subscribe(webContents);
    assert.equal(registrations, 1);
    assert.equal(replay.filter((event) => event.task).length, 12);
    cleanup();
    const replayCount = replay.length;
    harness.heldRuns[0].release();
    await waitUntil(() => harness.service.getActiveTasks().length === 0);
    assert.equal(replay.length, replayCount);
  } finally {
    cleanup?.();
    for (const heldRun of harness.heldRuns) heldRun.release();
  }
});

for (const subscription of ['webContents', 'callback']) {
  test(`正文迁移 ${subscription} 回放补齐 load 与 listener 注册之间完成的章节`, async () => {
    const harness = makeHarness({
      holdContent: true,
      holdContentAfterChapter: true,
      initialState: {
        outlineData: { outline: [{ id: 'parent', title: '目录', children: [
          { id: '1', title: '适配目录', content: '' },
          { id: '2', title: '未迁移目录', content: '' },
        ] }] },
        historicalAdaptationContentItems: [{ node_id: '1', status: 'idle' }, { node_id: '2', status: 'idle' }],
      },
    });
    harness.service.startHistoricalAdaptationContent({ projectId: 'historical-project' });
    await waitUntil(() => harness.heldRuns.length === 1);
    const loadedState = structuredClone(harness.getState());
    const replay = [];
    let unsubscribe = () => {};
    try {
      harness.heldRuns[0].release();
      await waitUntil(() => harness.heldRuns.length === 2);
      assert.equal(loadedState.historicalAdaptationContentItems[0].status, 'idle');
      assert.equal(loadedState.outlineData.outline[0].children[0].content, '');
      if (subscription === 'webContents') {
        harness.service.subscribe({
          isDestroyed: () => false,
          send(channel, event) { assert.equal(channel, 'tasks:event'); replay.push(event); },
          once(_event, callback) { unsubscribe = callback; },
        });
      } else {
        unsubscribe = harness.service.subscribeCallback((event) => replay.push(event));
      }
      const itemsById = new Map(loadedState.historicalAdaptationContentItems.map((item) => [item.node_id, item]));
      const bodiesById = new Map(loadedState.outlineData.outline[0].children.map((node) => [node.id, node.content]));
      for (const event of replay) {
        if (event.contentItemPatch) itemsById.set(event.contentItemPatch.node_id, event.contentItemPatch);
        if (event.outlineContentPatch) bodiesById.set(event.outlineContentPatch.nodeId, event.outlineContentPatch.content);
        assert.equal(Object.hasOwn(event.technicalPlanPatch || {}, 'historicalAdaptationContentItems'), false);
        assert.equal(Object.hasOwn(event.technicalPlanPatch || {}, 'outlineData'), false);
      }
      assert.equal(itemsById.get('1').status, 'success');
      assert.equal(bodiesById.get('1'), '迁移正文');
      assert.equal(itemsById.get('2').status, 'idle');
      assert.equal(replay.filter((event) => event.contentItemPatch).length, 2);
      assert.equal(replay.filter((event) => event.outlineContentPatch).length, 2);
    } finally {
      unsubscribe();
      for (const heldRun of harness.heldRuns) heldRun.release();
    }
    await waitUntil(() => harness.service.getActiveTasks().length === 0);
  });
}

test('启动恢复将未完成的正文迁移及运行中章节标记为可重试错误', () => {
  const items = [
    { node_id: '1', mode: 'direct', status: 'success' },
    { node_id: '2', mode: 'rewrite', status: 'running', plan_id: 'existing-plan-id' },
  ];
  const harness = makeHarness({ initialState: {
    historicalAdaptationContentItems: items,
    historicalAdaptationContentTask: {
      task_id: 'content-running', type: 'historical-adaptation-content', status: 'running', progress: 42, logs: [],
    },
  } });
  assert.equal(harness.getState().historicalAdaptationContentTask.status, 'error');
  assert.match(harness.getState().historicalAdaptationContentTask.error, /重新迁移/);
  assert.deepEqual(harness.getState().historicalAdaptationContentItems[0], items[0]);
  assert.equal(harness.getState().historicalAdaptationContentItems[1].status, 'error');
  assert.equal(harness.getState().historicalAdaptationContentItems[1].error_code, 'interrupted');
  assert.equal(harness.getState().historicalAdaptationContentItems[1].plan_id, 'existing-plan-id');
  assert.match(harness.getState().historicalAdaptationContentItems[1].error, /重新迁移/);
  assert.ok(harness.updates.some((patch) => patch.historicalAdaptationContentItem?.node_id === '2'));
  assert.equal(harness.updates.some((patch) => Object.hasOwn(patch, 'historicalAdaptationContentItems')), false);
});

test('正文一致性检查按项目启动并回传检查快照', async () => {
  const cachedCheck = { status: 'success', findings: [], checked_content_hash: 'existing-content-hash' };
  const harness = makeHarness({ initialState: {
    historicalAdaptationContentItems: [{ node_id: '1', recommended_mode: 'direct', status: 'success' }],
    historicalAdaptationContentCheck: cachedCheck,
  } });
  const task = harness.service.startHistoricalAdaptationContentCheck({ projectId: 'historical-project' });
  assert.equal(task.project_id, 'historical-project');
  await waitUntil(() => harness.runnerCalls.contentCheck.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.deepEqual(harness.runnerCalls.contentCheck[0].checkCache, cachedCheck);
  assert.equal(harness.getState().historicalAdaptationContentCheck.status, 'success');
});

test('启动恢复将未完成的一致性检查标记为错误并使快照失效', () => {
  const harness = makeHarness({ initialState: {
    historicalAdaptationContentCheck: { status: 'running', findings: [] },
    historicalAdaptationContentCheckTask: {
      task_id: 'check-running', type: 'historical-adaptation-content-check', status: 'running', progress: 60, logs: [],
    },
  } });
  assert.equal(harness.getState().historicalAdaptationContentCheckTask.status, 'error');
  assert.equal(harness.getState().historicalAdaptationContentCheck.status, 'stale');
});
