const assert = require('node:assert/strict');
const test = require('node:test');

const { createTaskService } = require('./taskService.cjs');

function createHarness() {
  let state = {
    workflowKind: 'technical-plan',
    outlineMinimumDepth: 4,
    outlineMinimumDepthSnapshot: 4,
    referenceKnowledgeDocumentIds: [],
    remoteKnowledgeScopes: [],
    outlineWordControlSnapshot: { minimumWords: 40000, maximumWords: 50000, sectionWords: 1800, strictSectionWords: false },
  };
  const updates = [];
  let runnerInput;
  const technicalPlanStore = {
    loadTechnicalPlan: () => state,
    updateTechnicalPlanWithoutReload: (patch) => {
      updates.push(patch);
      state = { ...state, ...patch };
    },
    clearTechnicalPlan: () => ({ success: true }),
    clearBidTemplate() {},
  };
  const emptyStore = { loadRejectionCheck: () => ({}), loadDuplicateCheck: () => ({}) };
  const service = createTaskService({
    aiService: {},
    agentService: {
      bindTaskContext: () => ({}),
      isPrimarySession: () => false,
      deletePersistentTask() {},
    },
    autoConfirmationService: { register() {}, unregister() {}, suppress() {} },
    technicalPlanStore,
    rejectionCheckStore: emptyStore,
    duplicateCheckStore: emptyStore,
    feasibilityReportStore: { loadFeasibilityReport: () => ({}) },
    knowledgeBaseService: {},
    knowledgeReferenceService: {
      createTaskSession() {
        return { dispose() {}, searchRemote: async () => [] };
      },
    },
    remoteKnowledgeDecisionService: { onDecision: () => () => {} },
    duplicateCheckService: {},
    openXmlHelperService: {},
    taskRunners: {
      outlineGeneration: async (input) => {
        runnerInput = input;
        await new Promise(() => {});
      },
    },
  });
  return { service, updates, getRunnerInput: () => runnerInput };
}

test('outline generation freezes minimum depth and clears the previous effective snapshot', async () => {
  const harness = createHarness();
  harness.service.startOutlineGeneration({
    minimum_outline_depth: 5,
    word_control_options: { minimumWords: 40000, maximumWords: 50000, sectionWords: 1800, strictSectionWords: false },
    reference_knowledge_document_ids: [],
    remote_knowledge_scopes: [],
    outline_mode: 'standalone-technical',
    outline_expansion_mode: 'ai-complement',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.getRunnerInput().payload.minimum_outline_depth, 5);
  assert.equal(harness.updates[0].outlineMinimumDepth, 5);
  assert.equal(Object.hasOwn(harness.updates[0], 'outlineMinimumDepthSnapshot'), true);
  assert.equal(harness.updates[0].outlineMinimumDepthSnapshot, undefined);
});
