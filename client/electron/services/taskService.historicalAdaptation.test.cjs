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

function makeHarness({ projectType = 'historical-bid-adaptation', initialState = {}, holdOutline = false } = {}) {
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
  const store = {
    loadTechnicalPlan: () => state,
    readOriginalPlanMarkdown: () => initialState.originalPlanMarkdown === '' ? '' : '# 历史标书\n## 原目录',
    updateTechnicalPlanWithoutReload(patch) {
      updates.push(patch);
      state = { ...state, ...patch };
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
      historicalAdaptationContent: async ({ payload, checkpointTask }) => {
        runnerCalls.content.push(payload);
        checkpointTask({ status: 'success', progress: 100, logs: [] }, {
          historicalAdaptationContentItems: [{
            node_id: '1', source_path: '适配目录', mode: 'direct', status: 'success', reason: '直接迁移',
            difference_ids: [], source_excerpt: '历史正文', blocked_terms: [], residuals: [],
          }],
          historicalAdaptationContentConfirmedAt: null,
        });
      },
      historicalAdaptationContentCheck: async ({ payload, checkpointTask }) => {
        runnerCalls.contentCheck.push(payload);
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
    getState: () => state,
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

test('建立正文迁移方案检查项目类型并调用项目 Store', () => {
  const harness = makeHarness();
  const state = harness.service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' });
  assert.equal(state.historicalAdaptationContentItems[0].recommended_mode, 'direct');

  assert.throws(
    () => makeHarness({ projectType: 'technical-plan' }).service.prepareHistoricalAdaptationContentPlan({ projectId: 'historical-project' }),
    /不是历史标书适配项目/,
  );
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
  assert.equal(initialPatch.historicalAdaptationContentItems[0].confirmed_at, undefined);
  assert.deepEqual(initialPatch.historicalAdaptationReviewFindings, []);
  assert.equal(initialPatch.historicalAdaptationReviewConfirmedAt, undefined);

  await waitUntil(() => harness.runnerCalls.content.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.ok(harness.events.find((event) => (
    event.task.type === 'historical-adaptation-content'
    && event.task.status === 'success'
    && event.technicalPlanPatch?.historicalAdaptationContentItems?.[0]?.node_id === '1'
  )));
});

test('启动恢复将未完成的正文迁移及运行中章节标记为可重试错误', () => {
  const items = [
    { node_id: '1', mode: 'direct', status: 'success' },
    { node_id: '2', mode: 'rewrite', status: 'running' },
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
  assert.match(harness.getState().historicalAdaptationContentItems[1].error, /重新迁移/);
});

test('正文一致性检查按项目启动并回传检查快照', async () => {
  const harness = makeHarness({ initialState: {
    historicalAdaptationContentItems: [{ node_id: '1', recommended_mode: 'direct', status: 'success' }],
  } });
  const task = harness.service.startHistoricalAdaptationContentCheck({ projectId: 'historical-project' });
  assert.equal(task.project_id, 'historical-project');
  await waitUntil(() => harness.runnerCalls.contentCheck.length === 1 && harness.service.getActiveTasks().length === 0);
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
