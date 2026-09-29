import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { formatOutlineMinimumDepth, isOutlineConfigLocked, normalizeOutlineMinimumDepth } from './outlineMinimumDepth.ts';

test('目录最低层级只接受默认、三级、四级、五级', () => {
  assert.equal(normalizeOutlineMinimumDepth(undefined), 0);
  assert.equal(normalizeOutlineMinimumDepth(null), 0);
  assert.equal(normalizeOutlineMinimumDepth(3), 3);
  assert.equal(normalizeOutlineMinimumDepth(4), 4);
  assert.equal(normalizeOutlineMinimumDepth(5), 5);
  assert.equal(normalizeOutlineMinimumDepth(2), 0);
  assert.equal(normalizeOutlineMinimumDepth(7), 0);
  assert.equal(formatOutlineMinimumDepth(0), '默认');
  assert.equal(formatOutlineMinimumDepth(3), '三级');
  assert.equal(formatOutlineMinimumDepth(4), '四级');
  assert.equal(formatOutlineMinimumDepth(5), '五级');
});

test('目录生成、目录调整和正文生成任务共同锁定目录配置', () => {
  assert.equal(isOutlineConfigLocked({ outline: 'running' }), true);
  assert.equal(isOutlineConfigLocked({ adjustment: 'pausing' }), true);
  assert.equal(isOutlineConfigLocked({ content: 'paused' }), true);
  assert.equal(isOutlineConfigLocked({ outline: 'success', adjustment: 'error', content: 'success' }), false);
  assert.equal(isOutlineConfigLocked({}), false);
});
