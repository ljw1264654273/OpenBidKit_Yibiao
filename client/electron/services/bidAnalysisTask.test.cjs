const test = require('node:test');
const assert = require('node:assert/strict');

const { getBidAnalysisTaskById } = require('./bidAnalysisTask.cjs');

test('技术评分提取保留评分分组、独立评分行和完整原文', () => {
  const prompt = getBidAnalysisTaskById('techRequirements').prompt();

  assert.match(prompt, /合并单元格/);
  assert.match(prompt, /每条独立评分行/);
  assert.match(prompt, /保持原始顺序/);
  assert.match(prompt, /不得提前合并/);
  assert.match(prompt, /完整评分原文/);
  assert.match(prompt, /明确响应内容/);
});
