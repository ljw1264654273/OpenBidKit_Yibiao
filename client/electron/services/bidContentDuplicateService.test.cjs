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

test('does not flag short or explicitly exempt paragraphs', () => {
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
  assert.equal(result.matches.length, 0);
});
