const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adjustMermaidReviewCodeForItem,
  convertMermaidIllustrationReviewItemForItem,
} = require('./technicalPlanIpc.cjs');

test('AI adjusts a Mermaid review item from current plan state and saves returned code', async () => {
  const requests = [];
  const saved = [];
  const technicalPlanStore = {
    loadTechnicalPlan: () => ({
      outlineData: {
        outline: [{
          id: '1.1',
          title: '实施流程',
          content: '旧正文',
        }],
      },
      contentGenerationSections: {
        '1.1': {
          id: '1.1',
          title: '实施流程',
          status: 'success',
          content: '正文事实：先完成资料收集，再进行成果验收。',
        },
      },
      contentIllustrationPlan: {
        revision: 'rev-1',
        plan_version: 1,
        items: [{
          item_id: 'mermaid-1',
          kind: 'mermaid',
          image_type: 'process',
          title: '实施流程图',
          section_ids: ['1.1'],
          placement: 'after',
          priority: 1,
          generation: {
            status: 'reviewing',
            code: 'flowchart TD\n  A["资料收集"] --> C["成果验收"]',
            review_status: 'pending',
          },
        }],
      },
    }),
    saveMermaidReviewCode: (payload) => {
      saved.push(payload);
      return { contentIllustrationPlan: { items: [{ item_id: payload.itemId }] } };
    },
  };
  const aiService = {
    collectJsonResponse: async (request) => {
      requests.push(request);
      return { code: 'flowchart TD\n  A["资料收集"] --> B["问题整改"]\n  B --> C["成果验收"]' };
    },
  };

  const result = await adjustMermaidReviewCodeForItem({
    technicalPlanStore,
    aiService,
  }, {
    itemId: 'mermaid-1',
    code: 'flowchart TD\n  A["资料收集"] --> C["成果验收"]',
    instruction: '在资料收集和成果验收之间增加问题整改节点',
    referenceImagePath: 'C:\\temp\\reference.png',
  });

  assert.equal(result.code, 'flowchart TD\n  A["资料收集"] --> B["问题整改"]\n  B --> C["成果验收"]');
  assert.deepEqual(saved, [{
    itemId: 'mermaid-1',
    code: result.code,
  }]);
  assert.equal(result.contentIllustrationPlan.items[0].item_id, 'mermaid-1');
  assert.equal(Array.isArray(requests[0].messages[1].content), true);
  assert.match(requests[0].messages[1].content.find((part) => part.type === 'text').text, /实施流程图/);
  assert.match(requests[0].messages[1].content.find((part) => part.type === 'text').text, /正文事实：先完成资料收集，再进行成果验收。/);
  assert.match(requests[0].messages[1].content.find((part) => part.type === 'text').text, /在资料收集和成果验收之间增加问题整改节点/);
  assert.deepEqual(requests[0].messages[1].content.find((part) => part.type === 'local_image'), {
    type: 'local_image',
    path: 'C:\\temp\\reference.png',
    detail: 'high',
  });
});

test('AI adjustment forwards multiple Mermaid reference images to the service', async () => {
  const requests = [];
  const technicalPlanStore = {
    loadTechnicalPlan: () => ({
      outlineData: { outline: [{ id: '1.1', title: '实施流程', content: '旧正文' }] },
      contentGenerationSections: {
        '1.1': { id: '1.1', title: '实施流程', status: 'success', content: '正文事实。' },
      },
      contentIllustrationPlan: {
        items: [{
          item_id: 'mermaid-1',
          kind: 'mermaid',
          image_type: 'process',
          title: '实施流程图',
          section_ids: ['1.1'],
          generation: { status: 'reviewing', code: 'flowchart TD\n  A["资料"] --> B["结果"]', review_status: 'pending' },
        }],
      },
    }),
    saveMermaidReviewCode: ({ itemId, code }) => ({
      contentIllustrationPlan: { items: [{ item_id: itemId, generation: { code } }] },
    }),
  };
  const aiService = {
    collectJsonResponse: async (request) => {
      requests.push(request);
      return { code: 'flowchart TD\n  A["资料"] --> B["审核"]' };
    },
  };

  await adjustMermaidReviewCodeForItem({
    technicalPlanStore,
    aiService,
  }, {
    itemId: 'mermaid-1',
    code: 'flowchart TD\n  A["资料"] --> B["结果"]',
    instruction: '参考多张图片调整布局',
    referenceImages: [
      { path: 'C:\\temp\\first.png' },
      { dataUrl: 'data:image/png;base64,SECOND' },
    ],
  });

  assert.deepEqual(
    requests[0].messages[1].content.filter((part) => part.type !== 'text'),
    [
      { type: 'local_image', path: 'C:\\temp\\first.png', detail: 'high' },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,SECOND',
          detail: 'high',
        },
      },
    ],
  );
});

test('IPC 为流程图提供独立的 AI 图片化入口并透传已确认流程', async () => {
  const calls = [];
  const technicalPlanStore = {
    loadTechnicalPlan: () => ({
      outlineData: {
        outline: [{ id: '1.1', title: '实施流程', content: '正文事实。' }],
      },
      contentGenerationSections: {
        '1.1': { content: '正文事实。' },
      },
      contentIllustrationPlan: {
        items: [{
          item_id: 'mermaid-1',
          kind: 'mermaid',
          image_type: 'process',
          title: '实施流程图',
          section_ids: ['1.1'],
          generation: {
            review_status: 'confirmed',
            code: 'flowchart TD\n  A["已确认"] --> B["流程"]',
          },
        }],
      },
    }),
    saveIllustrationRedrawCandidate: (payload) => {
      calls.push(payload);
      return { contentIllustrationPlan: { items: [] } };
    },
  };
  const aiService = {
    generateImage: async ({ prompt }) => {
      assert.match(prompt, /A\["已确认"\] --> B\["流程"\]/);
      return { asset_url: 'yibiao-asset://generated-images/flow.png' };
    },
  };

  const result = await convertMermaidIllustrationReviewItemForItem({
    technicalPlanStore,
    aiService,
  }, { itemId: 'mermaid-1' });

  assert.equal(calls[0].generation.redraw_status, 'running');
  assert.equal(calls.at(-1).generation.redraw_asset_url, 'yibiao-asset://generated-images/flow.png');
  assert.deepEqual(result, { contentIllustrationPlan: { items: [] } });
});
