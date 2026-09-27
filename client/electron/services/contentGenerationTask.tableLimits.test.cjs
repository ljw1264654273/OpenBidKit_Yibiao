const assert = require('node:assert/strict');
const test = require('node:test');
const { maxTablesForRequirement } = require('./contentGenerationTask.cjs');

test('全文表格上限采用预设绝对值且自定义值受叶子小节数量限制', () => {
  assert.equal(maxTablesForRequirement('none', 40), 0);
  assert.equal(maxTablesForRequirement('light', 40), 3);
  assert.equal(maxTablesForRequirement('moderate', 40), 7);
  assert.equal(maxTablesForRequirement('heavy', 40), 10);
  assert.equal(maxTablesForRequirement('heavy', 40, 6), 6);
  assert.equal(maxTablesForRequirement('light', 2, 5), 2);
  assert.equal(maxTablesForRequirement('none', 40, 5), 0);
});
