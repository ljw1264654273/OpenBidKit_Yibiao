const assert = require('node:assert/strict');
const test = require('node:test');
const { registerBidProjectIpc } = require('./bidProjectIpc.cjs');

function createIpcStub() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

function createProject(projectId, projectName) {
  return {
    projectId,
    projectName,
    projectType: 'technical-plan',
    status: 'completed',
  };
}

function createManager() {
  const leftProject = createProject('project-left', '左侧方案');
  const rightProject = createProject('project-right', '右侧方案');
  const result = {
    resultId: 'saved-result',
    leftProjectId: leftProject.projectId,
    rightProjectId: rightProject.projectId,
    sensitivity: 'medium',
    threshold: 0.64,
    summary: {
      leftParagraphCount: 1,
      rightParagraphCount: 1,
      duplicateParagraphCount: 1,
      maxSimilarity: 1,
      threshold: 0.64,
    },
    matches: [{
      id: 'match-0-0',
      similarity: 1,
      level: 'high',
      leftParagraph: { index: 0, text: '左侧正文内容足够长，能够被查重服务识别为同源重复段落，并且包含完整的项目管理事实。' },
      rightParagraph: { index: 0, text: '右侧正文内容足够长，能够被查重服务识别为同源重复段落，并且包含完整的项目管理事实。' },
      leftNodeId: 'left-node',
      rightNodeId: 'right-node',
      suggestion: { title: '改写', reason: '重复', instruction: '重新组织' },
    }],
  };
  const states = {
    [leftProject.projectId]: { outlineData: { outline: [{ id: 'left-node', title: '章节一', content: '左侧正文内容足够长，能够被查重服务识别为同源重复段落，并且包含完整的项目管理事实。' }] } },
    [rightProject.projectId]: { outlineData: { outline: [{ id: 'right-node', title: '章节一', content: '右侧正文内容足够长，能够被查重服务识别为同源重复段落，并且包含完整的项目管理事实。' }] } },
  };
  const projectStore = {
    listProjects: () => [leftProject, rightProject],
    getProject: (projectId) => ({ [leftProject.projectId]: leftProject, [rightProject.projectId]: rightProject }[projectId] || null),
    listSourceGroupProjects: () => [leftProject, rightProject],
    listRecentDuplicateSummaries: (projectIds) => Object.fromEntries((projectIds || []).map((projectId) => [projectId, null])),
    loadDuplicateResult: (resultId) => resultId === result.resultId ? {
      ...result,
      leftProject,
      rightProject,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    } : null,
    loadLatestDuplicateResult: () => null,
    updateDuplicateMatchDecision: (payload) => ({
      ...result,
      matches: result.matches.map((match) => match.id === payload.matchId
        ? { ...match, decision: payload.decision, decisionTargetSide: payload.targetSide }
        : match),
    }),
    saveDuplicateResult: (payload) => {
      assert.equal(payload.threshold, 0.64);
      assert.equal(payload.matches[0].leftNodeId, 'left-node');
      return result.resultId;
    },
  };
  const manager = {
    getProjectStore: () => projectStore,
    getTechnicalPlanStore: (projectId) => ({
      loadTechnicalPlan: () => states[projectId],
      readTenderMarkdown: () => '',
      saveChapterContent: () => ({ success: true }),
    }),
    getProject: (projectId) => projectStore.getProject(projectId),
    openProject: (projectId) => projectStore.getProject(projectId),
    closeProject: () => undefined,
    createProject: () => leftProject,
    updateProject: () => leftProject,
    deleteProject: () => ({ success: true }),
  };
  return { manager, projectStore, result, leftProject, rightProject };
}

function registerForTest(overrides = {}) {
  const ipc = createIpcStub();
  const fixture = createManager();
  const duplicateRewriteService = {
    rewriteMatch: async (payload) => ({
      rewrittenText: `改写：${payload.targetSide}`,
      reason: '已重新组织目标侧表达',
      riskNote: '请核对事实',
    }),
  };
  registerBidProjectIpc({
    ipcMain: ipc,
    bidProjectManager: fixture.manager,
    bidProjectImportService: {
      prepareImport: () => ({ success: true }),
      confirmImport: () => fixture.leftProject,
      discardImport: () => ({ success: true }),
    },
    technicalPlanStore: fixture.manager.getTechnicalPlanStore(fixture.leftProject.projectId),
    taskService: { cancelProjectTasks: async () => undefined },
    exportService: { exportWord: async () => ({ success: true }) },
    duplicateRewriteService,
    ...overrides,
  });
  return { ipc, fixture };
}

test('registers duplicate result and rewrite handlers without duplicating store logic', async () => {
  const { ipc, fixture } = registerForTest();
  for (const channel of [
    'bid-project:compare-content',
    'bid-project:recent-duplicate-summaries',
    'bid-project:load-duplicate-result',
    'bid-project:load-latest-duplicate-result',
    'bid-project:update-duplicate-match-decision',
    'bid-project:rewrite-duplicate-match',
  ]) {
    assert.equal(typeof ipc.handlers.get(channel), 'function', channel);
  }

  assert.deepEqual(
    await ipc.handlers.get('bid-project:recent-duplicate-summaries')({}, [fixture.leftProject.projectId]),
    { [fixture.leftProject.projectId]: null },
  );
  const decision = await ipc.handlers.get('bid-project:update-duplicate-match-decision')({}, {
    resultId: fixture.result.resultId,
    matchId: 'match-0-0',
    decision: 'ignored',
    targetSide: 'none',
  });
  assert.equal(decision.matches[0].decision, 'ignored');
  const rewrite = await ipc.handlers.get('bid-project:rewrite-duplicate-match')({}, {
    resultId: fixture.result.resultId,
    matchId: 'match-0-0',
    targetSide: 'right',
    leftProjectId: fixture.leftProject.projectId,
    rightProjectId: fixture.rightProject.projectId,
  });
  assert.equal(rewrite.rewrittenText, '改写：right');
});

test('compare-content returns the persisted result and saves the comparator threshold', async () => {
  const { ipc, fixture } = registerForTest();
  const result = await ipc.handlers.get('bid-project:compare-content')({}, {
    leftProjectId: fixture.leftProject.projectId,
    rightProjectId: fixture.rightProject.projectId,
    sensitivity: 'medium',
  });
  assert.equal(result.resultId, fixture.result.resultId);
  assert.equal(result.threshold, 0.64);
  assert.equal(result.matches[0].id, 'match-0-0');
});
