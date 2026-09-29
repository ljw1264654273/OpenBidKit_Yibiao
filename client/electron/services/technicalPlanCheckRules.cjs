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
const PLACE_SUFFIX_LEVEL = Object.freeze({ 省: 1, 市: 2, 县: 3, 区: 3, 镇: 4, 乡: 4, 街道: 4, 村: 5 });
const MAX_PLACE_DEPTH = 5;

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

function stripClauseNumber(text) {
  const source = String(text || '').trim();
  const patterns = [
    /^\s*[（(]\s*\d+(?:[.．]\d+)+\s*[)）]\s*[、.]?\s*/,
    /^\s*\d+(?:[.．]\d+){2,}\s*[、.)）]?\s*/,
    /^\s*\d+(?:[.．]\d+)+[、)）]\s*/,
    /^\s*\d+(?:[.．]\d+)+(?=\s)\s*/,
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
  const source = String(text || '').replace(
    /(?:(?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?)?|\d{1,2}\s*月\s*\d{1,2}\s*[日号])/g,
    (value) => ' '.repeat(value.length),
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

function isOrdinaryPlaceWord(run, token) {
  const previous = run[token.index - 1] || '';
  const next = run[token.index + token.value.length] || '';
  return (token.value === '市' && next === '场')
    || (token.value === '区' && next === '域')
    || (token.value === '乡' && next === '村')
    || (token.value === '村' && previous === '乡');
}

function placeTokens(run) {
  return [...run.matchAll(/街道|省|市|县|区|镇|乡|村/g)]
    .map((match) => ({
      value: match[0],
      index: match.index,
      end: match.index + match[0].length,
      level: PLACE_SUFFIX_LEVEL[match[0]],
    }))
    .filter((token) => !isOrdinaryPlaceWord(run, token));
}

function candidatesForChineseRun(run) {
  const tokens = placeTokens(run);
  const candidates = [];
  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    const first = tokens[startIndex];
    const firstNameStart = Math.max(0, first.index - 12);
    const firstName = run.slice(firstNameStart, first.index);
    if (firstName.length < 2) continue;

    let depth = 1;
    let previous = first;
    let endIndex = startIndex;
    while (depth < MAX_PLACE_DEPTH && endIndex + 1 < tokens.length) {
      const next = tokens[endIndex + 1];
      const segmentLength = next.index - previous.end;
      if (next.level <= previous.level || segmentLength < 2 || segmentLength > 12) break;
      depth += 1;
      endIndex += 1;
      previous = next;
    }

    candidates.push({
      firstName,
      tail: run.slice(first.index, previous.end),
      place: run.slice(firstNameStart, previous.end),
      depth,
    });
    if (depth > 1) startIndex = endIndex;
  }
  return candidates;
}

function extractPlaceCandidates(text) {
  const candidates = [];
  for (const run of String(text || '').match(/[\u4e00-\u9fa5]+/g) || []) {
    candidates.push(...candidatesForChineseRun(run));
  }
  return candidates;
}

function longestRepeatedName(candidates) {
  const suffixCounts = new Map();
  for (const candidate of candidates) {
    const maxLength = Math.min(12, candidate.firstName.length);
    for (let length = 2; length <= maxLength; length += 1) {
      const suffix = candidate.firstName.slice(-length);
      suffixCounts.set(suffix, (suffixCounts.get(suffix) || 0) + 1);
    }
  }
  return [...suffixCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[0].length - left[0].length)[0]?.[0] || '';
}

function referenceContainsPlace(referenceCandidates, firstName, tail) {
  return referenceCandidates.some((candidate) => {
    if (candidate.tail !== tail || !candidate.firstName.endsWith(firstName)) return false;
    const prefixLength = candidate.firstName.length - firstName.length;
    return prefixLength === 0 || prefixLength >= 2;
  });
}

function checkPlaceRelevance(proposalLines, referenceDocuments) {
  const proposalText = (proposalLines || []).map((line) => String(line || '')).join('\n');
  const referenceText = flattenReferenceLines(referenceDocuments).join('\n');
  const proposalCandidates = extractPlaceCandidates(proposalText);
  const referenceCandidates = extractPlaceCandidates(referenceText);
  const byTail = new Map();
  for (const candidate of proposalCandidates) {
    const values = byTail.get(candidate.tail) || [];
    values.push(candidate);
    byTail.set(candidate.tail, values);
  }
  const findings = [];
  for (const [tail, candidates] of byTail) {
    const firstName = longestRepeatedName(candidates);
    if (!firstName) continue;
    const count = candidates.filter((candidate) => candidate.firstName.endsWith(firstName)).length;
    if (referenceContainsPlace(referenceCandidates, firstName, tail)) continue;
    const place = `${firstName}${tail}`;
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
