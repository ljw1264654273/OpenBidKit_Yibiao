import assert from 'node:assert/strict';
import test from 'node:test';

import type { OutlineItem } from '../../../shared/types';
// @ts-expect-error Node's strip-types runner requires an explicit extension.
import { remapOutlineUiState } from './outlineUiState.ts';

const outline: OutlineItem[] = [{
  id: '1',
  title: '父级目录',
  description: '',
  children: [{ id: '1.1', title: '子级目录', description: '' }],
}];

test('目录保存后按 idMap 保留选中和展开状态', () => {
  const result = remapOutlineUiState({
    selectedItemId: '2.1',
    expandedItems: new Set(['2', '2.1', 'missing']),
  }, {
    '2': '1',
    '2.1': '1.1',
  }, outline);

  assert.equal(result.selectedItemId, '1.1');
  assert.deepEqual([...result.expandedItems], ['1', '1.1']);
});

test('目录删除后清理已不存在的选中和展开节点', () => {
  const result = remapOutlineUiState({
    selectedItemId: '2',
    expandedItems: new Set(['2', '2.1']),
  }, { '2.1': '1.1' }, outline);

  assert.equal(result.selectedItemId, null);
  assert.deepEqual([...result.expandedItems], ['1.1']);
});
