export function normalizeOrderedListMarkers(content: string): string {
  const lines = String(content || '').split(/\r?\n/);
  let inFence = false;
  const listStack: Array<{ indent: number; sequence: number }> = [];

  return lines.map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const match = /^([ \t]*)\d+\.\s+(.*)$/.exec(line);
    if (!match) return line;

    const indent = match[1];
    const indentKey = indent.replace(/\t/g, '    ').length;
    while (listStack.length && listStack[listStack.length - 1].indent > indentKey) {
      listStack.pop();
    }

    let currentList = listStack[listStack.length - 1];
    if (!currentList || currentList.indent !== indentKey) {
      currentList = { indent: indentKey, sequence: 0 };
      listStack.push(currentList);
    }

    currentList.sequence += 1;
    return `${indent}${currentList.sequence}. ${match[2]}`;
  }).join('\n');
}
