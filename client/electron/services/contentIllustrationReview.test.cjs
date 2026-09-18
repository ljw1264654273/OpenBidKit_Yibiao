const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adjustIllustrationReviewItem,
  confirmIllustrationReviewItem,
  convertMermaidIllustrationReviewItem,
  buildIllustrationBlock,
  getIllustrationKindLabel,
  getIllustrationReviewContext,
  previewIllustrationReviewItem,
  replaceIllustrationBlock,
  skipIllustrationReviewItem,
} = require('./contentIllustrationReview.cjs');

function createStore(item) {
  const calls = [];
  return {
    calls,
    loadTechnicalPlan: () => ({
      outlineData: { outline: [] },
      contentGenerationSections: {},
      contentIllustrationPlan: { items: [item] },
    }),
    previewIllustrationReviewItem: (payload) => {
      calls.push(['preview', payload]);
      return { success: true, code: payload.code };
    },
    confirmIllustrationReviewItem: (payload) => {
      calls.push(['confirm', payload]);
      return { contentIllustrationPlan: { items: [{ item_id: payload.itemId, generation: { review_status: 'confirmed' } }] } };
    },
    skipIllustrationReviewItem: (payload) => {
      calls.push(['skip', payload]);
      return { contentIllustrationPlan: { items: [{ item_id: payload.itemId, generation: { review_status: 'skipped' } }] } };
    },
  };
}

test('通用图片审核服务按 itemId 读取三类图片并提供中文类型标签', () => {
  assert.equal(getIllustrationKindLabel('ai'), 'AI 配图');
  assert.equal(getIllustrationKindLabel('mermaid'), '流程图');
  assert.equal(getIllustrationKindLabel('html'), 'PPT 图');

  const store = createStore({ item_id: 'ai-1', kind: 'ai', title: '现场部署图' });
  const context = getIllustrationReviewContext(store, { itemId: 'ai-1' });
  assert.equal(context.item.kind, 'ai');
  assert.equal(context.item.title, '现场部署图');
});

test('通用图片审核服务将预览、确认和跳过转给 Store', () => {
  const store = createStore({ item_id: 'html-1', kind: 'html', title: '进度图' });
  assert.deepEqual(previewIllustrationReviewItem({ technicalPlanStore: store }, { itemId: 'html-1' }), { success: true, code: undefined });
  assert.equal(confirmIllustrationReviewItem({ technicalPlanStore: store }, { itemId: 'html-1' }).contentIllustrationPlan.items[0].generation.review_status, 'confirmed');
  assert.equal(skipIllustrationReviewItem({ technicalPlanStore: store }, { itemId: 'html-1' }).contentIllustrationPlan.items[0].generation.review_status, 'skipped');
  assert.deepEqual(store.calls.map((entry) => entry[0]), ['preview', 'confirm', 'skip']);
});

test('候选图片正文块替换只替换指定图片并保留正文其他内容', () => {
  const block = buildIllustrationBlock({
    item_id: 'ai-1',
    title: '设备部署图',
    generation: { redraw_asset_url: 'yibiao-asset://generated-images/redraw.png' },
  });
  const content = [
    '前置正文。',
    '<!-- yibiao-illustration:start id="ai-1" -->',
    '![设备部署图](yibiao-asset://generated-images/original.png)',
    '*<!-- yibiao-figure-caption -->设备部署图*',
    '<!-- yibiao-illustration:end -->',
    '后置正文。',
  ].join('\n');

  const result = replaceIllustrationBlock(content, 'ai-1', block);
  assert.match(result, /前置正文/);
  assert.match(result, /redraw\.png/);
  assert.doesNotMatch(result, /original\.png/);
  assert.match(result, /后置正文/);
});

test('候选图片正文块不存在时拒绝静默追加', () => {
  assert.throws(
    () => replaceIllustrationBlock('只有正文。', 'ai-1', 'candidate'),
    /未找到正文图片块/,
  );
});

test('通用 AI 重绘要求只保存候选资源，不覆盖当前图片', async () => {
  const saves = [];
  const item = {
    item_id: 'ai-1',
    kind: 'ai',
    image_type: '工程图示',
    title: '设备部署图',
    section_ids: ['1.1'],
    generation: {
      status: 'success',
      review_status: 'pending',
      asset_url: 'yibiao-asset://generated-images/original.png',
    },
  };
  const store = {
    loadTechnicalPlan: () => ({
      outlineData: {
        outline: [{ id: '1.1', title: '实施方案', content: '正文事实：完成设备部署并验收。' }],
      },
      contentGenerationSections: {
        '1.1': { content: '正文事实：完成设备部署并验收。' },
      },
      contentIllustrationPlan: {
        revision: 'rev-1',
        items: [item],
      },
    }),
    saveIllustrationRedrawCandidate: ({ itemId, generation }) => {
      saves.push({ itemId, generation });
      return {
        contentIllustrationPlan: {
          items: [{
            ...item,
            generation: { ...item.generation, ...generation },
          }],
        },
      };
    },
  };
  const aiService = {
    generateImage: async ({ prompt }) => {
      assert.match(prompt, /提高可读性/);
      return { asset_url: 'yibiao-asset://generated-images/candidate.png' };
    },
  };

  const patch = await adjustIllustrationReviewItem({ technicalPlanStore: store, aiService }, {
    itemId: item.item_id,
    instruction: '提高可读性，减少装饰元素',
  });

  assert.equal(saves[0].generation.redraw_status, 'running');
  assert.equal(saves.at(-1).generation.redraw_asset_url, 'yibiao-asset://generated-images/candidate.png');
  assert.equal(patch.contentIllustrationPlan.items[0].generation.asset_url, item.generation.asset_url);
  assert.equal(patch.contentIllustrationPlan.items[0].generation.redraw_asset_url, 'yibiao-asset://generated-images/candidate.png');
});

test('流程图确认后使用已确认代码生成独立 AI 图片候选，不修改正文和当前资源', async () => {
  const saves = [];
  const item = {
    item_id: 'mermaid-1',
    kind: 'mermaid',
    image_type: 'process',
    title: '实施流程图',
    section_ids: ['1.1'],
    generation: {
      status: 'pending',
      review_status: 'confirmed',
      code: 'flowchart TD\n  A["资料收集"] --> B["成果验收"]',
      asset_url: 'yibiao-asset://generated-images/old.png',
    },
  };
  const state = {
    outlineData: {
      outline: [{ id: '1.1', title: '实施流程', content: '正文事实：先完成资料收集，再进行成果验收。' }],
    },
    contentGenerationSections: {
      '1.1': { content: '正文事实：先完成资料收集，再进行成果验收。' },
    },
    contentIllustrationPlan: { items: [item] },
  };
  const store = {
    loadTechnicalPlan: () => state,
    saveIllustrationRedrawCandidate: ({ itemId, generation }) => {
      saves.push({ itemId, generation });
      return {
        contentIllustrationPlan: {
          items: [{
            ...item,
            generation: { ...item.generation, ...generation },
          }],
        },
      };
    },
  };
  const aiService = {
    collectJsonResponse: async () => {
      throw new Error('流程图图片化不应再次调用文本模型修改 Mermaid 代码');
    },
    generateImage: async ({ prompt }) => {
      assert.match(prompt, /A\["资料收集"\] --> B\["成果验收"\]/);
      return { asset_url: 'yibiao-asset://generated-images/flow-candidate.png' };
    },
  };

  const result = await convertMermaidIllustrationReviewItem({
    technicalPlanStore: store,
    aiService,
  }, { itemId: item.item_id });

  assert.equal(saves[0].generation.redraw_status, 'running');
  assert.equal(saves.at(-1).generation.redraw_asset_url, 'yibiao-asset://generated-images/flow-candidate.png');
  assert.equal(result.contentIllustrationPlan.items[0].generation.asset_url, item.generation.asset_url);
  assert.equal(result.contentIllustrationPlan.items[0].generation.code, item.generation.code);
});

test('流程图图片化失败时保留已确认代码并写入可重试的错误状态', async () => {
  const saves = [];
  const item = {
    item_id: 'mermaid-1',
    kind: 'mermaid',
    image_type: 'process',
    title: '实施流程图',
    section_ids: ['1.1'],
    generation: {
      status: 'pending',
      review_status: 'confirmed',
      code: 'flowchart TD\n  A["资料收集"] --> B["成果验收"]',
    },
  };
  const store = {
    loadTechnicalPlan: () => ({
      outlineData: { outline: [{ id: '1.1', title: '实施流程', content: '正文事实。' }] },
      contentGenerationSections: { '1.1': { content: '正文事实。' } },
      contentIllustrationPlan: { items: [item] },
    }),
    saveIllustrationRedrawCandidate: ({ itemId, generation }) => {
      saves.push({ itemId, generation });
      return {
        contentIllustrationPlan: {
          items: [{
            ...item,
            generation: { ...item.generation, ...generation },
          }],
        },
      };
    },
  };

  await assert.rejects(
    () => convertMermaidIllustrationReviewItem({
      technicalPlanStore: store,
      aiService: {
        generateImage: async () => {
          throw new Error('模型暂时不可用');
        },
      },
    }, { itemId: item.item_id }),
    /模型暂时不可用/,
  );

  assert.equal(saves.at(-1).generation.redraw_status, 'error');
  assert.match(saves.at(-1).generation.redraw_error, /模型暂时不可用/);
  assert.equal(item.generation.review_status, 'confirmed');
  assert.equal(item.generation.code, 'flowchart TD\n  A["资料收集"] --> B["成果验收"]');
});
