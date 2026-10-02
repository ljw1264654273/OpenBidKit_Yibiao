import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node 类型擦除运行器需要显式扩展名
import { compareContentText, compareRenderedContent } from './contentComparison.ts';

const changedText = (text: string, ranges: { start: number; end: number }[]) => ranges.map((range) => text.slice(range.start, range.end));

test('中文局部迁移只标出地点和数量变化，保留公共文字', () => {
  const before = '服务范围：五峰村。\n工作量：120户。\n保持响应机制。';
  const after = '服务范围：横泾街道。\n工作量：350户。\n保持响应机制。';
  const diff = compareContentText(before, after);
  assert.deepEqual(changedText(before, diff.before), ['五峰村', '12']);
  assert.deepEqual(changedText(after, diff.after), ['横泾街道', '35']);
});

test('重复描述按实际位置标记，不能全局高亮相同词', () => {
  const before = '五峰村负责协调，五峰村负责实施。';
  const after = '五峰村负责协调，横泾街道负责实施。';
  const diff = compareContentText(before, after);
  assert.deepEqual(changedText(before, diff.before), ['五峰村']);
  assert.equal(diff.before[0].start, before.lastIndexOf('五峰村'));
});

test('直接迁移无高亮，纯新增和删除只标相应一侧', () => {
  assert.deepEqual(compareContentText('正文原样迁移', '正文原样迁移'), { before: [], after: [] });
  assert.deepEqual(compareContentText('', '新增正文'), { before: [], after: [{ start: 0, end: 4 }] });
  assert.deepEqual(compareContentText('删除正文', ''), { before: [{ start: 0, end: 4 }], after: [] });
});

test('emoji 不被拆分，范围可用于 DOM 的 UTF-16 偏移', () => {
  const diff = compareContentText('设备🛰️投入', '设备🚁投入');
  assert.deepEqual(changedText('设备🛰️投入', diff.before), ['🛰️']);
  assert.deepEqual(changedText('设备🚁投入', diff.after), ['🚁']);
});

test('长章节多段迁移保留中间及尾部未改正文', () => {
  const unchanged = Array.from({ length: 800 }, (_, index) => `第${index}条保障措施保持不变。\n`).join('');
  const before = `五峰村范围。\n${unchanged}投入120户。`;
  const after = `横泾街道范围。\n${unchanged}投入350户。`;
  const diff = compareContentText(before, after);
  assert.deepEqual(changedText(before, diff.before), ['五峰村', '12']);
  assert.deepEqual(changedText(after, diff.after), ['横泾街道', '35']);
});

test('缺失历史来源不把整章当新增，也不调用渲染器', () => {
  assert.deepEqual(compareRenderedContent(undefined, '迁移正文', () => { throw new Error('不应渲染'); }), { before: [], after: [] });
});

test('完全相同的直接迁移不生成高亮或渲染开销', () => {
  assert.deepEqual(compareRenderedContent('原样迁移', '原样迁移', () => { throw new Error('不应渲染'); }), { before: [], after: [] });
});

test('Markdown 表格、图片、代码、Mermaid、HTML 整体交给渲染器，绝不插入差异标记', () => {
  const before = '| 地点 |\n| --- |\n| 五峰村 |\n\n![图片](asset.png)\n\n```js\nconst value = 1;\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n<table><tr><td rowspan="2">五峰村</td></tr></table>';
  const after = before.replace('五峰村', '横泾街道');
  const inputs: string[] = [];
  const rendered = ['地点五峰村\nconst value = 1;\ngraph TD; A-->B\n五峰村', '地点横泾街道\nconst value = 1;\ngraph TD; A-->B\n五峰村'];
  const diff = compareRenderedContent(before, after, (markdown) => { inputs.push(markdown); return rendered[inputs.length - 1]; });
  assert.deepEqual(inputs, [before, after]);
  assert.deepEqual(changedText(rendered[0], diff.before), ['五峰村']);
  assert.deepEqual(changedText(rendered[1], diff.after), ['横泾街道']);
  assert.equal(diff.before[0].start, 2);
});
