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

export function locateOutlineSourceText(markdown: string, sourceText: string): LocatedOutlineSource {
  return createOutlineSourceLocator(markdown)(sourceText);
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

export function injectOutlineSourceAnchorMarkers(markdown: string, items: OutlineSourceViewItem[]) {
  const primary = items.find((item) => item.status === 'located'
    && Number.isInteger(item.matchStart)
    && Number.isInteger(item.matchEnd)
    && Number(item.matchStart) >= 0
    && Number(item.matchStart) < Number(item.matchEnd)
    && Number(item.matchEnd) <= markdown.length);
  if (!primary) return markdown;
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
  const locateSourceText = createOutlineSourceLocator(markdown);
  const items = sourceRecords.tenderRecords.map((record) => {
    const fallbackSource = () => locateSourceText(record.source_text);
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
  if (!validRange || normalizeWhitespace(anchoredText).text !== normalizeWhitespace(record.source_text).text) {
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

function createOutlineSourceLocator(markdown: string) {
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

    const exactStarts = findOccurrences(markdown, sourceText);
    if (exactStarts.length === 1) {
      const exactStart = exactStarts[0];
      return createLocatedSource(markdown, sourceText, exactStart, exactStart + sourceText.length, getParagraphs());
    }
    if (exactStarts.length > 1) {
      return { status: 'unlocated', sourceText, reason: 'ambiguous' };
    }

    const normalizedSource = normalizeWhitespace(sourceText).text;
    if (!normalizedSource) {
      return { status: 'unlocated', sourceText, reason: 'not-found' };
    }
    const normalizedStarts = findOccurrences(getNormalizedMarkdown().text, normalizedSource);
    if (normalizedStarts.length !== 1) {
      return {
        status: 'unlocated',
        sourceText,
        reason: normalizedStarts.length > 1 ? 'ambiguous' : 'not-found',
      };
    }

    const normalizedStart = normalizedStarts[0];
    const normalizedEnd = normalizedStart + normalizedSource.length;
    const normalized = getNormalizedMarkdown();
    const matchStart = normalized.originalIndices[normalizedStart];
    const matchEnd = normalized.originalIndices[normalizedEnd - 1] + 1;
    return createLocatedSource(markdown, sourceText, matchStart, matchEnd, getParagraphs());
  };
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
