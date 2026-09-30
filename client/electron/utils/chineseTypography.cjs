const CHINESE_BOUNDARY_CHAR = /[\p{Script=Han}，。；：！？、）》】”’]/u;
const CHINESE_START_CHAR = /[\p{Script=Han}“‘（《【]/u;
const CLOSING_PUNCTUATION = /[，。；：！？、）》】”’]/u;
const INLINE_PROTECTED_PATTERN = /!?\[[^\]\n]*\]\([^\)\n]*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|!?\[[^\]\n]+\]|<[^>\n]+>/gu;

function parseOpeningFence(line) {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { marker: match[1][0], length: match[1].length };
}

function isClosingFence(line, fence) {
  const marker = fence.marker === '`' ? '`' : '~';
  const match = new RegExp(`^ {0,3}(${marker}{${fence.length},})[ \\t]*$`).exec(line);
  return Boolean(match);
}

function isGfmTableDelimiter(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function collectTableLineIndexes(lines) {
  const indexes = new Set();
  for (let index = 1; index < lines.length; index += 1) {
    if (!isGfmTableDelimiter(lines[index]) || !lines[index - 1].includes('|')) continue;
    indexes.add(index - 1);
    indexes.add(index);
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      if (!lines[rowIndex].trim() || !lines[rowIndex].includes('|')) break;
      indexes.add(rowIndex);
    }
  }
  return indexes;
}

function isIndentedCodeLine(line) {
  const match = /^( {4,}|\t+)(.*)$/.exec(line);
  if (!match) return false;
  return !/^(?:\d+\.\s+|[-+*]\s+|>\s*|#{1,6}\s+)/.test(match[2]);
}

function isProtectedBlockLine(line) {
  return isIndentedCodeLine(line)
    || /^\s*\[[^\]\n]+\]:/.test(line)
    || /^\s*\|.*\|\s*$/.test(line)
    || /!\[[^\]]*\]\([^)]*\)/.test(line)
    || /^\s*<\/?(?:table|thead|tbody|tfoot|tr|th|td|div|section|article|pre|code|ul|ol|li|blockquote)\b/i.test(line);
}

function isStructuralLine(line) {
  return /^\s*(?:\d+\.\s+|[-+*]\s+|>\s*|#{1,6}\s+)/.test(line)
    || /^\s*(?:(?:\d+\.\s+)?(?:\*\*|__).+(?:\*\*|__))\s*$/.test(line);
}

function protectInlineSyntax(value) {
  const tokens = [];
  const protect = (match) => {
    const token = `\uE000${tokens.length}\uE001`;
    tokens.push(match);
    return token;
  };
  let text = '';
  let cursor = 0;
  while (cursor < value.length) {
    if (value[cursor] !== '`') {
      text += value[cursor];
      cursor += 1;
      continue;
    }

    let openingEnd = cursor + 1;
    while (value[openingEnd] === '`') openingEnd += 1;
    const openingLength = openingEnd - cursor;
    let closingStart = openingEnd;
    let closingEnd = -1;
    while (closingStart < value.length) {
      if (value[closingStart] !== '`') {
        closingStart += 1;
        continue;
      }
      let runEnd = closingStart + 1;
      while (value[runEnd] === '`') runEnd += 1;
      if (runEnd - closingStart === openingLength) {
        closingEnd = runEnd;
        break;
      }
      closingStart = runEnd;
    }

    if (closingEnd < 0) {
      text += value.slice(cursor, openingEnd);
      cursor = openingEnd;
      continue;
    }
    text += protect(value.slice(cursor, closingEnd));
    cursor = closingEnd;
  }
  text = text.replace(INLINE_PROTECTED_PATTERN, protect);
  return {
    text,
    restore: (nextValue) => nextValue.replace(/\uE000(\d+)\uE001/gu, (_, index) => tokens[Number(index)] || ''),
  };
}

function normalizeChineseLine(line) {
  const leading = line.match(/^[ \t]*/u)?.[0] || '';
  const source = line.slice(leading.length);
  const hardBreakMatch = source.match(/ {2,}$/u);
  const hardBreak = hardBreakMatch ? '  ' : '';
  let body = hardBreakMatch ? source.slice(0, -hardBreakMatch[0].length) : source;
  body = body.replace(
    /^((?:(?:>\s*)*)(?:(?:\d+\.\s+|[-+*]\s+))?(?:\*\*|__).*?(?:\*\*|__))[ \t\u00A0\u3000]+(?=[\p{Script=Han}“‘（《【])/u,
    '$1',
  );
  const protectedInline = protectInlineSyntax(body);
  let normalized = protectedInline.text.replace(/\u3000/gu, ' ');

  normalized = normalized
    .replace(/[ \t\u00A0]+(?=[，。；：！？、）》】”’])/gu, '')
    .replace(/(?<=[“‘（《【])[ \t\u00A0]+/gu, '')
    .replace(/([\p{Script=Han}，。；：！？、）》】”’])[ \t\u00A0]+(?=[\p{Script=Han}“‘（《【])/gu, '$1')
    .replace(/[ \t\u00A0]{2,}/gu, ' ')
    .replace(/[ \t\u00A0]+$/u, '');

  return `${leading}${protectedInline.restore(normalized)}${hardBreak}`;
}

function firstVisibleCharacter(line) {
  const value = String(line || '').trimStart();
  return value[0] || '';
}

function lastVisibleCharacter(line) {
  const value = String(line || '').trimEnd();
  return value[value.length - 1] || '';
}

function shouldJoinSoftBreak(previous, current) {
  if (!previous || !current || previous.protected || current.protected) return false;
  if (!previous.text || !current.text || / {2}$/.test(previous.text)) return false;
  if (isStructuralLine(previous.text) || isStructuralLine(current.text)) return false;

  const previousChar = lastVisibleCharacter(previous.text);
  const currentChar = firstVisibleCharacter(current.text);
  return CHINESE_BOUNDARY_CHAR.test(previousChar)
    && (CHINESE_START_CHAR.test(currentChar) || CLOSING_PUNCTUATION.test(currentChar));
}

function moveParagraphLeadingPunctuation(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    const current = entries[index];
    if (current.protected || String(entries[index - 1].text || '').trim()) continue;

    const match = /^\s*([，。；：！？、）》】”’]+)\s*(.+)$/u.exec(current.text);
    if (!match) continue;

    let previousIndex = index - 1;
    while (previousIndex >= 0 && !String(entries[previousIndex].text || '').trim()) {
      previousIndex -= 1;
    }
    if (previousIndex < 0 || entries[previousIndex].protected) continue;

    const hardBreakMatch = entries[previousIndex].text.match(/ {2}$/u);
    const hardBreak = hardBreakMatch ? hardBreakMatch[0] : '';
    const previousText = hardBreakMatch
      ? entries[previousIndex].text.slice(0, -hardBreakMatch[0].length)
      : entries[previousIndex].text;
    entries[previousIndex].text = `${previousText}${match[1]}${hardBreak}`;
    current.text = match[2];
  }
}

function normalizeChineseMarkdownTypography(content) {
  const lines = String(content || '').replace(/\r\n?/gu, '\n').split('\n');
  const tableLineIndexes = collectTableLineIndexes(lines);
  let fence = null;
  const entries = lines.map((line, index) => {
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      return { text: line, protected: true };
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence) {
      fence = openingFence;
      return { text: line, protected: true };
    }
    if (tableLineIndexes.has(index) || isProtectedBlockLine(line)) {
      return { text: line, protected: true };
    }
    return { text: normalizeChineseLine(line), protected: false };
  });
  moveParagraphLeadingPunctuation(entries);

  if (!entries.length) return '';
  let normalized = entries[0].text;
  for (let index = 1; index < entries.length; index += 1) {
    normalized += shouldJoinSoftBreak(entries[index - 1], entries[index])
      ? entries[index].text
      : `\n${entries[index].text}`;
  }
  return normalized;
}

module.exports = {
  normalizeChineseMarkdownTypography,
};
