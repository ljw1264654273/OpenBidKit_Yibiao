const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBidProjectVariantService } = require('./bidProjectVariantService.cjs');
const { createBidProjectManager } = require('./bidProjectManager.cjs');
const { calculateContentFingerprint } = require('./bidProjectVariantDeduplicationTask.cjs');

function createSourceFile() {
  return {
    fileName: '招标文件.docx',
    fileHash: 'file-hash',
    contentHash: 'content-hash',
    size: 128,
    modifiedAt: '2026-09-01T00:00:00.000Z',
  };
}

function createHarness({
  sourceStatus = 'completed',
  sourceType = 'technical-plan',
  tenderFile = { fileName: '招标文件.docx' },
  outlineData = {
    outline: [{
      id: 'chapter-1',
      title: '实施方案',
      content: '第一份标书正文',
      children: [{ id: 'section-1', title: '组织方式', content: '子章节正文' }],
    }],
  },
  importError = null,
} = {}) {
  const source = {
    projectId: 'source-project',
    projectName: '示范项目技术标',
    projectType: sourceType,
    status: sourceStatus,
    sourceGroupId: 'source-group',
    sourceFileName: '招标文件.docx',
    sourceFileHash: 'file-hash',
    sourceContentHash: 'content-hash',
    sourceFileSize: 128,
    sourceFileModifiedAt: '2026-09-01T00:00:00.000Z',
  };
  const seed = { marker: 'variant-seed' };
  const importedSeeds = [];
  const createdOptions = [];
  const deletedProjects = [];
  const projects = new Map([[source.projectId, source]]);
  const stores = new Map([[source.projectId, {
    loadTechnicalPlan: () => ({ tenderFile, outlineData }),
    exportVariantSeed: () => seed,
  }]]);
  const projectManager = {
    getProject: (projectId) => projects.get(projectId) || null,
    getProjectStore: () => ({
      listProjectSourceFiles: () => [{
        fileName: '招标文件.docx',
        fileHash: 'file-hash',
        contentHash: 'content-hash',
        size: 128,
      }],
    }),
    getTechnicalPlanStore: (projectId) => stores.get(projectId),
    createProject(options) {
      createdOptions.push(options);
      const created = {
        projectId: 'derived-project',
        projectName: '示范项目技术标 - 第 2 份',
        projectType: 'technical-plan',
        status: 'incomplete',
        sourceGroupId: source.sourceGroupId,
        derivedFromProjectId: source.projectId,
        uniquenessStatus: 'pending',
      };
      projects.set(created.projectId, created);
      stores.set(created.projectId, {
        importVariantSeed(value) {
          if (importError) throw importError;
          importedSeeds.push(value);
        },
      });
      return created;
    },
    updateProject(projectId, patch) {
      const updated = { ...projects.get(projectId), ...patch };
      projects.set(projectId, updated);
      return updated;
    },
    deleteProject(projectId) {
      deletedProjects.push(projectId);
      projects.delete(projectId);
      stores.delete(projectId);
      return { success: true };
    },
  };
  return {
    source,
    seed,
    projectManager,
    importedSeeds,
    createdOptions,
    deletedProjects,
  };
}

test('creates a technical-plan variant from a completed source and imports only its seed', async () => {
  const harness = createHarness();
  const service = createBidProjectVariantService({ projectManager: harness.projectManager });

  const created = await service.createVariantProject(harness.source.projectId);

  assert.equal(created.derivedFromProjectId, harness.source.projectId);
  assert.equal(created.currentStep, 'outline-generation');
  assert.equal(created.uniquenessStatus, 'pending');
  assert.equal(harness.createdOptions.length, 1);
  assert.equal(harness.createdOptions[0].projectType, 'technical-plan');
  assert.equal(harness.createdOptions[0].sourceGroupId, harness.source.sourceGroupId);
  assert.equal(harness.createdOptions[0].derivedFromProjectId, harness.source.projectId);
  assert.deepEqual(harness.importedSeeds, [harness.seed]);
});

test('rejects non-completed, expansion, or content-empty source projects', async () => {
  for (const options of [
    { sourceStatus: 'incomplete' },
    { sourceType: 'existing-plan-expansion' },
    { tenderFile: null },
    { outlineData: { outline: [{ id: 'chapter-1', title: '空章节' }] } },
  ]) {
    const harness = createHarness(options);
    const service = createBidProjectVariantService({ projectManager: harness.projectManager });
    await assert.rejects(
      () => service.createVariantProject(harness.source.projectId),
      /完成|普通技术方案|招标文件|正文/,
    );
    assert.equal(harness.createdOptions.length, 0);
  }
});

test('rejects creating a variant from another derived bid', async () => {
  const harness = createHarness();
  harness.source.derivedFromProjectId = 'original-source';

  await assert.rejects(
    createBidProjectVariantService({ projectManager: harness.projectManager })
      .createVariantProject(harness.source.projectId),
    /普通技术方案/,
  );
  assert.equal(harness.createdOptions.length, 0);
});

test('deletes the half-created project when seed import fails', async () => {
  const harness = createHarness({ importError: new Error('复制失败') });
  const service = createBidProjectVariantService({ projectManager: harness.projectManager });

  await assert.rejects(() => service.createVariantProject(harness.source.projectId), /复制失败/);
  assert.deepEqual(harness.deletedProjects, ['derived-project']);
  assert.ok(harness.projectManager.getProject(harness.source.projectId));
});

test('returns the source outline as a content-free difference reference', () => {
  const harness = createHarness();
  harness.projectManager.createProject({});
  const service = createBidProjectVariantService({ projectManager: harness.projectManager });

  const baseline = service.getVariantBaselineOutline('derived-project');

  assert.equal(baseline.outline[0].title, '实施方案');
  assert.equal(Object.hasOwn(baseline.outline[0], 'content'), false);
  assert.equal(Object.hasOwn(baseline.outline[0].children[0], 'content'), false);
});

test('copies tender and successful analysis into a clean outline-stage workspace and invalidates manual edits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-variant-integration-'));
  const db = new Database(':memory:');
  const app = { getPath: () => root };
  const manager = createBidProjectManager({
    app,
    db,
    fileService: {},
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
    configStore: { load: () => ({}) },
  });
  try {
    const sourceDocxPath = path.join(root, '招标原件.docx');
    fs.writeFileSync(sourceDocxPath, 'docx-fixture');
    const source = manager.createProject({
      projectName: '真实项目',
      sourceFile: createSourceFile(),
    });
    const sourceStore = manager.getTechnicalPlanStore(source.projectId);
    sourceStore.importVariantSeed({
      tenderFile: { fileName: '招标文件.docx', parserLabel: '测试解析器' },
      tenderFiles: [{
        id: 'tender-1',
        fileName: '招标文件.docx',
        markdown: '# 招标原文',
        sourceDocxPath,
      }],
      workingMarkdown: '# 当前标段\n技术要求',
      originalMarkdown: '# 招标原文\n第一标段\n第二标段',
      bidAnalysisMode: 'custom',
      bidAnalysisSelectedTaskIds: ['projectOverview', 'techRequirements'],
      bidAnalysisTasks: {
        projectOverview: { id: 'projectOverview', status: 'success', content: '项目概况' },
        techRequirements: { id: 'techRequirements', status: 'success', content: '技术要求' },
        ignoredError: { id: 'ignoredError', status: 'error', content: '不得复制' },
      },
      bidSectionMode: 'multiple',
      bidSections: [{ id: 'section-1', index: 1, title: '第一标段' }],
      bidSectionExtractionStatus: 'success',
      selectedSectionId: 'section-1',
      selectedSectionTitle: '第一标段',
    });
    sourceStore.saveOutline({
      reason: 'replace',
      outlineData: { outline: [{ id: 'node-1', title: '实施方案' }] },
    });
    sourceStore.saveChapterContent({ nodeId: 'node-1', content: '第一份正文' });
    sourceStore.updateTechnicalPlan({
      outlineWordControlOptions: { minimumWords: 200000, maximumWords: 300000, sectionWords: 1800, strictSectionWords: false },
      contentGenerationOptions: { imagePreset: 'enhanced', tableRequirement: 'heavy', maxTables: 10 },
      globalFacts: [{ id: 'facts', title: '项目事实', items: [] }],
      contentGenerationTask: {
        task_id: 'content-task',
        status: 'success',
        progress: 100,
        started_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:01:00.000Z',
      },
    });
    manager.updateProject(source.projectId, { status: 'completed' });

    const service = createBidProjectVariantService({ projectManager: manager });
    const derived = await service.createVariantProject(source.projectId);
    const derivedStore = manager.getTechnicalPlanStore(derived.projectId);
    const state = derivedStore.loadTechnicalPlan();

    assert.equal(state.step, 'outline-generation');
    assert.deepEqual(state.outlineWordControlOptions, {
      minimumWords: 40000,
      maximumWords: 60000,
      sectionWords: 1800,
      strictSectionWords: false,
    });
    assert.equal(state.contentGenerationOptions.tableRequirement, 'light');
    assert.equal(state.contentGenerationOptions.maxTables, 3);
    assert.equal(state.contentGenerationOptions.imagePreset, 'text-only');
    assert.equal(state.contentGenerationOptions.useAiImages, false);
    assert.equal(state.contentGenerationOptions.useMermaidImages, false);
    assert.equal(state.contentGenerationOptions.useHtmlImages, false);
    assert.equal(sourceStore.loadTechnicalPlan().contentGenerationOptions.imagePreset, 'enhanced');
    assert.equal(sourceStore.loadTechnicalPlan().outlineWordControlOptions.minimumWords, 200000);
    assert.equal(derivedStore.readTenderMarkdown().trim(), '# 当前标段\n技术要求');
    assert.equal(derivedStore.readOriginalTenderMarkdown().trim(), '# 招标原文\n第一标段\n第二标段');
    assert.equal(derivedStore.readTenderSourceMarkdown('tender-1').trim(), '# 招标原文');
    assert.equal(state.bidAnalysisTasks.projectOverview.status, 'success');
    assert.equal(state.bidAnalysisTasks.techRequirements.status, 'success');
    assert.equal(state.bidAnalysisTasks.ignoredError, undefined);
    assert.equal(state.outlineData, null);
    assert.deepEqual(state.globalFacts, []);
    assert.equal(state.contentGenerationTask, undefined);
    assert.equal(derivedStore.listTenderSourceDocxRelativePaths().length, 1);

    derivedStore.saveOutline({
      reason: 'replace',
      outlineData: { outline: [{ id: 'derived-node', title: '差异化方案' }] },
    });
    derivedStore.saveChapterContent({ nodeId: 'derived-node', content: '生成正文' });
    manager.updateProject(derived.projectId, {
      status: 'completed',
      uniquenessStatus: 'passed',
      uniquenessResultId: 'passed-result',
      uniquenessAutoRunRequested: true,
    });
    derivedStore.updateTechnicalPlan({
      variantDeduplicationTask: {
        task_id: 'stale-variant-task',
        type: 'variant-deduplication',
        status: 'success',
        progress: 100,
        logs: [],
      },
    });
    derivedStore.saveChapterContent({ nodeId: 'derived-node', content: '人工修改后的正文' });
    const invalidated = manager.getProject(derived.projectId);
    assert.equal(invalidated.status, 'incomplete');
    assert.equal(invalidated.uniquenessStatus, 'pending');
    assert.equal(invalidated.uniquenessResultId, undefined);
    assert.equal(invalidated.uniquenessAutoRunRequested, false);
    assert.equal(derivedStore.loadTechnicalPlan().variantDeduplicationTask, undefined);

    manager.updateProject(derived.projectId, {
      status: 'completed',
      uniquenessStatus: 'passed',
      uniquenessResultId: 'second-passed-result',
      uniquenessAutoRunRequested: true,
    });
    derivedStore.updateTechnicalPlan({
      variantDeduplicationTask: {
        task_id: 'second-stale-variant-task',
        type: 'variant-deduplication',
        status: 'error',
        progress: 80,
        logs: [],
      },
    });
    derivedStore.updateTechnicalPlan({
      contentGenerationItem: {
        nodeId: 'derived-node',
        section: { status: 'success', content: '后台任务重新生成的正文' },
      },
    });
    const taskInvalidated = manager.getProject(derived.projectId);
    assert.equal(taskInvalidated.status, 'incomplete');
    assert.equal(taskInvalidated.uniquenessStatus, 'pending');
    assert.equal(taskInvalidated.uniquenessResultId, undefined);
    assert.equal(taskInvalidated.uniquenessAutoRunRequested, true);
    assert.equal(derivedStore.loadTechnicalPlan().variantDeduplicationTask, undefined);

    derivedStore.updateTechnicalPlan({
      variantDeduplicationTask: {
        task_id: 'active-variant-task',
        type: 'variant-deduplication',
        status: 'running',
        progress: 30,
        logs: [],
      },
    });
    derivedStore.saveChapterContent({
      nodeId: 'derived-node',
      content: '自动查重改写后的正文',
      reason: 'variant-deduplication',
    });
    assert.equal(
      derivedStore.loadTechnicalPlan().variantDeduplicationTask.task_id,
      'active-variant-task',
    );

    derivedStore.updateTechnicalPlan({
      contentGenerationTask: {
        task_id: 'derived-content-task',
        status: 'success',
        progress: 100,
        started_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:01:00.000Z',
      },
    });

    const sourceFingerprint = calculateContentFingerprint(sourceStore);
    const derivedFingerprint = calculateContentFingerprint(derivedStore);
    const resultId = manager.getProjectStore().saveDuplicateResult({
      leftProjectId: source.projectId,
      rightProjectId: derived.projectId,
      summary: {
        duplicateParagraphCount: 0,
        exactSentenceCount: 0,
        leftContentFingerprint: sourceFingerprint,
        rightContentFingerprint: derivedFingerprint,
      },
      matches: [],
    });
    manager.updateProject(derived.projectId, {
      status: 'completed',
      uniquenessStatus: 'passed',
      uniquenessResultId: resultId,
      uniquenessAutoRunRequested: false,
    });
    assert.equal(manager.getProject(derived.projectId).status, 'completed');

    sourceStore.saveChapterContent({ nodeId: 'node-1', content: '第一份正文后来发生修改' });
    const stale = manager.getProject(derived.projectId);
    assert.equal(stale.status, 'incomplete');
    assert.equal(stale.uniquenessStatus, 'pending');
    assert.equal(stale.uniquenessResultId, undefined);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves illustration review items when variant deduplication rewrites body text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-variant-illustration-review-'));
  const db = new Database(':memory:');
  const manager = createBidProjectManager({
    app: { getPath: () => root },
    db,
    fileService: {},
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
    configStore: { load: () => ({}) },
  });
  try {
    const project = manager.createProject({ projectName: '第二份标书', sourceFile: createSourceFile() });
    const store = manager.getTechnicalPlanStore(project.projectId);
    store.saveOutline({
      reason: 'replace',
      outlineData: { outline: [{ id: 'node-1', title: '总体进度安排' }] },
    });
    store.saveChapterContent({ nodeId: 'node-1', content: '原正文' });
    store.updateTechnicalPlan({
      contentIllustrationPlan: {
        plan_version: 1,
        revision: 'variant-review-plan',
        items: [{
          item_id: 'variant-image-1',
          kind: 'html',
          image_type: 'gantt',
          title: '项目实施进度图',
          section_ids: ['node-1'],
          placement: 'before',
          generation: {
            status: 'success',
            review_status: 'pending',
            asset_url: 'yibiao-asset://generated-images/variant-image.png',
          },
        }],
      },
    });

    store.saveChapterContent({
      nodeId: 'node-1',
      content: '同源查重改写后的正文',
      reason: 'variant-deduplication',
    });

    const plan = store.loadTechnicalPlan().contentIllustrationPlan;
    assert.equal(plan.items[0].item_id, 'variant-image-1');
    assert.equal(plan.items[0].generation.review_status, 'pending');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
