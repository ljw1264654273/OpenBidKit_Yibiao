const { sourceHash } = require('./historicalSourceArchive.cjs');

function normalizeHeading(value) {
  return String(value || '').trim()
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^第[一二三四五六七八九十百千万0-9]+[章节篇部分]\s*/u, '')
    .replace(/^[（(]?[一二三四五六七八九十0-9]+[）)、.．]\s*/u, '')
    .replace(/\s+/gu, '').toLowerCase();
}

function normalizePath(value) {
  return (Array.isArray(value) ? value : String(value || '').split(/\s*(?:\/|>|→|》)\s*/u))
    .map(normalizeHeading).filter(Boolean);
}

function buildHistoricalSourceIndex(markdown) {
  const content = String(markdown || '');
  const sourceVersionHash = sourceHash(content);
  const headings = [];
  const linePattern = /^.*(?:\r?\n|$)/gmu;
  let fence = null;
  for (const match of content.matchAll(linePattern)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\r?\n$/u, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; continue; }
    const heading = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line);
    if (!heading) continue;
    headings.push({ level: heading[1].length, heading: heading[2], headingStart: match.index, bodyStart: match.index + match[0].length });
  }
  const stack = [];
  const occurrences = new Map();
  const nextBoundary = Array(headings.length).fill(content.length);
  const open = [];
  for (let index = 0; index < headings.length; index += 1) {
    while (open.length && headings[open.at(-1)].level >= headings[index].level) {
      nextBoundary[open.pop()] = headings[index].headingStart;
    }
    open.push(index);
  }
  const sections = headings.map((heading, index) => {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const path = [...stack.map((parent) => parent.heading), heading.heading];
    stack.push(heading);
    const key = normalizePath(path).join('/');
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    const body = content.slice(heading.bodyStart, nextBoundary[index]);
    const trimmedStart = body.length - body.trimStart().length;
    const sectionContent = body.trim();
    const startOffset = heading.bodyStart + trimmedStart;
    return {
      id: `${sourceVersionHash}:${index}`, path, heading: heading.heading, level: heading.level, occurrence,
      startOffset, endOffset: startOffset + sectionContent.length,
      contentHash: sourceHash(sectionContent), sourceVersionHash, content: sectionContent,
    };
  });
  const byPath = new Map();
  for (const section of sections) {
    const key = normalizePath(section.path).join('/');
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(section);
  }
  return { sourceVersionHash, sections, byPath };
}

function locateHistoricalSection(index, sourcePath) {
  const path = normalizePath(sourcePath);
  const exactMatches = index?.byPath?.get(path.join('/')) || [];
  // 标题存在但正文为空也要保留定位结果；调用方据此展示“历史原文为空”，
  // 不能把目录存在误报成路径/哈希不匹配。
  if (exactMatches.length === 1) {
    return { ...exactMatches[0], reliable: true, sourceTitle: exactMatches[0].heading };
  }
  // 目录适配模型有时会给历史来源补上“历史标书/原目录”等虚拟根节点。
  // 仅在去掉前缀后得到唯一正文候选时接受，避免重复标题被错误绑定。
  for (let start = 1; start < path.length; start += 1) {
    const suffixMatches = index?.byPath?.get(path.slice(start).join('/')) || [];
    if (suffixMatches.length === 1) {
      return { ...suffixMatches[0], reliable: true, sourceTitle: suffixMatches[0].heading };
    }
  }
  return { reliable: false, content: '' };
}

function findAllValueRanges(section, value) {
  const needle = String(value || '');
  if (!section?.reliable || !needle) return [];
  const ranges = [];
  for (let offset = 0; offset < section.content.length;) {
    const startOffset = section.content.indexOf(needle, offset);
    if (startOffset < 0) break;
    ranges.push({ startOffset, endOffset: startOffset + needle.length, occurrence: ranges.length + 1,
      sourceVersionHash: section.sourceVersionHash, sectionId: section.id, contentHash: section.contentHash });
    offset = startOffset + needle.length;
  }
  return ranges;
}

function bindRulesToSourceRanges(index, sourcePath, rules) {
  const section = locateHistoricalSection(index, sourcePath);
  const boundRules = (rules || []).map((rule) => {
    const values = rule.paragraphRewrite ? [...(rule.oldValues || []), ...(rule.oldContentEvidence || [])]
      : rule.targetAction === 'replace' ? rule.oldValues : rule.oldContentEvidence;
    const authorizedRanges = section.reliable ? (values || []).flatMap((value) => findAllValueRanges(section, value).map((range) => ({ ...range, oldValue: value }))) : [];
    return { ...rule, authorizedRanges, policy: section.reliable ? rule.policy : 'contextual-review' };
  });
  if (!section.reliable) return boundRules;
  const paragraphs = [];
  // 空行分段；标题、表格和围栏是边界，不把结构化 Markdown 授权给段落改写。
  let start = null;
  let end = 0;
  let fence = null;
  const flush = () => {
    if (start !== null) paragraphs.push({ startOffset: start, endOffset: end });
    start = null;
  };
  for (const match of section.content.matchAll(/^.*(?:\r?\n|$)/gmu)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\r?\n$/u, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { flush(); fence = marker[1]; continue; }
    if (!line.trim() || /^\s*(?:#{1,6}\s|\||<|!\[)/u.test(line)) { flush(); continue; }
    if (start === null) start = match.index;
    end = match.index + line.length;
  }
  flush();
  const affected = paragraphs.filter((paragraph) => boundRules.some((rule) => rule.paragraphRewrite
    && rule.authorizedRanges.some((range) => range.startOffset >= paragraph.startOffset && range.endOffset <= paragraph.endOffset)))
    .map((paragraph) => {
      const related = boundRules.filter((rule) => rule.targetAction !== 'review' && rule.authorizedRanges.some((range) =>
        range.startOffset >= paragraph.startOffset && range.endOffset <= paragraph.endOffset));
      return { ...paragraph, oldValue: section.content.slice(paragraph.startOffset, paragraph.endOffset),
        paragraphRewrite: true, differenceIds: related.map((rule) => rule.differenceId || rule.id),
        oldValues: [...new Set(related.flatMap((rule) => rule.oldValues || []))],
        targetRequirements: related.map((rule) => rule.targetRequirement).filter(Boolean),
        sourceVersionHash: section.sourceVersionHash, sectionId: section.id, contentHash: section.contentHash };
    });
  return boundRules.map((rule) => {
    if (rule.targetAction === 'review') return rule;
    const ranges = rule.authorizedRanges.map((range) => affected.find((paragraph) =>
      range.startOffset >= paragraph.startOffset && range.endOffset <= paragraph.endOffset) || range)
      .filter((range) => !rule.paragraphRewrite || range.paragraphRewrite);
    return { ...rule, authorizedRanges: [...new Map(ranges.map((range) => [`${range.startOffset}:${range.endOffset}`, range])).values()] };
  });
}

module.exports = { buildHistoricalSourceIndex, locateHistoricalSection, findAllValueRanges, bindRulesToSourceRanges, normalizePath };
