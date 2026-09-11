const assert = require('node:assert/strict');
const test = require('node:test');

test('formal heading titles remove terminal sentence delimiters', () => {
  const { normalizeFormalHeadingTitle } = require('./mandatoryBidContentRules.cjs');
  const delimiters = ['。', '．', '.', '，', ',', '；', ';', '：', ':', '、', '！', '？', '!', '?'];

  for (const delimiter of delimiters) {
    assert.equal(normalizeFormalHeadingTitle(`总体进度安排${delimiter}`), '总体进度安排');
  }
  assert.equal(normalizeFormalHeadingTitle('既有数据入库：；。'), '既有数据入库');
  assert.equal(normalizeFormalHeadingTitle(' 项目管理（一期） '), '项目管理（一期）');
  assert.equal(normalizeFormalHeadingTitle('阶段一：准备工作'), '阶段一：准备工作');
  assert.equal(normalizeFormalHeadingTitle(''), '');
});

test('outline title normalization is recursive, immutable, and idempotent', () => {
  const { normalizeOutlineHeadingTitles } = require('./mandatoryBidContentRules.cjs');
  const outlineData = {
    project_name: '测试项目',
    outline: [{
      id: '1',
      title: '总体安排。',
      description: '保持描述。',
      content: '保持正文。',
      metadata: { source: 'test' },
      children: [{ id: '1.1', title: '实施阶段：', content: '' }],
    }],
  };

  const normalized = normalizeOutlineHeadingTitles(outlineData);
  assert.notEqual(normalized, outlineData);
  assert.notEqual(normalized.outline, outlineData.outline);
  assert.equal(normalized.outline[0].title, '总体安排');
  assert.equal(normalized.outline[0].children[0].title, '实施阶段');
  assert.equal(normalized.outline[0].description, '保持描述。');
  assert.equal(normalized.outline[0].content, '保持正文。');
  assert.deepEqual(normalized.outline[0].metadata, { source: 'test' });
  assert.deepEqual(normalizeOutlineHeadingTitles(normalized), normalized);
  assert.equal(outlineData.outline[0].title, '总体安排。');
});
