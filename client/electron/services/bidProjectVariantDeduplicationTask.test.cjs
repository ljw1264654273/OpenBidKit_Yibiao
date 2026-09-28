const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readProjectParagraphs,
  replaceMatchedParagraph,
  runBidProjectVariantDeduplicationTask,
} = require('./bidProjectVariantDeduplicationTask.cjs');
const { compareBidContents } = require('./bidContentDuplicateService.cjs');

function makeOutline(content) {
  return { outline: [{ id: 'node-1', title: '实施方案', content }] };
}

function createHarness({ sourceContent, derivedContent, rewriteResponses = [], compareContents }) {
  const projects = new Map([
    ['source', { projectId: 'source', projectName: '第一份标书', status: 'completed' }],
    ['derived', {
      projectId: 'derived',
      projectName: '第二份标书',
      status: 'incomplete',
      derivedFromProjectId: 'source',
      uniquenessStatus: 'pending',
    }],
  ]);
  const sourceState = { outlineData: makeOutline(sourceContent) };
  const derivedState = { outlineData: makeOutline(derivedContent) };
  const sourceStore = {
    loadTechnicalPlan: () => structuredClone(sourceState),
    readTenderMarkdown: () => '# 招标要求\n不参与查重的固定原文。',
  };
  const saves = [];
  const derivedStore = {
    loadTechnicalPlan: () => structuredClone(derivedState),
    readTenderMarkdown: () => '# 招标要求\n不参与查重的固定原文。',
    saveChapterContent({ nodeId, content }) {
      saves.push({ nodeId, content });
      derivedState.outlineData.outline[0].content = content;
    },
  };
  const results = new Map();
  const projectStore = {
    saveDuplicateResult(result) {
      const resultId = result.resultId || `result-${results.size + 1}`;
      results.set(resultId, { ...structuredClone(result), resultId });
      return resultId;
    },
  };
  const manager = {
    getProject: (id) => projects.get(id) || null,
    getTechnicalPlanStore: (id) => (id === 'source' ? sourceStore : derivedStore),
    getProjectStore: () => projectStore,
    updateProject(id, patch) {
      const updated = { ...projects.get(id), ...patch };
      projects.set(id, updated);
      return updated;
    },
  };
  let rewriteCall = 0;
  const aiService = {
    async requestJson() {
      const response = rewriteResponses[Math.min(rewriteCall, rewriteResponses.length - 1)];
      rewriteCall += 1;
      return typeof response === 'function' ? response(rewriteCall) : response;
    },
  };
  const taskSnapshots = [];
  const updateTask = (patch) => {
    taskSnapshots.push(patch);
    return patch;
  };
  const checkpointTask = (patch) => {
    taskSnapshots.push(patch);
    return { task: patch };
  };
  return {
    manager,
    aiService,
    projects,
    sourceState,
    derivedState,
    results,
    saves,
    taskSnapshots,
    getRewriteCallCount: () => rewriteCall,
    run: (taskControl = { signal: new AbortController().signal }) => runBidProjectVariantDeduplicationTask({
      aiService,
      bidProjectManager: manager,
      updateTask,
      checkpointTask,
      taskControl,
      compareContents,
      payload: { projectId: 'derived' },
    }),
  };
}

test('publishes worker comparison progress before the uniqueness task completes', async () => {
  const harness = createHarness({
    sourceContent: '第一份标书采用现场集中协调机制，按周组织联席会议并留存闭环记录。',
    derivedContent: '第二份标书设置分层负责制度，由专业负责人每日汇总风险并安排后续处置。',
    compareContents: async (input, { onProgress }) => {
      onProgress(25);
      await new Promise((resolve) => setImmediate(resolve));
      onProgress(100);
      return compareBidContents(input);
    },
  });

  await harness.run();

  const comparisonUpdates = harness.taskSnapshots.filter((patch) => patch.stats?.uniqueness?.phase === 'comparing');
  assert.ok(comparisonUpdates.length >= 2);
  assert.ok(comparisonUpdates[0].progress > 0);
  assert.ok(comparisonUpdates.at(-1).progress >= comparisonUpdates[0].progress);
});

test('passes on the initial zero-match check and persists both body fingerprints', async () => {
  const harness = createHarness({
    sourceContent: '第一份标书采用现场集中协调机制，按周组织联席会议并留存闭环记录。',
    derivedContent: '第二份标书设置分层负责制度，由专业负责人每日汇总风险并安排后续处置。',
  });

  const result = await harness.run();

  assert.equal(result.summary.duplicateParagraphCount, 0);
  assert.equal(result.summary.exactSentenceCount, 0);
  assert.match(result.summary.leftContentFingerprint, /^[a-f0-9]{64}$/);
  assert.match(result.summary.rightContentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(harness.projects.get('derived').status, 'completed');
  assert.equal(harness.projects.get('derived').uniquenessStatus, 'passed');
  assert.equal(harness.projects.get('derived').uniquenessAttempts, 0);
  assert.equal(harness.saves.length, 0);
});

test('preserves markdown heading line breaks in the content sent to exact sentence comparison', () => {
  const repeatedSentence = '党中央、国务院明确保持土地承包关系稳定并长久不变，第二轮土地承包到期后再延长三十年。';
  const source = readProjectParagraphs({
    outlineData: makeOutline([
      '1. **国家层面政策背景**',
      `   ${repeatedSentence}`,
      '   1. **法律与制度依据：** 相关法律构成项目实施的制度基础。',
    ].join('\n')),
  });
  const derived = readProjectParagraphs({
    outlineData: makeOutline(`农村土地承包经营制度经历持续完善。\n${repeatedSentence}`),
  });

  const result = compareBidContents({
    leftContent: source.content,
    rightContent: derived.content,
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
});

test('rewrites only the derived side and rechecks until the built-in checker reaches zero', async () => {
  const repeated = '项目团队建立统一协调机制，明确各专业岗位职责，并按照计划推进全部实施工作。';
  const harness = createHarness({
    sourceContent: repeated,
    derivedContent: repeated,
    rewriteResponses: [{
      rewrittenText: '各专业负责人分别维护工作台账，项目负责人依据现场反馈安排下一阶段任务并跟踪关闭情况。',
      reason: '重组叙述结构',
      riskNote: '无明显风险',
    }],
  });

  await harness.run();

  assert.equal(harness.sourceState.outlineData.outline[0].content, repeated);
  assert.match(harness.derivedState.outlineData.outline[0].content, /工作台账/);
  assert.equal(harness.projects.get('derived').uniquenessStatus, 'passed');
  assert.equal(harness.projects.get('derived').uniquenessAttempts, 1);
  assert.equal(harness.getRewriteCallCount(), 1);
});

test('merges multiple paragraph rewrites in the same node into one save per round', async () => {
  const first = '项目团队建立统一协调机制，明确各专业岗位职责，并按照计划推进全部实施工作。';
  const second = '质量人员执行全过程检查制度，发现问题后立即登记并持续跟踪整改完成情况。';
  const harness = createHarness({
    sourceContent: `${first}\n\n${second}`,
    derivedContent: `${first}\n\n${second}`,
    rewriteResponses: [
      { rewrittenText: '现场事项由各专业负责人分别登记，项目负责人汇总风险后安排处置顺序并验收关闭。', reason: '改写一', riskNote: '无明显风险' },
      { rewrittenText: '检查人员按工序记录验证结果，偏差项进入整改清单并在复核合格后完成销项。', reason: '改写二', riskNote: '无明显风险' },
    ],
  });

  await harness.run();

  assert.equal(harness.getRewriteCallCount(), 2);
  assert.equal(harness.saves.length, 1);
  assert.match(harness.saves[0].content, /处置顺序/);
  assert.match(harness.saves[0].content, /整改清单/);
});

test('rewrites a derived paragraph only once when multiple source paragraphs match it', async () => {
  const shared = '项目团队建立统一协调机制，明确各专业岗位职责，并按照计划推进全部实施工作。';
  const harness = createHarness({
    sourceContent: `${shared}\n\n${shared}现场另设复核岗位。`,
    derivedContent: shared,
    rewriteResponses: [{
      rewrittenText: '专业负责人登记现场事项，复核岗位根据台账安排后续处置并逐项确认结果。',
      reason: '重新组织', riskNote: '无',
    }],
  });

  await harness.run();

  assert.equal(harness.getRewriteCallCount(), 1);
  assert.equal(harness.projects.get('derived').uniquenessStatus, 'passed');
});

test('targets the selected occurrence when identical paragraphs appear twice in a chapter', () => {
  const repeated = '项目团队建立统一协调机制，明确各专业岗位职责，并按照计划推进全部实施工作。';
  const replacement = '现场团队分工建立记录清单，责任人逐日核对进度并针对偏差安排复核。';
  assert.equal(
    replaceMatchedParagraph(`${repeated}\n\n${repeated}`, repeated, replacement, 1),
    `${repeated}\n\n${replacement}`,
  );
});

test('retries rewrites that lose protected numbers, dates, percentages, book titles, or standard codes', async () => {
  const repeated = '本项目自2026年9月27日起执行《安全生产法》和ISO 9001要求，抽检比例保持35%，共设置12个检查点。';
  const harness = createHarness({
    sourceContent: repeated,
    derivedContent: repeated,
    rewriteResponses: [
      { rewrittenText: '项目将执行相关制度并安排抽检。', reason: '遗漏事实', riskNote: '有风险' },
      { rewrittenText: '12个检查点自2026年9月27日起启用，抽检比例固定为35%；执行过程同时遵循《安全生产法》与ISO 9001要求。', reason: '保留事实后重组', riskNote: '无明显风险' },
    ],
  });

  await harness.run();

  assert.equal(harness.getRewriteCallCount(), 2);
  assert.equal(harness.projects.get('derived').uniquenessStatus, 'passed');
});

test('fails after five rewrite rounds when duplicate matches remain', async () => {
  const repeated = '项目团队建立统一协调机制，明确各专业岗位职责，并按照计划推进全部实施工作。';
  const harness = createHarness({
    sourceContent: repeated,
    derivedContent: repeated,
    rewriteResponses: [{ rewrittenText: repeated, reason: '未改变', riskNote: '无明显风险' }],
  });

  await assert.rejects(() => harness.run(), /5 轮|仍有/);

  assert.equal(harness.projects.get('derived').status, 'failed');
  assert.equal(harness.projects.get('derived').uniquenessStatus, 'failed');
  assert.equal(harness.projects.get('derived').uniquenessAttempts, 5);
  assert.equal(harness.getRewriteCallCount(), 5);
  const finalResult = [...harness.results.values()].at(-1);
  assert.ok(finalResult.summary.duplicateParagraphCount > 0);
});

test('cancellation clears automatic scheduling and returns the project to pending', async () => {
  const repeated = '项目团队建立统一协调机制，明确各专业岗位职责，并按照计划推进全部实施工作。';
  const harness = createHarness({ sourceContent: repeated, derivedContent: repeated });
  const controller = new AbortController();
  const reason = new Error('用户取消查重');
  reason.code = 'TASK_CANCELLED';
  controller.abort(reason);

  await assert.rejects(() => harness.run({ signal: controller.signal }), /用户取消查重/);

  const derived = harness.projects.get('derived');
  assert.equal(derived.status, 'incomplete');
  assert.equal(derived.uniquenessStatus, 'pending');
  assert.equal(derived.uniquenessAutoRunRequested, false);
});
