import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutlineItem } from '../../../shared/types/outline.ts';
// @ts-expect-error Node's strip-types runner requires an explicit extension.
import { canAddOutlineParent, getOutlineSubtreeMaxDepth, insertOutlineParent } from './outlineParent.ts';

const parent: Omit<OutlineItem, 'children'> = {
  id: '__outline_parent__',
  title: '新目录项',
  description: '请编辑描述',
};

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
  { id: '3', title: '第三章', description: '说明三', content_mode: 'ai-generate' },
];

test('原位包裹根节点并保留兄弟顺序和完整子树', () => {
  const result = insertOutlineParent(outline, '2', parent);
  assert.equal(result?.[1].id, '__outline_parent__');
  assert.equal(result?.[1].children?.[0].id, '2');
  assert.equal(result?.[1].children?.[0].children, undefined);
  assert.equal(result?.[2].id, '3');
  assert.equal(outline[1].id, '2');
});

test('原位包裹嵌套节点并保留其后代', () => {
  const result = insertOutlineParent(outline, '1.2', parent);
  assert.equal(result?.[0].children?.[1].id, '__outline_parent__');
  assert.equal(result?.[0].children?.[1].children?.[0].id, '1.2');
  assert.equal(result?.[0].children?.[1].children?.[0].children?.[0].id, '1.2.1');
});

test('只有整棵子树下移后不超过七级时才允许添加父目录', () => {
  const sixLevelNode: OutlineItem = {
    id: '1.2.3.4.5.6', title: '六级', description: '', content_mode: 'ai-generate',
  };
  const sevenLevelNode: OutlineItem = {
    id: '1.2.3.4.5.6.7', title: '七级', description: '', content_mode: 'ai-generate',
  };
  assert.equal(getOutlineSubtreeMaxDepth(sixLevelNode), 6);
  assert.equal(canAddOutlineParent(sixLevelNode), true);
  assert.equal(getOutlineSubtreeMaxDepth(sevenLevelNode), 7);
  assert.equal(canAddOutlineParent(sevenLevelNode), false);
});

test('找不到节点时返回 null', () => {
  assert.equal(insertOutlineParent(outline, 'missing', parent), null);
});
