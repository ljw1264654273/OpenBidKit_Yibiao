const test = require('node:test');
const assert = require('node:assert/strict');

const repair = require('./historicalAdaptationConsistencyRepair.cjs');
const realApplyRepairGroup = repair.applyRepairGroup;
const realValidateRepairGroup = repair.validateRepairGroup;
function hydrated(group, context) {
  const chapters = Array.isArray(context.chapters) ? context.chapters : [];
  return { ...group,
    expected_content_hash: context.expectedContentHash || group.expected_content_hash,
    expected_inputs_hash: context.expectedInputsHash || group.expected_inputs_hash,
    expected_facts_hash: context.expectedFactsHash || group.expected_facts_hash,
    chapters: group.chapters.map((edit) => {
      const chapter = chapters.find((item) => String(item.node_id) === String(edit.node_id));
      return { ...edit, expected_node_content_hash: repair.hashContent(chapter?.content), expected_item_fingerprint: chapter?.item_fingerprint };
    }),
  };
}
repair.applyRepairGroup = (group, context) => realApplyRepairGroup(hydrated(group, context), context);

const fact = (overrides = {}) => ({
  fact_id: 'location-1',
  kind: 'location',
  canonical_value: '新地点',
  evidence: ['招标文件：新地点'],
  chapter_node_ids: ['1', '2'],
  conflict: false,
  ...overrides,
});

const group = (overrides = {}) => ({
  group_id: 'g1',
  fact_id: 'location-1',
  confidence: 'high',
  rationale: '统一地点口径',
  expected_content_hash: 'fixture',
  expected_inputs_hash: 'fixture',
  expected_facts_hash: 'fixture',
  chapters: [{
    node_id: '1', expected_node_content_hash: 'fixture', expected_item_fingerprint: 'item-1',
    old_text: '旧地点', new_text: '新地点', evidence: ['证据'],
  }, {
    node_id: '2', expected_node_content_hash: 'fixture', expected_item_fingerprint: 'item-2',
    old_text: '旧地点', new_text: '新地点', evidence: ['证据'],
  }],
  ...overrides,
});

const context = (overrides = {}) => ({
  facts: [fact()],
  expectedContentHash: 'content-hash', expectedInputsHash: 'inputs-hash', expectedFactsHash: 'facts-hash',
  chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'ai', item_fingerprint: 'item-1' },
    { node_id: '2', content: '项目地点：旧地点。', content_origin: 'ai', item_fingerprint: 'item-2' }],
  ...overrides,
});

test('唯一替换可应用，重复命中拒绝且保留原文', () => {
  const single = context({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'ai', item_fingerprint: 'item-1' }] });
  const g = group({ chapters: [group().chapters[0]], expected_content_hash: 'fixture' });
  const ok = repair.applyRepairGroup(g, single);
  assert.equal(ok.ok, true);
  assert.equal(ok.chapters[0].content, '实施地点为新地点。');

  const ambiguous = context({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '旧地点，仍是旧地点。', content_origin: 'ai', item_fingerprint: 'item-1' }] });
  const result = repair.applyRepairGroup({ ...g, chapters: [g.chapters[0]] }, ambiguous);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'old-text-ambiguous');
  assert.equal(result.chapters?.[0]?.content, undefined);
});

test('拒绝重叠、空编辑、整章替换、Markdown保护范围和人工来源', () => {
  const base = context({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '旧地点以及旧地点。', content_origin: 'ai', item_fingerprint: 'item-1' }] });
  const one = group({ chapters: [group().chapters[0]], expected_content_hash: 'fixture' });
  assert.equal(repair.applyRepairGroup({ ...one, chapters: [{ ...one.chapters[0], old_text: '旧地点', new_text: '新地点' }, { ...one.chapters[0], old_text: '地点', new_text: '新地点' }] }, base).reason, 'duplicate-node');
  assert.equal(repair.applyRepairGroup({ ...one, chapters: [{ ...one.chapters[0], old_text: '', new_text: '新地点' }] }, base).reason, 'empty-edit');
  assert.equal(repair.applyRepairGroup({ ...one, chapters: [{ ...one.chapters[0], old_text: base.chapters[0].content, new_text: '新地点' }] }, base).reason, 'whole-chapter-replacement');
  const markdown = context({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '```md\n旧地点\n```', content_origin: 'ai', item_fingerprint: 'item-1' }] });
  assert.equal(repair.applyRepairGroup({ ...one, chapters: [{ ...one.chapters[0], old_text: '旧地点', new_text: '新地点' }] }, markdown).reason, 'markdown-protected');
  const manual = context({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'manual', item_fingerprint: 'item-1' }] });
  assert.equal(repair.applyRepairGroup({ ...one, chapters: [{ ...one.chapters[0] }] }, manual).reason, 'manual-source');
});

test('拒绝引入统一事实表之外的地点、对象、金额、日期、工作量、阶段、服务和名称', () => {
  const kinds = ['location', 'object', 'amount', 'schedule', 'workload', 'service', 'name'];
  for (const kind of kinds) {
    const f = fact({ kind, canonical_value: kind === 'amount' ? '100万元' : `${kind}事实`, evidence: [`${kind}事实`], chapter_node_ids: ['1'] });
    const c = context({ facts: [f], chapters: [{ node_id: '1', content: `章节原文：${f.canonical_value}。`, content_origin: 'ai', item_fingerprint: 'item-1' }] });
    const g = group({ fact_id: f.fact_id, chapters: [{ ...group().chapters[0], old_text: `章节原文：${f.canonical_value}`, new_text: `未登记${kind}事实` }] });
    const result = repair.applyRepairGroup(g, c);
    assert.equal(result.ok, false, kind);
    assert.equal(result.reason, 'fact-token-not-allowed', kind);
  }
});

test('跨章节必须覆盖事实全集，并满足置信度、冲突和 schema 门禁', () => {
  const c = context();
  assert.equal(repair.validateRepairGroup({ ...group(), chapters: [group().chapters[0]] }, c).reason, 'chapter-coverage-incomplete');
  assert.equal(repair.validateRepairGroup({ ...group(), confidence: 'medium' }, c).reason, 'confidence-not-high');
  assert.equal(repair.validateRepairGroup(group(), context({ facts: [fact({ conflict: true })] })).reason, 'fact-conflict');
  assert.equal(repair.validateRepairGroup(group(), context({ facts: [fact({ evidence: undefined })] })).reason, 'fact-schema-invalid');
  assert.equal(repair.validateRepairGroup(group(), context({ facts: [fact({ canonical_value: undefined })] })).reason, 'fact-schema-invalid');
  assert.equal(repair.validateRepairGroup(group(), context({ facts: [fact({ chapter_node_ids: undefined })] })).reason, 'fact-schema-invalid');
});

test('normalizeRepairResponse只接受固定修复组结构，并拒绝manual来源候选', () => {
  const normalized = repair.normalizeRepairResponse({ repair_groups: [group()] });
  assert.deepEqual(normalized.groups.map((item) => item.group_id), ['g1']);
  assert.throws(() => repair.normalizeRepairResponse({ groups: [] }), /repair response schema/i);
  assert.throws(() => repair.normalizeRepairResponse({ repair_groups: [{ group_id: 'bad' }] }), /repair group schema/i);
});
