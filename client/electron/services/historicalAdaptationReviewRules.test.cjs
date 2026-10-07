const assert = require('node:assert/strict');
const test = require('node:test');
const { reviewHistoricalAdaptationContent } = require('./historicalAdaptationReviewRules.cjs');

function fixture() {
  return {
    outline: [{ id: '1', title: '实施范围', content: '服务范围为横泾街道。', children: [] }],
    contentItems: [{
      node_id: '1',
      status: 'success',
      blocked_terms: ['五峰村'],
      residuals: [],
      difference_ids: ['location'],
    }],
    differences: [{ id: 'location', category: '名称地点替换', decision: 'confirmed', historical_excerpt: '五峰村' }],
  };
}

test('allows a chapter whose only pending issue is a placeholder', () => {
  const input = fixture();
  input.outline[0].content = '服务地点为【待核实】。';
  input.contentItems[0].status = 'review';
  input.contentItems[0].confirmed_at = undefined;

  const findings = reviewHistoricalAdaptationContent(input);

  assert.deepEqual(findings.map(({ code, severity }) => [code, severity]), [
    ['placeholder', 'P1'],
  ]);
  assert.equal(findings.every((finding) => finding.node_id === '1' && finding.evidence), true);
});

test('still blocks a review chapter that has no allowed placeholder output', () => {
  const input = fixture();
  input.outline[0].content = '服务地点待处理。';
  input.contentItems[0].status = 'review';

  const findings = reviewHistoricalAdaptationContent(input);

  assert.equal(findings.some((finding) => finding.code === 'chapter-not-ready' && finding.severity === 'P0'), true);
});

test('人工确认的章节不再重复产生正文阻断问题', () => {
  const input = fixture();
  input.outline[0].content = '服务地点仍为五峰村。';
  input.contentItems[0] = { ...input.contentItems[0], status: 'success', confirmed_at: '2026-10-07T00:00:00.000Z', residuals: ['五峰村'] };

  assert.deepEqual(reviewHistoricalAdaptationContent(input), []);
});

test('does not require legacy per-chapter confirmed_at when content is successful', () => {
  const input = fixture();
  input.contentItems[0].confirmed_at = undefined;
  const findings = reviewHistoricalAdaptationContent(input);
  assert.equal(findings.some((finding) => finding.code === 'chapter-unconfirmed'), false);
  assert.equal(findings.some((finding) => finding.code === 'chapter-not-ready'), false);
});

test('detects historical residue, deleted content residue and vague language', () => {
  const input = fixture();
  input.outline[0].content = '可能继续按五峰村旧方式办理。';
  input.differences.push({
    id: 'remove-old-scope', category: '删除内容', decision: 'confirmed', historical_excerpt: '旧方式办理',
    difference_schema_version: 2, target_action: 'remove', evidence_kind: 'locked-range', confidence: 'high',
    old_content_evidence: ['旧方式办理'], tender_requirement: '不再办理旧事项',
  });
  input.contentItems[0].difference_ids.push('remove-old-scope');

  const findings = reviewHistoricalAdaptationContent(input);

  assert.deepEqual(findings.map(({ code, severity }) => [code, severity]), [
    ['deleted-content-residue', 'P0'],
    ['historical-residue', 'P0'],
    ['vague-language', 'P1'],
  ]);
});

test('must-replace scans every chapter and cannot carry a previous exemption', () => {
  const input = fixture();
  input.outline[0].content = '五峰村正文。';
  input.contentItems[0].blocked_terms = [];
  Object.assign(input.differences[0], { difference_schema_version: 2, target_action: 'replace',
    evidence_kind: 'exact-value', confidence: 'high', replacements: [{ old_value: '五峰村', new_value: '横泾街道' }],
    tender_requirement: '横泾街道' });
  const first = reviewHistoricalAdaptationContent(input);
  assert.equal(first[0].code, 'historical-residue');
  const repeat = reviewHistoricalAdaptationContent(input, [{ ...first[0], resolution: 'resolved', resolution_note: '保留旧称' }]);
  assert.equal(repeat[0].resolution, 'open');
});

test('legacy deletion prose is not treated as executable evidence', () => {
  const input = fixture();
  input.outline[0].content = '旧方式办理。';
  input.differences.push({ id: 'old', category: '删除内容', decision: 'confirmed', historical_excerpt: '旧方式办理' });
  assert.equal(reviewHistoricalAdaptationContent(input).some((finding) => finding.code === 'deleted-content-residue'), false);
});

test('blocks an empty chapter even when its migration record is confirmed', () => {
  const input = fixture();
  input.outline[0].content = '';

  const findings = reviewHistoricalAdaptationContent(input);

  assert.equal(findings.some((finding) => finding.code === 'chapter-empty' && finding.severity === 'P0'), true);
});

test('reports unlinked confirmed differences and ignored decisions', () => {
  const input = fixture();
  input.differences = [
    { id: 'unlinked', category: '数据更新', decision: 'confirmed', title: '更新工作量' },
    { id: 'ignored', category: '其他人工判断', decision: 'ignored', title: '需人工判断' },
  ];

  const findings = reviewHistoricalAdaptationContent(input);

  assert.deepEqual(findings.map(({ code, severity }) => [code, severity]), [
    ['difference-uncovered', 'P1'],
    ['difference-ignored', 'P2'],
    ['manual-review', 'P2'],
  ]);
});

test('uses stable finding ids and carries decisions only for identical evidence', () => {
  const input = fixture();
  input.outline[0].content = '可能继续服务。';
  const first = reviewHistoricalAdaptationContent(input);
  const prior = [{ ...first[0], resolution: 'resolved', resolution_note: '已整改' }];
  const repeated = reviewHistoricalAdaptationContent(input, prior);

  assert.equal(repeated[0].id, first[0].id);
  assert.equal(repeated[0].resolution, 'resolved');
  assert.equal(repeated[0].resolution_note, '已整改');

  input.outline[0].content = '可能仍继续服务。';
  const changed = reviewHistoricalAdaptationContent(input, prior);
  assert.notEqual(changed[0].id, first[0].id);
  assert.equal(changed[0].resolution, 'open');
});
