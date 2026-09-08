import assert from 'node:assert/strict';
import test from 'node:test';

import type { OutlineItem } from '../../../shared/types';
import type { ScoreCoverageRecord } from '../types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { collectOutlineSourceRecords, locateOutlineSourceText } from './outlineSourceMatcher.ts';

const outline: OutlineItem[] = [{
  id: '1',
  title: '父级目录',
  description: '',
  children: [{
    id: '1.1',
    title: '子级目录',
    description: '',
  }],
}];

function record(overrides: Partial<ScoreCoverageRecord> & Pick<ScoreCoverageRecord, 'source_id'>): ScoreCoverageRecord {
  return {
    source_kind: 'response-point',
    source_text: overrides.source_id,
    node_ids: ['1.1'],
    coverage_location: 'description',
    user_override: 'none',
    supplement_kind: 'none',
    ...overrides,
  };
}

test('父级聚合后代招标来源并保留原记录顺序', () => {
  const records = [
    record({ source_id: 'child-response' }),
    record({ source_id: 'elsewhere', node_ids: ['2'] }),
    record({ source_id: 'child-requirement', source_kind: 'requirement' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1', records);

  assert.equal(result.scope, 'descendants');
  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['child-response', 'child-requirement']);
  assert.deepEqual(result.supplementRecords, []);
});

test('直属目录来源优先于后代来源', () => {
  const records = [
    record({ source_id: 'child-response' }),
    record({ source_id: 'parent-criterion', source_kind: 'criterion', node_ids: ['1'] }),
  ];

  const result = collectOutlineSourceRecords(outline, '1', records);

  assert.equal(result.scope, 'direct');
  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['parent-criterion']);
});

test('按 source_id 去重但保留相同文本的不同来源', () => {
  const records = [
    record({ source_id: 'same-id', source_text: '重复文本' }),
    record({ source_id: 'same-id', source_text: '不同记录文本' }),
    record({ source_id: 'different-id', source_text: '重复文本' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1.1', records);

  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['same-id', 'different-id']);
  assert.deepEqual(result.tenderRecords.map((item) => item.source_text), ['重复文本', '重复文本']);
});

test('将专业补充和用户补充分别归入补充来源', () => {
  const records = [
    record({ source_id: 'tender', source_kind: 'response-point' }),
    record({ source_id: 'professional', source_kind: 'professional-supplement' }),
    record({ source_id: 'user', source_kind: 'user-supplement' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1.1', records);

  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['tender']);
  assert.deepEqual(result.supplementRecords.map((item) => item.source_id), ['professional', 'user']);
});

test('排除无目录、未覆盖和已移除的记录', () => {
  const records = [
    record({ source_id: 'empty-node-ids', node_ids: [] }),
    record({ source_id: 'none-location', coverage_location: 'none' }),
    record({ source_id: 'removed', user_override: 'removed' }),
    record({ source_id: 'malformed-removed', node_ids: ['1.1'], coverage_location: 'description', user_override: 'removed' }),
    record({ source_id: 'kept' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1.1', records);

  assert.equal(result.scope, 'direct');
  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['kept']);
});

test('空的匹配范围返回 none', () => {
  const result = collectOutlineSourceRecords(outline, 'missing', [record({ source_id: 'child' })]);

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.tenderRecords, []);
  assert.deepEqual(result.supplementRecords, []);
});

test('空白规范化匹配映射回原始 Markdown 范围', () => {
  const markdown = '前置段落。\n\n本段包含  供应商\n\n应提供资质材料。\n\n后置段落。';
  const sourceText = '供应商 应提供资质材料';

  const result = locateOutlineSourceText(markdown, sourceText);
  const matchStart = markdown.indexOf('供应商');

  assert.deepEqual(result, {
    status: 'located',
    sourceText,
    matchStart,
    matchEnd: matchStart + '供应商\n\n应提供资质材料'.length,
    contextStart: 0,
    contextEnd: markdown.length,
    contextBefore: '前置段落。\n\n本段包含  ',
    matchedText: '供应商\n\n应提供资质材料',
    contextAfter: '。\n\n后置段落。',
  });
});

test('精确匹配优先保留原始文本范围', () => {
  const markdown = '第一段。\n\n需提交 A  B 两份材料。\n\n第三段。';
  const sourceText = 'A  B';

  const result = locateOutlineSourceText(markdown, sourceText);
  const matchStart = markdown.indexOf(sourceText);

  assert.equal(result.status, 'located');
  assert.equal(result.matchStart, matchStart);
  assert.equal(result.matchEnd, matchStart + sourceText.length);
  assert.equal(result.matchedText, sourceText);
});

test('未匹配来源只返回已保存文本且不猜测相近段落', () => {
  const sourceText = '供应商应提交完全不同的证明材料';

  const result = locateOutlineSourceText('供应商应提交证明材料。', sourceText);

  assert.deepEqual(result, { status: 'unlocated', sourceText });
});
