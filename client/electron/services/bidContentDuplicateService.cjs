const sensitivityThresholds = Object.freeze({
  low: 0.56,
  medium: 0.64,
  high: 0.76,
});

function normalizeParagraph(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
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
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((text, index) => ({
      index,
      text: normalizeParagraph(text),
    }))
    .filter((paragraph) => paragraph.text)
    .map((paragraph, index) => ({ ...paragraph, index }));
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
      leftParagraph,
      rightParagraph: best.rightParagraph,
      suggestion: buildRewriteSuggestion(leftParagraph.text, best.rightParagraph.text),
    });
  }

  const uniqueMatches = matches.filter((match, index, all) => (
    all.findIndex((candidate) => candidate.rightParagraph.index === match.rightParagraph.index) === index
  ));
  return {
    sensitivity: sensitivityThresholds[sensitivity] ? sensitivity : 'medium',
    threshold,
    leftParagraphs,
    rightParagraphs,
    matches: uniqueMatches,
    summary: {
      leftParagraphCount: leftParagraphs.length,
      rightParagraphCount: rightParagraphs.length,
      duplicateParagraphCount: uniqueMatches.length,
      maxSimilarity: uniqueMatches.reduce((max, item) => Math.max(max, item.similarity), 0),
    },
  };
}

module.exports = {
  buildRewriteSuggestion,
  compareBidContents,
  compactParagraph,
  editSimilarity,
  normalizeParagraph,
  paragraphSimilarity,
  splitBidParagraphs,
};
