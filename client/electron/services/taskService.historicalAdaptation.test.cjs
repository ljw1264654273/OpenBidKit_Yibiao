const test = require('node:test');
const assert = require('node:assert/strict');

const { createTaskService } = require('./taskService.cjs');

async function waitUntil(predicate, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('等待异步任务状态超时');
}

function makeHarness({ projectType = 'historical-bid-adaptation', initialState = {} } = {}) {
  let state = {
    workflowKind: 'existing-plan-expansion',
    bidAnalysisTasks: {},
    historicalAdaptationDifferences: [{ id: 'difference-1', decision: 'confirmed' }],
    historicalAdaptationDifferenceConfirmedAt: '2026-09-30T08:00:00.000Z',
    historicalAdaptationDifferenceTask: {
      task_id: 'difference-complete',
      type: 'historical-adaptation-difference',
      status: 'success',
      progress: 100,
      logs: [],
    },
    ...initialState,
  };
  let project = {
    projectId: 'historical-project',
    projectName: '横泾街道历史标书适配',
    projectType,
    status: 'incomplete',
  };
  const updates = [];
  const events = [];
  const runnerCalls = { bidAnalysis: [], difference: [] };
  const store = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlanWithoutReload(patch) {
      updates.push(patch);
      state = { ...state, ...patch };
    },
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
    },
  });
  service.subscribeCallback((event) => events.push(event));
  return {
    service,
    updates,
    events,
    runnerCalls,
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
