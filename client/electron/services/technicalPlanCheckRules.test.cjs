const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RULE_SEVERITY,
  splitPhrases,
  createChineseBigramSet,
  bigramCoverage,
  stripClauseNumber,
  extractRequirements,
  checkRequirements,
  extractScoreItems,
  checkScoreItems,
  findDurations,
  checkTimeConflicts,
  checkCalculations,
  checkLogicConflicts,
  checkLanguage,
  checkPlaceRelevance,
  extractPlaceCandidates,
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

test('ignores clause numbering and compares mandatory numeric tokens by normalized value and percent unit', () => {
  const [missing] = checkRequirements(['1. 必须提供10台设备并完成巡检'], '必须提供设备并完成巡检');
  assert.deepEqual(missing.missingNumbers, [10]);
  assert.deepEqual(missing.missingNumberTokens, ['10']);

  for (const clause of ['1.1', '1.1.1']) {
    const [nestedMissing] = checkRequirements(
      [`${clause} 必须提供10台设备并完成巡检`],
      '必须提供设备并完成巡检',
    );
    assert.deepEqual(nestedMissing.missingNumbers, [10]);
  }

  assert.deepEqual(
    checkRequirements(['1.1 服务指标必须达到95％并完成验收'], '服务指标必须达到95%并完成验收'),
    [],
  );
  assert.deepEqual(
    checkRequirements(['1.1.1 服务指标必须达到95%并完成验收'], '服务指标必须达到95％并完成验收'),
    [],
  );
  assert.deepEqual(
    checkRequirements(['必须提供10台设备并完成巡检'], '必须提供10.0台设备并完成巡检'),
    [],
  );
});

test('strips common Word clause numbers without deleting a leading decimal metric', () => {
  assert.equal(stripClauseNumber('1.1必须提供服务'), '必须提供服务');
  assert.equal(stripClauseNumber('1．1服务要求'), '服务要求');
  assert.equal(stripClauseNumber('1.1.1服务要求'), '服务要求');
  assert.equal(stripClauseNumber('1．1．1 服务要求'), '服务要求');
  assert.equal(stripClauseNumber('1.1.1、服务要求'), '服务要求');
  assert.equal(stripClauseNumber('（1.1）服务要求'), '服务要求');
  assert.equal(stripClauseNumber('1.5个月内完成'), '1.5个月内完成');
  assert.equal(stripClauseNumber('1.5 个月内完成'), '1.5 个月内完成');
  assert.equal(stripClauseNumber('1.5 %为最低比例'), '1.5 %为最低比例');
  assert.equal(stripClauseNumber('2.0.1版本必须兼容'), '2.0.1版本必须兼容');
  assert.equal(stripClauseNumber('192.168.1.1服务器必须可达'), '192.168.1.1服务器必须可达');
  for (const businessValue of [
    '1.5米为最低长度',
    '1.5吨载重必须满足运输要求',
    '2.5千克为单件重量',
    '1.5千瓦为额定功率',
    '2.5kWh为储能容量',
    '2.5万元为预算',
    '3.5台为配置数量',
    '4.5GB为容量',
    '2.0版本必须兼容',
    '2.0.1版必须兼容',
    '1.2协议必须支持',
    '192.168.1.1 必须可达',
    '192.168.1.0/24 为业务网段',
  ]) {
    assert.equal(stripClauseNumber(businessValue), businessValue);
  }
  assert.equal(stripClauseNumber('1.1 人员配置必须满足要求'), '人员配置必须满足要求');
  assert.equal(stripClauseNumber('1.1 项目概况'), '项目概况');
  assert.equal(stripClauseNumber('1.1 年度服务计划'), '年度服务计划');
  assert.equal(stripClauseNumber('1.1 地址规划必须满足要求'), '地址规划必须满足要求');
  assert.equal(stripClauseNumber('1.1 版本管理要求'), '版本管理要求');
  assert.equal(stripClauseNumber('1.1 人力资源配置'), '人力资源配置');
  assert.equal(stripClauseNumber('1.1 年限要求'), '年限要求');
  assert.equal(stripClauseNumber('1.1 站点建设'), '站点建设');
  assert.equal(stripClauseNumber('（1.1）人员配置必须满足要求'), '人员配置必须满足要求');
  assert.equal(stripClauseNumber('（1.1）版本管理要求'), '版本管理要求');
  assert.equal(stripClauseNumber('（1.1）地址规划要求'), '地址规划要求');
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

test('parses adjacent duration components as one duration', () => {
  assert.deepEqual(checkTimeConflicts(['服务期为1年6个月。', '服务期为18个月。']), []);
  assert.deepEqual(checkTimeConflicts(['服务期为1年零6个月。', '服务期为18个月。']), []);
  assert.deepEqual(checkTimeConflicts(['服务期为1年又6个月。', '服务期为18个月。']), []);

  const [result] = checkTimeConflicts(['服务期为1年30天。', '服务期为13个月。']);
  assert.equal(result.ruleId, 'time.inconsistent');
  assert.deepEqual(result.values, ['1年30天', '13个月']);
  assert.deepEqual(result.days, [390, 395]);

  const [decimalResult] = checkTimeConflicts(['服务期为1.1个月。', '服务期为1.2个月。']);
  assert.equal(decimalResult.ruleId, 'time.inconsistent');
  assert.deepEqual(decimalResult.values, ['1.1个月', '1.2个月']);
});

test('does not parse complete calendar dates or date ranges as durations', () => {
  for (const dateText of [
    '2026年',
    '2026年9月',
    '2026年9月29日',
    '2026年9月29号',
    '9月29日',
    '9月29号',
    '2026年9月至2027年3月',
    '9月29日至10月1日',
  ]) {
    assert.deepEqual(findDurations(dateText), [], dateText);
  }

  assert.deepEqual(
    findDurations('服务期自2026年9月29日至2027年9月28日，实际履约期限为30天。')
      .map((duration) => duration.label),
    ['30天'],
  );
  for (const rangeText of [
    '2026年9月29日至30日',
    '9月29日至30日',
    '2026年9月29日—30日',
    '2026年9月29号到30号',
  ]) {
    assert.deepEqual(findDurations(rangeText), [], rangeText);
  }
  assert.deepEqual(
    findDurations('服务期自2026年9月29日至30日，真实履约时间为30天。')
      .map((duration) => duration.label),
    ['30天'],
  );
  assert.deepEqual(checkTimeConflicts([
    '服务期自2026年9月29日至2027年9月28日。',
    '服务期安排以合同日期为准。',
  ]), []);
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

  const [suffixResult] = checkPlaceRelevance(['银河镇', '银河镇'], [['星银河镇'], [], []]);
  assert.equal(suffixResult.ruleId, 'relevance.place');
  assert.equal(suffixResult.place, '银河镇');
  assert.deepEqual(checkPlaceRelevance(['本市', '本市'], [[], [], []]), []);
});

test('normalizes common place lead-ins and continuous administrative chains', () => {
  assert.deepEqual(checkPlaceRelevance([
    '团队将在江苏省南京市开展驻场服务。',
    '本次履约覆盖江苏省南京市全部范围。',
  ], [
    ['采购范围明确为江苏省南京市。'],
    [],
    [],
  ]), []);

  const [result] = checkPlaceRelevance([
    '团队将在江苏省南京市开展驻场服务。',
    '本次履约覆盖江苏省南京市全部范围。',
  ], [
    ['采购范围明确为浙江省杭州市。'],
    [],
    [],
  ]);
  assert.equal(result.ruleId, 'relevance.place');
  assert.equal(result.place, '江苏省南京市');
});

test('extracts only maximal legal administrative chains with bounded candidates', () => {
  assert.deepEqual(
    extractPlaceCandidates('江苏省南京市鼓楼区。').map((candidate) => candidate.place),
    ['江苏省南京市鼓楼区'],
  );
  assert.deepEqual(
    extractPlaceCandidates('黑龙江省哈尔滨市南岗区，呼和浩特市，东山镇。')
      .map((candidate) => candidate.place),
    ['黑龙江省哈尔滨市南岗区', '呼和浩特市', '东山镇'],
  );
  assert.deepEqual(
    extractPlaceCandidates('石家庄市长安区。').map((candidate) => candidate.place),
    ['石家庄市长安区'],
  );
  assert.deepEqual(
    extractPlaceCandidates('内蒙古自治区呼和浩特市。').map((candidate) => candidate.place),
    ['内蒙古自治区呼和浩特市'],
  );
  assert.deepEqual(
    extractPlaceCandidates('新疆维吾尔自治区乌鲁木齐市天山区。').map((candidate) => candidate.place),
    ['新疆维吾尔自治区乌鲁木齐市天山区'],
  );
  assert.deepEqual(
    extractPlaceCandidates('香港特别行政区。').map((candidate) => candidate.place),
    ['香港特别行政区'],
  );
  assert.deepEqual(
    extractPlaceCandidates('重庆市两江新区。').map((candidate) => candidate.place),
    ['重庆市两江新区'],
  );
  assert.deepEqual(
    extractPlaceCandidates('延边朝鲜族自治州、大理白族自治州、黔东南苗族侗族自治州。')
      .map((candidate) => candidate.place),
    ['延边朝鲜族自治州', '大理白族自治州', '黔东南苗族侗族自治州'],
  );
  assert.deepEqual(
    extractPlaceCandidates('南京市项目位于东山镇。').map((candidate) => candidate.place),
    ['南京市', '东山镇'],
  );
  assert.deepEqual(
    extractPlaceCandidates('江苏省服务范围覆盖南京市。').map((candidate) => candidate.place),
    ['江苏省', '南京市'],
  );
  assert.deepEqual(extractPlaceCandidates('市场活跃，覆盖区域广，服务乡村振兴，推进市政、乡镇、县级、村镇建设。'), []);
  assert.deepEqual(extractPlaceCandidates('市场区域乡村市政乡镇县级村镇建设。'), []);

  const longText = `${'市场区域乡村普通说明。'.repeat(5000)}江苏省南京市鼓楼区。`;
  assert.deepEqual(
    extractPlaceCandidates(longText).map((candidate) => candidate.place),
    ['江苏省南京市鼓楼区'],
  );
});

test('keeps single cities and townships distinct from surrounding prose', () => {
  const [city] = checkPlaceRelevance([
    '团队将在南京市开展服务。',
    '本次履约覆盖南京市全域。',
  ], [['采购地点为北京市。'], [], []]);
  assert.equal(city.place, '南京市');

  const [longCity] = checkPlaceRelevance([
    '团队将在呼和浩特市开展服务。',
    '本次履约覆盖呼和浩特市全域。',
  ], [[], [], []]);
  assert.equal(longCity.place, '呼和浩特市');

  const [town] = checkPlaceRelevance([
    '团队将在东山镇开展服务。',
    '本次履约覆盖东山镇全域。',
  ], [[], [], []]);
  assert.equal(town.place, '东山镇');
});

test('uses exact normalized places for repeated sentences and reference matching', () => {
  assert.deepEqual(checkPlaceRelevance([
    '项目位于南京市。',
    '项目位于南京市。',
  ], [['南京市'], [], []]), []);
  assert.deepEqual(checkPlaceRelevance([
    '施工地点为东山镇。',
    '施工地点为东山镇。',
  ], [['东山镇'], [], []]), []);

  const [town] = checkPlaceRelevance(['东山镇', '东山镇'], [['西安东山镇'], [], []]);
  assert.equal(town.place, '东山镇');
  const [galaxy] = checkPlaceRelevance(['银河镇', '银河镇'], [['星银河镇'], [], []]);
  assert.equal(galaxy.place, '银河镇');
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
