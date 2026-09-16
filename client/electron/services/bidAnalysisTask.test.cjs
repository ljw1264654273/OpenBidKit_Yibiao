const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getBidAnalysisTaskById,
  getBidAnalysisTasks,
  runBidAnalysisTask,
} = require('./bidAnalysisTask.cjs');

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

test('技术评分提取保留评分分组、独立评分行和完整原文', () => {
  const prompt = getBidAnalysisTaskById('techRequirements').prompt();

  assert.match(prompt, /合并单元格/);
  assert.match(prompt, /每条独立评分行/);
  assert.match(prompt, /保持原始顺序/);
  assert.match(prompt, /不得提前合并/);
  assert.match(prompt, /完整评分原文/);
  assert.match(prompt, /明确响应内容/);
});

test('技术评分提取以原文一级评分大类作为归属边界', () => {
  const prompt = getBidAnalysisTaskById('techRequirements').prompt();

  assert.match(prompt, /原文一级评分大类.*权威边界/s);
  assert.match(prompt, /综合实力.*不得提取为技术评分项/s);
  assert.match(prompt, /没有明确评分大类.*语义/s);
  assert.match(prompt, /【所属评分大类名称】/);
  assert.match(prompt, /【所属评分大类属性】.*技术.*非技术.*无明确分类/s);
});

test('技术评分以原文评分大类为边界且完整投标结构不受影响', async () => {
  const techResult = `## 技术评分项

【评分项编号】：1
【评分项名称】：实施方案
【所属评分大类名称】：技术方案（40分）
【所属评分大类属性】：技术
【直接上级编号】：无
【直接上级名称】：技术方案（40分）
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：合并单元格
【层级依据说明】：rowspan=8
【权重/分值】：5
【评分标准】：按实施方案评分。
【评分行】：按实施方案评分。
【明确响应内容】：实施方案
【数据来源】：评分表技术方案大类

【评分项编号】：2
【评分项名称】：技术人员配备
【所属评分大类名称】：综合实力（50分）
【所属评分大类属性】：非技术
【直接上级编号】：无
【直接上级名称】：综合实力（50分）
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：合并单元格
【层级依据说明】：rowspan=5
【权重/分值】：25
【评分标准】：按人员证书评分。
【评分行】：按人员证书评分。
【明确响应内容】：人员证书
【数据来源】：评分表综合实力大类

【评分项编号】：3
【评分项名称】：仪器设备
【直接上级编号】：无
【直接上级名称】：综合实力（50分）
【直接上级类型】：评分维度/汇总容器
【层级依据类型】：合并单元格
【层级依据说明】：rowspan=5
【权重/分值】：3
【评分标准】：按设备证明评分。
【评分行】：按设备证明评分。
【明确响应内容】：设备证明
【数据来源】：评分表综合实力大类

## 技术评分要求

【评分要求名称】：通用规则
【适用范围】：技术评分项
【要求/判定口径】：未提供方案不得分。
【数据来源】：评分表说明`;
  const responseFileResult = `## 完整投标文件结构

1. 技术方案
2. 综合实力
3. 商务及资信文件`;
  const requiredTasks = getBidAnalysisTasks('key');
  const storedTasks = Object.fromEntries(requiredTasks.map((task) => [task.id, {
    id: task.id,
    label: task.label,
    status: 'success',
    content: `${task.label}已有结果`,
  }]));
  const checkpoints = [];
  const workspaceStore = {
    readTenderMarkdown: () => '# 招标文件\n\n评分表原文',
    loadTechnicalPlan: () => ({ bidAnalysisTasks: storedTasks }),
  };
  const aiService = {
    getConfig: () => ({}),
    chat: async ({ messages }) => {
      const prompt = messages.at(-1)?.content || '';
      if (prompt.includes('任务：提取技术评分信息')) return techResult;
      if (prompt.includes('任务：提取招标文件、询比文件或采购文件中关于响应文件')) return responseFileResult;
      throw new Error(`未覆盖的测试 Prompt：${prompt.slice(0, 30)}`);
    },
  };

  await runBidAnalysisTask({
    aiService,
    workspaceStore,
    updateTask: () => {},
    checkpointTask: (...args) => checkpoints.push(args),
    payload: {
      mode: 'key',
      task_ids: ['techRequirements', 'responseFileRequirements'],
    },
  });

  const completedItems = checkpoints
    .map(([, workspacePatch]) => workspacePatch?.bidAnalysisItem)
    .filter((item) => item?.status === 'success');
  const savedTech = completedItems.find((item) => item.id === 'techRequirements')?.content || '';
  const savedResponseFile = completedItems.find((item) => item.id === 'responseFileRequirements')?.content || '';
  assert.match(savedTech, /【评分项名称】：实施方案/);
  assert.doesNotMatch(savedTech, /技术人员配备|仪器设备|已排除的非技术评分项/);
  assert.match(savedTech, /## 技术评分要求/);
  assert.equal(savedResponseFile, responseFileResult);
  const savedTechPatch = checkpoints
    .map(([, , eventPatch]) => eventPatch?.technicalPlanPatch?.techRequirements)
    .find(Boolean);
  assert.equal(savedTechPatch, savedTech);
});
