const assert = require('node:assert/strict');
const test = require('node:test');

const {
  confirmIllustrationReviewItem,
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
