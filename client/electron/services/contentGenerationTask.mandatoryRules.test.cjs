const assert = require('node:assert/strict');
const test = require('node:test');

const { __mandatoryBidContentRulesTestRuntime: runtime } = require('./contentGenerationTask.cjs');

const FACTS = '工期事实：合同生效后30日内完成全部验收和交付。';
const chapter = { id: '1.1', title: '进度计划', description: '项目实施安排' };
const context = { item: chapter, parentChapters: [], siblingChapters: [] };
const joinMessages = (messages) => messages.map((message) => message.content).join('\n');

function assertScheduleRule(prompt, { facts = true } = {}) {
  if (facts) assert.match(prompt, /合同生效后30日/);
  assert.match(prompt, /硬性边界/);
  assert.match(prompt, /紧凑/);
  assert.match(prompt, /并行/);
  assert.match(prompt, /不评估实际能否完成/);
  assert.match(prompt, /全部工作、验收和成果交付/);
  assert.match(prompt, /相对时间/);
  assert.match(prompt, /开标、中标或合同生效前/);
  assert.match(prompt, /更现实.*延长/);
}

test('chapter planning and first content generation receive mandatory schedule bounds', () => {
  const planning = joinMessages(runtime.buildChapterContentPlanMessages({
    chapter, parentChapters: [], siblingChapters: [], projectOverview: '',
    bidAnalysisFactsText: FACTS, globalFactTitlesText: '', tableRequirement: 'none', knowledgeItems: [],
  }));
  const generation = joinMessages(runtime.buildChapterContentMessages({
    chapter, projectOverview: '', bidAnalysisFactsText: FACTS, selectedFactsText: '',
    contentPlan: null, knowledgeContents: [], wordControl: {},
  }));
  assertScheduleRule(planning);
  assertScheduleRule(generation);
});

test('ordinary and Agent restored optimization preserve tender schedule bounds', () => {
  const ordinary = joinMessages(runtime.buildRestoredChapterContentMessages({
    chapter, projectOverview: '', bidAnalysisFactsText: FACTS, selectedFactsText: '',
    contentPlan: null, knowledgeContents: [], restoredContent: '既有进度正文', wordControl: {},
  }));
  const agent = [
    runtime.buildAgentRestoredChapterContentPrompt('fabricate'),
    ...runtime.buildAgentRestoredChapterContentFiles({
      chapter, projectOverview: '', bidAnalysisFactsText: FACTS, selectedFactsText: '', contentPlan: null,
      knowledgeContents: [], restoredContent: '既有进度正文', wordControl: {},
    }).map((file) => file.content),
  ].join('\n');
  assertScheduleRule(ordinary);
  assertScheduleRule(agent);
});

test('word adjustment cannot extend or move a compact tender schedule', () => {
  const prompt = joinMessages(runtime.buildWordAdjustmentMessages({
    context, currentContent: '当前进度正文', currentWords: 10, targetWords: 20,
    mode: 'expand', granularity: 'sentence', selectedFactsText: '', bidAnalysisFactsText: FACTS,
    maximumChangeWords: 20, totalRemainingWords: 10, globalFactsMode: 'fabricate',
  }));
  assertScheduleRule(prompt);
});

test('normal and Agent original coverage repair receive Step02 schedule facts', () => {
  const target = { ...context, sources: [{ id: 'S1', content: '原进度' }] };
  const normal = joinMessages(runtime.buildOriginalCoverageRepairMessages({
    target, coverageItems: [{ source_id: 'S1' }], currentContent: '当前正文', attempt: 1,
    failures: [], bidAnalysisFactsText: FACTS,
  }));
  const agent = [
    runtime.buildAgentOriginalCoverageRepairPrompt(),
    runtime.buildAgentBidAnalysisFactsMarkdown(FACTS),
  ].join('\n');
  assertScheduleRule(normal);
  assertScheduleRule(agent);
});

test('normal and Agent consistency repair receive Step02 schedule facts', () => {
  const normal = joinMessages(runtime.buildConsistencyRepairMessages({
    context, conflicts: [], globalFactsText: '', bidAnalysisFactsText: FACTS,
    currentContent: '当前正文', attempt: 1, failures: [], tableRequirement: 'none', globalFactsMode: 'fabricate',
  }));
  const agent = [
    runtime.buildAgentConsistencyRepairPrompt('fabricate'),
    runtime.buildAgentFactsMarkdown('', FACTS),
  ].join('\n');
  assertScheduleRule(normal);
  assertScheduleRule(agent);
});

test('JSON correction retries keep the same schedule facts and deadline rule', () => {
  const retries = [
    runtime.buildWordAdjustmentRepairMessages(
      { invalidContent: '{}', issues: ['格式错误'] }, 'expand', 'sentence', '当前正文', FACTS,
    ),
    runtime.buildContentExpansionRepairMessages(
      { invalidContent: '{}', issues: ['格式错误'] }, '当前正文', FACTS,
    ),
    runtime.buildConsistencyRepairJsonRepairMessages(
      { invalidContent: '{}', issues: ['格式错误'] }, chapter.id, FACTS,
    ),
  ];
  retries.map(joinMessages).forEach((prompt) => assertScheduleRule(prompt));
});
