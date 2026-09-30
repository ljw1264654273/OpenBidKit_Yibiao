const cheerio = require('cheerio');

const blockTags = [
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dt', 'dd', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'ul',
];

function normalizeVisibleText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .trim();
}

function stripInlineMarkers(value) {
  return normalizeVisibleText(value)
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*>+\s*/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)]|[一二三四五六七八九十]+[、.)])\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~|`+)(.*?)\1/g, '$2')
    .replace(/[*_~`]/g, '')
    .trim();
}

function isMarkdownSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function splitMarkdownTableCells(value) {
  const source = String(value || '');
  const cells = [];
  let cell = '';
  let codeFenceLength = 0;
  let delimiterCount = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && source[index + 1] === '|') {
      cell += '|';
      index += 1;
      continue;
    }
    if (character === '`') {
      let runLength = 1;
      while (source[index + runLength] === '`') runLength += 1;
      if (codeFenceLength === 0) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      cell += source.slice(index, index + runLength);
      index += runLength - 1;
      continue;
    }
    if (character === '|' && codeFenceLength === 0) {
      cells.push(cell);
      cell = '';
      delimiterCount += 1;
      continue;
    }
    cell += character;
  }
  cells.push(cell);

  if (delimiterCount === 0) return [source];
  if (!cells[0].trim()) cells.shift();
  if (!cells.at(-1)?.trim()) cells.pop();
  return cells;
}

function serializePipeTableCells(cells) {
  return (cells || [])
    .map((cell) => String(cell || '').replace(/\|/g, '\\|'))
    .join(' | ');
}

function protectMarkdownTableBreaks(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => (
      splitMarkdownTableCells(line).length > 1
        ? line.replace(/<br\s*\/?\s*>/gi, ' ')
        : line
    ))
    .join('\n');
}

function tableCellText($, cell) {
  const clone = $(cell).clone();
  clone.find('br').replaceWith(' ');
  clone.find(blockTags.join(',')).each((_, element) => {
    $(element).after(' ');
  });
  return normalizeVisibleText(clone.text().replace(/\s+/g, ' '));
}

function parseLine(value) {
  const line = normalizeVisibleText(value);
  if (!line || /^\s*```/.test(line)) return null;
  if (!line.includes('|')) return stripInlineMarkers(line) || null;

  const cells = splitMarkdownTableCells(line).map(stripInlineMarkers);
  if (isMarkdownSeparator(cells)) return null;
  if (!cells.some(Boolean)) return null;
  return serializePipeTableCells(cells);
}

function htmlToText(content) {
  const $ = cheerio.load(protectMarkdownTableBreaks(content), null, false);

  $('table').each((_, table) => {
    const tableLines = [];
    $(table).find('tr').each((__, row) => {
      const cells = $(row).children('th, td').map((___, cell) => tableCellText($, cell)).get();
      if (cells.some(Boolean)) tableLines.push(serializePipeTableCells(cells));
    });
    $(table).replaceWith(`\n${tableLines.join('\n')}\n`);
  });
  $('br').replaceWith('\n');
  $(blockTags.join(',')).each((_, element) => {
    $(element).after('\n');
  });

  return $.root().text();
}

function toDocumentLines(content) {
  return htmlToText(content)
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean);
}

module.exports = {
  toDocumentLines,
  parsePipeTableRow: splitMarkdownTableCells,
  serializePipeTableCells,
};
