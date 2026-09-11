import type { OutlineItem } from '../../../shared/types';
import type { ScoreCoverageRecord } from '../types';

export interface OutlineSourceRecordSet {
  tenderRecords: ScoreCoverageRecord[];
  supplementRecords: ScoreCoverageRecord[];
  scope: 'direct' | 'descendants' | 'none';
}

export interface OutlineSourceViewItem {
  sourceId: string;
  kind: 'requirement' | 'criterion' | 'response-point';
  status: 'located' | 'unlocated';
  sourceText: string;
  contextBefore: string;
  matchedText: string;
  contextAfter: string;
  matchStart?: number;
  matchEnd?: number;
  locationReason?: 'not-found' | 'ambiguous' | 'stale-anchor';
}

export type LocatedOutlineSource =
  | {
      status: 'located';
      sourceText: string;
      matchStart: number;
      matchEnd: number;
      contextStart: number;
      contextEnd: number;
      contextBefore: string;
      matchedText: string;
      contextAfter: string;
    }
  | { status: 'unlocated'; sourceText: string; reason: 'not-found' | 'ambiguous' | 'stale-anchor' };

const TENDER_SOURCE_KINDS = new Set<ScoreCoverageRecord['source_kind']>([
  'requirement',
  'criterion',
  'response-point',
]);

const SUPPLEMENT_SOURCE_KINDS = new Set<ScoreCoverageRecord['source_kind']>([
  'professional-supplement',
  'user-supplement',
]);

interface NormalizedText {
  text: string;
  originalIndices: number[];
}

interface ParagraphRange {
  start: number;
  end: number;
}

export function collectOutlineSourceRecords(
  outline: OutlineItem[],
  nodeId: string,
  records: ScoreCoverageRecord[],
): OutlineSourceRecordSet {
  const directRecords = collectRecordsForNodeIds(records, new Set([nodeId]));
  if (directRecords.length > 0) {
    return toRecordSet(directRecords, 'direct');
  }

  const descendantIds = findDescendantIds(outline, nodeId);
  if (descendantIds.size === 0) {
    return emptyRecordSet();
  }

  const descendantRecords = collectRecordsForNodeIds(records, descendantIds);
  return descendantRecords.length > 0
    ? toRecordSet(descendantRecords, 'descendants')
    : emptyRecordSet();
}

export function locateOutlineSourceText(markdown: string, sourceText: string, sourceKind?: ScoreCoverageRecord['source_kind']): LocatedOutlineSource {
  return createOutlineSourceLocator(markdown, sourceKind)(sourceText);
}

export function injectMarkdownSourceAnchor(markdown: string, matchStart: number, matchEnd: number) {
  if (!Number.isInteger(matchStart)
    || !Number.isInteger(matchEnd)
    || matchStart < 0
    || matchStart >= matchEnd
    || matchEnd > markdown.length) return markdown;
  const startMarker = '<span data-outline-source-anchor="primary-start" class="outline-source-anchor-marker"></span>';
  const endMarker = '<span data-outline-source-anchor="primary-end"></span>';
  return `${markdown.slice(0, matchStart)}${startMarker}${markdown.slice(matchStart, matchEnd)}${endMarker}${markdown.slice(matchEnd)}`;
}

export function injectOutlineSourceAnchorMarkers(markdown: string, items: OutlineSourceViewItem[], activeIndex = 0) {
  const locatedItems = items.filter((item) => item.status === 'located'
    && Number.isInteger(item.matchStart)
    && Number.isInteger(item.matchEnd)
    && Number(item.matchStart) >= 0
    && Number(item.matchStart) < Number(item.matchEnd)
    && Number(item.matchEnd) <= markdown.length);
  const primary = locatedItems[Math.max(0, Math.min(activeIndex, locatedItems.length - 1))];
  if (!primary || primary.status !== 'located') return markdown;
  return injectMarkdownSourceAnchor(markdown, Number(primary.matchStart), Number(primary.matchEnd));
}

export function buildOutlineSourceViewItems(
  outline: OutlineItem[],
  nodeId: string,
  records: ScoreCoverageRecord[],
  markdown: string,
  currentDocumentHash?: string,
): { items: OutlineSourceViewItem[]; supplementKind?: 'professional' | 'user'; scope: OutlineSourceRecordSet['scope'] } {
  const sourceRecords = collectOutlineSourceRecords(outline, nodeId, records);
  const items = sourceRecords.tenderRecords.map((record) => {
    const fallbackSource = () => locateOutlineSourceText(markdown, record.source_text, record.source_kind);
    const locatedSource = locateFromStoredAnchor(markdown, record, currentDocumentHash, fallbackSource);
    return {
      sourceId: record.source_id,
      kind: record.source_kind,
      status: locatedSource.status,
      sourceText: record.source_text,
      contextBefore: locatedSource.status === 'located' ? locatedSource.contextBefore : '',
      matchedText: locatedSource.status === 'located' ? locatedSource.matchedText : record.source_text,
      contextAfter: locatedSource.status === 'located' ? locatedSource.contextAfter : '',
      ...(locatedSource.status === 'located'
        ? { matchStart: locatedSource.matchStart, matchEnd: locatedSource.matchEnd }
        : {}),
      ...(locatedSource.status === 'unlocated' ? { locationReason: locatedSource.reason } : {}),
    };
  }) as OutlineSourceViewItem[];

  const supplementRecord = items.length === 0 ? sourceRecords.supplementRecords[0] : undefined;
  return {
    items,
    ...(supplementRecord
      ? { supplementKind: supplementRecord.source_kind === 'professional-supplement' ? 'professional' as const : 'user' as const }
      : {}),
    scope: sourceRecords.scope,
  };
}

function locateFromStoredAnchor(
  markdown: string,
  record: ScoreCoverageRecord,
  currentDocumentHash: string | undefined,
  fallback: () => LocatedOutlineSource,
): LocatedOutlineSource {
  const anchor = record.source_anchor;
  if (!anchor || !currentDocumentHash) return fallback();
  if (anchor.document_hash !== currentDocumentHash) {
    const current = fallback();
    return current.status === 'located'
      ? current
      : { status: 'unlocated', sourceText: record.source_text, reason: 'stale-anchor' };
  }

  const matchStart = Number(anchor.match_start);
  const matchEnd = Number(anchor.match_end);
  const contextStart = Number(anchor.context_start);
  const contextEnd = Number(anchor.context_end);
  const validRange = Number.isInteger(matchStart)
    && Number.isInteger(matchEnd)
    && Number.isInteger(contextStart)
    && Number.isInteger(contextEnd)
    && contextStart >= 0
    && contextStart <= matchStart
    && matchStart < matchEnd
    && matchEnd <= contextEnd
    && contextEnd <= markdown.length;
  const anchoredText = validRange ? markdown.slice(matchStart, matchEnd) : '';
  const normalizedAnchoredText = anchor.match_method === 'table-cell' || anchor.match_method === 'html-visible-text'
    ? normalizeProjectedHtmlText(anchoredText).text
    : normalizeWhitespace(anchoredText).text;
  if (!validRange || normalizedAnchoredText !== normalizeWhitespace(record.source_text).text) {
    const current = fallback();
    return current.status === 'located'
      ? current
      : { status: 'unlocated', sourceText: record.source_text, reason: 'stale-anchor' };
  }

  return {
    status: 'located',
    sourceText: record.source_text,
    matchStart,
    matchEnd,
    contextStart,
    contextEnd,
    contextBefore: markdown.slice(contextStart, matchStart),
    matchedText: anchoredText,
    contextAfter: markdown.slice(matchEnd, contextEnd),
  };
}

function collectRecordsForNodeIds(records: ScoreCoverageRecord[], nodeIds: Set<string>) {
  const sourceIds = new Set<string>();
  return records.filter((record) => {
    if (!isEligibleRecord(record) || !record.node_ids.some((id) => nodeIds.has(id))) {
      return false;
    }
    if (sourceIds.has(record.source_id)) {
      return false;
    }
    sourceIds.add(record.source_id);
    return true;
  });
}

function isEligibleRecord(record: ScoreCoverageRecord) {
  return record.node_ids.length > 0
    && record.coverage_location !== 'none'
    && record.user_override !== 'removed'
    && (TENDER_SOURCE_KINDS.has(record.source_kind) || SUPPLEMENT_SOURCE_KINDS.has(record.source_kind));
}

function findDescendantIds(outline: OutlineItem[], nodeId: string) {
  const node = findOutlineNode(outline, nodeId);
  if (!node?.children?.length) {
    return new Set<string>();
  }

  const descendantIds = new Set<string>();
  const collectChildren = (items: OutlineItem[]) => {
    for (const item of items) {
      descendantIds.add(item.id);
      if (item.children?.length) {
        collectChildren(item.children);
      }
    }
  };
  collectChildren(node.children);
  return descendantIds;
}

function findOutlineNode(items: OutlineItem[], nodeId: string): OutlineItem | undefined {
  for (const item of items) {
    if (item.id === nodeId) {
      return item;
    }
    const child = item.children ? findOutlineNode(item.children, nodeId) : undefined;
    if (child) {
      return child;
    }
  }
  return undefined;
}

function toRecordSet(records: ScoreCoverageRecord[], scope: OutlineSourceRecordSet['scope']): OutlineSourceRecordSet {
  return {
    tenderRecords: records.filter((record) => TENDER_SOURCE_KINDS.has(record.source_kind)),
    supplementRecords: records.filter((record) => SUPPLEMENT_SOURCE_KINDS.has(record.source_kind)),
    scope,
  };
}

function emptyRecordSet(): OutlineSourceRecordSet {
  return { tenderRecords: [], supplementRecords: [], scope: 'none' };
}

function normalizeWhitespace(text: string): NormalizedText {
  const characters: string[] = [];
  const originalIndices: number[] = [];
  let inWhitespace = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) {
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

function createOutlineSourceLocator(markdown: string, sourceKind?: ScoreCoverageRecord['source_kind']) {
  let normalizedMarkdown: NormalizedText | undefined;
  let paragraphs: ParagraphRange[] | undefined;
  const getNormalizedMarkdown = () => {
    if (!normalizedMarkdown) {
      normalizedMarkdown = normalizeWhitespace(markdown);
    }
    return normalizedMarkdown;
  };
  const getParagraphs = () => {
    if (!paragraphs) {
      paragraphs = findParagraphs(markdown);
    }
    return paragraphs;
  };

  return (sourceText: string): LocatedOutlineSource => {
    if (!sourceText) {
      return { status: 'unlocated', sourceText, reason: 'not-found' };
    }

    if (sourceKind === 'requirement') {
      const tableResult = locateUniqueTableCellSourceText(markdown, sourceText);
      if (tableResult.status === 'located' || tableResult.reason === 'ambiguous') return tableResult;
    }

    const exactStarts = findOccurrences(markdown, sourceText);
    if (exactStarts.length === 1) {
      const exactStart = exactStarts[0];
      return createLocatedSource(markdown, sourceText, exactStart, exactStart + sourceText.length, getParagraphs());
    }
    if (exactStarts.length > 1) {
      return { status: 'unlocated', sourceText, reason: 'ambiguous' };
    }

    const candidates = [sourceText, normalizeSourceWrapper(sourceText)]
      .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
    for (const candidate of candidates) {
      const normalizedSource = normalizeWhitespace(candidate).text;
      if (!normalizedSource) continue;
      const normalizedStarts = findOccurrences(getNormalizedMarkdown().text, normalizedSource);
      if (normalizedStarts.length > 1) {
        return { status: 'unlocated', sourceText, reason: 'ambiguous' };
      }
      if (normalizedStarts.length !== 1) continue;

      const normalizedStart = normalizedStarts[0];
      const normalizedEnd = normalizedStart + normalizedSource.length;
      const normalized = getNormalizedMarkdown();
      const matchStart = normalized.originalIndices[normalizedStart];
      const matchEnd = normalized.originalIndices[normalizedEnd - 1] + 1;
      return createLocatedSource(markdown, sourceText, matchStart, matchEnd, getParagraphs());
    }
    const visibleResult = locateUniqueVisibleText(markdown, sourceText, candidates);
    if (visibleResult.status === 'located' || visibleResult.reason === 'ambiguous') return visibleResult;
    return { status: 'unlocated', sourceText, reason: 'not-found' };
  };
}

const SOURCE_ID_PREFIX_RE = /^[A-Za-z]+\d+(?:-[A-Za-z]+\d+)*[：:]\s*/u;
const TRAILING_SOURCE_PUNCTUATION_RE = /[。．.!！?？；;，,、:：]+$/u;

function normalizeSourceWrapper(sourceText: string) {
  return String(sourceText || '')
    .replace(SOURCE_ID_PREFIX_RE, '')
    .replace(TRAILING_SOURCE_PUNCTUATION_RE, '')
    .trim();
}

function locateUniqueTableCellSourceText(markdown: string, sourceText: string): LocatedOutlineSource {
  const candidates = [sourceText, normalizeSourceWrapper(sourceText)]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const normalizedSources = [...new Set(candidates.map((candidate) => normalizeWhitespace(candidate).text).filter(Boolean))];
  if (!normalizedSources.length) return { status: 'unlocated', sourceText, reason: 'not-found' };

  const matches: Array<{ matchStart: number; matchEnd: number }> = [];
  const cellPattern = /<td\b[^>]*>[\s\S]*?<\/td>/giu;
  let cellMatch: RegExpExecArray | null;
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

  if (matches.length > 1) return { status: 'unlocated', sourceText, reason: 'ambiguous' };
  if (matches.length === 1) return createLocatedSource(markdown, sourceText, matches[0].matchStart, matches[0].matchEnd, findParagraphs(markdown));
  return { status: 'unlocated', sourceText, reason: 'not-found' };
}

function locateUniqueVisibleText(markdown: string, sourceText: string, candidates: string[]): LocatedOutlineSource {
  const projection = normalizeProjectedHtmlText(markdown);
  for (const candidate of candidates) {
    const normalizedSource = normalizeWhitespace(candidate).text;
    const starts = findOccurrences(projection.text, normalizedSource);
    if (starts.length > 1) return { status: 'unlocated', sourceText, reason: 'ambiguous' };
    if (starts.length !== 1) continue;
    const matchStart = starts[0];
    const matchEnd = matchStart + normalizedSource.length;
    return createLocatedSource(
      markdown,
      sourceText,
      projection.originalIndices[matchStart],
      projection.originalIndices[matchEnd - 1] + 1,
      findParagraphs(markdown),
    );
  }
  return { status: 'unlocated', sourceText, reason: 'not-found' };
}

function normalizeProjectedHtmlText(markdown: string): NormalizedText {
  const characters: string[] = [];
  const originalIndices: number[] = [];
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

function isScoreSuffix(value: string) {
  return /^(?:（(?:客观分|主观分)）|\((?:客观分|主观分)\))$/u.test(value);
}

function findOccurrences(text: string, search: string) {
  if (!search) return [];
  const positions: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= text.length - search.length) {
    const index = text.indexOf(search, fromIndex);
    if (index < 0) break;
    positions.push(index);
    fromIndex = index + 1;
  }
  return positions;
}

function createLocatedSource(
  markdown: string,
  sourceText: string,
  matchStart: number,
  matchEnd: number,
  paragraphs: ParagraphRange[],
): LocatedOutlineSource {
  const firstParagraphIndex = findParagraphIndex(paragraphs, matchStart, 'after');
  const lastParagraphIndex = findParagraphIndex(paragraphs, Math.max(matchStart, matchEnd - 1), 'before');
  const adjacentContextStart = Math.max(
    paragraphs[Math.max(0, firstParagraphIndex - 1)]?.start ?? 0,
    matchStart - 600,
  );
  const adjacentContextEnd = Math.min(
    paragraphs[Math.min(paragraphs.length - 1, lastParagraphIndex + 1)]?.end ?? markdown.length,
    matchEnd + 600,
  );
  const contextStart = Math.min(adjacentContextStart, matchStart);
  const contextEnd = Math.max(adjacentContextEnd, matchEnd);

  return {
    status: 'located',
    sourceText,
    matchStart,
    matchEnd,
    contextStart,
    contextEnd,
    contextBefore: markdown.slice(contextStart, matchStart),
    matchedText: markdown.slice(matchStart, matchEnd),
    contextAfter: markdown.slice(matchEnd, contextEnd),
  };
}

function findParagraphs(markdown: string): ParagraphRange[] {
  const paragraphs: ParagraphRange[] = [];
  const separator = /\r?\n[\t ]*\r?\n/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(markdown)) !== null) {
    if (start < match.index && markdown.slice(start, match.index).trim()) {
      paragraphs.push({ start, end: match.index });
    }
    start = match.index + match[0].length;
  }
  if (start < markdown.length && markdown.slice(start).trim()) {
    paragraphs.push({ start, end: markdown.length });
  }
  return paragraphs.length > 0 ? paragraphs : [{ start: 0, end: markdown.length }];
}

function findParagraphIndex(
  paragraphs: ParagraphRange[],
  position: number,
  boundaryDirection: 'before' | 'after',
) {
  const index = paragraphs.findIndex((paragraph) => position >= paragraph.start && position < paragraph.end);
  if (index >= 0) {
    return index;
  }

  if (boundaryDirection === 'before') {
    for (let paragraphIndex = paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex -= 1) {
      if (paragraphs[paragraphIndex].end <= position) {
        return paragraphIndex;
      }
    }
    return 0;
  }

  const nextParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.start > position);
  return nextParagraphIndex >= 0 ? nextParagraphIndex : paragraphs.length - 1;
}
