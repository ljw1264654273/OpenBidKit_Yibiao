const crypto = require('node:crypto');

const TENDER_SOURCE_KINDS = new Set(['requirement', 'criterion', 'response-point']);
const SOURCE_ID_PREFIX_RE = /^[A-Za-z]+\d+(?:-[A-Za-z]+\d+)*[：:]\s*/u;
const TRAILING_SOURCE_PUNCTUATION_RE = /[。．.!！?？；;，,、:：]+$/u;

function hashMarkdown(markdown) {
  return crypto.createHash('sha256').update(String(markdown || ''), 'utf8').digest('hex');
}

function normalizeWhitespace(text) {
  const characters = [];
  const originalIndices = [];
  let inWhitespace = false;
  const value = String(text || '');

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/u.test(character)) {
      if (!inWhitespace) {
        characters.push(' ');
        originalIndices.push(index);
        inWhitespace = true;
      }
      continue;
    }
    characters.push(character);
    originalIndices.push(index);
    inWhitespace = false;
  }

  return { text: characters.join(''), originalIndices };
}

function findOccurrences(text, search) {
  if (!search) return [];
  const positions = [];
  let fromIndex = 0;
  while (fromIndex <= text.length - search.length) {
    const index = text.indexOf(search, fromIndex);
    if (index < 0) break;
    positions.push(index);
    fromIndex = index + 1;
  }
  return positions;
}

function findParagraphs(markdown) {
  const paragraphs = [];
  const separator = /\r?\n[\t ]*\r?\n/g;
  let start = 0;
  let match;
  while ((match = separator.exec(markdown)) !== null) {
    if (start < match.index && markdown.slice(start, match.index).trim()) {
      paragraphs.push({ start, end: match.index });
    }
    start = match.index + match[0].length;
  }
  if (start < markdown.length && markdown.slice(start).trim()) {
    paragraphs.push({ start, end: markdown.length });
  }
  return paragraphs.length ? paragraphs : [{ start: 0, end: markdown.length }];
}

function findParagraphIndex(paragraphs, position, direction) {
  const index = paragraphs.findIndex((paragraph) => position >= paragraph.start && position < paragraph.end);
  if (index >= 0) return index;
  if (direction === 'before') {
    for (let paragraphIndex = paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex -= 1) {
      if (paragraphs[paragraphIndex].end <= position) return paragraphIndex;
    }
    return 0;
  }
  const next = paragraphs.findIndex((paragraph) => paragraph.start > position);
  return next >= 0 ? next : paragraphs.length - 1;
}

function createLocatedResult(markdown, sourceText, matchStart, matchEnd, matchMethod) {
  const paragraphs = findParagraphs(markdown);
  const firstParagraphIndex = findParagraphIndex(paragraphs, matchStart, 'after');
  const lastParagraphIndex = findParagraphIndex(paragraphs, Math.max(matchStart, matchEnd - 1), 'before');
  const contextStart = Math.min(
    Math.max(paragraphs[Math.max(0, firstParagraphIndex - 1)]?.start ?? 0, matchStart - 600),
    matchStart,
  );
  const contextEnd = Math.max(
    Math.min(paragraphs[Math.min(paragraphs.length - 1, lastParagraphIndex + 1)]?.end ?? markdown.length, matchEnd + 600),
    matchEnd,
  );
  return {
    status: 'located',
    sourceText,
    blockId: `paragraph-${String(firstParagraphIndex + 1).padStart(6, '0')}`,
    matchStart,
    matchEnd,
    contextStart,
    contextEnd,
    matchMethod,
  };
}

function locateUniqueSourceText(markdownInput, sourceTextInput, options = {}) {
  const markdown = String(markdownInput || '');
  const sourceText = String(sourceTextInput || '');
  if (!sourceText) {
    return { status: 'unlocated', reason: 'not-found', sourceText, occurrenceCount: 0 };
  }

  if (options.sourceKind === 'requirement') {
    const tableResult = locateUniqueTableCellSourceText(markdown, sourceText);
    if (tableResult.status === 'located' || tableResult.reason === 'ambiguous') return tableResult;
  }

  const exactPositions = findOccurrences(markdown, sourceText);
  if (exactPositions.length === 1) {
    const matchStart = exactPositions[0];
    return createLocatedResult(markdown, sourceText, matchStart, matchStart + sourceText.length, 'exact');
  }
  if (exactPositions.length > 1) {
    return { status: 'unlocated', reason: 'ambiguous', sourceText, occurrenceCount: exactPositions.length };
  }

  const candidates = [sourceText, normalizeSourceWrapper(sourceText)]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  let lastOccurrenceCount = 0;
  for (const candidate of candidates) {
    const normalizedMarkdown = normalizeWhitespace(markdown);
    const normalizedSource = normalizeWhitespace(candidate).text;
    const normalizedPositions = findOccurrences(normalizedMarkdown.text, normalizedSource);
    lastOccurrenceCount = normalizedPositions.length;
    if (normalizedPositions.length > 1) {
      return { status: 'unlocated', reason: 'ambiguous', sourceText, occurrenceCount: normalizedPositions.length };
    }
    if (normalizedPositions.length !== 1) continue;

    const normalizedStart = normalizedPositions[0];
    const normalizedEnd = normalizedStart + normalizedSource.length;
    const matchStart = normalizedMarkdown.originalIndices[normalizedStart];
    const matchEnd = normalizedMarkdown.originalIndices[normalizedEnd - 1] + 1;
    return createLocatedResult(markdown, sourceText, matchStart, matchEnd, candidate === sourceText ? 'normalized-whitespace' : 'normalized-source');
  }

  const visibleResult = locateUniqueVisibleText(markdown, sourceText, candidates);
  if (visibleResult.status === 'located' || visibleResult.reason === 'ambiguous') return visibleResult;

  return {
    status: 'unlocated',
    reason: 'not-found',
    sourceText,
    occurrenceCount: lastOccurrenceCount,
  };
}

function locateUniqueTableCellSourceText(markdown, sourceText) {
  const candidates = [sourceText, normalizeSourceWrapper(sourceText)]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const normalizedSources = [...new Set(candidates.map((candidate) => normalizeWhitespace(candidate).text).filter(Boolean))];
  if (!normalizedSources.length) return { status: 'unlocated', reason: 'not-found', sourceText, occurrenceCount: 0 };

  const matches = [];
  const cellPattern = /<td\b[^>]*>[\s\S]*?<\/td>/giu;
  let cellMatch;
  while ((cellMatch = cellPattern.exec(markdown)) !== null) {
    const cellHtml = cellMatch[0];
    const contentStart = cellMatch.index + cellHtml.indexOf('>') + 1;
    const contentEnd = cellMatch.index + cellHtml.lastIndexOf('</td>');
    const projection = normalizeProjectedHtmlText(markdown.slice(contentStart, contentEnd));
    for (const normalizedSource of normalizedSources) {
      const starts = findOccurrences(projection.text, normalizedSource);
      if (starts.length !== 1) continue;
      const matchStart = starts[0];
      const matchEnd = matchStart + normalizedSource.length;
      const trailingText = projection.text.slice(matchEnd).trim();
      if (trailingText && !isScoreSuffix(trailingText)) continue;
      matches.push({
        matchStart: contentStart + projection.originalIndices[matchStart],
        matchEnd: contentStart + projection.originalIndices[matchEnd - 1] + 1,
      });
      break;
    }
  }

  if (matches.length > 1) return { status: 'unlocated', reason: 'ambiguous', sourceText, occurrenceCount: matches.length };
  if (matches.length === 1) {
    return createLocatedResult(markdown, sourceText, matches[0].matchStart, matches[0].matchEnd, 'table-cell');
  }
  return { status: 'unlocated', reason: 'not-found', sourceText, occurrenceCount: 0 };
}

function locateUniqueVisibleText(markdown, sourceText, candidates) {
  const projection = normalizeProjectedHtmlText(markdown);
  for (const candidate of candidates) {
    const normalizedSource = normalizeWhitespace(candidate).text;
    const starts = findOccurrences(projection.text, normalizedSource);
    if (starts.length > 1) return { status: 'unlocated', reason: 'ambiguous', sourceText, occurrenceCount: starts.length };
    if (starts.length !== 1) continue;
    const matchStart = starts[0];
    const matchEnd = matchStart + normalizedSource.length;
    return createLocatedResult(
      markdown,
      sourceText,
      projection.originalIndices[matchStart],
      projection.originalIndices[matchEnd - 1] + 1,
      'html-visible-text',
    );
  }
  return { status: 'unlocated', reason: 'not-found', sourceText, occurrenceCount: 0 };
}

function normalizeProjectedHtmlText(markdown) {
  const characters = [];
  const originalIndices = [];
  for (let index = 0; index < markdown.length;) {
    if (markdown[index] === '<') {
      const closeIndex = markdown.indexOf('>', index + 1);
      if (closeIndex >= 0) {
        if (/^<br\b/i.test(markdown.slice(index, closeIndex + 1))) {
          characters.push('\n');
          originalIndices.push(index);
        }
        index = closeIndex + 1;
        continue;
      }
    }
    if (markdown.startsWith('&nbsp;', index)) {
      characters.push(' ');
      originalIndices.push(index);
      index += 6;
      continue;
    }
    characters.push(markdown[index]);
    originalIndices.push(index);
    index += 1;
  }
  const normalized = normalizeWhitespace(characters.join(''));
  return {
    text: normalized.text,
    originalIndices: normalized.originalIndices.map((offset) => originalIndices[offset]),
  };
}

function isScoreSuffix(value) {
  return /^(?:（(?:客观分|主观分)）|\((?:客观分|主观分)\))$/u.test(value);
}

function normalizeSourceWrapper(sourceText) {
  return String(sourceText || '')
    .replace(SOURCE_ID_PREFIX_RE, '')
    .replace(TRAILING_SOURCE_PUNCTUATION_RE, '')
    .trim();
}

function collectCanonicalSources(scorePlan) {
  const sources = new Map();
  for (const group of scorePlan?.groups || []) {
    sources.set(group.requirement_id, { source_kind: 'requirement', source_text: group.source_title });
    for (const criterion of group.criteria || []) {
      sources.set(criterion.criterion_id, { source_kind: 'criterion', source_text: criterion.source_text });
      for (const point of criterion.response_points || []) {
        sources.set(point.point_id, { source_kind: 'response-point', source_text: point.source_text });
      }
      for (const supplement of criterion.supplements || []) {
        sources.set(supplement.supplement_id, { source_kind: 'professional-supplement', source_text: supplement.title });
      }
    }
  }
  return sources;
}

function attachScoreCoverageAnchors({ markdown: markdownInput, scorePlan, scoreCoverageMap }) {
  if (!scoreCoverageMap || !Array.isArray(scoreCoverageMap.records)) return scoreCoverageMap;
  const markdown = String(markdownInput || '');
  const documentHash = hashMarkdown(markdown);
  const canonicalSources = collectCanonicalSources(scorePlan);
  const records = scoreCoverageMap.records.flatMap((inputRecord) => {
    const canonical = canonicalSources.get(inputRecord.source_id);
    if (canonicalSources.size > 0 && !canonical && TENDER_SOURCE_KINDS.has(inputRecord.source_kind)) {
      return [];
    }
    const record = {
      ...inputRecord,
      ...(canonical || {}),
    };
    delete record.source_anchor;

    if (!TENDER_SOURCE_KINDS.has(record.source_kind)) {
      return [{ ...record, source_location_status: 'not-applicable' }];
    }

    const located = locateUniqueSourceText(markdown, record.source_text, { sourceKind: record.source_kind });
    if (located.status !== 'located') {
      return [{ ...record, source_location_status: located.reason }];
    }
    return [{
      ...record,
      source_location_status: 'located',
      source_anchor: {
        document_hash: documentHash,
        block_id: located.blockId,
        match_start: located.matchStart,
        match_end: located.matchEnd,
        context_start: located.contextStart,
        context_end: located.contextEnd,
        match_method: located.matchMethod,
      },
    }];
  });

  return {
    ...scoreCoverageMap,
    version: 2,
    document_hash: documentHash,
    records,
  };
}

module.exports = {
  hashMarkdown,
  locateUniqueSourceText,
  attachScoreCoverageAnchors,
};
