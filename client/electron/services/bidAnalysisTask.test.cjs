const test = require('node:test');
const assert = require('node:assert/strict');

const { getBidAnalysisTaskById } = require('./bidAnalysisTask.cjs');

test('技术评分项名称必须逐字保留评分表评审因素标题', () => {
  const task = getBidAnalysisTaskById('techRequirements');
  const prompt = task.prompt();

  assert.match(prompt, /评分项名称必须逐字复制评分表中对应的评审因素名称/);
  assert.match(prompt, /“项目实施方案”不得改写为“实施方案”/);
  assert.match(prompt, /只允许删除序号、换行和末尾单独标注的分值/);
  assert.match(prompt, /不得从评分标准正文归纳或重写评分项名称/);
});
