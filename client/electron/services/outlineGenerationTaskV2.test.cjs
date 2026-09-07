const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInitialPrompt,
  createScorePlanningPrompt,
  createChildrenPrompt,
  MAX_OUTLINE_DEPTH,
  TECHNICAL_SCORE_GROUPS_SCHEMA,
  SCORE_DIRECTORY_PLAN_SCHEMA,
  SCORE_COVERAGE_MAP_SCHEMA,
  buildCapacityReference,
  buildOutlineReviewContext,
  validateFinalOutline,
  buildRemoteKnowledgeFile,
  runOutlineGenerationTaskV2,
} = require('./outlineGenerationTaskV2.cjs');

test('独立成册模式直接以技术评分大项作为一级目录', () => {
  const prompt = createInitialPrompt('按响应文件要求生成。', { standaloneTechnical: true });

  assert.match(prompt, /一级目录必须直接对应技术评分大项/);
  assert.match(prompt, /不得创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”/);
  assert.match(prompt, /不得加入商务、资信、投标函、授权委托书/);
});

test('独立成册评分规划把根节点固定为评分项层级', () => {
  const prompt = createScorePlanningPrompt({ standaloneTechnical: true });

  assert.match(prompt, /score_item_level 固定为 1/);
  assert.match(prompt, /target_title 必须与 root_title 完全一致/);
  assert.match(prompt, /不得再创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”/);
});

test('独立成册生成子目录时不重复评分项根标题', () => {
  const prompt = createChildrenPrompt({
    hasOriginalPlan: false,
    originalOnly: false,
    targetLeafCount: 10,
    allowRootChanges: false,
    standaloneTechnical: true,
  });

  assert.match(prompt, /现有一级根节点本身就是评分项映射节点/);
  assert.match(prompt, /不得在根节点下面再次生成同名评分项/);
  assert.doesNotMatch(prompt, /"title":"技术方案"/);
});

test('字数推算仅生成容量参考且不强制匹配叶子数量', () => {
  assert.deepEqual(buildCapacityReference({
    minimumWords: 10000,
    maximumWords: 14000,
    sectionWords: 3000,
  }), {
    suggested_ai_leaf_count: 4,
    advisory_only: true,
  });
});

test('评分规划和完整目录允许七级', () => {
  assert.equal(MAX_OUTLINE_DEPTH, 7);
  assert.equal(TECHNICAL_SCORE_GROUPS_SCHEMA.properties.version.const, 2);
  assert.equal(SCORE_DIRECTORY_PLAN_SCHEMA.properties.branches.items.properties.score_item_level.maximum, 7);
  assert.equal(SCORE_COVERAGE_MAP_SCHEMA.properties.version.const, 1);
});

test('目录审核把叶子数量作为参考并报告真实七级深度', () => {
  const leaf = (id, title) => ({ id, title, description: `${title}的具体响应内容`, content_mode: 'ai-generate' });
  let current = [leaf('1.1.1.1.1.1.1', '第七级甲'), leaf('1.1.1.1.1.1.2', '第七级乙')];
  for (let level = 6; level >= 2; level -= 1) {
    const id = Array.from({ length: level }, () => '1').join('.');
    current = [{ id, title: `第${level}级`, description: `第${level}级具体范围`, children: current }, leaf(`${id}.2`, `第${level + 1}级并列项`)];
  }
  const outline = {
    outline: [{ id: '1', title: '技术方案', description: '技术方案具体响应范围', attr: '技术', children: current }],
  };
  const context = buildOutlineReviewContext({ outline, scoreDirectoryPlan: { branches: [] }, targetLeafCount: 50 });

  assert.equal(context.leaf_count.advisory_only, true);
  assert.equal(context.leaf_count.suggested, 50);
  assert.equal('within_acceptable_range' in context.leaf_count, false);
  assert.equal(context.structure.max_depth, 7);
});

test('评分覆盖映射缺失时最终门禁失败', () => {
  const outline = {
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '响应项目总体方案评分要求',
      attr: '技术',
      content_mode: 'ai-generate',
    }],
  };
  const scorePlan = {
    version: 2,
    groups: [{
      requirement_id: 'R1',
      source_title: '项目总体方案',
      target_title: '项目总体方案',
      source_order: 1,
      expected_path: ['R1'],
      criteria: [],
    }],
  };
  const result = validateFinalOutline({
    outline,
    scorePlan,
    scoreCoverageMap: { version: 1, coverage_mode: 'full', records: [] },
  });

  assert.equal(result.valid, false);
  assert.ok(result.mandatoryIssues.some((issue) => issue.code === 'score-source-missing'));
});

test('远程目录参考文件明确标记为不可信材料且不泄露内部来源标识到标题', () => {
  const file = buildRemoteKnowledgeFile([
    { title: '规范片段', content: '远程正文', knowledgeBaseId: 'kb-secret', knowledgeId: 'doc-secret', chunkId: 'chunk-secret' },
  ]);
  assert.equal(file.path, '远程知识参考.md');
  assert.match(file.content, /仅是参考材料/);
  assert.match(file.content, /规范片段/);
  assert.match(file.content, /远程正文/);
  assert.doesNotMatch(file.content, /kb-secret|doc-secret|chunk-secret/);
});

test('original-only 真实目录任务不调用远程检索，也不注入远程文件', async () => {
  const searches = [];
  const runs = [];
  const storedPlan = {
    workflowKind: 'existing-plan-expansion',
    originalPlanFile: { fileName: '原方案.docx' },
    outlineExpansionMode: 'original-only',
    tenderFile: { fileName: '招标.md' },
    projectOverview: '智慧水务平台建设',
    bidAnalysisTasks: { responseFileRequirements: { content: '技术方案目录要求' } },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => storedPlan,
    readOriginalPlanMarkdown: () => '# 原方案目录',
    hasBidTemplate: () => false,
  };
  const root = { id: '1', title: '原方案一级', attr: '技术' };
  const runsOutput = [
    { outline: [root] },
    { outline: [{ ...root, content_mode: 'ai-generate' }] },
  ];
  const agentService = {
    runTask: async (input) => {
      runs.push(input);
      return { output_content: JSON.stringify(runsOutput.shift()) };
    },
    updatePersistentTask() {},
  };
  const checkpointTask = (patch, data) => ({ task: {
    task_id: 'task-outline-test',
    stats: data || {},
    logs: [],
    ...patch,
  } });
  await runOutlineGenerationTaskV2({
    aiService: {},
    agentService,
    ordinaryAgentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    knowledgeSession: { searchRemote: async (input) => { searches.push(input); return []; } },
    openXmlHelperService: {},
    updateTask: (patch) => ({ task_id: 'task-outline-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: {
      signal: new AbortController().signal,
      waitForOutlineSelection: async () => ({ items: [root], selectedIds: ['1'] }),
    },
    payload: {},
  });
  assert.equal(searches.length, 0);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].initial_stage, 'initial-outline');
  assert.deepEqual(runs[0].files, [{ path: '原方案.md', content: '# 原方案目录' }]);
  assert.equal(runs[0].files.some((file) => file.path === '远程知识参考.md'), false);
  assert.equal(runs[1].files.some((file) => file.path === '远程知识参考.md'), false);
});

test('非 original-only 真实目录任务按 outline 阶段检索并注入远程参考文件', async () => {
  const searches = [];
  const runs = [];
  const queryPlanningInputs = [];
  const storedPlan = {
    outlineMode: 'standalone-technical',
    techRequirements: '平台总体设计评分项-技术要求末尾',
    projectOverview: '智慧水务平台建设-项目概述末尾',
    bidAnalysisTasks: { responseFileRequirements: { content: '技术方案目录要求-响应要求末尾' } },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => storedPlan,
    hasBidTemplate: () => false,
  };
  const root = { id: '1', title: '平台总体设计', attr: '技术' };
  const outputs = [
    { outline: [root] },
    { outline: [{ ...root, content_mode: 'ai-generate' }] },
  ];
  const agentService = {
    runTask: async (input) => {
      runs.push(input);
      return { output_content: JSON.stringify(outputs.shift()) };
    },
    updatePersistentTask() {},
  };
  const checkpointTask = (patch, data) => ({ task: {
    task_id: 'task-outline-remote-test',
    stats: data || {},
    logs: [],
    ...patch,
  } });
  await runOutlineGenerationTaskV2({
    aiService: {
      collectJsonResponse: async (input) => {
        queryPlanningInputs.push(input);
        if (input.logTitle === '远程知识查询规划-outline') {
          return {
            queries: ['土地延包实施流程有哪些？', '成果汇交如何验收？', '质量和进度如何控制？'],
          };
        }
        throw new Error(`Unexpected AI request: ${input.logTitle}`);
      },
    },
    agentService,
    ordinaryAgentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    knowledgeSession: {
      searchRemote: async (input) => {
        searches.push(input);
        return [{ title: '远程规范片段', content: '平台总体设计参考' }];
      },
    },
    openXmlHelperService: {},
    updateTask: (patch) => ({ task_id: 'task-outline-remote-test', stats: {}, logs: [], ...patch }),
    checkpointTask,
    taskControl: {
      signal: new AbortController().signal,
      waitForOutlineSelection: async () => ({ items: [root], selectedIds: ['1'] }),
    },
    payload: {},
  });
  assert.equal(searches.length, 1);
  assert.deepEqual(searches[0], {
    stage: 'outline',
    queries: ['土地延包实施流程有哪些？', '成果汇交如何验收？', '质量和进度如何控制？'],
    matchCount: 8,
  });
  assert.equal(queryPlanningInputs.length, 1);
  const planningPrompt = queryPlanningInputs[0].messages[1].content;
  assert.match(planningPrompt, /项目概述末尾/);
  assert.match(planningPrompt, /响应要求末尾/);
  assert.match(planningPrompt, /技术要求末尾/);
  assert.equal(runs.length, 2);
  assert.ok(runs[1].files.some((file) => file.path === '远程知识参考.md'));
});
