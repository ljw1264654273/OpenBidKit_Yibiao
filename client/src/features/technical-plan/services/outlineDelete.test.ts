import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutlineItem } from '../../../shared/types/outline.ts';
// @ts-expect-error Node's strip-types runner requires an explicit extension.
import { deleteOutlineOnly } from './outlineDelete.ts';

const outline: OutlineItem[] = [
  {
    id: '1',
    title: '第一章',
    description: '说明一',
    children: [
      { id: '1.1', title: '第一节', description: '说明 1.1', content_mode: 'ai-generate' },
      {
        id: '1.2',
        title: '第二节',
        description: '说明 1.2',
        children: [{ id: '1.2.1', title: '第一小节', description: '说明 1.2.1', content_mode: 'ai-generate' }],
      },
    ],
  },
  { id: '2', title: '第二章', description: '说明二', content_mode: 'ai-generate' },
];

test('删除根目录时提升全部直接子目录并保留子树顺序', () => {
  const result = deleteOutlineOnly(outline, '1');
  assert.deepEqual(result?.map((item) => item.id), ['1.1', '1.2', '2']);
  assert.equal(result?.[1].children?.[0].id, '1.2.1');
  assert.equal(outline[0].id, '1');
});

test('删除嵌套目录时将子目录提升到原父级并保留兄弟顺序', () => {
  const result = deleteOutlineOnly(outline, '1.2');
  assert.deepEqual(result?.[0].children?.map((item) => item.id), ['1.1', '1.2.1']);
  assert.equal(result?.[1].id, '2');
});

test('删除叶子目录时只移除当前节点', () => {
  const result = deleteOutlineOnly(outline, '1.1');
  assert.deepEqual(result?.[0].children?.map((item) => item.id), ['1.2']);
});

test('找不到目录时返回 null', () => {
  assert.equal(deleteOutlineOnly(outline, 'missing'), null);
});
