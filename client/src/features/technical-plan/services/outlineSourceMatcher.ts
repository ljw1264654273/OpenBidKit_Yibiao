import type { OutlineItem } from '../../../shared/types';
import type { ScoreCoverageRecord } from '../types';

export interface OutlineSourceRecordSet {
  tenderRecords: ScoreCoverageRecord[];
  supplementRecords: ScoreCoverageRecord[];
  scope: 'direct' | 'descendants' | 'none';
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
  | { status: 'unlocated'; sourceText: string };

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
  if (!sourceText) {
    return { status: 'unlocated', sourceText };
  }

  const exactStart = markdown.indexOf(sourceText);
  if (exactStart >= 0) {
    return createLocatedSource(markdown, sourceText, exactStart, exactStart + sourceText.length);
  }

  const normalizedMarkdown = normalizeWhitespace(markdown);
  const normalizedSource = normalizeWhitespace(sourceText).text;
  const normalizedStart = normalizedMarkdown.text.indexOf(normalizedSource);
  if (normalizedStart < 0 || !normalizedSource) {
    return { status: 'unlocated', sourceText };
  }

  const normalizedEnd = normalizedStart + normalizedSource.length;
  const matchStart = normalizedMarkdown.originalIndices[normalizedStart];
  const matchEnd = normalizedMarkdown.originalIndices[normalizedEnd - 1] + 1;
  return createLocatedSource(markdown, sourceText, matchStart, matchEnd);
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

function createLocatedSource(
  markdown: string,
  sourceText: string,
  matchStart: number,
  matchEnd: number,
): LocatedOutlineSource {
  const paragraphs = findParagraphs(markdown);
  const firstParagraphIndex = findParagraphIndex(paragraphs, matchStart, 'after');
  const lastParagraphIndex = findParagraphIndex(paragraphs, Math.max(matchStart, matchEnd - 1), 'before');
  const contextStart = Math.max(
    paragraphs[Math.max(0, firstParagraphIndex - 1)]?.start ?? 0,
    matchStart - 600,
  );
  const contextEnd = Math.min(
    paragraphs[Math.min(paragraphs.length - 1, lastParagraphIndex + 1)]?.end ?? markdown.length,
    matchEnd + 600,
  );

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
    if (start < match.index) {
      paragraphs.push({ start, end: match.index });
    }
    start = match.index + match[0].length;
  }
  if (start < markdown.length) {
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
