const assert = require('node:assert/strict');
const test = require('node:test');

const {
  runContentGenerationTask,
  shouldGenerateMermaidReviewDraft,
} = require('./contentGenerationTask.cjs');

test('Mermaid 初次生成始终先进入审核草稿，不受 AI 重绘配置影响', () => {
  assert.equal(shouldGenerateMermaidReviewDraft({ kind: 'mermaid' }, false), true);
  assert.equal(shouldGenerateMermaidReviewDraft({ kind: 'mermaid' }, true), false);
  assert.equal(shouldGenerateMermaidReviewDraft({ kind: 'ai' }, false), false);
});

test('专项 Mermaid AI 重绘批量处理已确认项并强制使用生图模型', async () => {
  const generatedImages = [];
  const state = {
    workflowKind: 'technical-plan',
    outlineData: {
      project_overview: '智慧水务',
      outline: [
        { id: 's1', title: '实施组织', description: '实施组织', content_mode: 'ai-generate', content: '实施组织正文。' },
        { id: 's2', title: '验收流程', description: '验收流程', content_mode: 'ai-generate', content: '验收流程正文。' },
      ],
    },
    globalFacts: [{ title: '项目事实', content: '项目周期为 180 日历天。' }],
    globalFactsTask: { status: 'success' },
    contentGenerationOptions: {
      enableConsistencyAudit: false,
      useAiImages: false,
      useMermaidImages: true,
      useAiRedesignForMermaid: false,
      useHtmlImages: false,
      tableRequirement: 'none',
      maxAiImages: 0,
      maxMermaidImages: 2,
      maxHtmlImages: 0,
      htmlImageTypes: '',
    },
    contentGenerationSections: {
      s1: { id: 's1', title: '实施组织', status: 'success', content: '实施组织正文。' },
      s2: { id: 's2', title: '验收流程', status: 'success', content: '验收流程正文。' },
    },
    contentGenerationPlans: {},
    contentIllustrationPlan: {
      plan_version: 3,
      revision: 'test',
      items: [
        {
          item_id: 'm1',
          kind: 'mermaid',
          image_type: 'process',
          title: '实施组织流程图',
          section_ids: ['s1'],
          placement: 'after',
          priority: 1,
          generation: {
            status: 'pending',
            code: 'flowchart TD\n  A["启动"] --> B["实施"]',
            review_status: 'confirmed',
          },
        },
        {
          item_id: 'm2',
          kind: 'mermaid',
          image_type: 'process',
          title: '验收流程图',
          section_ids: ['s2'],
          placement: 'after',
          priority: 2,
          generation: {
            status: 'pending',
            code: 'flowchart TD\n  A["自检"] --> B["验收"]',
            review_status: 'confirmed',
          },
        },
        {
          item_id: 'm3',
          kind: 'mermaid',
          image_type: 'process',
          title: '未确认流程图',
          section_ids: ['s2'],
          placement: 'after',
          priority: 3,
          generation: {
            status: 'reviewing',
            code: 'flowchart TD\n  A["待确认"] --> B["暂不重绘"]',
            review_status: 'pending',
          },
        },
      ],
    },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => structuredClone(state),
    updateTechnicalPlanWithoutReload: (patch) => Object.assign(state, patch),
  };
  const checkpointTask = (taskPatch, workspacePatch = {}) => {
    Object.assign(state, workspacePatch);
    if (workspacePatch.contentIllustrationItem) {
      state.contentIllustrationPlan = {
        ...state.contentIllustrationPlan,
        items: state.contentIllustrationPlan.items.map((item) => (
          item.item_id === workspacePatch.contentIllustrationItem.item_id
            ? workspacePatch.contentIllustrationItem
            : item
        )),
      };
    }
    state.contentGenerationTask = { ...(state.contentGenerationTask || {}), ...taskPatch };
    return { task: state.contentGenerationTask };
  };
  const aiService = {
    getConfig: () => ({ concurrency_limit: 1, image_model: { concurrency_limit: 1 } }),
    getImageModelAvailability: () => ({ available: true }),
    collectJsonResponse: async () => {
      throw new Error('专项 Mermaid AI 重绘不应重新生成 Mermaid 代码');
    },
    generateImage: async ({ logTitle, prompt }) => {
      generatedImages.push({ logTitle, prompt });
      return { asset_url: `yibiao-asset://generated-images/${generatedImages.length}.png` };
    },
  };

  await runContentGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    knowledgeSession: {},
    updateTask: (patch) => ({ ...(state.contentGenerationTask || {}), ...patch }),
    checkpointTask,
    taskControl: { signal: new AbortController().signal, isPauseRequested: () => false },
    payload: { redrawConfirmedMermaidIllustrations: true },
  });

  assert.deepEqual(generatedImages.map((entry) => entry.logTitle), [
    'Mermaid AI图片重绘-m1-实施组织流程图',
    'Mermaid AI图片重绘-m2-验收流程图',
  ]);
  assert.match(generatedImages[0].prompt, /已校验 Mermaid 代码/);
  assert.equal(state.contentIllustrationPlan.items.find((item) => item.item_id === 'm1')?.generation?.status, 'success');
  assert.equal(state.contentIllustrationPlan.items.find((item) => item.item_id === 'm2')?.generation?.status, 'success');
  assert.equal(state.contentIllustrationPlan.items.find((item) => item.item_id === 'm3')?.generation?.status, 'reviewing');
});

test('统一图片候选重绘只处理指定图片并保留原图资源', async () => {
  const generatedImages = [];
  const state = {
    workflowKind: 'technical-plan',
    outlineData: {
      project_overview: '智慧水务',
      outline: [
        { id: 's1', title: '实施组织', description: '实施组织', content_mode: 'ai-generate', content: '实施组织正文。' },
        { id: 's2', title: '设备部署', description: '设备部署', content_mode: 'ai-generate', content: '设备部署正文。' },
      ],
    },
    globalFacts: [{ title: '项目事实', content: '项目周期为 180 日历天。' }],
    globalFactsTask: { status: 'success' },
    contentGenerationOptions: {
      enableConsistencyAudit: false,
      useAiImages: true,
      useMermaidImages: true,
      useHtmlImages: false,
      tableRequirement: 'none',
    },
    contentGenerationSections: {
      s1: { id: 's1', title: '实施组织', status: 'error', content: '实施组织正文。', error: '正文旧错误' },
      s2: { id: 's2', title: '设备部署', status: 'success', content: '设备部署正文。' },
    },
    contentGenerationPlans: {},
    contentIllustrationPlan: {
      plan_version: 3,
      revision: 'test',
      items: [
        {
          item_id: 'ai1',
          kind: 'ai',
          image_type: 'engineering',
          title: '设备部署图',
          section_ids: ['s2'],
          placement: 'after',
          priority: 1,
          generation: {
            status: 'success',
            review_status: 'confirmed',
            asset_url: 'yibiao-asset://generated-images/original-ai.png',
          },
        },
        {
          item_id: 'm1',
          kind: 'mermaid',
          image_type: 'process',
          title: '实施组织流程图',
          section_ids: ['s1'],
          placement: 'after',
          priority: 2,
          generation: {
            status: 'pending',
            code: 'flowchart TD\n  A["启动"] --> B["实施"]',
            review_status: 'confirmed',
          },
        },
      ],
    },
  };
  const workspaceStore = {
    loadTechnicalPlan: () => structuredClone(state),
    updateTechnicalPlanWithoutReload: (patch) => Object.assign(state, patch),
  };
  const checkpointTask = (taskPatch, workspacePatch = {}) => {
    Object.assign(state, workspacePatch);
    if (workspacePatch.contentIllustrationItem) {
      state.contentIllustrationPlan = {
        ...state.contentIllustrationPlan,
        items: state.contentIllustrationPlan.items.map((item) => (
          item.item_id === workspacePatch.contentIllustrationItem.item_id
            ? workspacePatch.contentIllustrationItem
            : item
        )),
      };
    }
    state.contentGenerationTask = { ...(state.contentGenerationTask || {}), ...taskPatch };
    return { task: state.contentGenerationTask };
  };
  const aiService = {
    getConfig: () => ({ concurrency_limit: 1, image_model: { concurrency_limit: 1 } }),
    getImageModelAvailability: () => ({ available: true }),
    collectJsonResponse: async () => {
      throw new Error('统一候选重绘不应重新生成 Mermaid 代码');
    },
    generateImage: async ({ logTitle, prompt }) => {
      generatedImages.push({ logTitle, prompt });
      return { asset_url: `yibiao-asset://generated-images/redraw-${generatedImages.length}.png` };
    },
  };

  await runContentGenerationTask({
    aiService,
    agentService: {},
    workspaceStore,
    knowledgeBaseService: {},
    knowledgeSession: {},
    updateTask: (patch) => ({ ...(state.contentGenerationTask || {}), ...patch }),
    checkpointTask,
    taskControl: { signal: new AbortController().signal, isPauseRequested: () => false },
    payload: { redrawConfirmedIllustrations: true, illustrationItemIds: ['ai1'] },
  });

  assert.deepEqual(generatedImages.map((entry) => entry.logTitle), [
    'AI配图候选重绘-ai1-设备部署图',
  ]);
  const aiItem = state.contentIllustrationPlan.items.find((item) => item.item_id === 'ai1');
  const mermaidItem = state.contentIllustrationPlan.items.find((item) => item.item_id === 'm1');
  assert.equal(aiItem.generation.asset_url, 'yibiao-asset://generated-images/original-ai.png');
  assert.equal(aiItem.generation.redraw_status, 'success');
  assert.equal(aiItem.generation.redraw_asset_url, 'yibiao-asset://generated-images/redraw-1.png');
  assert.equal(mermaidItem.generation.redraw_status, undefined);
  assert.equal(state.contentGenerationTask.status, 'success');
  assert.equal(state.contentGenerationRuntime, undefined);
});
