import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { canAddOutlineChild, outlineDepth } from './outlineDepth.ts';

test('目录最多允许七级', () => {
  assert.equal(outlineDepth('1.2.3.4.5.6.7'), 7);
  assert.equal(canAddOutlineChild('1.2.3.4.5.6'), true);
  assert.equal(canAddOutlineChild('1.2.3.4.5.6.7'), false);
});

test('技术方案主页不再把叶子数量差异作为目录异常', () => {
  const source = fs.readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /AI生成小节数量未达到预期/);
  assert.doesNotMatch(source, /word_adjustment_warning_kind === 'leaf-count'/);
});
