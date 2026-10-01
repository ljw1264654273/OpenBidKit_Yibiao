export interface MarkdownTextHighlight {
  start: number;
  end: number;
  className: string;
}

// 范围基于渲染后的 root.textContent，跨粗体、链接、表格单元格也保持位置一致。
export function highlightTextRanges(root: Element, ranges: MarkdownTextHighlight[]) {
  if (!ranges.length) return;
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) { nodes.push(current as Text); current = walker.nextNode(); }
  let offset = 0;
  let rangeIndex = 0;
  for (const node of nodes) {
    const value = node.data;
    const end = offset + value.length;
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= offset) rangeIndex++;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (let index = rangeIndex; index < ranges.length && ranges[index].start < end; index++) {
      const range = ranges[index];
      const startInNode = Math.max(0, range.start - offset);
      const endInNode = Math.min(value.length, range.end - offset);
      if (startInNode > cursor) fragment.appendChild(document.createTextNode(value.slice(cursor, startInNode)));
      const mark = document.createElement('mark');
      mark.className = range.className;
      mark.textContent = value.slice(startInNode, endInNode);
      fragment.appendChild(mark);
      cursor = endInNode;
    }
    if (cursor) {
      if (cursor < value.length) fragment.appendChild(document.createTextNode(value.slice(cursor)));
      node.replaceWith(fragment);
    }
    offset = end;
  }
}
