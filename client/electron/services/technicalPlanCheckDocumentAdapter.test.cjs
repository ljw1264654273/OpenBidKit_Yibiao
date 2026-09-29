const assert = require('node:assert/strict');
const test = require('node:test');

const { toDocumentLines } = require('./technicalPlanCheckDocumentAdapter.cjs');
const { extractScoreItems } = require('./technicalPlanCheckRules.cjs');

test('normalizes equivalent HTML, Markdown and MinerU score tables to the same line', () => {
  const expected = [
    '评分说明',
    '评分因素 | 评分内容 | 分值',
    '评分因素 | 实施方案 | 10',
  ];
  const fixtures = [
    `
      <p>评分说明</p>
      <table>
        <thead><tr><th>评分因素</th><th>评分内容</th><th>分值</th></tr></thead>
        <tbody><tr><td>评分因素</td><td>实施方案</td><td>10</td></tr></tbody>
      </table>
    `,
    `
      # 评分说明

      | 评分因素 | 评分内容 | 分值 |
      | :--- | ---: | --- |
      | 评分因素 | 实施方案 | 10 |
    `,
    `
      ## 评分说明

      <table><tr><td>评分因素</td><td>评分内容</td><td>分值</td></tr></table>

      | 评分因素 | 实施方案 | 10 |
      | --- | --- | --- |
    `,
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(toDocumentLines(fixture), expected);
  }
});

test('keeps HTML table cell breaks and block paragraphs inside one normalized cell', () => {
  assert.deepEqual(toDocumentLines(`
    <table>
      <tr><td>评分因素</td><td>实施方案<br>重点说明</td><td>10</td></tr>
      <tr><td>评分因素</td><td><p>多段</p><p>内容</p></td><td>5</td></tr>
    </table>
  `), [
    '评分因素 | 实施方案 重点说明 | 10',
    '评分因素 | 多段 内容 | 5',
  ]);
});

test('strips Markdown and HTML markers without swallowing visible paragraph text', () => {
  const lines = toDocumentLines(`
    # 项目概况
    - **服务内容**包含[现场踏勘](https://example.com)、\`成果整理\`。
    1. <strong>服务周期</strong>为 30 天 &amp; 提供验收支持。<br>第二行说明
    \`\`\`text
    围栏中的正文仍需保留
    \`\`\`
  `);

  assert.deepEqual(lines, [
    '项目概况',
    '服务内容包含现场踏勘、成果整理。',
    '服务周期为 30 天 & 提供验收支持。',
    '第二行说明',
    '围栏中的正文仍需保留',
  ]);
});

test('filters Markdown table alignment separators and decodes entities in cells', () => {
  assert.deepEqual(toDocumentLines(`
    | 项目 | 内容 |
    | :--- | ---: |
    | 服务范围 | 勘察 &amp; 设计 |
  `), [
    '项目 | 内容',
    '服务范围 | 勘察 & 设计',
  ]);
});

test('keeps Markdown table HTML breaks inside cells and does not split escaped or code-span pipes', () => {
  assert.deepEqual(toDocumentLines(`
    | 类型 | 内容 | 分值 |
    | --- | --- | --- |
    | 实施 | 第一段<br>第二段 | 10 |
    | 说明 | A \\| B 与 \`C | D\` | 5 |
  `), [
    '类型 | 内容 | 分值',
    '实施 | 第一段 第二段 | 10',
    '说明 | A \\| B 与 C \\| D | 5',
  ]);
});

test('preserves literal pipes through adapter serialization and score extraction', () => {
  const lines = toDocumentLines('| 评分因素 | A \\| B 与 `C | D` | 10 |');
  assert.deepEqual(lines, ['评分因素 | A \\| B 与 C \\| D | 10']);
  assert.deepEqual(extractScoreItems(lines), [{ desc: 'A | B 与 C | D', score: 10 }]);
});
