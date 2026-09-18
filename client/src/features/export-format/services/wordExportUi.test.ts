import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's strip-types test runner needs the explicit TypeScript extension.
import { hasGeneratedContent } from './wordExportUi.ts';

test('只有目录标题时不允许导出 Word', () => {
  assert.equal(hasGeneratedContent([
    { id: '1', title: '第一章', description: '', content: '', children: [
      { id: '1.1', title: '项目概况', description: '', content: '   ' },
    ] },
  ]), false);
});

test('任意正文叶节点有内容时允许导出 Word', () => {
  assert.equal(hasGeneratedContent([
    { id: '1', title: '第一章', description: '', content: '', children: [
      { id: '1.1', title: '项目概况', description: '', content: '本项目正文内容' },
    ] },
  ]), true);
});
