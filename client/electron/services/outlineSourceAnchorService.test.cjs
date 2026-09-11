const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  locateUniqueSourceText,
  attachScoreCoverageAnchors,
} = require('./outlineSourceAnchorService.cjs');

function coverageRecord(overrides = {}) {
  return {
    source_id: 'R1-C1',
    source_kind: 'criterion',
    source_text: 'Agent 改写文本',
    node_ids: ['1.1'],
    coverage_location: 'description',
    user_override: 'none',
    supplement_kind: 'none',
    ...overrides,
  };
}

const scorePlan = {
  version: 2,
  groups: [{
    requirement_id: 'R1',
    source_title: '总体方案',
    criteria: [{
      criterion_id: 'R1-C1',
      source_text: '供应商应提交实施方案',
      response_points: [{
        point_id: 'R1-C1-P1',
        source_text: '进度安排',
      }],
      supplements: [{
        supplement_id: 'R1-C1-S1',
        title: '合理化建议',
      }],
    }],
  }],
};

test('唯一精确来源生成绑定当前文档哈希的字符锚点', () => {
  const markdown = '前置段落。\n\n供应商应提交实施方案。\n\n后置段落。';
  const result = locateUniqueSourceText(markdown, '供应商应提交实施方案');

  assert.equal(result.status, 'located');
  assert.equal(result.matchStart, markdown.indexOf('供应商应提交实施方案'));
  assert.equal(result.matchEnd, result.matchStart + '供应商应提交实施方案'.length);
  assert.equal(result.matchMethod, 'exact');
  assert.equal(result.blockId, 'paragraph-000002');
});

test('唯一空白规范化来源映射回原始 Markdown 区间', () => {
  const markdown = '供应商应提交\n\n实施方案。';
  const result = locateUniqueSourceText(markdown, '供应商应提交 实施方案');

  assert.equal(result.status, 'located');
  assert.equal(result.matchMethod, 'normalized-whitespace');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '供应商应提交\n\n实施方案');
});

test('重复来源不再静默定位到第一次出现', () => {
  const result = locateUniqueSourceText('总体方案。\n\n总体方案。', '总体方案');

  assert.deepEqual(result, {
    status: 'unlocated',
    reason: 'ambiguous',
    sourceText: '总体方案',
    occurrenceCount: 2,
  });
});

test('相互重叠的重复来源同样判定为不唯一', () => {
  const result = locateUniqueSourceText('哈哈哈', '哈哈');

  assert.equal(result.status, 'unlocated');
  assert.equal(result.reason, 'ambiguous');
  assert.equal(result.occurrenceCount, 2);
});

test('来源带评分映射前缀和句末标点时仍可唯一定位原文', () => {
  const markdown = '评分内容：政策背景、项目技术要求理解进行打分。';
  const result = locateUniqueSourceText(markdown, 'R1-C1-P1：政策背景、项目技术要求理解。');

  assert.equal(result.status, 'located');
  assert.equal(result.matchMethod, 'normalized-source');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '政策背景、项目技术要求理解');
});

test('一级评分大项优先在评分表项目单元格中定位', () => {
  const markdown = '响应文件目录：项目总体方案。\n<table><tbody><tr><td rowspan="3"><p>项目总体</p><p>方案</p></td><td><p>项目总体方案设计的科学性</p></td></tr></tbody></table>';
  const result = locateUniqueSourceText(markdown, '项目总体方案', { sourceKind: 'requirement' });

  assert.equal(result.status, 'located');
  assert.equal(result.matchMethod, 'table-cell');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '项目总体</p><p>方案');
});

test('一级评分大项允许评分方式后缀并忽略评分目录中的同名文本', () => {
  const markdown = '响应文件目录：人员配置情况（格式见第六章）。\n<table><tbody><tr><td rowspan="4"><p>人员配置情况（客观分）</p></td><td><p>项目负责人</p></td></tr></tbody></table>';
  const result = locateUniqueSourceText(markdown, '人员配置情况', { sourceKind: 'requirement' });

  assert.equal(result.status, 'located');
  assert.equal(result.matchMethod, 'table-cell');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '人员配置情况');
});

test('覆盖映射使用权威评分清单校正来源并只给唯一招标来源生成锚点', () => {
  const markdown = '总体方案。\n\n供应商应提交实施方案。\n\n进度安排。\n\n总体方案。';
  const result = attachScoreCoverageAnchors({
    markdown,
    scorePlan,
    scoreCoverageMap: {
      version: 1,
      coverage_mode: 'full',
      records: [
        coverageRecord(),
        coverageRecord({ source_id: 'R1', source_kind: 'response-point', source_text: '错误标题', node_ids: ['1'] }),
        coverageRecord({ source_id: 'R1-C1-P1', source_kind: 'response-point', source_text: '进度', node_ids: ['1.1.1'] }),
        coverageRecord({ source_id: 'R1-C1-S1', source_kind: 'professional-supplement', source_text: '合理化建议' }),
        coverageRecord({ source_id: 'FAKE-C1', source_kind: 'criterion', source_text: '后置段落' }),
      ],
    },
  });

  assert.equal(result.version, 2);
  assert.equal(result.document_hash, crypto.createHash('sha256').update(markdown, 'utf8').digest('hex'));
  assert.equal(result.records[0].source_kind, 'criterion');
  assert.equal(result.records[0].source_text, '供应商应提交实施方案');
  assert.equal(result.records[0].source_anchor.match_method, 'exact');
  assert.equal(result.records[0].source_anchor.block_id, 'paragraph-000002');
  assert.equal(result.records[1].source_kind, 'requirement');
  assert.equal(result.records[1].source_text, '总体方案');
  assert.equal(result.records[1].source_anchor, undefined);
  assert.equal(result.records[1].source_location_status, 'ambiguous');
  assert.equal(result.records[2].source_text, '进度安排');
  assert.equal(result.records[2].source_location_status, 'located');
  assert.equal(result.records[3].source_anchor, undefined);
  assert.equal(result.records[3].source_location_status, 'not-applicable');
  assert.equal(result.records.some((record) => record.source_id === 'FAKE-C1'), false);
});

test('不存在的来源保持未定位且清除任何旧锚点', () => {
  const result = attachScoreCoverageAnchors({
    markdown: '当前正文',
    scoreCoverageMap: {
      version: 2,
      coverage_mode: 'full',
      records: [coverageRecord({
        source_text: '原文不存在',
        source_anchor: { document_hash: 'stale', match_start: 0, match_end: 2, context_start: 0, context_end: 2, match_method: 'exact' },
      })],
    },
  });

  assert.equal(result.records[0].source_anchor, undefined);
  assert.equal(result.records[0].source_location_status, 'not-found');
});
