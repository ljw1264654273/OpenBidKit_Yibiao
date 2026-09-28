const sensitivityThresholds = Object.freeze({
  low: 0.56,
  medium: 0.64,
  high: 0.76,
});

const minimumExactSentenceCharacters = 8;
const exactSentenceRulesVersion = 3;
const headingLikeEndingPattern = /(?:概况|目标|安排|措施|方案|承诺|分析|理解|认识|要求|内容|范围|依据|说明|清单|计划|组织|职责|制度|机制|标准|服务|保障|原则|思路|流程|体系|结构|情况|背景|意义|特点|概述|介绍|设计|规划|部署|分类|组成|功能|任务|条件|方式|方法|过程|结果|效果|建议|要点|重点|难点|问题|风险|响应|资源|进度|质量|安全|管理|控制)$/u;
const sentencePredicatePattern = /(?:是|为|有|将|会|能|可|应|需|须|已|未|并|通过|按照|根据|确保|保证|完成|建立|开展|提供|负责|满足|实现|采用|包括|具有|形成|达到|提升|加强|制定|配置|落实|支持|使用|做到|具备|覆盖|用于|适用|保持|持续|及时|严格|能够|可以|需要|应当|必须|不得|完善|明确|有效|符合|执行|包含|构成|提出|采取|设置|承担|配备|协同)/u;

const illustrationBlockPatterns = Object.freeze([
  /<!--\s*yibiao-illustration:start\b[\s\S]*?<!--\s*yibiao-illustration:end\s*-->/gi,
  /<!--\s*yibiao-inline-image:start\b[\s\S]*?<!--\s*yibiao-inline-image:end\s*-->/gi,
  /<!\s*yibiaoillustration:start\b[\s\S]*?<!\s*yibiaoillustration:end\s*>/gi,
  /<!\s*yibiaofigurecaption\b[\s\S]*?(?:<!\s*)?yibiaoillustration:end\b(?:\s*(?:-->|>))?/gi,
]);

function removeIllustrationBlocks(value) {
  let text = String(value || '').replace(/\r\n?/g, '\n');
  for (const pattern of illustrationBlockPatterns) {
    text = text.replace(pattern, '\n');
  }
  return text;
}

function illustrationBlockRanges(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const ranges = [];
  for (const pattern of illustrationBlockPatterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      match = pattern.exec(text);
    }
    pattern.lastIndex = 0;
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  return ranges.reduce((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      return merged;
    }
    merged.push({ ...range });
    return merged;
  }, []);
}

function replaceTextPreservingIllustrationBlocks(value, replacement) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const ranges = illustrationBlockRanges(text);
  if (!ranges.length) return String(replacement || '');

  let cursor = 0;
  let inserted = false;
  let result = '';
  for (const range of ranges) {
    const before = text.slice(cursor, range.start);
    if (!inserted && before.trim()) {
      result += String(replacement || '');
      inserted = true;
    } else if (!before.trim()) {
      result += before;
    }
    result += text.slice(range.start, range.end);
    cursor = range.end;
  }
  const after = text.slice(cursor);
  if (!inserted && after.trim()) {
    result += String(replacement || '');
    inserted = true;
  } else if (!after.trim()) {
    result += after;
  }
  return inserted ? result : text;
}

function replaceFirstTextOutsideIllustrationBlocks(value, oldText, replacement) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const ranges = illustrationBlockRanges(text);
  let cursor = 0;
  for (const range of ranges) {
    const before = text.slice(cursor, range.start);
    const matchIndex = before.indexOf(String(oldText || ''));
    if (matchIndex >= 0) {
      return `${text.slice(0, cursor + matchIndex)}${String(replacement || '')}${text.slice(cursor + matchIndex + String(oldText || '').length)}`;
    }
    cursor = range.end;
  }
  const after = text.slice(cursor);
  const matchIndex = after.indexOf(String(oldText || ''));
  if (matchIndex >= 0) {
    return `${text.slice(0, cursor + matchIndex)}${String(replacement || '')}${text.slice(cursor + matchIndex + String(oldText || '').length)}`;
  }
  return null;
}

function normalizeParagraph(value) {
  return removeIllustrationBlocks(value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[`*_>#~-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactParagraph(value) {
  return normalizeParagraph(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function splitBidParagraphs(content) {
  return removeIllustrationBlocks(content)
    .split(/\n\s*\n+/)
    .map((sentenceText) => ({
      sentenceText: String(sentenceText || '').trim(),
      text: normalizeParagraph(sentenceText),
    }))
    .filter((paragraph) => paragraph.text)
    .map((paragraph, index) => {
      const result = { index, text: paragraph.text };
      Object.defineProperty(result, 'sentenceText', {
        configurable: false,
        enumerable: false,
        value: paragraph.sentenceText,
        writable: false,
      });
      return result;
    });
}

function splitSentences(value) {
  const text = removeIllustrationBlocks(value);
  const sentences = [];
  let start = 0;
  const isAsciiLetter = (character) => Boolean(character && /[A-Za-z]/.test(character));
  const isDigit = (character) => Boolean(character && /[0-9]/.test(character));
  const isMarkdownHeadingBoundary = (index) => {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const line = text.slice(lineStart, index);
    const hasStructuralMarker = /^\s{0,3}(?:#{1,6}\s+|[-*+>]\s+|\d+(?:\.\d+)*[.)、．]\s+|[一二三四五六七八九十百千万零〇两]+[、.．]\s+|[（(][一二三四五六七八九十百千万零〇两\d]+[）)]\s+|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s+)/u.test(line);
    return hasStructuralMarker && isHeadingLikeSentence(line);
  };
  const isBoundary = (index) => {
    const character = text[index];
    if ('。！？!?'.includes(character)) return true;
    if (character === '\n') return isMarkdownHeadingBoundary(index);
    if (character !== '.') return false;
    const previous = text[index - 1];
    const next = text[index + 1];
    if (isDigit(previous) && isDigit(next)) return false;
    if (isAsciiLetter(previous) && isAsciiLetter(next)) return false;
    const tokenStart = Math.max(
      text.lastIndexOf(' ', index - 1),
      text.lastIndexOf('\n', index - 1),
      text.lastIndexOf('\t', index - 1),
    ) + 1;
    const token = text.slice(tokenStart, index + 1);
    if (/^\d+\.$/u.test(token)) return false;
    if (/^(?:(?:[A-Za-z]\.){2,}|(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|e\.g|i\.e)\.)$/i.test(token)) return false;
    return true;
  };
  const push = (end) => {
    const sentence = normalizeParagraph(text.slice(start, end));
    if (sentence) sentences.push(sentence);
    start = end;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (isBoundary(index)) push(index + 1);
  }
  push(text.length);
  return sentences;
}

function isPureListMarker(value) {
  const text = normalizeParagraph(value);
  if (!text) return true;
  return /^(?:\d+\s*[.．、:：)]|[（(]\s*\d+\s*[）)]|[一二三四五六七八九十百千万零〇两]+\s*[、.．:：]|[（(]\s*[一二三四五六七八九十百千万零〇两]+\s*[）)])$/.test(text);
}

function hasSentenceTerminator(value) {
  const text = normalizeParagraph(value).replace(/[\s"'“”‘’「」『』《》〈〉（），,、；;：:【】〔〕\[\]()]+$/u, '');
  if (!text) return false;
  if (/[。！？!?]$/u.test(text)) return true;
  if (!text.endsWith('.')) return false;
  return !/[（(【\[/\\]$/u.test(text.slice(0, -1));
}

function isHeadingLikeSentence(value) {
  const text = normalizeParagraph(value);
  if (!/[\u4e00-\u9fff]/u.test(text) || /[，,；;：:]/u.test(text)) return false;
  const content = compactParagraph(text);
  return headingLikeEndingPattern.test(content) && !sentencePredicatePattern.test(content);
}

function exactSentenceMatchText(value) {
  const text = normalizeParagraph(value);
  const withoutListMarker = text.replace(
    /^\s*(?:\d+(?:\.\d+)*[.)、．]\s*|[一二三四五六七八九十百千万零〇两]+[、.．]\s*|[（(][一二三四五六七八九十百千万零〇两\d]+[）)]\s*|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*)/u,
    '',
  ).trim();
  if (!withoutListMarker || withoutListMarker === text) return text;
  const labeledContent = withoutListMarker.match(/^([^，,；;。！？!?：:]{1,30})[：:]\s*(\S[\s\S]*)$/u);
  return labeledContent?.[2]?.trim() || text;
}

function exactSentenceEntries(paragraph) {
  return splitSentences(paragraph.sentenceText || paragraph.text)
    .filter((sentence) => (
      hasSentenceTerminator(sentence)
      && !isPureListMarker(sentence)
      && !isHeadingLikeSentence(sentence)
    ))
    .map((sentence) => ({
      sentence,
      normalized: compactParagraph(sentence),
      matchKey: compactParagraph(exactSentenceMatchText(sentence)),
    }))
    .filter((entry) => entry.matchKey.length >= minimumExactSentenceCharacters);
}

function collectExactSentenceMatches(leftParagraphs, rightParagraphs, leftExempt, rightExempt) {
  const rightSentencesByKey = new Map();
  for (const rightParagraph of rightParagraphs) {
    const rightCompact = compactParagraph(rightParagraph.text);
    if (!rightCompact || rightExempt.has(rightCompact) || looksExemptParagraph(rightParagraph.text)) continue;
    exactSentenceEntries(rightParagraph).forEach((entry) => {
      const occurrences = rightSentencesByKey.get(entry.matchKey) || [];
      occurrences.push({ paragraph: rightParagraph, sentence: entry.sentence });
      rightSentencesByKey.set(entry.matchKey, occurrences);
    });
  }

  const groups = new Map();
  for (const leftParagraph of leftParagraphs) {
    const leftCompact = compactParagraph(leftParagraph.text);
    if (!leftCompact || leftExempt.has(leftCompact) || looksExemptParagraph(leftParagraph.text)) continue;
    const leftSentenceEntries = exactSentenceEntries(leftParagraph);

    for (const entry of leftSentenceEntries) {
      for (const occurrence of rightSentencesByKey.get(entry.matchKey) || []) {
        const groupKey = `${leftParagraph.index}:${occurrence.paragraph.index}`;
        const group = groups.get(groupKey) || {
          leftParagraph,
          rightParagraph: occurrence.paragraph,
          exactSentences: [],
          matchKeys: new Set(),
        };
        if (!group.matchKeys.has(entry.matchKey)) {
          group.exactSentences.push({
            normalized: entry.normalized,
            left: entry.sentence,
            right: occurrence.sentence,
          });
          group.matchKeys.add(entry.matchKey);
        }
        groups.set(groupKey, group);
      }
    }
  }
  return Array.from(groups.values(), ({ matchKeys: _matchKeys, ...group }) => group);
}

function refreshExactSentenceMatches(matches) {
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    if (!match || typeof match !== 'object') return [];
    const groups = match.leftParagraph && match.rightParagraph
      ? collectExactSentenceMatches(
        [match.leftParagraph],
        [match.rightParagraph],
        new Set(),
        new Set(),
      )
      : [];
    const exactSentences = groups[0]?.exactSentences || [];
    if (exactSentences.length) {
      return [{
        ...match,
        exactSentences,
        matchType: match.matchType === 'similar-paragraph' ? 'mixed' : (match.matchType || 'exact-sentence'),
      }];
    }
    if (match.matchType === 'exact-sentence') return [];
    const { exactSentences: _oldExactSentences, ...withoutExactSentences } = match;
    return [{
      ...withoutExactSentences,
      ...(match.matchType === 'mixed' ? { matchType: 'similar-paragraph' } : {}),
    }];
  });
}

function makeNGramSet(value, size = 2) {
  const text = compactParagraph(value);
  return makeNGramSetFromCompact(text, size);
}

function makeNGramSetFromCompact(text, size = 2) {
  if (!text) return new Set();
  if (text.length <= size) return new Set([text]);
  const grams = new Set();
  for (let index = 0; index <= text.length - size; index += 1) {
    grams.add(text.slice(index, index + size));
  }
  return grams;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function editSimilarity(leftValue, rightValue) {
  const left = compactParagraph(leftValue);
  const right = compactParagraph(rightValue);
  return editSimilarityFromCompact(left, right);
}

function editSimilarityFromCompact(left, right) {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = shorter === left ? right : left;
  let previous = Array.from({ length: shorter.length + 1 }, (_, index) => index);
  for (let row = 1; row <= longer.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= shorter.length; column += 1) {
      current[column] = longer[row - 1] === shorter[column - 1]
        ? previous[column - 1]
        : Math.min(previous[column - 1] + 1, previous[column] + 1, current[column - 1] + 1);
    }
    previous = current;
  }
  return Math.max(0, 1 - previous[shorter.length] / Math.max(left.length, right.length));
}

function tokenSet(value) {
  const compact = compactParagraph(value);
  return tokenSetFromCompact(compact);
}

function tokenSetFromCompact(compact) {
  const tokens = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    tokens.add(compact.slice(index, index + 2));
  }
  return tokens;
}

function paragraphSimilarity(left, right) {
  return paragraphSimilarityPrepared(prepareComparableParagraph(left), prepareComparableParagraph(right));
}

function prepareComparableParagraph(value) {
  const compact = compactParagraph(value);
  return {
    compact,
    ngrams: makeNGramSetFromCompact(compact, 2),
    tokens: tokenSetFromCompact(compact),
  };
}

function paragraphSimilarityUpperBound(left, right) {
  const ngram = jaccard(left.ngrams, right.ngrams);
  const token = jaccard(left.tokens, right.tokens);
  return {
    ngram,
    token,
    score: Math.max(
      0.5 + ngram * 0.35 + token * 0.15,
      ngram * 0.92,
      token * 0.95,
    ),
  };
}

function paragraphSimilarityPrepared(left, right, preparedOverlap) {
  const overlap = preparedOverlap || paragraphSimilarityUpperBound(left, right);
  const edit = editSimilarityFromCompact(left.compact, right.compact);
  const { ngram, token } = overlap;
  // 字符编辑距离对调序很敏感，因此同时保留顺序无关的字符 n-gram 得分。
  return Number(Math.max(
    edit * 0.5 + ngram * 0.35 + token * 0.15,
    ngram * 0.92,
    token * 0.95,
  ).toFixed(4));
}

function looksExemptParagraph(text) {
  const normalized = normalizeParagraph(text);
  if (!normalized) return true;
  if (/招标文件原话|采购文件原文|规范条文|国家标准|行业标准|依据《|按照《/.test(normalized)) {
    return true;
  }
  return /公司/.test(normalized)
    && /(资质|资格|体系|多年|经验|证书|认证|营业执照)/.test(normalized)
    && normalized.length >= 35;
}

function buildRewriteSuggestion(leftText, rightText) {
  const left = normalizeParagraph(leftText);
  const right = normalizeParagraph(rightText);
  const shared = left.length <= right.length ? left : right;
  const firstSentence = shared.split(/[。！？；]/).map((item) => item.trim()).find(Boolean) || '本段核心内容';
  return {
    title: '建议结合本项目重写',
    reason: '两份标书的论述结构和关键表达高度相近，少量换词或调序仍可能被识别为重复。',
    instruction: `保留“${firstSentence.slice(0, 30)}”所表达的业务目标，改用本项目的实施对象、责任边界、方法步骤和量化指标重新组织本段。`,
  };
}

function compareBidContents({
  leftContent,
  rightContent,
  sensitivity = 'medium',
  exemptParagraphs = [],
  leftExemptParagraphs = [],
  rightExemptParagraphs = [],
  minimumCharacters = 30,
} = {}, { onProgress } = {}) {
  let lastProgress = -1;
  const reportProgress = (value) => {
    if (typeof onProgress !== 'function') return;
    const next = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    if (next === lastProgress) return;
    lastProgress = next;
    onProgress(next);
  };
  const threshold = sensitivityThresholds[sensitivity] || sensitivityThresholds.medium;
  const leftParagraphs = splitBidParagraphs(leftContent);
  const rightParagraphs = splitBidParagraphs(rightContent);
  const leftExempt = new Set([...exemptParagraphs, ...leftExemptParagraphs].map(compactParagraph).filter(Boolean));
  const rightExempt = new Set([...exemptParagraphs, ...rightExemptParagraphs].map(compactParagraph).filter(Boolean));
  const leftComparable = leftParagraphs.map((paragraph) => ({
    paragraph,
    prepared: prepareComparableParagraph(paragraph.text),
  })).filter(({ paragraph, prepared }) => (
    prepared.compact.length >= minimumCharacters
    && !leftExempt.has(prepared.compact)
    && !looksExemptParagraph(paragraph.text)
  ));
  const rightComparable = rightParagraphs.map((paragraph) => ({
    paragraph,
    prepared: prepareComparableParagraph(paragraph.text),
  })).filter(({ paragraph, prepared }) => (
    prepared.compact.length >= minimumCharacters
    && !rightExempt.has(prepared.compact)
    && !looksExemptParagraph(paragraph.text)
  ));
  const matches = [];
  const totalPairs = leftComparable.length * rightComparable.length;
  let processedPairs = 0;

  reportProgress(0);

  for (const leftItem of leftComparable) {
    let best = null;
    for (const rightItem of rightComparable) {
      const overlap = paragraphSimilarityUpperBound(leftItem.prepared, rightItem.prepared);
      const roundedUpperBound = Number(overlap.score.toFixed(4));
      if (roundedUpperBound >= threshold && (!best || roundedUpperBound > best.similarity)) {
        const similarity = paragraphSimilarityPrepared(leftItem.prepared, rightItem.prepared, overlap);
        if (!best || similarity > best.similarity) {
          best = { rightParagraph: rightItem.paragraph, similarity };
        }
      }
      processedPairs += 1;
      reportProgress(totalPairs ? (processedPairs / totalPairs) * 90 : 90);
    }
    if (!best || best.similarity < threshold) continue;
    matches.push({
      id: `match-${leftItem.paragraph.index}-${best.rightParagraph.index}`,
      similarity: best.similarity,
      level: best.similarity >= Math.min(0.94, threshold + 0.14) ? 'high' : 'medium',
      matchType: 'similar-paragraph',
      leftParagraph: leftItem.paragraph,
      rightParagraph: best.rightParagraph,
      suggestion: buildRewriteSuggestion(leftItem.paragraph.text, best.rightParagraph.text),
    });
  }
  if (!totalPairs) reportProgress(90);

  const uniqueMatches = matches.filter((match, index, all) => (
    all.findIndex((candidate) => candidate.rightParagraph.index === match.rightParagraph.index) === index
  ));
  reportProgress(92);
  const exactSentenceGroups = collectExactSentenceMatches(leftParagraphs, rightParagraphs, leftExempt, rightExempt);
  const mergedMatches = [...uniqueMatches];
  for (const group of exactSentenceGroups) {
    const existing = mergedMatches.find((match) => (
      match.leftParagraph.index === group.leftParagraph.index
      && match.rightParagraph.index === group.rightParagraph.index
    ));
    if (existing) {
      existing.matchType = 'mixed';
      existing.exactSentences = group.exactSentences;
      continue;
    }
    mergedMatches.push({
      id: `exact-${group.leftParagraph.index}-${group.rightParagraph.index}`,
      similarity: 1,
      level: 'high',
      matchType: 'exact-sentence',
      exactSentences: group.exactSentences,
      leftParagraph: group.leftParagraph,
      rightParagraph: group.rightParagraph,
      suggestion: buildRewriteSuggestion(group.leftParagraph.text, group.rightParagraph.text),
    });
  }
  reportProgress(100);
  return {
    sensitivity: sensitivityThresholds[sensitivity] ? sensitivity : 'medium',
    threshold,
    leftParagraphs,
    rightParagraphs,
    matches: mergedMatches,
    summary: {
      leftParagraphCount: leftParagraphs.length,
      rightParagraphCount: rightParagraphs.length,
      duplicateParagraphCount: mergedMatches.length,
      exactSentenceCount: exactSentenceGroups.reduce((count, group) => count + group.exactSentences.length, 0),
      maxSimilarity: mergedMatches.reduce((max, item) => Math.max(max, item.similarity), 0),
    },
  };
}

module.exports = {
  buildRewriteSuggestion,
  collectExactSentenceMatches,
  compareBidContents,
  compactParagraph,
  editSimilarity,
  exactSentenceRulesVersion,
  normalizeParagraph,
  removeIllustrationBlocks,
  replaceFirstTextOutsideIllustrationBlocks,
  replaceTextPreservingIllustrationBlocks,
  paragraphSimilarity,
  refreshExactSentenceMatches,
  splitSentences,
  splitBidParagraphs,
};
