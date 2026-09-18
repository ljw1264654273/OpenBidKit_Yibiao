const assert = require('node:assert/strict');
const test = require('node:test');

const {
  confirmIllustrationReviewItem,
  getIllustrationKindLabel,
  getIllustrationReviewContext,
  previewIllustrationReviewItem,
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
