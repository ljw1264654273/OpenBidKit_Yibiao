const assert = require('node:assert/strict');
const test = require('node:test');

const registry = require('./historicalAdaptationFactRegistry.cjs');

test('normalizes Chinese digits, qualifiers and stable fact keys', () => {
  assert.equal(registry.normalizeChineseDigits('三年'), '3年');
  assert.equal(registry.normalizeQualifier(' 项目服务期限： '), '项目服务期限');
  assert.equal(registry.canonicalFactKey({ kind: 'schedule', slot: 'contract_duration', qualifier: '项目服务期限' }), 'schedule:contract_duration:项目服务期限');
});

test('merges same facts across chapters and marks conflicting values', () => {
  const facts = registry.mergeFacts([
    { kind: 'schedule', slot: 'contract_duration', qualifier: '服务期限', value: '3年', evidence: '基线3年', node_id: '1' },
    { kind: 'schedule', slot: 'contract_duration', qualifier: '服务期限', value: '三年', evidence: '正文三年', node_id: '2' },
    { kind: 'schedule', slot: 'contract_duration', qualifier: '服务期限', value: '2年', evidence: '正文2年', node_id: '3' },
  ]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].conflict, true);
  assert.deepEqual(facts[0].chapter_node_ids.sort(), ['1', '2', '3']);
  assert.equal(registry.factsHash(facts), registry.factsHash(structuredClone(facts)));
});

test('rejects unknown fact slots and empty evidence', () => {
  assert.throws(() => registry.canonicalFactKey({ kind: 'schedule', slot: 'unknown', qualifier: '' }), /槽位/);
  assert.throws(() => registry.normalizeCandidate({ kind: 'schedule', slot: 'contract_duration', value: '3年', evidence: '' }, '1'), /evidence/);
});
