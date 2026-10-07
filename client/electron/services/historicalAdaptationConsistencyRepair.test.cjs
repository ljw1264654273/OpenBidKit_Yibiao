const test = require('node:test');
const assert = require('node:assert/strict');

const repair = require('./historicalAdaptationConsistencyRepair.cjs');
function itemFingerprint(chapter) {
  return repair.stableHash({ node_id: String(chapter.node_id), content: String(chapter.content ?? '') });
}

function contextHashes(context) {
  return {
    expectedContentHash: repair.stableHash((context.chapters || []).map(({ node_id, content }) => ({ node_id: String(node_id), content: String(content ?? '') }))),
    expectedInputsHash: repair.stableHash((context.chapters || []).map(({ node_id, item_fingerprint }) => ({ node_id: String(node_id), item_fingerprint }))),
    expectedFactsHash: repair.stableHash(context.facts || []),
  };
}

function hydrated(group, context) {
  const hashes = contextHashes(context);
  return {
    ...group,
    expected_content_hash: hashes.expectedContentHash,
    expected_inputs_hash: hashes.expectedInputsHash,
    expected_facts_hash: hashes.expectedFactsHash,
    chapters: group.chapters.map((edit) => {
      const chapter = (context.chapters || []).find((item) => String(item.node_id) === String(edit.node_id));
      return {
        ...edit,
        expected_node_content_hash: repair.hashContent(chapter?.content),
        expected_item_fingerprint: chapter?.item_fingerprint,
      };
    }),
  };
}

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
  expected_content_hash: repair.stableHash('content-fixture'),
  expected_inputs_hash: repair.stableHash('inputs-fixture'),
  expected_facts_hash: repair.stableHash('facts-fixture'),
  chapters: [{
    node_id: '1', expected_node_content_hash: repair.hashContent('实施地点为旧地点。'), expected_item_fingerprint: repair.stableHash({ node_id: '1', content: '实施地点为旧地点。' }),
    old_text: '旧地点', new_text: '新地点', evidence: ['证据'],
  }, {
    node_id: '2', expected_node_content_hash: repair.hashContent('项目地点：旧地点。'), expected_item_fingerprint: repair.stableHash({ node_id: '2', content: '项目地点：旧地点。' }),
    old_text: '旧地点', new_text: '新地点', evidence: ['证据'],
  }],
  ...overrides,
});

const context = (overrides = {}) => ({
  facts: [fact()],
  chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'ai' },
    { node_id: '2', content: '项目地点：旧地点。', content_origin: 'ai' }],
  ...overrides,
});

function makeContext(overrides = {}) {
  const value = context(overrides);
  value.chapters = value.chapters.map((chapter) => ({ ...chapter, item_fingerprint: chapter.item_fingerprint || itemFingerprint(chapter) }));
  const hashes = contextHashes(value);
  if (!Object.prototype.hasOwnProperty.call(overrides, 'expectedContentHash')) value.expectedContentHash = hashes.expectedContentHash;
  if (!Object.prototype.hasOwnProperty.call(overrides, 'expectedInputsHash')) value.expectedInputsHash = hashes.expectedInputsHash;
  if (!Object.prototype.hasOwnProperty.call(overrides, 'expectedFactsHash')) value.expectedFactsHash = hashes.expectedFactsHash;
  return value;
}

test('唯一替换可应用，重复命中拒绝且保留原文', () => {
  const single = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'ai' }] });
  const g = group({ chapters: [group().chapters[0]] });
  const ok = repair.applyRepairGroup(hydrated(g, single), single);
  assert.equal(ok.ok, true);
  assert.equal(ok.chapters[0].content, '实施地点为新地点。');

  const ambiguous = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '旧地点，仍是旧地点。', content_origin: 'ai' }] });
  const result = repair.applyRepairGroup(hydrated({ ...g, chapters: [g.chapters[0]] }, ambiguous), ambiguous);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'old-text-ambiguous');
  assert.equal(result.chapters?.[0]?.content, undefined);
});

test('拒绝重复节点、空编辑、整章替换、Markdown保护范围和人工来源', () => {
  const base = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '旧地点甲旧地点乙。', content_origin: 'ai' }] });
  const one = group({ chapters: [group().chapters[0]] });
  const overlap = { ...one, chapters: [{ ...one.chapters[0], old_text: '旧地点甲旧', new_text: '新地点' }, { ...one.chapters[0], old_text: '旧地点乙', new_text: '新地点' }] };
  assert.equal(repair.applyRepairGroup(hydrated(overlap, base), base).reason, 'duplicate-node');
  assert.equal(repair.applyRepairGroup(hydrated({ ...one, chapters: [{ ...one.chapters[0], old_text: '', new_text: '新地点' }] }, base), base).reason, 'empty-edit');
  assert.equal(repair.applyRepairGroup(hydrated({ ...one, chapters: [{ ...one.chapters[0], old_text: base.chapters[0].content, new_text: '新地点' }] }, base), base).reason, 'whole-chapter-replacement');
  const noOp = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'ai' }] });
  assert.equal(repair.applyRepairGroup(hydrated({ ...one, chapters: [{ ...one.chapters[0], old_text: '旧地点', new_text: '旧地点' }] }, noOp), noOp).reason, 'no-op-edit');
  const markdown = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '```md\n旧地点\n```', content_origin: 'ai' }] });
  assert.equal(repair.applyRepairGroup(hydrated({ ...one, chapters: [{ ...one.chapters[0], old_text: '旧地点', new_text: '新地点' }] }, markdown), markdown).reason, 'markdown-protected');
  const manual = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'manual' }] });
  assert.equal(repair.applyRepairGroup(hydrated({ ...one, chapters: [{ ...one.chapters[0] }] }, manual), manual).reason, 'manual-source');
});

test('拒绝引入统一事实表之外的地点、对象、金额、日期、工作量、阶段、服务和名称', () => {
  const kinds = ['location', 'object', 'amount', 'schedule', 'workload', 'service', 'name'];
  for (const kind of kinds) {
    const f = fact({ kind, canonical_value: kind === 'amount' ? '100万元' : `${kind}事实`, evidence: [`${kind}事实`], chapter_node_ids: ['1'] });
    const c = makeContext({ facts: [f], chapters: [{ node_id: '1', content: `章节原文：${f.canonical_value}。`, content_origin: 'ai' }] });
    const g = group({ fact_id: f.fact_id, chapters: [{ ...group().chapters[0], old_text: `章节原文：${f.canonical_value}`, new_text: `未登记${kind}事实` }] });
    const result = repair.applyRepairGroup(hydrated(g, c), c);
    assert.equal(result.ok, false, kind);
    assert.equal(result.reason, 'fact-token-not-allowed', kind);
  }
});

test('跨章节必须覆盖事实全集，并满足置信度、冲突和 schema 门禁', () => {
  const c = makeContext();
  assert.equal(repair.validateRepairGroup({ ...group(), chapters: [group().chapters[0]] }, c).reason, 'chapter-coverage-incomplete');
  assert.equal(repair.validateRepairGroup({ ...group(), confidence: 'medium' }, c).reason, 'confidence-not-high');
  assert.equal(repair.validateRepairGroup(group(), makeContext({ facts: [fact({ conflict: true })] })).reason, 'fact-conflict');
  assert.equal(repair.validateRepairGroup(group(), makeContext({ facts: [fact({ evidence: undefined })] })).reason, 'fact-schema-invalid');
  assert.equal(repair.validateRepairGroup(group(), makeContext({ facts: [fact({ canonical_value: undefined })] })).reason, 'fact-schema-invalid');
  assert.equal(repair.validateRepairGroup(group(), makeContext({ facts: [fact({ chapter_node_ids: undefined })] })).reason, 'fact-schema-invalid');
});

test('缺失或错误的全局 hash、节点 hash 和 fingerprint 均拒绝', () => {
  const c = makeContext({ facts: [fact({ chapter_node_ids: ['1'] })], chapters: [{ node_id: '1', content: '实施地点为旧地点。', content_origin: 'ai' }] });
  const valid = hydrated({ ...group(), chapters: [group().chapters[0]] }, c);
  const reasons = { expected_content_hash: 'content-hash-mismatch', expected_inputs_hash: 'inputs-hash-mismatch', expected_facts_hash: 'facts-hash-mismatch' };
  for (const field of ['expected_content_hash', 'expected_inputs_hash', 'expected_facts_hash']) {
    const missing = { ...valid, [field]: undefined };
    assert.equal(repair.validateRepairGroup(missing, c).reason, 'repair-group-schema-invalid');
    const wrong = { ...valid, [field]: repair.stableHash(`wrong-${field}`) };
    assert.equal(repair.validateRepairGroup(wrong, c).reason, reasons[field]);
  }
  assert.equal(repair.validateRepairGroup({ ...valid, chapters: [{ ...valid.chapters[0], expected_node_content_hash: undefined }] }, c).reason, 'repair-group-schema-invalid');
  assert.equal(repair.validateRepairGroup({ ...valid, chapters: [{ ...valid.chapters[0], expected_item_fingerprint: undefined }] }, c).reason, 'repair-group-schema-invalid');
});

test('normalizeRepairResponse只接受固定修复组结构，并拒绝manual来源候选', () => {
  const normalized = repair.normalizeRepairResponse({ repair_groups: [group()] });
  assert.deepEqual(normalized.groups.map((item) => item.group_id), ['g1']);
  assert.throws(() => repair.normalizeRepairResponse({ groups: [] }), /repair response schema/i);
  assert.throws(() => repair.normalizeRepairResponse({ repair_groups: [{ group_id: 'bad' }] }), /repair group schema/i);
});
