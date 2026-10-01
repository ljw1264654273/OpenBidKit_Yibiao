import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoricalAdaptationDifference } from '../technical-plan/types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { buildBulkConfirmedDifferences } from './differenceConfirmation.ts';

function createDifference(id: string, decision: HistoricalAdaptationDifference['decision'], action: string): HistoricalAdaptationDifference {
  return {
    id,
    category: '数据更新',
    priority: 'medium',
    title: `差异 ${id}`,
    historical_location: '',
    historical_excerpt: '',
    tender_requirement: '',
    action,
    note: '',
    decision,
    content_change_scope: 'none',
  };
}

test('批量确认只确认待确认项并保留已处理项', () => {
  const pending = createDifference('pending', 'pending', '原处理要求');
  const confirmed = createDifference('confirmed', 'confirmed', '已确认要求');
  const ignored = createDifference('ignored', 'ignored', '无需处理要求');

  const result = buildBulkConfirmedDifferences([pending, confirmed, ignored], {});

  assert.equal(result[0]?.decision, 'confirmed');
  assert.strictEqual(result[1], confirmed);
  assert.strictEqual(result[2], ignored);
});

test('批量确认待确认项时一并保存当前草稿', () => {
  const pending = createDifference('pending', 'pending', '原处理要求');
  const draft = { ...pending, action: '人工修改后的处理要求', note: '人工备注' };

  const result = buildBulkConfirmedDifferences([pending], { pending: draft });

  assert.deepEqual(result[0], { ...draft, decision: 'confirmed' });
});
