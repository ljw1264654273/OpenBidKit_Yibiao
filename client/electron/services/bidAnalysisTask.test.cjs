const test = require('node:test');
const assert = require('node:assert/strict');

const { getBidAnalysisTaskById } = require('./bidAnalysisTask.cjs');

test('技术评分项名称保留实质标题并去掉末尾主客观分标记', () => {
  const task = getBidAnalysisTaskById('techRequirements');
  const prompt = task.prompt();

  assert.match(prompt, /评分项名称必须逐字复制评分表中对应的评审因素名称/);
  assert.match(prompt, /“项目实施方案”不得改写为“实施方案”/);
  assert.match(prompt, /只允许删除序号、换行、末尾单独标注的分值/);
  assert.match(prompt, /标题末尾仅表示评分方式的“（客观分）”“（主观分）”/);
  assert.match(prompt, /不得从评分标准正文归纳或重写评分项名称/);
});

test('技术评分层级使用结构化父级类型和结构依据而不是标题词表', () => {
  const task = getBidAnalysisTaskById('techRequirements');
  const prompt = task.prompt();

  assert.match(prompt, /【评分项编号】/);
  assert.match(prompt, /【直接上级编号】/);
  assert.match(prompt, /【直接上级名称】/);
  assert.match(prompt, /【直接上级类型】.*评分维度\/汇总容器.*业务分组.*无/s);
  assert.match(prompt, /【层级依据类型】.*合并单元格.*编号层级.*独立父级行.*汇总行.*无/s);
  assert.match(prompt, /【层级依据说明】/);
  assert.match(prompt, /合并单元格|rowspan/);
  assert.match(prompt, /编号层级/);
  assert.match(prompt, /汇总行/);
  assert.match(prompt, /不得根据父级名称中的字样判断类型/);
  assert.doesNotMatch(prompt, /“技术方案（40分）”“技术评分”“技术部分”“技术标”等通用类别/);
});
