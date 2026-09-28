const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskService } = require('./taskService.cjs');
const { isTechnicalPlanContentComplete } = require('./technicalPlanContentState.cjs');

async function waitUntil(predicate, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('等待异步任务状态超时');
}

function makeHarness({
  autoRunRequested = false,
  contentTaskStatus,
  variantTaskStatus,
  derived = true,
  contentRunnerError = null,
  reconstructedContentComplete = false,
  reconstructedLegacyContentComplete = false,
} = {}) {
  let project = {
    projectId: 'derived',
    projectName: '第二份标书',
    status: 'incomplete',
    derivedFromProjectId: derived ? 'source' : undefined,
    uniquenessStatus: derived ? 'pending' : 'none',
    uniquenessAutoRunRequested: autoRunRequested,
  };
  let state = {
    workflowKind: 'technical-plan',
    outlineMode: 'standalone-technical',
    outlineExpansionMode: 'ai-complement',
    outlineWordControlOptions: {},
    outlineWordControlSnapshot: {},
    referenceKnowledgeDocumentIds: [],
    remoteKnowledgeScopes: [],
    outlineData: {
      outline: [{
        id: 'node-1',
        title: '方案',
        content: '完整正文',
        ...(reconstructedContentComplete && !reconstructedLegacyContentComplete
          ? { content_mode: 'ai-generate' }
          : {}),
      }],
    },
    contentGenerationSections: { 'node-1': { status: 'success' } },
    ...(contentTaskStatus ? {
      contentGenerationTask: {
        task_id: 'content-recovery',
        type: 'content-generation',
        status: contentTaskStatus,
        progress: contentTaskStatus === 'success' ? 100 : 60,
        logs: [],
      },
    } : {}),
    ...(variantTaskStatus ? {
      variantDeduplicationTask: {
        task_id: 'variant-recovery',
        type: 'variant-deduplication',
        status: variantTaskStatus,
        progress: 50,
        logs: [],
      },
    } : {}),
  };
  const workspaceUpdates = [];
  const projectUpdates = [];
  const payloads = { outline: [], content: [], variant: [] };
  const store = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlanWithoutReload(patch) {
      workspaceUpdates.push(patch);
      state = { ...state, ...patch };
    },
    clearBidTemplate() {},
  };
  const bidProjectManager = {
    listProjects: () => [project],
    getCurrentProjectId: () => project.projectId,
    getProject: (id) => (id === project.projectId ? project : id === 'source' ? { projectId: 'source', status: 'completed' } : null),
    getTechnicalPlanStore: () => store,
    updateProject(id, patch) {
      assert.equal(id, project.projectId);
      projectUpdates.push(patch);
      project = { ...project, ...patch };
      return project;
    },
    getProjectStore: () => ({
      listPendingAutomaticUniquenessProjects: () => (
        project.derivedFromProjectId && project.uniquenessAutoRunRequested ? [project] : []
      ),
    }),
  };
  const completeRunner = (bucket) => async ({ payload, checkpointTask }) => {
    payloads[bucket].push(payload);
    if (bucket === 'content' && contentRunnerError) throw contentRunnerError;
    if (bucket === 'variant') {
      bidProjectManager.updateProject(project.projectId, {
        status: 'completed',
        uniquenessStatus: 'passed',
        uniquenessAutoRunRequested: false,
      });
    }
    checkpointTask({ status: 'success', progress: 100, logs: [] });
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
    bidProjectVariantService: {
      getVariantBaselineOutline: () => ({ outline: [{ id: '1', title: '第一份目录' }] }),
    },
    rejectionCheckStore: { loadRejectionCheck: () => ({}) },
    duplicateCheckStore: { loadDuplicateCheck: () => ({}) },
    feasibilityReportStore: { loadFeasibilityReport: () => ({}) },
    knowledgeBaseService: {},
    remoteKnowledgeDecisionService: { onDecision: () => () => {} },
    duplicateCheckService: {},
    openXmlHelperService: {},
    taskRunners: {
      outlineGeneration: completeRunner('outline'),
      contentGeneration: completeRunner('content'),
      variantDeduplication: completeRunner('variant'),
    },
  });
  return {
    service,
    payloads,
    workspaceUpdates,
    projectUpdates,
    getProject: () => project,
    getState: () => state,
  };
}

test('adds the first-bid outline only when starting an outline task for a derived project', async () => {
  const derivedHarness = makeHarness();
  derivedHarness.service.startOutlineGeneration({ projectId: 'derived', outline_mode: 'standalone-technical' });
  await waitUntil(() => derivedHarness.payloads.outline.length === 1);
  assert.equal(derivedHarness.payloads.outline[0].variant_baseline_outline.outline[0].title, '第一份目录');

  const ordinaryHarness = makeHarness({ derived: false });
  ordinaryHarness.service.startOutlineGeneration({ projectId: 'derived', outline_mode: 'standalone-technical' });
  await waitUntil(() => ordinaryHarness.payloads.outline.length === 1);
  assert.equal(Object.hasOwn(ordinaryHarness.payloads.outline[0], 'variant_baseline_outline'), false);
});

test('marks full content generation for automatic checking and starts it once after the content lock is released', async () => {
  const harness = makeHarness();

  harness.service.startContentGeneration({ projectId: 'derived' });
  assert.equal(harness.getProject().uniquenessAutoRunRequested, true);

  await waitUntil(() => harness.payloads.variant.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.equal(harness.payloads.content.length, 1);
  assert.equal(harness.payloads.variant.length, 1);
  assert.equal(harness.getProject().uniquenessAutoRunRequested, false);
  assert.equal(harness.getProject().uniquenessStatus, 'passed');
});

test('clears automatic uniqueness scheduling when full content generation fails', async () => {
  const harness = makeHarness({ contentRunnerError: new Error('正文生成失败') });

  harness.service.startContentGeneration({ projectId: 'derived' });
  assert.equal(harness.getProject().uniquenessAutoRunRequested, true);

  await waitUntil(() => harness.service.getActiveTasks().length === 0);
  assert.equal(harness.payloads.variant.length, 0);
  assert.equal(harness.getProject().status, 'failed');
  assert.equal(harness.getProject().uniquenessAutoRunRequested, false);
});

test('startup recovery schedules only flagged derived projects with successful body generation', async () => {
  const flagged = makeHarness({ autoRunRequested: true, contentTaskStatus: 'success' });
  await waitUntil(() => flagged.payloads.variant.length === 1 && flagged.service.getActiveTasks().length === 0);
  assert.equal(flagged.payloads.variant.length, 1);

  const unflagged = makeHarness({ autoRunRequested: false, contentTaskStatus: 'success' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unflagged.payloads.variant.length, 0);

  const unfinished = makeHarness({ autoRunRequested: true, contentTaskStatus: 'paused' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unfinished.payloads.variant.length, 0);
});

test('allows uniqueness retry when outline edits removed the successful task record but all current body sections remain complete', async () => {
  const harness = makeHarness({ reconstructedContentComplete: true });

  harness.service.startVariantDeduplication({ projectId: 'derived' });

  await waitUntil(() => harness.payloads.variant.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.equal(harness.getProject().uniquenessStatus, 'passed');
});

test('reconstructs completed body state for legacy outlines without content modes', async () => {
  const harness = makeHarness({
    reconstructedContentComplete: true,
    reconstructedLegacyContentComplete: true,
  });

  harness.service.startVariantDeduplication({ projectId: 'derived' });

  await waitUntil(() => harness.payloads.variant.length === 1 && harness.service.getActiveTasks().length === 0);
  assert.equal(harness.getProject().uniquenessStatus, 'passed');
});

test('does not reconstruct completion while a persisted body task is unfinished', () => {
  assert.equal(isTechnicalPlanContentComplete({
    outlineData: {
      outline: [{ id: 'node-1', title: '方案', content: '已有正文' }],
    },
    contentGenerationSections: {
      'node-1': { status: 'success', content: '已有正文' },
    },
    contentGenerationTask: {
      type: 'content-generation',
      status: 'paused',
    },
  }), false);
});

test('startup recovery turns an interrupted uniqueness task into a retryable failure', () => {
  const harness = makeHarness({ variantTaskStatus: 'running' });

  assert.equal(harness.getState().variantDeduplicationTask.status, 'error');
  assert.match(harness.getState().variantDeduplicationTask.error, /重新查重/);
  assert.equal(harness.getProject().status, 'failed');
  assert.equal(harness.getProject().uniquenessStatus, 'failed');
});
