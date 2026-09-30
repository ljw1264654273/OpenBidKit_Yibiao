const assert = require('node:assert/strict');
const test = require('node:test');

let normalizeChineseMarkdownTypography;
try {
  ({ normalizeChineseMarkdownTypography } = require('./chineseTypography.cjs'));
} catch {
  normalizeChineseMarkdownTypography = undefined;
}

test('normalizes Chinese prose spacing and punctuation boundaries', () => {
  assert.equal(typeof normalizeChineseMarkdownTypography, 'function');
  assert.equal(
    normalizeChineseMarkdownTypography('本项目 涉及　测绘， 资料需要衔接。'),
    '本项目涉及测绘，资料需要衔接。',
  );
  assert.equal(
    normalizeChineseMarkdownTypography('**服务需求分析：**   本项目服务需求集中在三个层面。'),
    '**服务需求分析：**本项目服务需求集中在三个层面。',
  );
});

test('removes Chinese soft line breaks before closing punctuation', () => {
  assert.equal(
    normalizeChineseMarkdownTypography('按照“谁主导、谁配合、谁接收\n”的原则逐环节界定工作界面。'),
    '按照“谁主导、谁配合、谁接收”的原则逐环节界定工作界面。',
  );
  assert.equal(
    normalizeChineseMarkdownTypography('三方以书面清单作为移交凭据，接口人保持相对固定\n。'),
    '三方以书面清单作为移交凭据，接口人保持相对固定。',
  );
});

test('moves closing punctuation away from a new paragraph start', () => {
  assert.equal(
    normalizeChineseMarkdownTypography('上一段内容\n\n。下一段内容'),
    '上一段内容。\n\n下一段内容',
  );
  assert.equal(
    normalizeChineseMarkdownTypography('按照“约定\n\n”的原则执行'),
    '按照“约定”\n\n的原则执行',
  );
});

test('preserves Markdown structure and protected content', () => {
  const source = [
    '1. **正文层次标题**',
    '',
    '使用 OpenAI API 处理 20 GB 数据。',
    '',
    '第一行  ',
    '第二行',
    '',
    '正文包含 `foo bar` 和 [OpenAI API](https://example.com/a b) 说明。',
    '',
    '<span data-title="甲 乙">甲 乙</span>',
    '',
    '| 字段 一 | 字段 二 |',
    '| --- | --- |',
    '',
    '![示意 图](https://example.com/a b.png)',
    '',
    '```text',
    '甲 乙， 丙',
    '```',
  ].join('\n');

  assert.equal(
    normalizeChineseMarkdownTypography(source),
    [
      '1. **正文层次标题**',
      '',
      '使用 OpenAI API 处理 20 GB 数据。',
      '',
      '第一行  ',
      '第二行',
      '',
      '正文包含 `foo bar` 和 [OpenAI API](https://example.com/a b) 说明。',
      '',
      '<span data-title="甲 乙">甲乙</span>',
      '',
      '| 字段 一 | 字段 二 |',
      '| --- | --- |',
      '',
      '![示意 图](https://example.com/a b.png)',
      '',
      '```text',
      '甲 乙， 丙',
      '```',
    ].join('\n'),
  );
});

test('preserves variable-length inline code and indented code blocks', () => {
  const source = [
    '正文包含 ``甲 乙`` 和 ```丙 丁``` 说明。',
    '',
    '    甲 乙， 丙',
    '\t丁 戊， 己',
  ].join('\n');

  assert.equal(normalizeChineseMarkdownTypography(source), source);
});

test('only closes fenced code with a matching marker and sufficient length', () => {
  const source = [
    '````text',
    '甲 乙， 丙',
    '```',
    '丁 戊， 己',
    '~~~',
    '庚 辛， 壬',
    '````',
  ].join('\n');

  assert.equal(normalizeChineseMarkdownTypography(source), source);
});

test('preserves GFM tables without leading or trailing pipes', () => {
  const source = [
    '字段 一 | 字段 二',
    '--- | ---',
    '甲 乙 | 丙 丁',
    '戊 己 | 庚 辛',
    '',
    '表格 后正文。',
  ].join('\n');

  assert.equal(
    normalizeChineseMarkdownTypography(source),
    [
      '字段 一 | 字段 二',
      '--- | ---',
      '甲 乙 | 丙 丁',
      '戊 己 | 庚 辛',
      '',
      '表格后正文。',
    ].join('\n'),
  );
});

test('preserves reference-style Markdown links and labels', () => {
  const source = [
    '正文包含 [甲 乙][ref]、[丙 丁][] 和 [戊 己] 说明。',
    '',
    '[ref]: https://example.com/a b "甲 乙"',
  ].join('\n');

  assert.equal(normalizeChineseMarkdownTypography(source), source);
});

test('removes prose spacing after bold lead-ins in lists and blockquotes', () => {
  const source = [
    '- **服务目标：** 正文内容。',
    '+ **实施范围：**  正文内容。',
    '* **质量要求：**\t正文内容。',
    '> **验收标准：**   正文内容。',
    '普通正文中的 **术语。** 不应被改写。',
  ].join('\n');

  assert.equal(
    normalizeChineseMarkdownTypography(source),
    [
      '- **服务目标：**正文内容。',
      '+ **实施范围：**正文内容。',
      '* **质量要求：**正文内容。',
      '> **验收标准：**正文内容。',
      '普通正文中的 **术语。** 不应被改写。',
    ].join('\n'),
  );
});

test('normalization is idempotent', () => {
  const source = '**服务需求分析：**  本项目 服务需求。\n下一句。';
  const once = normalizeChineseMarkdownTypography(source);
  assert.equal(normalizeChineseMarkdownTypography(once), once);
});
