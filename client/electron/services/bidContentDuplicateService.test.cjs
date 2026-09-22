const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareBidContents,
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

test('exempts tender quoted paragraphs while reporting short exact sentences', () => {
  const tenderQuote = '招标文件原话：投标人应当遵守采购人发布的全部管理制度。';
  const result = compareBidContents({
    leftContent: [
      '短句重复',
      tenderQuote,
      '公司具备完善的项目管理体系、质量保障体系和售后服务体系，拥有相关资质与多年行业经验。',
    ].join('\n\n'),
    rightContent: [
      '短句重复',
      tenderQuote,
      '公司具备完善的项目管理体系、质量保障体系和售后服务体系，拥有相关资质与多年行业经验。',
    ].join('\n\n'),
    sensitivity: 'medium',
    exemptParagraphs: [tenderQuote],
  });

  assert.equal(splitBidParagraphs('短句重复\n\n长段落').length, 2);
  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, '短句重复');
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

test('reports a short exact sentence after ignoring whitespace and punctuation', () => {
  const result = compareBidContents({
    leftContent: '质量第一。',
    rightContent: '质量第一！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].matchType, 'exact-sentence');
  assert.deepEqual(result.matches[0].exactSentences, [{
    normalized: '质量第一',
    left: '质量第一。',
    right: '质量第一！',
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

test('keeps numbered sentences with actual content in exact sentence matching', () => {
  const result = compareBidContents({
    leftContent: '1. 项目概况。',
    rightContent: '1、项目概况！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].exactSentences[0].normalized, '1项目概况');
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

test('reports exact text when punctuation changes the sentence boundaries', () => {
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
    leftContent: '按 U.S. 标准执行。后续安排。',
    rightContent: '按 U.S. 标准执行！后续安排！',
    sensitivity: 'high',
  });

  assert.equal(result.summary.exactSentenceCount, 2);
  assert.deepEqual(
    result.matches.flatMap((match) => match.exactSentences.map((sentence) => sentence.normalized)),
    ['按us标准执行', '后续安排'],
  );
});
