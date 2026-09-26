export type MarkdownEditorSurface = 'inline' | 'fullscreen';

export interface MarkdownEditorSelection {
  start: number;
  end: number;
  selectedText: string;
  surface: MarkdownEditorSurface;
  scrollTop: number;
}

export interface ContentAiEditSnapshot {
  nodeId: string;
  content: string;
  selectionStart: number;
  selectionEnd: number;
  selectedText: string;
  surface: MarkdownEditorSurface;
  createdAt: string;
}

interface ProtectedRange {
  start: number;
  end: number;
}

const INLINE_IMAGE_PATTERN = /<!-- yibiao-inline-image:start\b[^>]*-->[\s\S]*?<!-- yibiao-inline-image:end -->/gi;

function clampOffset(value: number, contentLength: number) {
  return Math.max(0, Math.min(contentLength, Math.floor(Number(value) || 0)));
}

function normalizeRange(startValue: number, endValue: number, contentLength: number) {
  const start = clampOffset(Math.min(startValue, endValue), contentLength);
  const end = clampOffset(Math.max(startValue, endValue), contentLength);
  return { start, end };
}

function joinInsertion(before: string, insertionValue: string, after: string) {
  const insertion = String(insertionValue || '').trim();
  if (!insertion) return { content: `${before}${after}`, insertionStart: before.length, insertionEnd: before.length };

  const beforeTrimmed = before.replace(/\s+$/, '');
  const afterTrimmed = after.replace(/^\s+/, '');
  const prefix = beforeTrimmed ? `${beforeTrimmed}\n\n` : '';
  const suffix = afterTrimmed ? `\n\n${afterTrimmed}` : '';
  return {
    content: `${prefix}${insertion}${suffix}`,
    insertionStart: prefix.length,
    insertionEnd: prefix.length + insertion.length,
  };
}

export function createContentAiEditSnapshot({
  nodeId,
  content,
  selectionStart,
  selectionEnd,
  surface,
}: {
  nodeId: string;
  content: string;
  selectionStart: number;
  selectionEnd: number;
  surface: MarkdownEditorSurface;
}): ContentAiEditSnapshot {
  const source = String(content || '');
  const range = normalizeRange(selectionStart, selectionEnd, source.length);
  return {
    nodeId: String(nodeId || ''),
    content: source,
    selectionStart: range.start,
    selectionEnd: range.end,
    selectedText: source.slice(range.start, range.end),
    surface,
    createdAt: new Date().toISOString(),
  };
}

export function validateContentAiEditSnapshot({
  currentNodeId,
  currentContent,
  snapshot,
}: {
  currentNodeId: string;
  currentContent: string;
  snapshot: ContentAiEditSnapshot;
}): { valid: true } | { valid: false; message: string } {
  const content = String(currentContent || '');
  if (String(currentNodeId || '') !== snapshot.nodeId || content !== snapshot.content) {
    return { valid: false, message: '正文已发生变化，请重新选择位置并生成' };
  }
  if (snapshot.selectionStart < 0 || snapshot.selectionEnd < snapshot.selectionStart || snapshot.selectionEnd > content.length) {
    return { valid: false, message: '正文已发生变化，请重新选择位置并生成' };
  }
  if (content.slice(snapshot.selectionStart, snapshot.selectionEnd) !== snapshot.selectedText) {
    return { valid: false, message: '正文已发生变化，请重新选择位置并生成' };
  }
  return { valid: true };
}

export function applyContentAiTextCandidate({
  currentNodeId,
  currentContent,
  snapshot,
  mode,
  candidateText,
}: {
  currentNodeId: string;
  currentContent: string;
  snapshot: ContentAiEditSnapshot;
  mode: 'rewrite' | 'continue';
  candidateText: string;
}) {
  const validation = validateContentAiEditSnapshot({ currentNodeId, currentContent, snapshot });
  if (!validation.valid) throw new Error(validation.message);

  if (mode === 'rewrite') {
    const replacement = String(candidateText || '');
    const content = currentContent.slice(0, snapshot.selectionStart)
      + replacement
      + currentContent.slice(snapshot.selectionEnd);
    return {
      content,
      selection: {
        start: snapshot.selectionStart,
        end: snapshot.selectionStart + replacement.length,
      },
    };
  }

  const before = currentContent.slice(0, snapshot.selectionStart);
  const after = currentContent.slice(snapshot.selectionStart);
  const joined = joinInsertion(before, candidateText, after);
  return {
    content: joined.content,
    selection: {
      start: joined.insertionEnd,
      end: joined.insertionEnd,
    },
  };
}

export function insertInlineImageBlock({
  content,
  insertionOffset,
  markdown,
}: {
  content: string;
  insertionOffset: number;
  markdown: string;
}) {
  const source = String(content || '');
  const offset = clampOffset(insertionOffset, source.length);
  const joined = joinInsertion(source.slice(0, offset), markdown, source.slice(offset));
  return {
    content: joined.content,
    selection: {
      start: joined.insertionEnd,
      end: joined.insertionEnd,
    },
  };
}

export function findProtectedInlineImageRanges(content: string): ProtectedRange[] {
  const source = String(content || '');
  INLINE_IMAGE_PATTERN.lastIndex = 0;
  const ranges: ProtectedRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = INLINE_IMAGE_PATTERN.exec(source))) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

export function selectionIntersectsProtectedRange(
  selection: Pick<ProtectedRange, 'start' | 'end'>,
  ranges: ProtectedRange[],
) {
  return ranges.some((range) => selection.start < range.end && selection.end > range.start);
}

