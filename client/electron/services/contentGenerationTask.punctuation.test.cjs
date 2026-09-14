const assert = require('node:assert/strict');
const test = require('node:test');

const {
  __developerContentExpansionPatchRuntime,
  buildChapterContentMessages,
  shouldCheckpointIllustrationGeneration,
} = require('./contentGenerationTask.cjs');

const normalize = (value) => __developerContentExpansionPatchRuntime.normalizeGeneratedLeadInPunctuation(value);
const normalizeSave = (value) => __developerContentExpansionPatchRuntime.normalizeLeafContentForSave(
  value,
  { id: '1.1', title: '测试章节' },
);

test('Mermaid review results use a durable illustration checkpoint', () => {
  assert.equal(shouldCheckpointIllustrationGeneration('reviewing'), true);
  assert.equal(shouldCheckpointIllustrationGeneration('success'), true);
  assert.equal(shouldCheckpointIllustrationGeneration('running'), false);
});

test('inline bold lead-ins use a Chinese colon before following prose', () => {
  assert.equal(
    normalize('**房屋建筑信息核实。** 房屋数量核实。'),
    '**房屋建筑信息核实：** 房屋数量核实。',
  );
  assert.equal(normalize('__房屋属性信息核实.__ 房屋权属方面'), '__房屋属性信息核实：__ 房屋权属方面');
});

test('inline lead-ins with an internal colon still end with a Chinese colon', () => {
  assert.equal(
    normalize('**第一阶段：前期准备与资料对接。** 自合同签订后即启动'),
    '**第一阶段：前期准备与资料对接：** 自合同签订后即启动',
  );
  assert.equal(
    normalize('**第一阶段：前期准备与资料对接.** 自合同签订后即启动'),
    '**第一阶段：前期准备与资料对接：** 自合同签订后即启动',
  );
});

test('numbered inline and standalone titles cannot bypass punctuation cleanup', () => {
  assert.equal(normalize('1. **实施安排。** 正文'), '1. **实施安排：** 正文');
  assert.equal(normalize('2. **质量保证。**'), '2. **质量保证**');
});

test('colon-ending lead-ins discard external delimiters before following prose', () => {
  const delimiters = ['，', ',', '、', '；', ';', '：', ':'];
  for (const delimiter of delimiters) {
    assert.equal(
      normalize(`**图属一致性处理：**${delimiter}各类表格`),
      '**图属一致性处理：** 各类表格',
    );
    assert.equal(
      normalize(`__图属一致性处理:__ ${delimiter} 各类表格`),
      '__图属一致性处理：__ 各类表格',
    );
  }
  assert.equal(
    normalize('**图属一致性处理：** ，，； 各类表格'),
    '**图属一致性处理：** 各类表格',
  );
});

test('colon-ending lead-ins keep trailing delimiters when no prose follows', () => {
  assert.equal(normalize('**图属一致性处理：**，'), '**图属一致性处理**，');
  assert.equal(normalize('**图属一致性处理：** ，； '), '**图属一致性处理** ，； ');
});

test('standalone titles keep internal colons while removing terminal punctuation', () => {
  assert.equal(normalize('**第一阶段：前期准备与资料对接。**'), '**第一阶段：前期准备与资料对接**');
});

test('standalone bold lead-ins remove terminal sentence punctuation', () => {
  assert.equal(normalize('**自查自检机制。**'), '**自查自检机制**');
  assert.equal(normalize('  **自查自检机制.**  '), '  **自查自检机制**  ');
  for (const delimiter of ['。', '．', '.', '，', ',', '；', ';', '：', ':', '、', '！', '!', '？', '?']) {
    assert.equal(normalize(`**质量保证${delimiter}**`), '**质量保证**');
  }
});

test('two or more parallel bold items receive continuous Arabic numbering', () => {
  assert.equal(
    normalizeSave('**实施安排。**\n内容一。\n\n**质量保证：**\n内容二。'),
    '1. **实施安排**\n内容一。\n\n2. **质量保证**\n内容二。',
  );
  assert.equal(
    normalizeSave('3. **实施安排。** 正文一。\n**质量保证。** 正文二。\n2. **验收交付。** 正文三。'),
    '1. **实施安排：** 正文一。\n2. **质量保证：** 正文二。\n3. **验收交付：** 正文三。',
  );
});

test('skipped, duplicate, and out-of-order peer numbers are normalized by appearance', () => {
  assert.equal(
    normalizeSave('2. **第一项**\n2. **第二项**\n8. **第三项**'),
    '1. **第一项**\n2. **第二项**\n3. **第三项**',
  );
  assert.equal(normalizeSave('1. **第一项**\n2. **第二项**'), '1. **第一项**\n2. **第二项**');
});

test('nested body outline items restart numbering within each indentation level', () => {
  const source = [
    '8. **全过程登记制度**',
    '   6. **借阅利用审批**',
    '      4. **申请提出：** 借阅人填写申请单。',
    '      9. **审批权限：** 项目负责人审批。',
    '   7. **档案移交**',
    '2. **其他管理制度**',
    '   8. **其他审批**',
  ].join('\n');
  assert.equal(
    normalizeSave(source),
    [
      '1. **全过程登记制度**',
      '   1. **借阅利用审批**',
      '      1. **申请提出：** 借阅人填写申请单。',
      '      2. **审批权限：** 项目负责人审批。',
      '   2. **档案移交**',
      '2. **其他管理制度**',
      '   1. **其他审批**',
    ].join('\n'),
  );
});

test('ordinary nested ordered-list items are normalized to valid Markdown list starts', () => {
  assert.equal(
    normalizeSave([
      '1. **全过程登记制度**',
      '   4. 申请提出',
      '   5. 审批权限',
      '2. **其他管理制度**',
      '   8. 其他审批',
    ].join('\n')),
    [
      '1. **全过程登记制度**',
      '   1. 申请提出',
      '   2. 审批权限',
      '2. **其他管理制度**',
      '   1. 其他审批',
    ].join('\n'),
  );
});

test('a single structural bold title remains unnumbered', () => {
  assert.equal(normalizeSave('**唯一分项。**\n正文。'), '**唯一分项**\n正文。');
});

test('punctuation normalization skips protected blocks and unrelated prose', () => {
  const source = [
    '| **表格标题。** | 内容 |',
    '![**图片说明。**](image.png)',
    '<img alt="**图片说明。**" src="image.png">',
    '普通正文中的 **术语。** 不应被改写。',
    '```markdown',
    '**代码示例。**',
    '```',
  ].join('\r\n');
  assert.equal(normalize(source), source.replace(/\r\n/g, '\n'));
});

test('peer numbering skips protected Markdown and ordinary inline emphasis', () => {
  const source = [
    '| **表格标题。** | 内容 |',
    '![**图片说明。**](image.png)',
    '**图片说明。** ![示意图](image.png)',
    '普通正文中的 **术语。** 不应被改写。',
    '```markdown',
    '**代码示例。**',
    '```',
  ].join('\n');
  assert.equal(normalizeSave(source), source);
});

test('normalization handles converted Markdown headings and is idempotent', () => {
  const normalized = normalize('**自查自检机制。**\n\n**实施要点：** 逐项检查。');
  assert.equal(normalized, '**自查自检机制**\n\n**实施要点：** 逐项检查。');
  assert.equal(normalize(normalized), normalized);
});

test('full save normalization is idempotent', () => {
  const source = '**第一项。** 正文。\n\n4. **第二项：**，正文。';
  const once = normalizeSave(source);
  assert.equal(once, '1. **第一项：** 正文。\n\n2. **第二项：** 正文。');
  assert.equal(normalizeSave(once), once);
});

test('save normalization applies the existing heading cleanup before punctuation cleanup', () => {
  assert.equal(
    __developerContentExpansionPatchRuntime.normalizeLeafContentForSave('### 自查自检机制。', { id: '1.1', title: '其他章节' }),
    '**自查自检机制**',
  );
});

test('chapter content prompt states the lead-in punctuation rules', () => {
  const messages = buildChapterContentMessages({
    chapter: { id: '1.1', title: '测试章节', description: '' },
    projectOverview: '',
    selectedFactsText: '',
    regenerateRequirement: '',
    contentPlan: null,
    knowledgeContents: [],
    wordControl: {},
  });
  const prompt = messages.map((message) => message.content).join('\n');
  assert.match(prompt, /行内加粗引导标题/);
  assert.match(prompt, /中文冒号/);
  assert.match(prompt, /独立成行/);
  assert.match(prompt, /加粗结束标记后不得再写/);
  assert.doesNotMatch(prompt, /加粗引导语只允许写简短主题词，禁止使用任何形式的编号/);
});

test('chapter content prompt requires nested Markdown for body outline hierarchy', () => {
  const messages = buildChapterContentMessages({
    chapter: { id: '1.1', title: '测试章节', description: '' },
    projectOverview: '',
    selectedFactsText: '',
    regenerateRequirement: '',
    contentPlan: null,
    knowledgeContents: [],
    wordControl: {},
  });
  const prompt = messages.map((message) => message.content).join('\n');
  assert.match(prompt, /嵌套 Markdown 有序列表/);
  assert.match(
    prompt,
    /1\. \*\*全过程登记制度\*\*\n {3}正文内容……\n {3}1\. \*\*借阅利用审批\*\*\n {6}正文内容……\n {6}1\. \*\*申请提出：\*\*/,
  );
  assert.match(prompt, /Markdown 列表语法统一使用“1\.”/);
  assert.match(prompt, /每个新开的子列表必须从“1\.”开始/);
  assert.match(prompt, /不要把“一、”“（一）”等最终展示编号写进正文文字/);
  assert.doesNotMatch(prompt, /同一层级出现两个及以上并列论述分项时，每个分项标题必须按出现顺序使用连续阿拉伯数字序号/);
});

test('ordinary and Agent restored optimization prompts require nested body outline structure', () => {
  const ordinary = __developerContentExpansionPatchRuntime.buildRestoredChapterContentMessages({
    chapter: { id: '1.1', title: '测试章节', description: '' },
    projectOverview: '', selectedFactsText: '', regenerateRequirement: '', contentPlan: null,
    knowledgeContents: [], restoredContent: '正文底稿', wordControl: {},
  }).map((message) => message.content).join('\n');
  const agent = __developerContentExpansionPatchRuntime.buildAgentRestoredChapterContentPrompt('fabricate');
  for (const prompt of [ordinary, agent]) {
    assert.match(prompt, /嵌套 Markdown 有序列表/);
    assert.match(prompt, /Markdown 列表语法统一使用“1\.”/);
    assert.match(prompt, /每个新开的子列表必须从“1\.”开始/);
    assert.match(prompt, /中文冒号/);
  }
});

test('word adjustment prompt states the lead-in punctuation rules', () => {
  const messages = __developerContentExpansionPatchRuntime.buildWordAdjustmentMessages({
    context: { item: { id: '1.1', title: '测试章节', description: '' }, parentChapters: [], siblingChapters: [] },
    currentContent: '**自查自检机制。**',
    currentWords: 1,
    targetWords: 2,
    mode: 'expand',
    granularity: 'sentence',
    maximumChangeWords: 10,
    totalRemainingWords: 2,
    globalFactsMode: 'fabricate',
  });
  const prompt = messages.map((message) => message.content).join('\n');
  assert.match(prompt, /行内加粗引导标题/);
  assert.match(prompt, /中文冒号/);
  assert.match(prompt, /独立成行/);
  assert.match(prompt, /加粗结束标记后不得再写/);
  assert.match(prompt, /嵌套 Markdown 有序列表/);
  assert.match(prompt, /Markdown 列表语法统一使用“1\.”/);
  assert.match(prompt, /每个新开的子列表必须从“1\.”开始/);
});
