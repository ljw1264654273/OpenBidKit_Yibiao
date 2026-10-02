export interface ContentTextRange {
  start: number;
  end: number;
}

type Change = { kind: 'equal' | 'remove' | 'add'; text: string };

// Myers 对比的搜索量有上限，整章重写时直接标记剩余变化区域。
// 先比较行，再比较变化行里的字符，长章节局改不会建立全文平方矩阵。
function compareTokens(before: string[], after: string[]): Change[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const left = before.slice(prefix, before.length - suffix);
  const right = after.slice(prefix, after.length - suffix);
  const leading: Change[] = prefix ? [{ kind: 'equal', text: before.slice(0, prefix).join('') }] : [];
  const trailing: Change[] = suffix ? [{ kind: 'equal', text: before.slice(before.length - suffix).join('') }] : [];
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let steps = 0;
  for (let distance = 0; distance <= left.length + right.length; distance++) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (++steps > 250000) {
        return [...leading, { kind: 'remove', text: left.join('') }, { kind: 'add', text: right.join('') }, ...trailing];
      }
      let x = diagonal === -distance || (diagonal !== distance
        && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) || 0 : (frontier.get(diagonal - 1) || 0) + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) { x++; y++; }
      frontier.set(diagonal, x);
      if (x < left.length || y < right.length) continue;

      const changes: Change[] = [];
      for (let depth = distance; depth >= 0; depth--) {
        const previous = trace[depth];
        const k = x - y;
        const previousK = k === -depth || (k !== depth
          && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) || 0;
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
          changes.push({ kind: 'equal', text: left[--x] }); y--;
        }
        if (!depth) break;
        if (x === previousX) changes.push({ kind: 'add', text: right[--y] });
        else changes.push({ kind: 'remove', text: left[--x] });
      }
      return [...leading, ...changes.reverse(), ...trailing];
    }
  }
  return [...leading, ...trailing];
}

function appendRange(ranges: ContentTextRange[], start: number, end: number) {
  if (start === end) return;
  const last = ranges[ranges.length - 1];
  if (last?.end === start) last.end = end;
  else ranges.push({ start, end });
}

export function compareContentText(before: string, after: string) {
  const result: { before: ContentTextRange[]; after: ContentTextRange[] } = { before: [], after: [] };
  if (before === after) return result;
  const lines = (value: string) => value.match(/[^\n]*\n|[^\n]+$/g) || [];
  const changes = compareTokens(lines(before), lines(after));
  let beforeOffset = 0;
  let afterOffset = 0;
  for (let index = 0; index < changes.length;) {
    const change = changes[index];
    if (change.kind === 'equal') {
      beforeOffset += change.text.length;
      afterOffset += change.text.length;
      index++;
      continue;
    }
    let removed = '';
    let added = '';
    while (index < changes.length && changes[index].kind !== 'equal') {
      const part = changes[index++];
      if (part.kind === 'remove') removed += part.text;
      else added += part.text;
    }
    for (const part of compareTokens(Array.from(removed), Array.from(added))) {
      if (part.kind === 'remove') {
        appendRange(result.before, beforeOffset, beforeOffset + part.text.length);
        beforeOffset += part.text.length;
      } else if (part.kind === 'add') {
        appendRange(result.after, afterOffset, afterOffset + part.text.length);
        afterOffset += part.text.length;
      } else {
        beforeOffset += part.text.length;
        afterOffset += part.text.length;
      }
    }
  }
  return result;
}

// Diff rendered text coordinates, never Markdown markup: tables, images and code remain intact.
export function compareRenderedContent(before: string | undefined, after: string, renderedText: (markdown: string) => string) {
  if (before === undefined || before === after) return { before: [], after: [] };
  return compareContentText(renderedText(before), renderedText(after));
}
