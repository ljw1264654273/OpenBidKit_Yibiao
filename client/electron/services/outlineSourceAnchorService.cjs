const crypto = require('node:crypto');

const TENDER_SOURCE_KINDS = new Set(['requirement', 'criterion', 'response-point']);

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

function locateUniqueSourceText(markdownInput, sourceTextInput) {
  const markdown = String(markdownInput || '');
  const sourceText = String(sourceTextInput || '');
  if (!sourceText) {
    return { status: 'unlocated', reason: 'not-found', sourceText, occurrenceCount: 0 };
  }

  const exactPositions = findOccurrences(markdown, sourceText);
  if (exactPositions.length === 1) {
    const matchStart = exactPositions[0];
    return createLocatedResult(markdown, sourceText, matchStart, matchStart + sourceText.length, 'exact');
  }
  if (exactPositions.length > 1) {
    return { status: 'unlocated', reason: 'ambiguous', sourceText, occurrenceCount: exactPositions.length };
  }

  const normalizedMarkdown = normalizeWhitespace(markdown);
  const normalizedSource = normalizeWhitespace(sourceText).text;
  const normalizedPositions = findOccurrences(normalizedMarkdown.text, normalizedSource);
  if (normalizedPositions.length !== 1) {
    return {
      status: 'unlocated',
      reason: normalizedPositions.length > 1 ? 'ambiguous' : 'not-found',
      sourceText,
      occurrenceCount: normalizedPositions.length,
    };
  }

  const normalizedStart = normalizedPositions[0];
  const normalizedEnd = normalizedStart + normalizedSource.length;
  const matchStart = normalizedMarkdown.originalIndices[normalizedStart];
  const matchEnd = normalizedMarkdown.originalIndices[normalizedEnd - 1] + 1;
  return createLocatedResult(markdown, sourceText, matchStart, matchEnd, 'normalized-whitespace');
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

    const located = locateUniqueSourceText(markdown, record.source_text);
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
