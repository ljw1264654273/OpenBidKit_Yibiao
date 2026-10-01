const assert = require('node:assert/strict');
const test = require('node:test');
const { reviewHistoricalAdaptationContent } = require('./historicalAdaptationReviewRules.cjs');

function fixture() {
  return {
    outline: [{ id: '1', title: '实施范围', content: '服务范围为横泾街道。', children: [] }],
    contentItems: [{
      node_id: '1',
      status: 'success',
      confirmed_at: '2026-10-01T00:00:00.000Z',
      blocked_terms: ['五峰村'],
      residuals: [],
      difference_ids: ['location'],
    }],
    differences: [{ id: 'location', category: '名称地点替换', decision: 'confirmed', historical_excerpt: '五峰村' }],
  };
}

test('blocks sections that are not successful and unresolved placeholders without requiring per-chapter confirmation', () => {
  const input = fixture();
  input.outline[0].content = '服务地点为【待核实】。';
  input.contentItems[0].status = 'review';
  input.contentItems[0].confirmed_at = undefined;

  const findings = reviewHistoricalAdaptationContent(input);

  assert.deepEqual(findings.map(({ code, severity }) => [code, severity]), [
    ['chapter-not-ready', 'P0'],
    ['placeholder', 'P0'],
  ]);
  assert.equal(findings.every((finding) => finding.node_id === '1' && finding.evidence), true);
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
  });
  input.contentItems[0].difference_ids.push('remove-old-scope');

  const findings = reviewHistoricalAdaptationContent(input);

  assert.deepEqual(findings.map(({ code, severity }) => [code, severity]), [
    ['deleted-content-residue', 'P0'],
    ['historical-residue', 'P0'],
    ['vague-language', 'P1'],
  ]);
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
