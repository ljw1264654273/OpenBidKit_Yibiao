import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoricalAdaptationDifference } from '../technical-plan/types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { buildDifferenceRecommendation } from './differenceRecommendation.ts';

function createDifference(overrides: Partial<HistoricalAdaptationDifference> = {}): HistoricalAdaptationDifference {
  return {
    id: 'difference',
    category: '名称地点替换',
    priority: 'high',
    title: '项目地点调整',
    historical_location: '项目概况',
    historical_excerpt: '服务地点：五峰村',
    tender_requirement: '服务地点：横泾街道',
    action: '按当前招标基线调整地点',
    note: '',
    decision: 'pending',
    content_change_scope: 'location-target',
    difference_schema_version: 2,
    replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
    target_action: 'replace',
    evidence_kind: 'exact-value',
    confidence: 'high',
    old_content_evidence: ['五峰村'],
    ...overrides,
  };
}

test('确定替换推荐直接说明旧值、新值和正文影响', () => {
  const recommendation = buildDifferenceRecommendation(createDifference());

  assert.equal(recommendation.action, 'replace');
  assert.match(recommendation.title, /确定替换/);
  assert.match(recommendation.summary, /五峰村/);
  assert.match(recommendation.summary, /横泾街道/);
  assert.match(recommendation.impact, /地点/);
  assert.equal(recommendation.requiresAdvancedReview, false);
});

test('删除旧内容推荐说明确认后的删除范围', () => {
  const recommendation = buildDifferenceRecommendation(createDifference({
    target_action: 'remove',
    category: '删除内容',
    content_change_scope: 'none',
    replacements: [],
    evidence_kind: 'locked-range',
    old_content_evidence: ['完成登记发证及成果移交。'],
    title: '删除登记发证服务',
  }));

  assert.equal(recommendation.action, 'remove');
  assert.match(recommendation.title, /删除旧内容/);
  assert.match(recommendation.summary, /完成登记发证及成果移交/);
  assert.match(recommendation.impact, /完整旧内容/);
});

test('缺少可靠替换映射时推荐人工复核而不是猜测', () => {
  const recommendation = buildDifferenceRecommendation(createDifference({
    target_action: 'replace',
    replacements: [],
    evidence_kind: 'contextual',
    content_change_scope: 'none',
  }));

  assert.equal(recommendation.action, 'review');
  assert.match(recommendation.title, /仅人工复核/);
  assert.match(recommendation.summary, /没有完整的旧值和新值映射/);
  assert.equal(recommendation.requiresAdvancedReview, true);
});

test('无实际变化或同一旧值指向多个新值时推荐人工复核', () => {
  const noOp = buildDifferenceRecommendation(createDifference({
    replacements: [{ old_value: '五峰村', new_value: '五峰村' }],
  }));
  const conflicting = buildDifferenceRecommendation(createDifference({
    replacements: [
      { old_value: '五峰村', new_value: '横泾街道' },
      { old_value: '五峰村', new_value: '其他街道' },
    ],
  }));

  assert.equal(noOp.action, 'review');
  assert.equal(noOp.requiresAdvancedReview, true);
  assert.equal(conflicting.action, 'review');
  assert.equal(conflicting.requiresAdvancedReview, true);
});

test('局部重写和人工复核都明确不会整章自动改写', () => {
  const rewrite = buildDifferenceRecommendation(createDifference({
    target_action: 'rewrite-fragment',
    content_change_scope: 'none',
    replacements: [],
    evidence_kind: 'locked-range',
    old_content_evidence: ['旧服务事项'],
  }));
  const review = buildDifferenceRecommendation(createDifference({
    target_action: 'review',
    content_change_scope: 'none',
    replacements: [],
    evidence_kind: 'contextual',
    confidence: 'low',
  }));

  assert.equal(rewrite.action, 'rewrite-fragment');
  assert.match(rewrite.impact, /仅定位片段/);
  assert.equal(review.action, 'review');
  assert.match(review.impact, /不会自动修改正文/);
});
