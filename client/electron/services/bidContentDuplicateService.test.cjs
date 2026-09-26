const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareBidContents,
  refreshExactSentenceMatches,
  splitBidParagraphs,
} = require('./bidContentDuplicateService.cjs');

test('detects paragraph-level near duplicates after small edits and reordering', () => {
  const left = [
    '一、项目实施目标\n本项目将建立统一的项目管理机制，明确责任边界，确保建设任务按期完成。',
    '二、质量保障措施\n项目组将通过阶段评审、现场检查和问题闭环，持续保障交付质量。',
  ].join('\n\n');
  const right = [
    '二、质量保障措施\n项目组通过现场检查、阶段评审和问题闭环，持续保障项目交付质量。',
    '一、项目实施目标\n本项目建立统一项目管理机制，明确责任边界，确保建设任务按期完成。',
  ].join('\n\n');

  const result = compareBidContents({
    leftContent: left,
    rightContent: right,
    sensitivity: 'medium',
  });

  assert.equal(result.matches.length, 2);
  assert.ok(result.matches.every((match) => match.similarity >= 0.64));
  assert.ok(result.matches.some((match) => match.leftParagraph.index === 0 && match.rightParagraph.index === 1));
  assert.ok(result.matches.some((match) => match.leftParagraph.index === 1 && match.rightParagraph.index === 0));
});

test('exempts tender quoted paragraphs while reporting eligible exact sentences', () => {
  const tenderQuote = '招标文件原话：投标人应当遵守采购人发布的全部管理制度。';
  const result = compareBidContents({
    leftContent: [
      '本项目采用统一管理措施。',
      tenderQuote,
      '公司具备完善的项目管理体系、质量保障体系和售后服务体系，拥有相关资质与多年行业经验。',
    ].join('\n\n'),
    rightContent: [
      '本项目采用统一管理措施。',
      tenderQuote,
      '公司具备完善的项目管理体系、质量保障体系和售后服务体系，拥有相关资质与多年行业经验。',
    ].join('\n\n'),
    sensitivity: 'medium',
    exemptParagraphs: [tenderQuote],
  });

  assert.equal(splitBidParagraphs('短句重复\n\n长段落').length, 2);
  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, '本项目采用统一管理措施');
});

test('ignores complete illustration blocks when splitting bid paragraphs', () => {
  const content = [
    '正文段落一，保留在文字查重范围内。',
    '',
    '<!-- yibiao-illustration:start id="figure-1" -->',
    '![六阶段工期进度甘特图](yibiao-asset://generated-images/figure-1.png)',
    '',
    '*<!-- yibiao-figure-caption -->六阶段工期进度甘特图*',
    '<!-- yibiao-illustration:end -->',
    '',
    '正文段落二，图片内容不参与文字查重。',
  ].join('\n');

  assert.deepEqual(splitBidParagraphs(content).map((paragraph) => paragraph.text), [
    '正文段落一，保留在文字查重范围内。',
    '正文段落二，图片内容不参与文字查重。',
  ]);

  assert.deepEqual(splitBidParagraphs([
    '正文段落三，旧格式图片前的文字。',
    '',
    '<! yibiaofigurecaption 六阶段工期进度甘特图 <! yibiaoillustration:end',
    '',
    '正文段落四，旧格式图片后的文字。',
  ].join('\n')).map((paragraph) => paragraph.text), [
    '正文段落三，旧格式图片前的文字。',
    '正文段落四，旧格式图片后的文字。',
  ]);

  assert.deepEqual(splitBidParagraphs([
    '正文段落五，截图中这种图片标记前的文字。',
    '',
    '<! yibiaofigurecaption 六阶段工期进度甘特图 <!',
    'yibiaoillustration:end',
    '',
    '正文段落六，截图中这种图片标记后的文字。',
  ].join('\n')).map((paragraph) => paragraph.text), [
    '正文段落五，截图中这种图片标记前的文字。',
    '正文段落六，截图中这种图片标记后的文字。',
  ]);

  assert.deepEqual(splitBidParagraphs([
    '正文段落七，图片结束标记后同一行正文前。',
    '',
    '<! yibiaofigurecaption 六阶段工期进度甘特图 <! yibiaoillustration:end 同一行正文仍需保留。',
  ].join('\n')).map((paragraph) => paragraph.text), [
    '正文段落七，图片结束标记后同一行正文前。',
    '同一行正文仍需保留。',
  ]);
});

test('ignores complete inline image blocks when splitting bid paragraphs', () => {
  const content = [
    '正文段落一，保留在文字查重范围内。',
    '',
    '<!-- yibiao-inline-image:start id="inline-1" -->',
    '![现场部署图](yibiao-asset://generated-images/technical-plan/illustrations/inline-candidates/inline-1.png)',
    '',
    '*<!-- yibiao-figure-caption -->现场部署图*',
    '<!-- yibiao-inline-image:end -->',
    '',
    '正文段落二，手工插图内容不参与文字查重。',
  ].join('\n');

  assert.deepEqual(splitBidParagraphs(content).map((paragraph) => paragraph.text), [
    '正文段落一，保留在文字查重范围内。',
    '正文段落二，手工插图内容不参与文字查重。',
  ]);
});

test('does not report a short phrase as an exact sentence', () => {
  const result = compareBidContents({
    leftContent: '质量第一。',
    rightContent: '质量第一！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});

test('does not report the four known incomplete fragments as exact sentences', () => {
  const result = compareBidContents({
    leftContent: [
      '制度要求：',
      '不得打乱重分。',
      '第二轮土地承包到期后再延长三十年，',
      '无致命错误，',
    ].join('\n\n'),
    rightContent: [
      '制度要求：',
      '不得打乱重分：',
      '第二轮土地承包到期后再延长三十年，',
      '无致命错误，',
    ].join('\n\n'),
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});

test('refreshes persisted exact sentences with the current complete-sentence rules', () => {
  const matches = refreshExactSentenceMatches([
    {
      id: 'old-incomplete',
      matchType: 'exact-sentence',
      leftParagraph: { index: 0, text: '制度要求：' },
      rightParagraph: { index: 0, text: '制度要求：' },
    },
    {
      id: 'old-mixed',
      matchType: 'mixed',
      leftParagraph: { index: 1, text: '本项目采用统一管理措施。制度要求：' },
      rightParagraph: { index: 1, text: '本项目采用统一管理措施！制度要求：' },
    },
  ]);

  assert.deepEqual(matches.map((match) => ({
    id: match.id,
    matchType: match.matchType,
    exactSentences: (match.exactSentences || []).map((sentence) => sentence.normalized),
  })), [{
    id: 'old-mixed',
    matchType: 'mixed',
    exactSentences: ['本项目采用统一管理措施'],
  }]);
});

test('does not report pure list markers as exact sentences', () => {
  const result = compareBidContents({
    leftContent: '1.\n2.\n3.',
    rightContent: '1.\n2.\n3.',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});

test('keeps eligible numbered sentences in exact sentence matching', () => {
  const result = compareBidContents({
    leftContent: '1. 本项目建设目标明确。',
    rightContent: '1、本项目建设目标明确！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, '1本项目建设目标明确');
});

test('reports exact sentences inside otherwise different paragraphs', () => {
  const result = compareBidContents({
    leftContent: '本项目采用分阶段实施。实施周期为30天。',
    rightContent: '本项目采用一次性实施。实施周期为30天！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].matchType, 'exact-sentence');
  assert.match(result.matches[0].leftParagraph.text, /实施周期为30天/);
  assert.match(result.matches[0].rightParagraph.text, /实施周期为30天/);
});

test('treats semicolons as in-sentence punctuation', () => {
  const result = compareBidContents({
    leftContent: '确保安全；保证质量。',
    rightContent: '确保安全保证质量。',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].matchType, 'exact-sentence');
  assert.equal(result.matches[0].exactSentences[0].normalized, '确保安全保证质量');
});

test('recognizes English full stops as sentence boundaries', () => {
  const result = compareBidContents({
    leftContent: 'This sentence is identical. Left-only sentence.',
    rightContent: 'This sentence is identical. Right-only sentence.',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, 'thissentenceisidentical');
});

test('does not split decimal values into multiple exact sentences', () => {
  const result = compareBidContents({
    leftContent: '项目预算为3.14万元。',
    rightContent: '项目预算为3.14万元！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches[0].exactSentences.length, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, '项目预算为314万元');
});

test('does not split common abbreviations into multiple exact sentences', () => {
  const result = compareBidContents({
    leftContent: '按 U.S. 标准执行总体质量控制。后续安排。',
    rightContent: '按 U.S. 标准执行总体质量控制！后续安排！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.deepEqual(
    result.matches.flatMap((match) => match.exactSentences.map((sentence) => sentence.normalized)),
    ['按us标准执行总体质量控制'],
  );
});

test('does not count a shared clause when the complete sentences differ', () => {
  const result = compareBidContents({
    leftContent: '本项目应加强质量管理，确保按期完成。',
    rightContent: '本项目将建立质量体系，确保按期完成。',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});

test('counts one complete sentence instead of each comma-separated clause', () => {
  const result = compareBidContents({
    leftContent: '本项目应加强质量管理，确保按期完成并满足验收要求。',
    rightContent: '本项目应加强质量管理，确保按期完成并满足验收要求。',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(
    result.matches[0].exactSentences.map((sentence) => sentence.normalized),
    ['本项目应加强质量管理确保按期完成并满足验收要求'],
  );
});

test('does not count an unpunctuated heading as an exact sentence', () => {
  const result = compareBidContents({
    leftContent: '项目概况',
    rightContent: '项目概况',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});

test('does not count a long title-like noun phrase as an exact sentence', () => {
  const result = compareBidContents({
    leftContent: '项目实施目标及总体安排。',
    rightContent: '项目实施目标及总体安排。',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});

test('uses the minimum effective character boundary for exact sentences', () => {
  const shortResult = compareBidContents({
    leftContent: '项目周期为三年。',
    rightContent: '项目周期为三年！',
    sensitivity: 'high',
  });
  const eligibleResult = compareBidContents({
    leftContent: '项目周期为30天。',
    rightContent: '项目周期为30天！',
    sensitivity: 'high',
  });

  assert.equal(shortResult.summary.exactSentenceCount, 0);
  assert.equal(eligibleResult.summary.exactSentenceCount, 1);
});

test('treats a line break as whitespace inside one complete sentence', () => {
  const result = compareBidContents({
    leftContent: '本项目将建立统一的项目管理机制，\n确保建设任务按期完成。',
    rightContent: '本项目将建立统一的项目管理机制，确保建设任务按期完成！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, '本项目将建立统一的项目管理机制确保建设任务按期完成');
});

test('does not treat malformed terminal punctuation as a complete sentence', () => {
  const result = compareBidContents({
    leftContent: '矢量数据采用Shapefile（.',
    rightContent: '矢量数据采用 Shapefile（.',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 0);
  assert.equal(result.matches.length, 0);
});
