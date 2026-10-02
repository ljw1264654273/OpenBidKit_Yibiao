import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import type { TechnicalPlanState } from '../technical-plan/types';
// @ts-expect-error Node type stripping requires an explicit extension.
import { applyHistoricalAdaptationContentPatch } from './contentItemPatch.ts';

const fixture = () => ({
  outlineData: { outline: [{ id: '1', title: '父章', children: [{ id: '1.1', title: '正文', content: '人工正文' }] }, { id: '2', title: '未变正文', content: '保留' }] },
  historicalAdaptationContentItems: [{ node_id: '1.1', status: 'error', error: '失败', residuals: ['旧地点'], manual_mode: 'rewrite' }, { node_id: '2', status: 'success' }],
  historicalAdaptationContentConfirmedAt: '已确认',
} as unknown as TechnicalPlanState);

test('局部 item 和正文 patch 按存在性合并，保留其他章节与未出现字段', () => {
  const before = fixture();
  const next = applyHistoricalAdaptationContentPatch(before, {
    contentItemPatch: { node_id: '1.1', status: 'success', error: undefined, manual_mode: undefined, residuals: [] },
    outlineContentPatch: { nodeId: '1.1', content: '' },
    technicalPlanPatch: { historicalAdaptationContentConfirmedAt: undefined },
  });
  assert.equal(next.historicalAdaptationContentItems[0].status, 'success');
  assert.equal(next.historicalAdaptationContentItems[0].error, undefined);
  assert.equal(next.historicalAdaptationContentItems[0].manual_mode, undefined);
  assert.deepEqual(next.historicalAdaptationContentItems[0].residuals, []);
  assert.equal(next.outlineData!.outline[0].children![0].content, '');
  assert.equal(next.historicalAdaptationContentConfirmedAt, undefined);
  assert.equal(next.historicalAdaptationContentItems[1], before.historicalAdaptationContentItems[1]);
  assert.equal(next.outlineData!.outline[1], before.outlineData!.outline[1]);
  assert.equal(before.outlineData!.outline[0].children![0].content, '人工正文');
});

test('全文空集合和 null 清理生效，缺失正文字段不擦除正文', () => {
  const before = fixture();
  const unchanged = applyHistoricalAdaptationContentPatch(before, { outlineContentPatch: { nodeId: '1.1' } });
  assert.equal(unchanged.outlineData!.outline[0].children![0].content, '人工正文');
  const cleared = applyHistoricalAdaptationContentPatch(before, { technicalPlanPatch: { historicalAdaptationContentItems: [], outlineData: null } });
  assert.deepEqual(cleared.historicalAdaptationContentItems, []);
  assert.equal(cleared.outlineData, null);
});

test('局部新章节加入，并保留 snapshot 内有意出现的空值', () => {
  const next = applyHistoricalAdaptationContentPatch(fixture(), { contentItemPatch: { node_id: '3', status: 'idle' }, technicalPlanPatch: { historicalAdaptationContentTask: undefined } });
  assert.equal(next.historicalAdaptationContentItems[2].node_id, '3');
  assert.equal(Object.hasOwn(next, 'historicalAdaptationContentTask'), true);
  assert.equal(next.historicalAdaptationContentTask, undefined);
});

test('100章每章120k字符连续100次局部 patch，P95 不超过16ms', () => {
  const content = '保持未修改正文。'.repeat(15000);
  let state = { outlineData: { outline: Array.from({ length: 100 }, (_, index) => ({ id: String(index), title: String(index), content })) }, historicalAdaptationContentItems: Array.from({ length: 100 }, (_, index) => ({ node_id: String(index), status: 'idle' })) } as unknown as TechnicalPlanState;
  const timings: number[] = [];
  for (let index = 0; index < 100; index++) {
    const started = performance.now();
    state = applyHistoricalAdaptationContentPatch(state, { contentItemPatch: { node_id: String(index), status: 'success' }, outlineContentPatch: { nodeId: String(index), content: `${content}${index}` } });
    timings.push(performance.now() - started);
  }
  const p95 = timings.sort((a, b) => a - b)[94];
  assert.ok(p95 <= 16, `P95 ${p95.toFixed(3)}ms exceeds 16ms`);
  assert.equal(state.outlineData!.outline[99].content, `${content}99`);
});
