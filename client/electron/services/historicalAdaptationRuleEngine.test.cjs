const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHistoricalAdaptationRules, summarizeRuleDistribution } = require('./historicalAdaptationRuleEngine.cjs');

function difference(overrides = {}) {
  return {
    id: 'place', decision: 'confirmed', difference_schema_version: 2,
    category: '名称地点替换', content_change_scope: 'location-target',
    historical_excerpt: '五峰村开展农村服务', tender_requirement: '横泾街道服务',
    target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high',
    replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
    old_content_evidence: ['五峰村'], action: '替换地点',
    ...overrides,
  };
}

test('精确映射只保留完整旧值，不推导村级后缀或通用短语', () => {
  const rules = buildHistoricalAdaptationRules([difference()]);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].oldValues, ['五峰村']);
  assert.deepEqual(rules[0].replacements, [{ oldValue: '五峰村', newValue: '横泾街道' }]);
  assert.equal(rules[0].policy, 'must-replace');
  for (const phrase of ['开展农村', '展农村', '村辖区']) {
    assert.equal(rules[0].oldValues.some((value) => phrase.includes(value)), false);
  }
});

test('replace 的 scope 为 none 仍形成确定性可执行规则', () => {
  const [rule] = buildHistoricalAdaptationRules([difference({ content_change_scope: 'none' })]);
  assert.equal(rule.targetAction, 'replace');
  assert.equal(rule.policy, 'must-replace');
});

test('旧 replace 要求按新地区实际重写时保留映射并升级为段落语义规则', () => {
  const [rule] = buildHistoricalAdaptationRules([difference({
    action: '删除木渎镇五峰村地理概况、行政区划和人口等内容，按横泾街道实际情况重写测区理解',
  })]);
  assert.equal(rule.targetAction, 'rewrite-fragment');
  assert.equal(rule.paragraphRewrite, true);
  assert.deepEqual(rule.replacements, [{ oldValue: '五峰村', newValue: '横泾街道' }]);
  assert.deepEqual(rule.oldValues, ['五峰村']);
});

test('嵌套地点旧值走段落语义改写，独立工作量仍精确替换', () => {
  const [rule] = buildHistoricalAdaptationRules([difference({ replacements: [
    { old_value: '五峰村', new_value: '横泾街道' },
    { old_value: '木渎镇五峰村', new_value: '横泾街道' },
  ] })]);
  assert.equal(rule.paragraphRewrite, true);
  const [quantity] = buildHistoricalAdaptationRules([difference({ content_change_scope: 'workload', action: '数量更新',
    replacements: [{ old_value: '965宗', new_value: '3082宗' }] })]);
  assert.equal(quantity.targetAction, 'replace');
});

test('缺映射、非 v2 和忽略项绝不从备注猜测规则', () => {
  const rules = buildHistoricalAdaptationRules([
    difference({ id: 'missing', replacements: [], action: '把五峰村换成横泾街道' }),
    difference({ id: 'legacy', difference_schema_version: undefined }),
    difference({ id: 'ignored', decision: 'ignored' }),
  ]);
  assert.equal(rules.length, 0);
});

test('不同差异中的嵌套地点映射也升级，避免交叉规则产生重叠编辑', () => {
  const rules = buildHistoricalAdaptationRules([difference(), difference({ id: 'full-place',
    replacements: [{ old_value: '木渎镇五峰村', new_value: '横泾街道' }], old_content_evidence: ['木渎镇五峰村'],
  })]);
  assert.equal(rules.every((rule) => rule.paragraphRewrite && rule.targetAction === 'rewrite-fragment'), true);
});

test('冲突替换映射不生成规则', () => {
  const rules = buildHistoricalAdaptationRules([difference({
    replacements: [
      { old_value: '五峰村', new_value: '横泾街道' },
      { old_value: '五峰村', new_value: '其他街道' },
    ],
  })]);

  assert.equal(rules.length, 0);
});

test('服务内容证据保留原文，尚未绑定范围的动作只可复核', () => {
  const [rule] = buildHistoricalAdaptationRules([difference({
    id: 'service', target_action: 'remove', evidence_kind: 'locked-range',
    content_change_scope: 'none', replacements: [],
    old_content_evidence: ['完成数据建库、登记发证及成果移交。'],
  })]);
  assert.deepEqual(rule.oldContentEvidence, ['完成数据建库、登记发证及成果移交。']);
  assert.equal(rule.targetAction, 'remove');
  assert.equal(rule.policy, 'contextual-review');
  assert.deepEqual(rule.authorizedRanges, []);
  assert.deepEqual(summarizeRuleDistribution([rule]), {
    total: 1, mustReplace: 0, contextualReview: 1, reliableCount: 0,
    blocked: false, lowConfidenceHits: [],
  });
});
