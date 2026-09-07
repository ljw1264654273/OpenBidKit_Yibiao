const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutlineItems, parseImageContextHeading } = require('./duplicateCheckService.cjs');

test('duplicate outline extraction recovers level seven from a clamped Markdown heading', () => {
  const markdown = [
    '# 1 一级目录',
    '## 1.1 二级目录',
    '### 1.1.1 三级目录',
    '#### 1.1.1.1 四级目录',
    '##### 1.1.1.1.1 五级目录',
    '###### 1.1.1.1.1.1 六级目录',
    '###### 1.1.1.1.1.1.1 七级目录',
  ].join('\n');

  const result = buildOutlineItems(markdown);
  const deepest = result.items.at(-1);

  assert.equal(deepest.number, '1.1.1.1.1.1.1');
  assert.equal(deepest.level, 7);
  assert.equal(deepest.path_titles.length, 7);
  assert.equal(deepest.normalized_path, '一级目录>二级目录>三级目录>四级目录>五级目录>六级目录>七级目录');
});

test('duplicate image context recovers level seven from the full numeric marker', () => {
  assert.deepEqual(
    parseImageContextHeading('###### 1.1.1.1.1.1.1 七级目录'),
    { level: 7, title: '七级目录' },
  );
});

test('ordinary Markdown depth is not overridden by Chinese chapter markers', () => {
  const result = buildOutlineItems([
    '# 总体方案',
    '## 第一章 项目范围',
    '### 第一节 术语定义',
  ].join('\n'));

  assert.deepEqual(result.items.map((item) => item.level), [1, 2, 3]);
  assert.deepEqual(result.items.at(-1).path_titles, ['总体方案', '项目范围', '术语定义']);
  assert.deepEqual(
    parseImageContextHeading('### 第一章 项目范围'),
    { level: 3, title: '项目范围' },
  );
});
