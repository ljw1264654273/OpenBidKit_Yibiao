const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { buildDocxBuffer } = require('./exportService.cjs');

function readDocxXml(buffer, entryName) {
  const entry = new AdmZip(buffer).getEntry(entryName);
  assert.ok(entry, `DOCX should contain ${entryName}`);
  return entry.getData().toString('utf8');
}

function paragraphsContaining(documentXml, texts) {
  const paragraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
  return texts.map((text) => {
    const paragraph = paragraphs.find((value) => value.includes(`>${text}`));
    assert.ok(paragraph, `expected a paragraph containing ${text}`);
    return paragraph;
  });
}

function numberingLevel(numberingXml, reference, level) {
  const abstractNum = numberingXml.match(new RegExp(
    `<w:abstractNum[\\s\\S]*?<w:nsid[^>]*>[\\s\\S]*?</w:abstractNum>`,
  ))?.[0] || numberingXml;
  const levels = [...abstractNum.matchAll(new RegExp(`<w:lvl w:ilvl="${level}"[^>]*>[\\s\\S]*?</w:lvl>`, 'g'))];
  assert.ok(levels.length, `expected numbering level ${level} for ${reference}`);
  return levels.at(-1)[0];
}

const bodyOutlineLevels = [
  { numbering_style: 'chinese-dot', font: '黑体', size: '三号' },
  { numbering_style: 'chinese-paren', font: '楷体', size: '三号' },
  { numbering_style: 'decimal-dot', font: '仿宋', size: '三号' },
  { numbering_style: 'decimal-full-paren', font: '仿宋', size: '三号' },
];

test('Word export preserves four body outline levels and applies per-level typography', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '正文层次测试',
    export_format: {
      body_text: {
        font: '宋体',
        size: '小四',
        alignment: '左对齐',
        spacing_before_pt: 0,
        spacing_after_pt: 0,
        first_line_indent_chars: 2,
        line_spacing_multiple: 1.2,
        list_style: 'disc',
        ordered_list_style: 'decimal-dot',
        list_indent_chars: 2,
        body_outline_levels: bodyOutlineLevels,
      },
      headings: [],
    },
    outline: [{
      id: '1',
      title: '正文层次',
      content: [
        '1. 第一层内容',
        '   1. 第二层内容',
        '      1. 第三层内容',
        '         1. 第四层内容',
      ].join('\n'),
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');
  const paragraphs = paragraphsContaining(documentXml, ['第一层内容', '第二层内容', '第三层内容', '第四层内容']);

  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ilvl w:val="(\d+)"\/>/)?.[1])),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.match(/<w:rFonts[^>]*w:eastAsia="([^"]+)"/)?.[1]),
    ['黑体', '楷体', '仿宋', '仿宋'],
  );
  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:sz w:val="(\d+)"\/>/)?.[1])),
    [32, 32, 32, 32],
  );

  assert.match(numberingLevel(numberingXml, 'body-outline', 0), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="%1、"\/>/);
  assert.match(numberingLevel(numberingXml, 'body-outline', 1), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="（%2）"\/>/);
  assert.match(numberingLevel(numberingXml, 'body-outline', 2), /<w:numFmt w:val="decimal"\/>[\s\S]*<w:lvlText w:val="%3\."\/>/);
  assert.match(numberingLevel(numberingXml, 'body-outline', 3), /<w:numFmt w:val="decimal"\/>[\s\S]*<w:lvlText w:val="（%4）"\/>/);
});

test('Word export uses the fifth-level circled-number fallback', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '第五层测试',
    export_format: {
      body_text: {
        font: '宋体',
        size: '小四',
        alignment: '左对齐',
        spacing_before_pt: 0,
        spacing_after_pt: 0,
        first_line_indent_chars: 2,
        line_spacing_multiple: 1.2,
        list_style: 'disc',
        ordered_list_style: 'decimal-dot',
        list_indent_chars: 2,
        body_outline_levels: bodyOutlineLevels,
      },
      headings: [],
    },
    outline: [{
      id: '1',
      title: '第五层',
      content: [
        '1. 第一层',
        '   1. 第二层',
        '      1. 第三层',
        '         1. 第四层',
        '            1. 第五层内容',
      ].join('\n'),
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');
  const paragraph = paragraphsContaining(documentXml, ['第五层内容']).at(-1);

  assert.equal(Number(paragraph.match(/<w:ilvl w:val="(\d+)"\/>/)?.[1]), 4);
  assert.match(numberingLevel(numberingXml, 'body-outline', 4), /<w:numFmt w:val="decimalEnclosedCircle"\/>/);
});

test('Word export keeps ordinary body paragraphs on the unified body typography', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '普通正文测试',
    export_format: {
      body_text: {
        font: '宋体',
        size: '小四',
        alignment: '左对齐',
        spacing_before_pt: 0,
        spacing_after_pt: 0,
        first_line_indent_chars: 2,
        line_spacing_multiple: 1.2,
        list_style: 'disc',
        ordered_list_style: 'decimal-dot',
        list_indent_chars: 2,
        body_outline_levels: bodyOutlineLevels,
      },
      headings: [],
    },
    outline: [{
      id: '1',
      title: '普通正文',
      content: '这是一段普通正文，不属于有序正文层次。',
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const paragraph = paragraphsContaining(documentXml, ['这是一段普通正文'])[0];

  assert.match(paragraph, /<w:rFonts[^>]*w:eastAsia="宋体"/);
  assert.match(paragraph, /<w:sz w:val="24"\/>/);
});

test('Word export keeps legacy ordered-list style when body outline levels are absent', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '旧模板兼容测试',
    export_format: {
      body_text: {
        font: '宋体',
        size: '小四',
        alignment: '左对齐',
        spacing_before_pt: 0,
        spacing_after_pt: 0,
        first_line_indent_chars: 2,
        line_spacing_multiple: 1.2,
        list_style: 'disc',
        ordered_list_style: 'chinese-paren',
        list_indent_chars: 2,
      },
      headings: [],
    },
    outline: [{
      id: '1',
      title: '旧模板',
      content: [
        '1. 第一层',
        '   1. 第二层',
        '      1. 第三层',
        '         1. 第四层内容',
      ].join('\n'),
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');
  const paragraphs = paragraphsContaining(documentXml, ['第一层', '第二层', '第三层', '第四层内容']);

  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ilvl w:val="(\d+)"\/>/)?.[1])),
    [0, 1, 2, 3],
  );
  assert.match(numberingLevel(numberingXml, 'body-outline', 0), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="（%1）"\/>/);
});
