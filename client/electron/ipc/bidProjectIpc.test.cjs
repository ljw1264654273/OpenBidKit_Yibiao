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
  let savedDuplicatePayload;
  let savedChapterContent;
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
    loadDuplicateResultPage: (resultId, offset, limit) => resultId === result.resultId ? {
      ...result,
      leftProject,
      rightProject,
      offset,
      limit,
      totalMatches: result.matches.length,
      hasMore: offset + limit < result.matches.length,
      matches: result.matches.slice(offset, offset + limit),
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
      savedDuplicatePayload = payload;
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
      saveChapterContent: (payload) => {
        savedChapterContent = payload;
        return { success: true };
      },
    }),
    getProject: (projectId) => projectStore.getProject(projectId),
    openProject: (projectId) => projectStore.getProject(projectId),
    closeProject: () => undefined,
    createProject: () => leftProject,
    updateProject: () => leftProject,
    deleteProject: () => ({ success: true }),
  };
  return {
    manager,
    projectStore,
    result,
    leftProject,
    rightProject,
    states,
    getSavedDuplicatePayload: () => savedDuplicatePayload,
    getSavedChapterContent: () => savedChapterContent,
  };
}

function registerForTest(overrides = {}) {
  const ipc = createIpcStub();
  const fixture = createManager();
  const expansionProject = {
    ...fixture.leftProject,
    projectId: 'expansion-project',
    projectName: '扩写项目',
    projectType: 'existing-plan-expansion',
  };
  const expansionCalls = [];
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
      prepareExpansionImport: (payload) => {
        expansionCalls.push(['prepare', payload]);
        return { success: true, token: 'expansion-token' };
      },
      confirmExpansionImport: (token, options) => {
        expansionCalls.push(['confirm', token, options]);
        return expansionProject;
      },
      discardExpansionImport: (token) => {
        expansionCalls.push(['discard', token]);
        return { success: true };
      },
    },
    technicalPlanStore: fixture.manager.getTechnicalPlanStore(fixture.leftProject.projectId),
    taskService: { cancelProjectTasks: async () => undefined },
    exportService: { exportWord: async () => ({ success: true }) },
    duplicateRewriteService,
    ...overrides,
  });
  return { ipc, fixture, expansionCalls, expansionProject };
}

test('registers expansion import handlers and forwards payloads unchanged', async () => {
  const { ipc, expansionCalls, expansionProject } = registerForTest();
  for (const channel of [
    'bid-project:prepare-expansion-import',
    'bid-project:confirm-expansion-import',
    'bid-project:discard-expansion-import',
  ]) {
    assert.equal(typeof ipc.handlers.get(channel), 'function', channel);
  }

  const payload = {
    tenderFilePaths: ['C:\\资料\\招标文件.docx'],
    originalPlanFilePaths: ['C:\\资料\\原方案.docx'],
  };
  const options = { projectName: '扩写项目' };
  assert.deepEqual(
    await ipc.handlers.get('bid-project:prepare-expansion-import')({}, payload),
    { success: true, token: 'expansion-token' },
  );
  assert.deepEqual(
    await ipc.handlers.get('bid-project:confirm-expansion-import')({}, 'expansion-token', options),
    expansionProject,
  );
  assert.deepEqual(
    await ipc.handlers.get('bid-project:discard-expansion-import')({}, 'expansion-token'),
    { success: true },
  );
  assert.deepEqual(expansionCalls, [
    ['prepare', payload],
    ['confirm', 'expansion-token', options],
    ['discard', 'expansion-token'],
  ]);
});

test('registers duplicate result and rewrite handlers without duplicating store logic', async () => {
  const { ipc, fixture } = registerForTest();
  for (const channel of [
    'bid-project:compare-content',
    'bid-project:recent-duplicate-summaries',
    'bid-project:load-duplicate-result',
    'bid-project:load-duplicate-result-page',
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
  const page = await ipc.handlers.get('bid-project:load-duplicate-result-page')({}, fixture.result.resultId, 0, 1);
  assert.equal(page.totalMatches, 1);
  assert.equal(page.matches[0].id, 'match-0-0');
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

test('compare-content keeps node mapping aligned after ignoring an illustration block', async () => {
  const { ipc, fixture } = registerForTest();
  fixture.states[fixture.leftProject.projectId].outlineData.outline[0].content = [
    '<!-- yibiao-illustration:start id="figure-1" -->',
    '![工期图](yibiao-asset://generated-images/figure-1.png)',
    '',
    '*<!-- yibiao-figure-caption -->六阶段工期进度甘特图*',
    '<!-- yibiao-illustration:end -->',
    '',
    '左侧正文内容足够长，能够被查重服务识别为同源重复段落，并且包含完整的项目管理事实。',
  ].join('\n');

  const result = await ipc.handlers.get('bid-project:compare-content')({}, {
    leftProjectId: fixture.leftProject.projectId,
    rightProjectId: fixture.rightProject.projectId,
    sensitivity: 'medium',
  });

  assert.equal(result.resultId, fixture.result.resultId);
  assert.equal(fixture.getSavedDuplicatePayload().summary.leftParagraphCount, 1);
  assert.equal(fixture.getSavedDuplicatePayload().matches[0].leftNodeId, 'left-node');
});

test('replace-content preserves an illustration block in the same raw paragraph', async () => {
  const { ipc, fixture } = registerForTest();
  const illustration = [
    '<! yibiaofigurecaption 六阶段工期进度甘特图 <! yibiaoillustration:end ',
    '同行正文仍需保留。',
  ].join('');
  fixture.states[fixture.leftProject.projectId].outlineData.outline[0].content = illustration;

  await ipc.handlers.get('bid-project:replace-content')({}, fixture.leftProject.projectId, {
    nodeId: 'left-node',
    oldText: '同行正文仍需保留。',
    newText: '改写后的正文。',
  });

  const saved = fixture.getSavedChapterContent();
  assert.equal(saved.nodeId, 'left-node');
  assert.match(saved.content, /yibiaofigurecaption/);
  assert.match(saved.content, /改写后的正文。/);
  assert.doesNotMatch(saved.content, /同行正文仍需保留。/);
});

test('replace-content fallback never replaces text inside an illustration block', async () => {
  const { ipc, fixture } = registerForTest();
  fixture.states[fixture.leftProject.projectId].outlineData.outline[0].content = [
    '<!-- yibiao-illustration:start id="figure-1" -->',
    '![重复句子](yibiao-asset://generated-images/figure-1.png)',
    '',
    '*<!-- yibiao-figure-caption -->重复句子*',
    '<!-- yibiao-illustration:end -->',
    '重复句子',
  ].join('\n');

  await ipc.handlers.get('bid-project:replace-content')({}, fixture.leftProject.projectId, {
    nodeId: 'left-node',
    oldText: '重复句子',
    newText: '改写后的正文。',
  });

  const saved = fixture.getSavedChapterContent();
  assert.match(saved.content, /!\[重复句子\]/);
  assert.match(saved.content, /改写后的正文。/);
  assert.match(saved.content, /<!-- yibiao-figure-caption -->重复句子/);
});
