const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskService } = require('./taskService.cjs');
const { runTechnicalPlanCheckTask } = require('./technicalPlanCheckTask.cjs');

async function waitUntil(predicate) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('后台任务等待超时');
}

function harness(runner, initial = {}, options = {}) {
  let state = { reportPath: 'old.docx', summary: { total: 2 }, ...initial };
  let projectId = 'first';
  const writes = [];
  const events = [];
  const projectWrites = [];
  let recoveries = 0;
  const checkStore = {
    loadState: () => state,
    updateWithoutReload(patch) { writes.push(patch); state = { ...state, ...patch }; },
    checkpointTask(task, patch) { writes.push({ ...patch, checkTask: task }); state = { ...state, ...patch, checkTask: task }; return state; },
    recoverInterruptedTask() {
      recoveries += 1;
      if (state.checkTask?.status === 'running') state = { ...state, checkTask: { ...state.checkTask, status: 'error', error: '应用已重启，请重新执行' } };
      return state;
    },
  };
  let technicalState = { outlineWordControlSnapshot: {}, ...(options.technicalState || {}) };
  const technicalStore = {
    loadTechnicalPlan: () => technicalState,
    updateTechnicalPlanWithoutReload: (patch) => {
      if (!options.allowTechnicalWrites) assert.fail('不应写入技术方案项目');
      technicalState = { ...technicalState, ...patch };
    },
  };
  const service = createTaskService({
    aiService: {}, agentService: { bindTaskContext: () => ({}), loadPersistentTask: () => null },
    autoConfirmationService: { unregister() {} },
    technicalPlanStore: technicalStore,
    bidProjectManager: { getCurrentProjectId: () => projectId, listProjects: () => [], getTechnicalPlanStore: () => {
      if (options.noProjectAccess) assert.fail('技术方案检查不应访问当前项目 Store');
      return technicalStore;
    }, getProject: () => options.project, updateProject: (id, patch) => projectWrites.push({ id, patch }) },
    rejectionCheckStore: { loadRejectionCheck: () => ({}) }, duplicateCheckStore: { loadDuplicateCheck: () => ({}) },
    technicalPlanCheckStore: checkStore, technicalPlanCheckService: options.technicalPlanCheckService || {},
    taskRunners: { technicalPlanCheck: runner, ...(options.taskRunners || {}) },
  });
  service.subscribeCallback((event) => events.push(event));
  return { service, writes, events, checkStore, state: () => state, projectWrites, recoveries: () => recoveries, switchProject: () => { projectId = 'second'; } };
}

test('persists running before dispatch, checkpoint and real-time patch, replay full state', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness(async ({ updateTask, checkpointTask, previousState, workspaceStore }) => {
    assert.equal(workspaceStore, h.checkStore);
    assert.equal(previousState.reportPath, 'old.docx');
    updateTask({ progress: 30, logs: ['需求检查'] });
    await gate;
    checkpointTask({ status: 'success', progress: 100 }, { reportPath: 'new.docx', summary: { total: 0 } });
  });
  const task = h.service.startTechnicalPlanCheck();
  assert.equal(h.state().checkTask.status, 'running');
  assert.equal(task.group, 'technical-plan-check');
  assert.equal(task.projectId, undefined);
  await waitUntil(() => h.events.some((event) => event.technicalPlanCheckPatch?.checkTask?.progress === 30));
  const replay = [];
  const unsubscribe = h.service.subscribeCallback((event) => replay.push(event));
  assert.equal(replay[0].technicalPlanCheck.reportPath, 'old.docx');
  assert.equal(h.service.getActiveTasks().length, 1);
  release();
  await waitUntil(() => h.service.getActiveTasks().length === 0);
  assert.equal(h.state().reportPath, 'new.docx');
  assert.equal(h.state().checkTask.status, 'success');
  assert.equal(h.projectWrites.length, 0);
  unsubscribe();
});

test('singleton remains mutually exclusive across project switches', async () => {
  let runs = 0;
  let release;
  const h = harness(async () => { runs += 1; await new Promise((resolve) => { release = resolve; }); });
  const first = h.service.startTechnicalPlanCheck({ projectId: 'first' });
  h.switchProject();
  const second = h.service.startTechnicalPlanCheck({ projectId: 'second' });
  assert.equal(first.task_id, second.task_id);
  await waitUntil(() => runs === 1);
  release();
  await waitUntil(() => h.service.getActiveTasks().length === 0);
});

test('singleton starts independently without accessing the current project Store', async () => {
  const h = harness(async ({ checkpointTask }) => checkpointTask({ status: 'success' }), {}, { noProjectAccess: true });
  h.service.startTechnicalPlanCheck();
  await waitUntil(() => h.service.getActiveTasks().length === 0);
  assert.equal(h.state().checkTask.status, 'success');
});

test('runner failure persists logs and retains previous report', async () => {
  const h = harness(async ({ updateTask }) => { updateTask({ logs: ['读取招标文件', '采购需求检查'] }); throw new Error('解析失败'); });
  h.service.startTechnicalPlanCheck();
  await waitUntil(() => h.service.getActiveTasks().length === 0);
  assert.equal(h.state().checkTask.status, 'error');
  assert.deepEqual(h.state().checkTask.logs, ['读取招标文件', '采购需求检查']);
  assert.equal(h.state().reportPath, 'old.docx');
});

test('startup recovery delegates interrupted check to Store', () => {
  const h = harness(async () => {}, { checkTask: { status: 'running' } });
  assert.equal(h.recoveries(), 1);
  assert.equal(h.state().checkTask.status, 'error');
});

test('stage logs survive close and restart without writes after cancellation', async () => {
  let entered = false;
  const h = harness(runTechnicalPlanCheckTask, {}, { technicalPlanCheckService: {
    async prepareDocuments(state, callback, { signal, onStage }) {
      onStage('tender');
      onStage('requirements');
      entered = true;
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      signal.throwIfAborted();
    },
  } });
  h.service.startTechnicalPlanCheck();
  await waitUntil(() => entered);
  assert.deepEqual(h.state().checkTask.logs, ['1/13 读取招标文件', '2/13 读取采购需求文件']);
  const writesBeforeClose = h.writes.length;
  await h.service.close();
  assert.equal(h.writes.length, writesBeforeClose);
  const restarted = harness(async () => {}, h.state());
  assert.equal(restarted.state().checkTask.status, 'error');
  assert.deepEqual(restarted.state().checkTask.logs, ['1/13 读取招标文件', '2/13 读取采购需求文件']);
});

test('close aborts and awaits settlement, forbids starts and rejects late checkpoints', async () => {
  let entered = false;
  let settle;
  let lateCheckpointRejected = false;
  const h = harness(async ({ taskControl, checkpointTask }) => {
    entered = true;
    await new Promise((resolve) => taskControl.signal.addEventListener('abort', resolve, { once: true }));
    await new Promise((resolve) => { settle = resolve; });
    try { checkpointTask({ status: 'success' }, { reportPath: 'late.docx' }); } catch { lateCheckpointRejected = true; }
  });
  h.service.startTechnicalPlanCheck();
  await waitUntil(() => entered);
  let closed = false;
  const closing = h.service.close().then(() => { closed = true; });
  await waitUntil(() => Boolean(settle));
  assert.equal(closed, false);
  assert.throws(() => h.service.startTechnicalPlanCheck(), /关闭/);
  settle();
  await closing;
  assert.equal(lateCheckpointRejected, true);
  assert.equal(h.state().reportPath, 'old.docx');
  assert.equal(h.service.getActiveTasks().length, 0);
});

test('close cancels queued tasks without draining them into new runners', async () => {
  let runs = 0;
  const h = harness(async () => {}, {}, { allowTechnicalWrites: true, taskRunners: {
    contentGeneration: async ({ taskControl }) => {
      runs += 1;
      await new Promise((resolve) => taskControl.signal.addEventListener('abort', resolve, { once: true }));
    },
  } });
  h.service.startContentGeneration({ projectId: 'one' });
  h.service.startContentGeneration({ projectId: 'two' });
  const queued = h.service.startContentGeneration({ projectId: 'three' });
  assert.equal(queued.status, 'queued');
  await waitUntil(() => runs === 2);
  await h.service.close();
  assert.equal(runs, 2);
  assert.equal(h.service.getActiveTasks().length, 0);
});

test('close immediately after successful content checkpoint prevents automatic variant startup', async () => {
  let variants = 0;
  let closing;
  const h = harness(async () => {}, {}, {
    allowTechnicalWrites: true,
    project: { derivedFromProjectId: 'source', uniquenessAutoRunRequested: true },
    taskRunners: {
      contentGeneration: async ({ checkpointTask }) => {
        checkpointTask({ status: 'success' });
        closing = h.service.close();
      },
      variantDeduplication: async () => { variants += 1; },
    },
  });
  h.service.startContentGeneration({ projectId: 'derived' });
  await waitUntil(() => Boolean(closing));
  await closing;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(variants, 0);
});
