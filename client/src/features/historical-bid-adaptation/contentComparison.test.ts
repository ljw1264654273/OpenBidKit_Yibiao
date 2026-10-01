import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node 类型擦除运行器需要显式扩展名
import { compareContentText } from './contentComparison.ts';

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
