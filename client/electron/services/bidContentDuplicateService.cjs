const sensitivityThresholds = Object.freeze({
  low: 0.56,
  medium: 0.64,
  high: 0.76,
});

const illustrationBlockPatterns = Object.freeze([
  /<!--\s*yibiao-illustration:start\b[\s\S]*?<!--\s*yibiao-illustration:end\s*-->/gi,
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
    .map((text, index) => ({
      index,
      text: normalizeParagraph(text),
    }))
    .filter((paragraph) => paragraph.text)
    .map((paragraph, index) => ({ ...paragraph, index }));
}

function splitSentences(value) {
  const text = removeIllustrationBlocks(value);
  const sentences = [];
  let start = 0;
  const isAsciiLetter = (character) => Boolean(character && /[A-Za-z]/.test(character));
  const isDigit = (character) => Boolean(character && /[0-9]/.test(character));
  const isBoundary = (index) => {
    const character = text[index];
    if ('。！？；!?;，,：:'.includes(character)) return true;
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
    if (/^(?:(?:[A-Za-z]\.){2,}|(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|e\.g|i\.e)\.)$/i.test(token)) return false;
    return true;
  };
  const push = (end) => {
    const sentence = normalizeParagraph(text.slice(start, end));
    if (sentence) sentences.push(sentence);
    start = end;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' || text[index] === '\r') {
      push(index);
      while (text[index + 1] === '\n' || text[index + 1] === '\r') index += 1;
      start = index + 1;
      continue;
    }
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

function collectExactSentenceMatches(leftParagraphs, rightParagraphs, leftExempt, rightExempt) {
  const rightSentencesByKey = new Map();
  const rightParagraphsByKey = new Map();
  for (const rightParagraph of rightParagraphs) {
    const rightCompact = compactParagraph(rightParagraph.text);
    if (!rightCompact || rightExempt.has(rightCompact) || looksExemptParagraph(rightParagraph.text)) continue;
    const rightSentences = splitSentences(rightParagraph.text)
      .filter((sentence) => !isPureListMarker(sentence));
    if (!rightSentences.length) continue;
    const sameParagraphs = rightParagraphsByKey.get(rightCompact) || [];
    sameParagraphs.push(rightParagraph);
    rightParagraphsByKey.set(rightCompact, sameParagraphs);
    rightSentences.forEach((sentence) => {
      const normalized = compactParagraph(sentence);
      if (!normalized) return;
      const occurrences = rightSentencesByKey.get(normalized) || [];
      occurrences.push({ paragraph: rightParagraph, sentence });
      rightSentencesByKey.set(normalized, occurrences);
    });
  }

  const groups = new Map();
  for (const leftParagraph of leftParagraphs) {
    const leftCompact = compactParagraph(leftParagraph.text);
    if (!leftCompact || leftExempt.has(leftCompact) || looksExemptParagraph(leftParagraph.text)) continue;
    const leftSentences = splitSentences(leftParagraph.text)
      .filter((sentence) => !isPureListMarker(sentence));
    const leftSentenceEntries = leftSentences
      .map((sentence) => ({ sentence, normalized: compactParagraph(sentence) }))
      .filter((entry) => entry.normalized);

    for (const entry of leftSentenceEntries) {
      for (const occurrence of rightSentencesByKey.get(entry.normalized) || []) {
        const groupKey = `${leftParagraph.index}:${occurrence.paragraph.index}`;
        const group = groups.get(groupKey) || {
          leftParagraph,
          rightParagraph: occurrence.paragraph,
          exactSentences: [],
        };
        if (!group.exactSentences.some((item) => (
          item.normalized === entry.normalized
          && item.left === entry.sentence
          && item.right === occurrence.sentence
        ))) {
          group.exactSentences.push({
            normalized: entry.normalized,
            left: entry.sentence,
            right: occurrence.sentence,
          });
        }
        groups.set(groupKey, group);
      }
    }

    for (const rightParagraph of rightParagraphsByKey.get(leftCompact) || []) {
      const groupKey = `${leftParagraph.index}:${rightParagraph.index}`;
      const group = groups.get(groupKey) || {
        leftParagraph,
        rightParagraph,
        exactSentences: [],
      };
      const matchedText = group.exactSentences.map((item) => item.normalized).join('');
      if (matchedText !== leftCompact) {
        group.exactSentences.push({
          normalized: leftCompact,
          left: leftParagraph.text,
          right: rightParagraph.text,
        });
      }
      groups.set(groupKey, group);
    }
  }
  return Array.from(groups.values());
}

function makeNGramSet(value, size = 2) {
  const text = compactParagraph(value);
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
  const tokens = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    tokens.add(compact.slice(index, index + 2));
  }
  return tokens;
}

function paragraphSimilarity(left, right) {
  const edit = editSimilarity(left, right);
  const ngram = jaccard(makeNGramSet(left, 2), makeNGramSet(right, 2));
  const token = jaccard(tokenSet(left), tokenSet(right));
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
} = {}) {
  const threshold = sensitivityThresholds[sensitivity] || sensitivityThresholds.medium;
  const leftParagraphs = splitBidParagraphs(leftContent);
  const rightParagraphs = splitBidParagraphs(rightContent);
  const leftExempt = new Set([...exemptParagraphs, ...leftExemptParagraphs].map(compactParagraph).filter(Boolean));
  const rightExempt = new Set([...exemptParagraphs, ...rightExemptParagraphs].map(compactParagraph).filter(Boolean));
  const matches = [];

  for (const leftParagraph of leftParagraphs) {
    const leftCompact = compactParagraph(leftParagraph.text);
    if (leftCompact.length < minimumCharacters || leftExempt.has(leftCompact) || looksExemptParagraph(leftParagraph.text)) {
      continue;
    }
    let best = null;
    for (const rightParagraph of rightParagraphs) {
      const rightCompact = compactParagraph(rightParagraph.text);
      if (rightCompact.length < minimumCharacters || rightExempt.has(rightCompact) || looksExemptParagraph(rightParagraph.text)) {
        continue;
      }
      const similarity = paragraphSimilarity(leftParagraph.text, rightParagraph.text);
      if (!best || similarity > best.similarity) {
        best = { rightParagraph, similarity };
      }
    }
    if (!best || best.similarity < threshold) continue;
    matches.push({
      id: `match-${leftParagraph.index}-${best.rightParagraph.index}`,
      similarity: best.similarity,
      level: best.similarity >= Math.min(0.94, threshold + 0.14) ? 'high' : 'medium',
      matchType: 'similar-paragraph',
      leftParagraph,
      rightParagraph: best.rightParagraph,
      suggestion: buildRewriteSuggestion(leftParagraph.text, best.rightParagraph.text),
    });
  }

  const uniqueMatches = matches.filter((match, index, all) => (
    all.findIndex((candidate) => candidate.rightParagraph.index === match.rightParagraph.index) === index
  ));
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
  compareBidContents,
  compactParagraph,
  editSimilarity,
  normalizeParagraph,
  removeIllustrationBlocks,
  replaceFirstTextOutsideIllustrationBlocks,
  replaceTextPreservingIllustrationBlocks,
  paragraphSimilarity,
  splitSentences,
  splitBidParagraphs,
};
