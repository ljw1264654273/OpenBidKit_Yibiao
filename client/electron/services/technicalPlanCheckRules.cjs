const { parsePipeTableRow } = require('./technicalPlanCheckDocumentAdapter.cjs');

const RULE_SEVERITY = Object.freeze({
  'requirement.partial': 'review',
  'requirement.missing': 'review',
  'requirement.mandatory-number-missing': 'review',
  'score.partial': 'review',
  'score.missing': 'review',
  'time.inconsistent': 'review',
  'logic.inconsistent': 'review',
  'language.placeholder': 'review',
  'language.repeated-char': 'review',
  'relevance.place': 'review',
  'format.chapter-score': 'review',
  'format.numbering-mixed': 'review',
  'format.numbering-manual-styles': 'review',
  'format.numbering-auto-styles': 'review',
  'language.english-unknown': 'review',
  'language.english-variant': 'review',
  'calculation.mismatch': 'issue',
  'language.unbalanced-pair': 'issue',
  'format.alignment': 'issue',
  'format.indent': 'issue',
  'format.spacing': 'issue',
  'format.line-spacing': 'issue',
  'format.grid': 'issue',
  'format.font-size': 'issue',
  'format.font-family': 'issue',
  'format.table-center': 'issue',
  'format.image-center': 'issue',
  'check.skipped': 'info',
  'check.statistics': 'info',
});

const NUMBER_PATTERN = String.raw`\d+(?:\.\d+)?`;
const FUNCTION_WORDS = [
  '以及', '并且', '而且', '同时', '对于', '按照', '根据', '通过', '结合', '依托',
  '应当', '必须', '不得', '不低于', '不少于', '至少', '不超过', '不高于', '以上',
  '以内', '支持', '提供', '满足', '具备', '采用', '配置', '要求', '实现', '包括',
  '包含', '与', '和', '及', '或', '须',
].join('|');
const SPLIT_RE = new RegExp(
  String.raw`[，,、。；;：:（()）)\s\d%．./\-—_*▲★※【】\[\]{}"'“”‘’<>《》=＝]+|${FUNCTION_WORDS}`,
);
const REQUIREMENT_MARK_RE = /必须|应当|不应|不得|须|不低于|不少于|至少|以上|支持|具备|提供|满足|要求|▲|★|※|响应|符合|采用|配置|实现|包括/;
const MANDATORY_RE = /▲|★|※|必须|不得|不低于|不少于|至少/;
const DURATION_COMPONENT_RE = new RegExp(`(${NUMBER_PATTERN})\\s*(个月|周|星期|天|日|年)`, 'g');
const CALCULATION_RE = new RegExp(`(${NUMBER_PATTERN})\\s*([+＋\\-－×xX*])\\s*(${NUMBER_PATTERN})\\s*=\\s*(${NUMBER_PATTERN})`, 'g');
const BUSINESS_UNITS = [
  '平方公里', '平方千米', '平方分米', '平方厘米', '平方毫米', '立方分米', '立方厘米', '立方毫米',
  '平方米', '立方米', '人民币', '公斤', '千克', '公里', '千米', '分米', '厘米', '毫米', '公顷',
  '万元', '亿元', '个月', '星期', '小时', '分钟', '毫升', 'Gbps', 'Mbps', 'GB', 'MB', 'TB',
  'kWh', 'kW', 'Wh', '千瓦', 'm²', 'm³', '㎡', '亩', '吨', '克', '升', '℃', '年', '月', '周',
  '天', '日', '秒', '瓦', 'W',
  '米', '元', '台', '套', '个', '项', '人', '次', '件', '份', '辆', '组', '座', '处', '家', '名',
  '点', '站', 'V', 'A', 'm', 'L', '度', '%', '％',
];
const BUSINESS_SEMANTICS = ['版本', '服务器', '协议', '地址', '网段', '端口', 'IP', '版'];
const PLACE_SUFFIX_LEVEL = Object.freeze({
  特别行政区: 1,
  自治区: 1,
  省: 1,
  自治州: 2,
  市: 2,
  盟: 2,
  自治县: 3,
  新区: 3,
  县: 3,
  区: 3,
  旗: 3,
  街道: 4,
  镇: 4,
  乡: 4,
  村: 5,
});
const MAX_PLACE_DEPTH = 5;
const PLACE_SUFFIXES = ['特别行政区', '自治区', '自治州', '自治县', '新区', '街道', '省', '市', '县', '区', '镇', '乡', '村', '盟', '旗'];
const SPECIAL_ADMIN_REGIONS = [
  '内蒙古自治区',
  '广西壮族自治区',
  '西藏自治区',
  '宁夏回族自治区',
  '新疆维吾尔自治区',
  '香港特别行政区',
  '澳门特别行政区',
];
const NON_PLACE_WORDS = new Set(['市场', '区域', '乡村', '村镇', '市政', '乡镇', '县级']);
const PLACE_CONNECTORS = new Set([
  '在', '于', '为', '至', '到', '和', '及', '与', '的', '将', '由', '从', '往', '向',
  '位于', '覆盖', '包括', '包含', '面向', '负责', '进入', '遍及',
]);
const CHINESE_WORD_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' });

function createFinding(ruleId, category, message, contexts = [], details = {}) {
  const severity = RULE_SEVERITY[ruleId];
  if (!severity) throw new Error(`未定义检查规则严重级别：${ruleId}`);
  return {
    ruleId,
    severity,
    category,
    message,
    contexts: Array.isArray(contexts) ? contexts : [],
    ...details,
  };
}

function splitPhrases(text) {
  return String(text || '')
    .split(SPLIT_RE)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function createChineseBigramSet(text) {
  const chinese = String(text || '').replace(/[^\u4e00-\u9fa5]/g, '');
  const result = new Set();
  for (let index = 0; index < chinese.length - 1; index += 1) {
    result.add(chinese.slice(index, index + 2));
  }
  return result;
}

function bigramCoverage(text, corpusOrBigrams) {
  const expected = createChineseBigramSet(text);
  if (!expected.size) return 1;
  const corpus = corpusOrBigrams instanceof Set
    ? corpusOrBigrams
    : createChineseBigramSet(corpusOrBigrams);
  let matched = 0;
  for (const bigram of expected) {
    if (corpus.has(bigram)) matched += 1;
  }
  return matched / expected.size;
}

function isValidIpv4Prefix(source) {
  const match = String(source || '').match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?(?=$|[^\d./])/,
  );
  if (!match) return false;
  if (match.slice(1, 5).some((part) => Number(part) > 255)) return false;
  return match[5] === undefined || Number(match[5]) <= 32;
}

function matchingBusinessTerm(text, terms) {
  const source = String(text || '').toLocaleLowerCase('en-US');
  return terms.find((term) => {
    const normalizedTerm = term.toLocaleLowerCase('en-US');
    if (!source.startsWith(normalizedTerm)) return false;
    if (!/[a-z]$/i.test(term)) return true;
    return !/^[a-z]/i.test(source.slice(normalizedTerm.length));
  }) || '';
}

function isProtectedBusinessNumericPrefix(source, numericPrefix) {
  if (isValidIpv4Prefix(source)) return true;
  if (/[)）]/.test(numericPrefix[0])) return false;
  const rest = source.slice(numericPrefix[0].length);
  if (!numericPrefix[2] && matchingBusinessTerm(rest, BUSINESS_SEMANTICS)) return true;
  const unit = matchingBusinessTerm(rest, BUSINESS_UNITS);
  if (!unit) return false;
  return !numericPrefix[2] || !/^[\u4e00-\u9fa5]$/.test(unit);
}

function stripClauseNumber(text) {
  const source = String(text || '').trim();
  const numericPrefix = source.match(
    /^\s*[（(]?\s*(\d+(?:[.．]\d+)+)(?:\s*[)）])?([ \t]*)/,
  );
  if (numericPrefix && isProtectedBusinessNumericPrefix(source, numericPrefix)) return source;
  const patterns = [
    /^\s*[（(]\s*\d+(?:[.．]\d+)+\s*[)）]\s*[、.]?\s*/,
    /^\s*\d+(?:[.．]\d+)+\s*[、.)）]?\s*/,
    /^\s*(?:[（(]?[一二三四五六七八九十]+[)）]|[（(]\d+[)）]|[一二三四五六七八九十]+、|\d+(?:[、)]|[.．](?!\d))|第[一二三四五六七八九十\d]+条)\s*/,
  ];
  for (const pattern of patterns) {
    if (pattern.test(source)) return source.replace(pattern, '').trim();
  }
  return source;
}

function extractRequirements(lines, minLength = 12) {
  const requirements = [];
  const seen = new Set();
  for (const line of lines || []) {
    const text = String(line || '').trim();
    if (
      text.length >= minLength
      && REQUIREMENT_MARK_RE.test(text)
      && (stripClauseNumber(text) !== text || text.includes('|') || text.length >= 20)
      && !seen.has(text)
    ) {
      seen.add(text);
      requirements.push(text);
    }
  }
  return requirements;
}

function extractNumericTokens(text) {
  return [...String(text || '').matchAll(new RegExp(`(?<![\\d.])(${NUMBER_PATTERN})\\s*([%％])?`, 'g'))]
    .map((match) => ({
      value: Number(match[1]),
      unit: match[2] ? '%' : '',
      raw: `${match[1]}${match[2] || ''}`,
      key: `${Number(match[1])}|${match[2] ? '%' : ''}`,
    }));
}

function coverageFor(text, proposalText, proposalBigrams) {
  const phrases = splitPhrases(text);
  const matched = phrases.filter((phrase) => proposalText.includes(phrase));
  const phraseCoverage = matched.length / Math.max(phrases.length, 1);
  const coverage = Math.max(phraseCoverage, bigramCoverage(text, proposalBigrams));
  return {
    coverage,
    missing: phrases.filter((phrase) => !proposalText.includes(phrase)).slice(0, 8),
  };
}

function checkRequirements(requirements, proposal) {
  const proposalText = String(proposal || '');
  const proposalBigrams = createChineseBigramSet(proposalText);
  const proposalNumberKeys = new Set(extractNumericTokens(proposalText).map((token) => token.key));
  const findings = [];

  for (const requirement of requirements || []) {
    const text = String(requirement || '');
    const { coverage, missing } = coverageFor(text, proposalText, proposalBigrams);
    const requirementBody = stripClauseNumber(text);
    const missingNumberTokens = [...new Map(
      extractNumericTokens(requirementBody)
        .filter((token) => !proposalNumberKeys.has(token.key))
        .map((token) => [token.key, token]),
    ).values()];
    const missingNumbers = [...new Set(missingNumberTokens.map((token) => token.value))];
    if (missingNumberTokens.length && MANDATORY_RE.test(text)) {
      findings.push(createFinding(
        'requirement.mandatory-number-missing',
        '采购需求',
        `强制需求中的数值未在方案中找到：${missingNumberTokens.map((token) => token.raw).join('、')}`,
        [text],
        {
          requirement: text,
          missing,
          missingNumbers,
          missingNumberTokens: missingNumberTokens.map((token) => token.raw),
          coverage: Number(coverage.toFixed(3)),
        },
      ));
    } else if (coverage < 0.6) {
      const ruleId = coverage >= 0.35 ? 'requirement.partial' : 'requirement.missing';
      findings.push(createFinding(
        ruleId,
        '采购需求',
        ruleId === 'requirement.partial' ? '采购需求疑似仅部分响应，建议人工复核' : '采购需求疑似未响应，建议人工复核',
        [text],
        { requirement: text, missing, coverage: Number(coverage.toFixed(3)) },
      ));
    }
  }
  return findings;
}

function extractScoreItems(lines) {
  const items = [];
  const seen = new Set();
  for (const line of lines || []) {
    const text = String(line || '');
    const cells = parsePipeTableRow(text).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    for (let index = 0; index < cells.length; index += 1) {
      if (!new RegExp(`^${NUMBER_PATTERN}\\s*分?$`).test(cells[index])) continue;
      if (index === 0) break;
      const desc = cells[index - 1];
      if (!desc || seen.has(desc)) break;
      seen.add(desc);
      items.push({ desc, score: Number(cells[index].match(new RegExp(NUMBER_PATTERN))[0]) });
      break;
    }
  }
  return items;
}

function checkScoreItems(items, proposal) {
  const proposalText = String(proposal || '');
  const proposalBigrams = createChineseBigramSet(proposalText);
  const findings = [];
  for (const item of items || []) {
    const desc = String(item?.desc || '');
    const { coverage, missing } = coverageFor(desc, proposalText, proposalBigrams);
    if (coverage >= 0.6) continue;
    const ruleId = coverage >= 0.35 ? 'score.partial' : 'score.missing';
    findings.push(createFinding(
      ruleId,
      '评分标准',
      ruleId === 'score.partial' ? '评分项疑似覆盖不足，建议人工复核' : '评分项疑似未覆盖，建议人工复核',
      [desc],
      { desc, score: item?.score, missing, coverage: Number(coverage.toFixed(3)) },
    ));
  }
  return findings;
}

function findDurations(text) {
  const mask = (value) => ' '.repeat(value.length);
  const source = String(text || '')
    .replace(
      /(?:(?:19|20)\d{2}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]\s*(?:至|到|[-—–~～])\s*(?:(?:19|20)\d{2}\s*年\s*)?(?:\d{1,2}\s*月\s*)?\d{1,2}\s*[日号]/g,
      mask,
    )
    .replace(
      /(?:(?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?)?|\d{1,2}\s*月\s*\d{1,2}\s*[日号])/g,
      mask,
    );
  const groups = [];
  let current = null;
  for (const match of source.matchAll(DURATION_COMPONENT_RE)) {
    const component = {
      value: Number(match[1]),
      unit: match[2],
      start: match.index,
      end: match.index + match[0].length,
    };
    const gap = current ? source.slice(current.end, component.start) : '';
    const canAppend = current
      && /^\s*(?:零|又|和|及)?\s*$/.test(gap)
      && !current.components.some((item) => item.unit === component.unit);
    if (!canAppend) {
      if (current) groups.push(current);
      current = { components: [], end: component.end };
    }
    current.components.push(component);
    current.end = component.end;
  }
  if (current) groups.push(current);

  return groups.map((group) => {
    const components = group.components.map(({ value, unit }) => ({ value, unit }));
    const monthsOnly = components.every(({ unit }) => unit === '年' || unit === '个月');
    const months = monthsOnly
      ? components.reduce((total, item) => total + item.value * (item.unit === '年' ? 12 : 1), 0)
      : null;
    return {
      components,
      label: components.map((item) => `${item.value}${item.unit}`).join(''),
      days: components.reduce((total, item) => total + durationToDays(item.value, item.unit), 0),
      months,
      value: components.length === 1 ? components[0].value : undefined,
      unit: components.length === 1 ? components[0].unit : undefined,
    };
  });
}

function durationToDays(value, unit) {
  return Number(value) * ({ 年: 365, 个月: 30, 月: 30, 周: 7, 星期: 7, 天: 1, 日: 1 }[unit] || 1);
}

function checkTimeConflicts(lines) {
  const byKeyword = new Map();
  const keywords = ['工期', '服务期', '服务周期', '质保期', '运维期', '运维服务'];
  for (const rawLine of lines || []) {
    const line = String(rawLine || '');
    const durations = findDurations(line);
    if (!durations.length) continue;
    for (const keyword of keywords) {
      if (!line.includes(keyword)) continue;
      const values = byKeyword.get(keyword) || [];
      for (const duration of durations) {
        values.push({
          line,
          days: duration.days,
          months: duration.months,
          label: duration.label,
        });
      }
      byKeyword.set(keyword, values);
    }
  }

  const findings = [];
  for (const [keyword, entries] of byKeyword) {
    const compareByMonths = entries.every((entry) => entry.months !== null);
    const exactValue = (value) => Number(Number(value).toFixed(9));
    const comparisonValues = [...new Set(entries.map((entry) => exactValue(
      compareByMonths ? entry.months : entry.days,
    )))].sort((left, right) => left - right);
    if (comparisonValues.length <= 1) continue;
    const values = [...new Set(entries.map((entry) => entry.label))];
    const days = [...new Set(entries.map((entry) => exactValue(entry.days)))].sort((left, right) => left - right);
    findings.push(createFinding(
      'time.inconsistent',
      '时间一致性',
      `“${keyword}”前后表述不一致：${values.join('、')}（折算天数 ${days.join('、')}）`,
      entries.slice(0, 3).map((entry) => entry.line.slice(0, 120)),
      { keyword, values, days },
    ));
  }
  return findings;
}

function calculate(left, operator, right) {
  if (operator === '+' || operator === '＋') return left + right;
  if (operator === '-' || operator === '－') return left - right;
  if (['×', 'x', 'X', '*'].includes(operator)) return left * right;
  return undefined;
}

function checkCalculations(lines) {
  const findings = [];
  for (const rawLine of lines || []) {
    const line = String(rawLine || '');
    for (const match of line.matchAll(CALCULATION_RE)) {
      const left = Number(match[1]);
      const operator = match[2];
      const right = Number(match[3]);
      const stated = Number(match[4]);
      const expected = calculate(left, operator, right);
      if (Math.abs(expected - stated) <= Math.max(0.02, Math.abs(expected) * 0.005)) continue;
      findings.push(createFinding(
        'calculation.mismatch',
        '计算正确性',
        `算式有误：${match[0]}，正确结果应约为 ${expected}`,
        [line.slice(0, 160)],
        { expression: match[0], expected, actual: stated },
      ));
    }
  }
  return findings;
}

function checkLogicConflicts(lines) {
  const groups = [
    ['人员', /人员|人手|队伍/],
    ['设备', /设备|仪器/],
    ['村', /村|行政村/],
    ['工期', /工期|服务期/],
  ];
  const valueRe = new RegExp(`(?<![\\d.])(${NUMBER_PATTERN})\\s*(人|台|个|天|年|个月)(?![\\d.%])`, 'g');
  const findings = [];

  for (const [group, keywordRe] of groups) {
    const matches = [];
    for (const rawLine of lines || []) {
      const line = String(rawLine || '');
      if (!keywordRe.test(line)) continue;
      for (const match of line.matchAll(valueRe)) {
        matches.push({ value: Number(match[1]), unit: match[2], line });
      }
    }
    const byUnit = new Map();
    for (const match of matches) {
      const values = byUnit.get(match.unit) || [];
      values.push(match);
      byUnit.set(match.unit, values);
    }
    for (const [unit, entries] of byUnit) {
      const values = [...new Set(entries.map((entry) => entry.value))].sort((left, right) => left - right);
      if (values.length <= 1 || matches.length > 200) continue;
      findings.push(createFinding(
        'logic.inconsistent',
        '逻辑一致性',
        `“${group}”前后数值不一致（单位 ${unit}）：${values.join('、')}`,
        entries.slice(0, 4).map((entry) => entry.line.slice(0, 70)),
        { group, unit, values },
      ));
    }
  }
  return findings;
}

function checkLanguage(lines) {
  const fullText = (lines || []).map((line) => String(line || '')).join('\n');
  const findings = [];
  const placeholderRe = /×{2,}|x{2,}|X{2,}|\[[A-Za-z_]+\]/g;
  for (const match of fullText.matchAll(placeholderRe)) {
    findings.push(createFinding(
      'language.placeholder',
      '语言表达',
      `疑似模板占位符未填写：${match[0]}`,
      [fullText.slice(Math.max(0, match.index - 30), match.index + match[0].length + 60)],
      { placeholder: match[0] },
    ));
  }
  for (const rawLine of lines || []) {
    const line = String(rawLine || '');
    for (const match of line.matchAll(/([\u4e00-\u9fa5])\1/g)) {
      findings.push(createFinding(
        'language.repeated-char',
        '语言表达',
        `疑似重复汉字：“${match[0]}”`,
        [line.slice(0, 80)],
        { repeated: match[0] },
      ));
    }
  }
  for (const [open, close] of [['（', '）'], ['《', '》'], ['【', '】']]) {
    const openCount = fullText.split(open).length - 1;
    const closeCount = fullText.split(close).length - 1;
    if (openCount === closeCount) continue;
    findings.push(createFinding(
      'language.unbalanced-pair',
      '语言表达',
      `${open}${close} 数量不配对：${open}有${openCount}个，${close}有${closeCount}个`,
      [],
      { pair: `${open}${close}`, openCount, closeCount },
    ));
  }
  return findings;
}

function flattenReferenceLines(referenceDocuments) {
  const result = [];
  for (const document of referenceDocuments || []) {
    if (Array.isArray(document)) result.push(...document);
    else result.push(document);
  }
  return result.map((line) => String(line || ''));
}

function isChineseWord(segment) {
  return Boolean(segment?.isWordLike) && /^[\u4e00-\u9fa5]+$/.test(segment.segment);
}

function previousChineseSegment(segments, index, position, minimumStart) {
  if (index <= 0) return null;
  const segment = segments[index - 1];
  if (
    segment.index + segment.segment.length !== position
    || !isChineseWord(segment)
  ) return null;
  const clippedStart = Math.max(segment.index, minimumStart);
  if (clippedStart >= position) return null;
  return {
    segment: clippedStart === segment.index
      ? segment
      : {
        ...segment,
        segment: segment.segment.slice(clippedStart - segment.index),
        index: clippedStart,
      },
    index: index - 1,
  };
}

function standalonePlaceNameStart(
  source,
  segments,
  containingIndex,
  suffixStart,
  suffixEnd,
  hasChildSuffix,
  minimumStart,
) {
  const containing = segments[containingIndex];
  if (!isChineseWord(containing)) return null;
  const containingEnd = containing.index + containing.segment.length;
  const inlineName = source.slice(containing.index, suffixStart);
  if (suffixStart === containing.index && suffixEnd < containingEnd && !hasChildSuffix) return null;
  if (suffixStart === containing.index && suffixEnd < containingEnd) {
    const previous = previousChineseSegment(
      segments,
      containingIndex,
      containing.index,
      minimumStart,
    );
    if (previous && NON_PLACE_WORDS.has(previous.segment.segment)) return null;
  }

  let name = inlineName;
  let start = containing.index;
  let previousIndex = containingIndex;
  let previousPosition = containing.index;
  if (inlineName) {
    while (name.length < 2) {
      const previous = previousChineseSegment(
        segments,
        previousIndex,
        previousPosition,
        minimumStart,
      );
      if (
        !previous
        || previous.segment.segment.length !== 1
        || PLACE_CONNECTORS.has(previous.segment.segment)
      ) break;
      name = `${previous.segment.segment}${name}`;
      start = previous.segment.index;
      previousIndex = previous.index;
      previousPosition = previous.segment.index;
    }
    if (name.length < 2 || name.length > 12 || !/^[\u4e00-\u9fa5]+$/.test(name)) return null;
    return start;
  }

  while (true) {
    const previous = previousChineseSegment(
      segments,
      previousIndex,
      previousPosition,
      minimumStart,
    );
    if (!previous || PLACE_CONNECTORS.has(previous.segment.segment)) break;
    const expandedName = `${previous.segment.segment}${name}`;
    if (expandedName.length > 12) break;
    name = expandedName;
    start = previous.segment.index;
    previousIndex = previous.index;
    previousPosition = previous.segment.index;
  }
  if (name.length < 2 || name.length > 12 || !/^[\u4e00-\u9fa5]+$/.test(name)) return null;
  return start;
}

function specialRegionComponents(source) {
  const components = [];
  for (const place of SPECIAL_ADMIN_REGIONS) {
    let start = source.indexOf(place);
    while (start >= 0) {
      components.push({
        place,
        suffix: place.endsWith('特别行政区') ? '特别行政区' : '自治区',
        level: 1,
        start,
        end: start + place.length,
      });
      start = source.indexOf(place, start + place.length);
    }
  }
  return components;
}

function placeComponents(text) {
  const source = String(text || '');
  const segments = [...CHINESE_WORD_SEGMENTER.segment(source)];
  const specialComponents = specialRegionComponents(source)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const suffixPattern = new RegExp(PLACE_SUFFIXES.join('|'), 'g');
  const suffixMatches = [...source.matchAll(suffixPattern)].map((match) => ({
    suffix: match[0],
    start: match.index,
    end: match.index + match[0].length,
    level: PLACE_SUFFIX_LEVEL[match[0]],
  }));
  const components = [];
  let specialCursor = 0;
  let segmentCursor = 0;

  for (let index = 0; index < suffixMatches.length; index += 1) {
    const match = suffixMatches[index];
    while (
      specialCursor < specialComponents.length
      && specialComponents[specialCursor].end <= match.start
    ) {
      components.push(specialComponents[specialCursor]);
      specialCursor += 1;
    }
    if (specialComponents.some((component) => (
      component.start <= match.start && match.end <= component.end
    ))) continue;

    while (
      segmentCursor < segments.length
      && segments[segmentCursor].index + segments[segmentCursor].segment.length <= match.start
    ) segmentCursor += 1;
    const containing = segments[segmentCursor];
    if (
      !containing
      || containing.index > match.start
      || containing.index + containing.segment.length <= match.start
    ) continue;

    const previous = components.at(-1);
    const child = suffixMatches[index + 1];
    const hasChildSuffix = Boolean(
      child
      && child.level > match.level
      && child.start >= match.end
      && /^[\u4e00-\u9fa5]+$/.test(source.slice(match.end, child.start)),
    );
    const start = standalonePlaceNameStart(
      source,
      segments,
      segmentCursor,
      match.start,
      match.end,
      hasChildSuffix,
      previous?.end ?? 0,
    );
    if (start === null) continue;

    const place = source.slice(start, match.end);
    if ([...NON_PLACE_WORDS].some((word) => place.includes(word))) continue;
    components.push({
      place,
      suffix: match.suffix,
      level: match.level,
      start,
      end: match.end,
    });
  }

  while (specialCursor < specialComponents.length) {
    components.push(specialComponents[specialCursor]);
    specialCursor += 1;
  }

  return components.sort((left, right) => left.start - right.start || left.end - right.end);
}

function extractPlaceCandidates(text) {
  const components = placeComponents(text);
  const candidates = [];
  for (let index = 0; index < components.length; index += 1) {
    const chain = [components[index]];
    while (chain.length < MAX_PLACE_DEPTH && index + 1 < components.length) {
      const previous = chain.at(-1);
      const next = components[index + 1];
      if (next.start !== previous.end || next.level <= previous.level) break;
      chain.push(next);
      index += 1;
    }
    candidates.push({
      place: chain.map((component) => component.place).join(''),
      depth: chain.length,
    });
  }
  return candidates;
}

function checkPlaceRelevance(proposalLines, referenceDocuments) {
  const proposalText = (proposalLines || []).map((line) => String(line || '')).join('\n');
  const referenceText = flattenReferenceLines(referenceDocuments).join('\n');
  const proposalCandidates = extractPlaceCandidates(proposalText);
  const referenceCandidates = extractPlaceCandidates(referenceText);
  const referencePlaces = new Set(referenceCandidates.map((candidate) => candidate.place));
  const counts = new Map();
  for (const candidate of proposalCandidates) {
    counts.set(candidate.place, (counts.get(candidate.place) || 0) + 1);
  }
  const findings = [];
  for (const [place, count] of counts) {
    if (count < 2 || referencePlaces.has(place)) continue;
    findings.push(createFinding(
      'relevance.place',
      '内容相关性',
      `疑似与本项目无关或需核实的地名：“${place}”（出现${count}次，未在三份参考文档中出现）`,
      [],
      { place, count },
    ));
  }
  return findings.sort((left, right) => left.place.localeCompare(right.place, 'zh-CN'));
}

function summarizeResults(findings) {
  const summary = {
    total: 0,
    issue: 0,
    review: 0,
    info: 0,
    req_unresp: 0,
    req_part: 0,
    score_uncov: 0,
    score_pcov: 0,
    internal_total: 0,
  };
  for (const finding of findings || []) {
    summary.total += 1;
    if (Object.prototype.hasOwnProperty.call(summary, finding?.severity)) {
      summary[finding.severity] += 1;
    }
    const ruleId = String(finding?.ruleId || '');
    if (ruleId === 'requirement.missing') summary.req_unresp += 1;
    if (ruleId === 'requirement.partial') summary.req_part += 1;
    if (ruleId === 'score.missing') summary.score_uncov += 1;
    if (ruleId === 'score.partial') summary.score_pcov += 1;
    if (/^(?:time|calculation|logic|language|relevance|format)\./.test(ruleId)) {
      summary.internal_total += 1;
    }
  }
  return summary;
}

module.exports = {
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
  durationToDays,
  checkTimeConflicts,
  checkCalculations,
  checkLogicConflicts,
  checkLanguage,
  extractPlaceCandidates,
  checkPlaceRelevance,
  summarizeResults,
  summarizeFindings: summarizeResults,
};
