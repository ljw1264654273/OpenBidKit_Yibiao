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

  const cells = line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(stripInlineMarkers);
  if (isMarkdownSeparator(cells)) return null;
  if (!cells.some(Boolean)) return null;
  return cells.join(' | ');
}

function htmlToText(content) {
  const $ = cheerio.load(String(content || ''), null, false);

  $('table').each((_, table) => {
    const tableLines = [];
    $(table).find('tr').each((__, row) => {
      const cells = $(row).children('th, td').map((___, cell) => tableCellText($, cell)).get();
      if (cells.some(Boolean)) tableLines.push(cells.join(' | '));
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
};
