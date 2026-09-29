const assert = require('node:assert/strict');
const test = require('node:test');

const { toDocumentLines } = require('./technicalPlanCheckDocumentAdapter.cjs');

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
  const ordinaryModalWords = [
    ['供应商配置10人', ['供应商']],
    ['响应时间5秒', ['响应时间']],
    ['应用系统配置3台', ['应用系统']],
    ['对应岗位配置2人', ['对应岗位']],
    ['按需配置4套', ['按需']],
    ['无需配置6台', ['无需']],
    ['需方计划2023年', ['需方计划']],
    ['应答文件2024年', ['应答文件']],
  ];
  for (const [text, phrases] of ordinaryModalWords) {
    assert.deepEqual(splitPhrases(text), phrases, text);
  }
  assert.deepEqual(splitPhrases('需由项目经理负责提供2台设备'), ['由项目经理负责', '台设备']);
  assert.deepEqual(splitPhrases('应在指定地点配置2.5台'), ['在指定地点']);
  assert.deepEqual(splitPhrases('应按招标文件要求配置2.5套'), ['按招标文件']);
  assert.deepEqual(splitPhrases('业务需要分析记录2025年历史'), ['业务需要分析记录', '年历史']);
  assert.deepEqual(splitPhrases('实际需要调研记录2024年历史'), ['实际需要调研记录', '年历史']);
  const corpus = createChineseBigramSet('甲乙丙丁');
  assert.equal(bigramCoverage('甲乙丙丁', corpus), 1);
  assert.equal(bigramCoverage('甲乙丙丁戊己', corpus), 0.6);
  assert.deepEqual(checkRequirements(['必须提供现场服务'], '现场服务'), []);
  assert.deepEqual(checkRequirements(['必须按照规范配置设备'], '规范设备'), []);
  assert.deepEqual(checkRequirements(['应当采用国产设备'], '国产设备'), []);
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

test('treats syntactically valid need and should assertions as mandatory without matching ordinary words', () => {
  for (const requirement of [
    '设备数量2.5台需配置到位',
    '设备数量2.5台应配置到位',
    '费用2.5元报价需要符合要求',
    '设备应为2.5台',
    '设备2台应在现场配置',
    '设备2台需及时提供',
    '设备2台应全部配置',
    '设备2台需按要求提供',
    '需由供应商提供2.5套设备',
    '设备严禁使用2.5台',
    '设备2台应由项目经理配置',
    '需由投标人提供2台设备',
    '应在项目现场配置2台设备',
    '应根据合同要求配置2台设备',
    '项目需要2台设备',
    '项目需要不少于2台设备',
    '现场需要3人驻场',
    '系统需要4GB内存',
    '系统需要分析2.5项风险',
    '系统需要升级至2.0.1版本',
    '系统需要校验1.2协议',
    '系统需要评估2.5项风险',
    '系统需由项目经理负责提供2.5套授权',
    '设备应在指定地点配置2.5台',
    '系统应按招标文件要求配置2.5套',
    '设备2台应在现场，后续方案配置',
    '设备2台应在现场持续充分优先逐步配置',
  ]) {
    const numericText = requirement.match(/\d+(?:\.\d+)+|\d+(?:\.\d+)?/)[0];
    const [finding] = checkRequirements([requirement], requirement.replace(numericText, ''));
    assert.equal(finding.ruleId, 'requirement.mandatory-number-missing');
    assert.ok(
      finding.missingNumberTokens.some((token) => token.includes(numericText)),
      requirement,
    );
  }
  for (const requirement of [
    '供应商配置10人',
    '响应时间5秒',
    '应用系统配置3台',
    '对应岗位配置2人',
    '按需配置4套',
    '无需配置6台',
    '需方计划2023年',
    '应答文件2024年',
    '业务需要分析记录2025年历史资料',
    '实际需要调研记录2024年历史资料',
    '业务需要分析记录2025月历史资料',
    '实际需要调研记录2024日历史资料',
    '业务需要分析报告引用10项历史数据',
    '业务需要分析记录10项',
    '用户需要调研包含3人历史访谈',
  ]) {
    assert.equal(
      checkRequirements([requirement], requirement.replace(/\d+(?:\.\d+)?/, ''))
        .some((finding) => finding.ruleId === 'requirement.mandatory-number-missing'),
      false,
      requirement,
    );
  }
  assert.deepEqual(extractRequirements([
    '业务需要分析记录2025年历史资料并形成背景说明',
    '实际需要调研记录2024年历史资料并形成背景说明',
  ]), []);

  const shortRequirement = '设备应在指定地点配置2.5台并完成验收';
  assert.deepEqual(extractRequirements([shortRequirement]), [shortRequirement]);
  const [shortFinding] = checkRequirements(
    extractRequirements([shortRequirement]),
    '设备应在指定地点配置并完成验收',
  );
  assert.equal(shortFinding.ruleId, 'requirement.mandatory-number-missing');
  assert.deepEqual(shortFinding.missingNumbers, [2.5]);
});

test('recognizes newly supported action verbs after need as mandatory assertions', () => {
  for (const requirement of [
    '系统需要适配2.0.1版本',
    '系统需要解析1.2协议',
    '系统需要编制2.5项措施',
  ]) {
    const numericText = requirement.match(/\d+(?:\.\d+)+|\d+(?:\.\d+)?/)[0];
    const [finding] = checkRequirements([requirement], requirement.replace(numericText, ''));
    assert.ok(finding, requirement);
    assert.equal(finding.ruleId, 'requirement.mandatory-number-missing', requirement);
  }
});

test('treats need before ambiguous actions as noun usage after business actual or user', () => {
  for (const requirement of [
    '业务需要说明2台历史设备',
    '业务需要分析10项',
    '实际需要分析10项',
    '用户需要调研3人',
  ]) {
    assert.equal(
      checkRequirements([requirement], requirement.replace(/\d+(?:\.\d+)?/, ''))
        .some((finding) => finding.ruleId === 'requirement.mandatory-number-missing'),
      false,
      requirement,
    );
  }
});

test('extracts an assertion with a business numeric token below the minimum length', () => {
  const requirement = '系统必须兼容1.1版本';
  assert.deepEqual(extractRequirements([requirement]), [requirement]);
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
  const [unitMismatch] = checkRequirements(
    ['必须提供10台设备并完成巡检'],
    '必须提供10人并完成巡检',
  );
  assert.equal(unitMismatch.ruleId, 'requirement.mandatory-number-missing');
  assert.deepEqual(unitMismatch.missingNumberTokens, ['10']);
});

test('compares mandatory IP CIDR version and protocol tokens as complete typed values', () => {
  const cases = [
    ['服务器地址192.168.1.1必须可达', '服务器地址192.168.1.2必须可达', '192.168.1.1'],
    ['业务网段192.168.1.0/24必须可达', '业务网段192.168.1.0/25必须可达', '192.168.1.0/24'],
    ['系统必须兼容2.0.1版本', '系统必须兼容2.0.9版本', '2.0.1版本'],
    ['系统必须支持TLS 1.2协议', '系统必须支持TLS 1.3协议', '1.2协议'],
    ['系统采用2.0.1版本必须兼容', '系统采用2.0.9版本必须兼容', '2.0.1版本'],
    ['系统采用1.2协议必须支持', '系统采用1.3协议必须支持', '1.2协议'],
    ['系统版本号2.0.1必须兼容', '系统版本号2.0.9必须兼容', '版本号2.0.1'],
    ['系统版本号：2.0.1必须兼容', '系统版本号：2.0.9必须兼容', '版本号：2.0.1'],
    ['系统版本：2.0.1必须兼容', '系统版本：2.0.9必须兼容', '版本：2.0.1'],
    ['系统协议号=1.2必须支持', '系统协议号=1.3必须支持', '协议号=1.2'],
    ['系统版本为2.0.1必须兼容', '系统版本为2.0.9必须兼容', '版本为2.0.1'],
    ['系统协议是1.2并必须支持', '系统协议是1.3并必须支持', '协议是1.2'],
    ['系统协议1.2应支持', '系统协议1.3应支持', '协议1.2'],
    ['系统版本2.0.1应由供应商提供兼容证明', '系统版本2.0.9应由供应商提供兼容证明', '版本2.0.1'],
    ['系统版本2.0.1应及时支持旧接口', '系统版本2.0.9应及时支持旧接口', '版本2.0.1'],
    ['系统版本2.0.1需由项目经理负责提供兼容证明', '系统版本2.0.9需由项目经理负责提供兼容证明', '版本2.0.1'],
    ['系统版本2.0.1需要分析2.5项兼容风险', '系统版本2.0.9需要分析2.5项兼容风险', '版本2.0.1'],
  ];
  for (const [requirement, proposal, token] of cases) {
    const [finding] = checkRequirements([requirement], proposal);
    assert.equal(finding.ruleId, 'requirement.mandatory-number-missing');
    assert.deepEqual(finding.missingNumberTokens, [token]);
  }

  assert.deepEqual(checkRequirements(
    ['服务器地址192.168.1.1必须可达'],
    '服务器地址192.168.1.1必须可达',
  ), []);
  assert.deepEqual(checkRequirements(
    ['业务网段192.168.1.0/24必须可达'],
    '业务网段192.168.1.0/24必须可达',
  ), []);
  assert.deepEqual(checkRequirements(
    ['系统采用2．0．1 版本必须兼容'],
    '系统采用2.0.1版本必须兼容',
  ), []);
  assert.deepEqual(checkRequirements(
    ['系统采用1．2 协议应支持'],
    '系统采用1.2协议应支持',
  ), []);
  assert.deepEqual(checkRequirements(
    ['1.1 版本管理要求必须说明'],
    '版本管理要求必须说明',
  ), []);
  assert.deepEqual(checkRequirements(
    ['1.1协议管理要求必须说明'],
    '协议管理要求必须说明',
  ), []);
  assert.deepEqual(checkRequirements(
    ['1.1 版本需求分析必须说明'],
    '版本需求分析必须说明',
  ), []);
  assert.deepEqual(checkRequirements(
    ['1.1 协议应急处置必须说明'],
    '协议应急处置必须说明',
  ), []);
  for (const [requirement, proposal, token] of [
    ['系统版本1.1必须兼容', '1.1 版本管理说明\n系统必须提供兼容证明', '版本1.1'],
    ['系统协议1.2必须支持', '1.2 协议管理说明\n系统必须提供支持证明', '协议1.2'],
    ['系统版本2.0.1必须兼容', '2.0.1 版本管理说明\n系统必须提供兼容证明', '版本2.0.1'],
  ]) {
    const [finding] = checkRequirements([requirement], proposal);
    assert.equal(finding.ruleId, 'requirement.mandatory-number-missing');
    assert.deepEqual(finding.missingNumberTokens, [token]);
  }
  assert.deepEqual(checkRequirements(
    ['系统版本2.0.1必须兼容'],
    '2.0.1版本必须兼容',
  ), []);
  assert.equal(stripClauseNumber('1.2协议应用说明'), '协议应用说明');
  assert.equal(stripClauseNumber('1.2版本响应说明'), '版本响应说明');
  assert.equal(stripClauseNumber('1.1版本是否兼容必须说明'), '版本是否兼容必须说明');
  assert.equal(stripClauseNumber('1.1协议是否支持必须说明'), '协议是否支持必须说明');
  assert.equal(stripClauseNumber('1.1版本为主说明必须提交'), '版本为主说明必须提交');
});

test('removes Chinese chapter prefixes before indexing proposal numeric tokens', () => {
  for (const proposal of [
    '第一章 1.1 版本管理说明\n系统必须提供兼容证明',
    '第2节：1.1 版本管理说明\n系统必须提供兼容证明',
    '第三部分、1.1 版本管理说明\n系统必须提供兼容证明',
    '第一章 第1节 1.1版本管理\n系统必须提供兼容证明',
    '第一篇 1.1版本管理\n系统必须提供兼容证明',
    '第一卷 1.1版本管理\n系统必须提供兼容证明',
    '第一章 技术方案 1.1版本管理\n系统必须提供兼容证明',
    '第一章 技术方案 版本 1.1 管理\n系统必须提供兼容证明',
    toDocumentLines(`
      <h1>第一章 1.1 版本管理说明</h1>
      <p>系统必须提供兼容证明</p>
    `).join('\n'),
  ]) {
    const [finding] = checkRequirements(['系统必须兼容1.1版本'], proposal);
    assert.ok(finding, proposal);
    assert.equal(finding.ruleId, 'requirement.mandatory-number-missing', proposal);
    assert.deepEqual(finding.missingNumberTokens, ['1.1版本'], proposal);
  }

  assert.deepEqual(checkRequirements(
    ['系统必须兼容1.1版本'],
    '系统必须兼容1.1版本',
  ), []);
  assert.deepEqual(checkRequirements(
    ['系统必须兼容1.1版本'],
    '第一章 系统必须兼容1.1版本',
  ), []);
  for (const [requirement, proposal] of [
    ['系统必须采用1.1版本', '第一章 系统采用1.1版本'],
    ['系统版本为1.1必须兼容', '第一章 系统版本为1.1'],
    ['系统必须支持1.2协议', '第一章 系统支持1.2协议'],
  ]) {
    assert.equal(
      checkRequirements([requirement], proposal)
        .some((finding) => finding.ruleId === 'requirement.mandatory-number-missing'),
      false,
      proposal,
    );
  }

  for (const proposal of [
    '第一章 必须响应事项 1.1版本管理',
    '第一章 系统兼容1.1版本管理，其他内容必须说明',
    '第一章 技术方案 1.1版本管理',
    '第一章 技术方案 1.1版本管理，其他内容必须说明',
  ]) {
    const [finding] = checkRequirements(['系统必须兼容1.1版本'], proposal);
    assert.equal(finding.ruleId, 'requirement.mandatory-number-missing', proposal);
    assert.deepEqual(finding.missingNumberTokens, ['1.1版本'], proposal);
  }

  const [protocolFinding] = checkRequirements(
    ['系统必须支持1.2协议'],
    '第一章 技术方案 协议 1.2 管理\n系统必须提供协议支持证明',
  );
  assert.equal(protocolFinding.ruleId, 'requirement.mandatory-number-missing');
  assert.deepEqual(protocolFinding.missingNumberTokens, ['1.2协议']);
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
  assert.equal(stripClauseNumber('1.5 米以上'), '1.5 米以上');
  assert.equal(stripClauseNumber('2.5 台需配置'), '2.5 台需配置');
  assert.equal(stripClauseNumber('2.5 台应在现场配置'), '2.5 台应在现场配置');
  assert.equal(stripClauseNumber('2.5 台需按要求提供'), '2.5 台需按要求提供');
  assert.equal(stripClauseNumber('1.5 米长度不得低于'), '1.5 米长度不得低于');
  assert.equal(stripClauseNumber('1.5 年期必须'), '1.5 年期必须');
  assert.equal(stripClauseNumber('2.5 元报价需要符合'), '2.5 元报价需要符合');
  assert.equal(stripClauseNumber('1.5 年期服务方案应当覆盖'), '1.5 年期服务方案应当覆盖');
  assert.equal(stripClauseNumber('2.5 元报价方案必须符合'), '2.5 元报价方案必须符合');
  assert.equal(stripClauseNumber('2.5 台核心设备应当配置'), '2.5 台核心设备应当配置');
  assert.equal(stripClauseNumber('2.5 台关键核心生产设备必须配置'), '2.5 台关键核心生产设备必须配置');
  assert.equal(stripClauseNumber('1.5 年长期运维服务期限必须满足'), '1.5 年长期运维服务期限必须满足');
  assert.equal(stripClauseNumber('2.5 元最终综合报价方案必须符合'), '2.5 元最终综合报价方案必须符合');
  assert.equal(stripClauseNumber('2.5 台关键核心设备，必须配置'), '2.5 台关键核心设备，必须配置');
  assert.equal(stripClauseNumber('1.5 年长期运维服务期限,必须满足'), '1.5 年长期运维服务期限,必须满足');
  assert.equal(stripClauseNumber('2.0.1版本必须兼容'), '2.0.1版本必须兼容');
  assert.equal(stripClauseNumber('2.0.1 版本必须兼容'), '2.0.1 版本必须兼容');
  assert.equal(stripClauseNumber('1.2 协议应支持'), '1.2 协议应支持');
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
  assert.equal(stripClauseNumber('1.1人员配置必须满足要求'), '人员配置必须满足要求');
  assert.equal(stripClauseNumber('1.1人才配置必须满足要求'), '人才配置必须满足要求');
  assert.equal(stripClauseNumber('1.1 项目概况'), '项目概况');
  assert.equal(stripClauseNumber('1.1项目概况'), '项目概况');
  assert.equal(stripClauseNumber('1.1 年度服务计划'), '年度服务计划');
  assert.equal(stripClauseNumber('1.1年度服务计划'), '年度服务计划');
  assert.equal(stripClauseNumber('1.1月度服务计划'), '月度服务计划');
  assert.equal(stripClauseNumber('1.1 地址规划必须满足要求'), '地址规划必须满足要求');
  assert.equal(stripClauseNumber('1.1 版本管理要求'), '版本管理要求');
  assert.equal(stripClauseNumber('1.1 人力资源配置'), '人力资源配置');
  assert.equal(stripClauseNumber('1.1 年限要求'), '年限要求');
  assert.equal(stripClauseNumber('1.1 站点建设'), '站点建设');
  assert.equal(stripClauseNumber('1.1站点建设'), '站点建设');
  assert.equal(stripClauseNumber('1.1点位布置'), '点位布置');
  assert.equal(stripClauseNumber('1.1台账管理'), '台账管理');
  assert.equal(stripClauseNumber('1.1元数据管理'), '元数据管理');
  assert.equal(stripClauseNumber('1.1次要事项'), '次要事项');
  assert.equal(stripClauseNumber('1.1元宇宙平台必须说明'), '元宇宙平台必须说明');
  assert.equal(stripClauseNumber('1.1站务管理必须说明'), '站务管理必须说明');
  assert.equal(stripClauseNumber('1.1月报管理必须说明'), '月报管理必须说明');
  assert.equal(stripClauseNumber('1.1点检管理必须说明'), '点检管理必须说明');
  assert.equal(stripClauseNumber('1.1人防系统必须说明'), '人防系统必须说明');
  assert.equal(stripClauseNumber('1.1项下管理必须说明'), '项下管理必须说明');
  assert.equal(stripClauseNumber('1.1 版本管理要求必须说明'), '版本管理要求必须说明');
  assert.equal(stripClauseNumber('1.1协议管理要求必须说明'), '协议管理要求必须说明');
  assert.equal(stripClauseNumber('1.1 版本需求分析必须说明'), '版本需求分析必须说明');
  assert.equal(stripClauseNumber('1.1 协议应急处置必须说明'), '协议应急处置必须说明');
  assert.equal(stripClauseNumber('（1.1）人员配置必须满足要求'), '人员配置必须满足要求');
  assert.equal(stripClauseNumber('（1.1）版本管理要求'), '版本管理要求');
  assert.equal(stripClauseNumber('（1.1）地址规划要求'), '地址规划要求');
});

test('protects leading quantities across the complete sentence fragment', () => {
  for (const businessValue of [
    '2.5台关键设备，核心系统设备，必须配置',
    '2.5台用于面向复杂业务场景持续运行并承担核心生产任务的关键核心生产设备，必须配置',
  ]) {
    assert.equal(stripClauseNumber(businessValue), businessValue);
  }
});

test('rejects single-character units that are prefixes of ordinary compound words', () => {
  for (const [source, expected] of [
    ['1.1 项目概况，人员数量必须达到10人', '项目概况，人员数量必须达到10人'],
    ['1.5 年度服务期限必须满足要求', '年度服务期限必须满足要求'],
    ['2.5 台账与设备管理必须符合要求', '台账与设备管理必须符合要求'],
    ['3.2 人员数量必须达到10人', '人员数量必须达到10人'],
  ]) {
    assert.equal(stripClauseNumber(source), expected, source);
  }

  const [finding] = checkRequirements(
    ['必须提供1.1项服务'],
    '1.1 项目概况，人员数量必须达到10人',
  );
  assert.equal(finding.ruleId, 'requirement.mandatory-number-missing');
  assert.deepEqual(finding.missingNumberTokens, ['1.1']);
});

test('protects a valid single-character quantity when its sentence contains an assertion', () => {
  const businessValue = '1.5 项服务必须提供';
  assert.equal(stripClauseNumber(businessValue), businessValue);
  assert.equal(
    checkRequirements(['必须提供1.5项服务'], businessValue)
      .some((finding) => finding.ruleId === 'requirement.mandatory-number-missing'),
    false,
  );
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

test('rejects generic suffix words and merges legal prefecture-to-county chains', () => {
  assert.deepEqual(checkPlaceRelevance(
    ['开展市政工程和乡镇服务', '开展市政工程和乡镇服务'],
    [[], [], []],
  ), []);
  assert.deepEqual(checkPlaceRelevance(
    ['本项目设置服务区和休息区', '本项目设置服务区和休息区'],
    [[], [], []],
  ), []);
  assert.deepEqual(
    extractPlaceCandidates('苏州市昆山市。').map((candidate) => candidate.place),
    ['苏州市昆山市'],
  );
  assert.deepEqual(
    extractPlaceCandidates('延边朝鲜族自治州延吉市。').map((candidate) => candidate.place),
    ['延边朝鲜族自治州延吉市'],
  );
  assert.deepEqual(
    extractPlaceCandidates('江苏省苏州市昆山市周市镇。').map((candidate) => candidate.place),
    ['江苏省苏州市昆山市周市镇'],
  );
  assert.deepEqual(
    extractPlaceCandidates('南京市上海市。').map((candidate) => candidate.place),
    ['南京市', '上海市'],
  );
  assert.deepEqual(
    extractPlaceCandidates('北京市上海市。').map((candidate) => candidate.place),
    ['北京市', '上海市'],
  );
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
