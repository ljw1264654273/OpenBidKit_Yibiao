const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RULE_SEVERITY,
  splitPhrases,
  createChineseBigramSet,
  bigramCoverage,
  extractRequirements,
  checkRequirements,
  extractScoreItems,
  checkScoreItems,
  checkTimeConflicts,
  checkCalculations,
  checkLogicConflicts,
  checkLanguage,
  checkPlaceRelevance,
  summarizeResults,
} = require('./technicalPlanCheckRules.cjs');

test('splits requirement phrases and reuses a precomputed Chinese bigram corpus', () => {
  assert.deepEqual(splitPhrases('必须按照规范，提供现场服务'), ['规范', '现场服务']);
  const corpus = createChineseBigramSet('甲乙丙丁');
  assert.equal(bigramCoverage('甲乙丙丁', corpus), 1);
  assert.equal(bigramCoverage('甲乙丙丁戊己', corpus), 0.6);
});

test('extracts unique marked requirements and classifies coverage thresholds', () => {
  const lines = [
    '1. 服务团队必须配备不少于10人并提供驻场支持',
    '1. 服务团队必须配备不少于10人并提供驻场支持',
    '普通背景介绍不会作为需求',
  ];
  assert.deepEqual(extractRequirements(lines), [lines[0]]);

  assert.deepEqual(checkRequirements(['甲乙丙丁戊己'], '甲乙丙丁'), []);
  assert.equal(checkRequirements(['甲乙丙丁戊己'], '甲乙丙')[0].ruleId, 'requirement.partial');
  assert.equal(checkRequirements(['甲乙丙丁戊己'], '庚辛壬癸')[0].ruleId, 'requirement.missing');
});

test('reports missing mandatory numbers directly without the recovered maximum-value wording', () => {
  const [result] = checkRequirements(['必须提供10台设备并完成巡检'], '必须提供设备并完成巡检');
  assert.equal(result.ruleId, 'requirement.mandatory-number-missing');
  assert.equal(result.severity, 'review');
  assert.deepEqual(result.missingNumbers, [10]);
  assert.match(result.message, /10/);
  assert.doesNotMatch(result.message, /最大值/);
});

test('extracts score items only from pipe table rows and uses the same coverage thresholds', () => {
  assert.deepEqual(extractScoreItems([
    '实施方案 10分',
    '10 | 首格数值没有前一格',
    '评分因素 | 实施方案 | 10',
    '项目团队 | 人员配置 | 5分',
  ]), [
    { desc: '实施方案', score: 10 },
    { desc: '人员配置', score: 5 },
  ]);

  assert.deepEqual(checkScoreItems([{ desc: '甲乙丙丁戊己', score: 10 }], '甲乙丙丁'), []);
  assert.equal(checkScoreItems([{ desc: '甲乙丙丁戊己', score: 10 }], '甲乙丙')[0].ruleId, 'score.partial');
  assert.equal(checkScoreItems([{ desc: '甲乙丙丁戊己', score: 10 }], '庚辛壬癸')[0].ruleId, 'score.missing');
});

test('checks only internal proposal duration keywords and compares normalized days', () => {
  assert.deepEqual(checkTimeConflicts([
    '工期为30天。',
    '工期为1个月。',
    '招标期限为90天。',
    '招标期限调整为120天。',
  ]), []);

  const [result] = checkTimeConflicts(['运维服务周期为1年。', '运维服务期限为300天。']);
  assert.equal(result.ruleId, 'time.inconsistent');
  assert.equal(result.severity, 'review');
  assert.deepEqual(result.values, ['1年', '300天']);
});

test('supports only explicit addition, subtraction and multiplication calculations', () => {
  assert.deepEqual(checkCalculations(['10 / 2 = 4', '50% + 50% = 90%', '合计 10 与 20 为 40']), []);
  assert.deepEqual(checkCalculations(['10 + 2 = 12', '10－2=8', '10 X 2 = 20']), []);

  const [result] = checkCalculations(['10 × 2 = 30']);
  assert.equal(result.ruleId, 'calculation.mismatch');
  assert.equal(result.severity, 'issue');
  assert.match(result.message, /20/);
});

test('detects only the four exact logic groups and allowed units', () => {
  const results = checkLogicConflicts([
    '人员配置10人。',
    '现场队伍配置12人。',
    '设备投入5台。',
    '仪器投入6台。',
    '行政村覆盖3个。',
    '村级服务覆盖4个。',
    '工期30天。',
    '服务期40天。',
    '车辆安排2台，后续车辆安排3台。',
    '质保期1年，质保期2年。',
    '人员预算10万元，人员预算20万元。',
  ]);

  assert.deepEqual(results.map((result) => result.group), ['人员', '设备', '村', '工期']);
  assert.ok(results.every((result) => result.ruleId === 'logic.inconsistent'));
});

test('checks placeholders, repeated Chinese characters and only specified unbalanced pairs', () => {
  const results = checkLanguage([
    '项目名称：XX项目，[OWNER]负责。',
    '人人参与复核。',
    '方案（试行版。',
    '半角括号(不参与本规则。',
  ]);

  assert.ok(results.some((result) => result.ruleId === 'language.placeholder'));
  const repeated = results.find((result) => result.ruleId === 'language.repeated-char');
  assert.equal(repeated.severity, 'review');
  assert.match(repeated.message, /人人/);
  assert.equal(results.filter((result) => result.ruleId === 'language.unbalanced-pair').length, 1);
});

test('flags a suffixed place only after two proposal occurrences and absence from all references', () => {
  const references = [
    ['采购范围为本省区域。'],
    ['采购需求不指定地点。'],
    ['评分标准不涉及地点。'],
  ];
  assert.deepEqual(checkPlaceRelevance(['星河镇，开展服务。'], references), []);

  const [result] = checkPlaceRelevance(['星河镇，开展服务。', '星河镇，设置驻点。'], references);
  assert.equal(result.ruleId, 'relevance.place');
  assert.equal(result.place, '星河镇');
  assert.equal(result.count, 2);
  assert.deepEqual(checkPlaceRelevance(
    ['星河镇，开展服务。', '星河镇，设置驻点。'],
    [['星河镇'], references[1], references[2]],
  ), []);

  const [suffixResult] = checkPlaceRelevance(['河镇', '河镇'], [['星河镇'], [], []]);
  assert.equal(suffixResult.ruleId, 'relevance.place');
  assert.equal(suffixResult.place, '河镇');
});

test('keeps every produced rule ID in the stable severity map and summarizes severities', () => {
  const findings = [
    ...checkRequirements(['必须提供10台设备'], '提供设备'),
    ...checkScoreItems([{ desc: '甲乙丙丁戊己', score: 10 }], '庚辛'),
    ...checkTimeConflicts(['服务期30天', '服务期40天']),
    ...checkCalculations(['2+2=5']),
    ...checkLogicConflicts(['人员2人', '人员3人']),
    ...checkLanguage(['XX项目', '人人参与', '《标题']),
    ...checkPlaceRelevance(['星河镇，服务', '星河镇，驻点'], [[], [], []]),
  ];

  for (const finding of findings) {
    assert.equal(finding.severity, RULE_SEVERITY[finding.ruleId], finding.ruleId);
  }
  assert.equal(RULE_SEVERITY['format.chapter-score'], 'review');
  assert.equal(RULE_SEVERITY['format.numbering-mixed'], 'review');
  assert.equal(RULE_SEVERITY['format.numbering-manual-styles'], 'review');
  assert.equal(RULE_SEVERITY['format.numbering-auto-styles'], 'review');
  assert.equal(RULE_SEVERITY['language.english-unknown'], 'review');
  assert.equal(RULE_SEVERITY['language.english-variant'], 'review');
  assert.equal(RULE_SEVERITY['format.font-family'], 'issue');
  assert.equal(RULE_SEVERITY['check.statistics'], 'info');
  assert.equal(RULE_SEVERITY['format.numbering'], undefined);
  assert.equal(RULE_SEVERITY['format.English'], undefined);
});

test('restores recovered summary fields by rule ID and excludes requirement and score from internal total', () => {
  const findings = [
    { ruleId: 'requirement.missing', severity: 'review' },
    { ruleId: 'requirement.partial', severity: 'review' },
    { ruleId: 'score.missing', severity: 'review' },
    { ruleId: 'score.partial', severity: 'review' },
    { ruleId: 'time.inconsistent', severity: 'review' },
    { ruleId: 'calculation.mismatch', severity: 'issue' },
    { ruleId: 'logic.inconsistent', severity: 'review' },
    { ruleId: 'language.placeholder', severity: 'review' },
    { ruleId: 'language.repeated-char', severity: 'review' },
    { ruleId: 'language.unbalanced-pair', severity: 'issue' },
    { ruleId: 'relevance.place', severity: 'review' },
    { ruleId: 'format.alignment', severity: 'issue' },
    { ruleId: 'check.statistics', severity: 'info' },
  ];

  assert.deepEqual(summarizeResults(findings), {
    total: 13,
    issue: 3,
    review: 9,
    info: 1,
    req_unresp: 1,
    req_part: 1,
    score_uncov: 1,
    score_pcov: 1,
    internal_total: 8,
  });
});
