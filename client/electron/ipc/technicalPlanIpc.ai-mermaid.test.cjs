const assert = require('node:assert/strict');
const test = require('node:test');

const { adjustMermaidReviewCodeForItem } = require('./technicalPlanIpc.cjs');

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
  });

  assert.equal(result.code, 'flowchart TD\n  A["资料收集"] --> B["问题整改"]\n  B --> C["成果验收"]');
  assert.deepEqual(saved, [{
    itemId: 'mermaid-1',
    code: result.code,
  }]);
  assert.equal(result.contentIllustrationPlan.items[0].item_id, 'mermaid-1');
  assert.match(requests[0].messages[1].content, /实施流程图/);
  assert.match(requests[0].messages[1].content, /正文事实：先完成资料收集，再进行成果验收。/);
  assert.match(requests[0].messages[1].content, /在资料收集和成果验收之间增加问题整改节点/);
});
