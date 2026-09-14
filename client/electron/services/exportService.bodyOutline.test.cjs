const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { buildDocxBuffer, buildDocxResult } = require('./exportService.cjs');

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

const onePixelPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const bodyOutlineLevels = [
  { numbering_style: 'chinese-dot', font: '黑体', size: '小四', first_line_indent_chars: 0 },
  { numbering_style: 'chinese-paren', font: '楷体', size: '小四', first_line_indent_chars: 0.5 },
  { numbering_style: 'decimal-dot', font: '仿宋', size: '小四', first_line_indent_chars: 1 },
  { numbering_style: 'decimal-full-paren', font: '仿宋', size: '小四', first_line_indent_chars: 2 },
];

test('Word export calculates each body outline level indent from the body margin', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '正文层次独立缩进测试',
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
      title: '正文层次独立缩进',
      content: [
        '1. 第一层',
        '   1. 第二层',
        '      1. 第三层',
        '         1. 第四层',
      ].join('\n'),
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const numberingXml = readDocxXml(buffer, 'word/numbering.xml');
  const paragraphs = paragraphsContaining(documentXml, ['第一层', '第二层', '第三层', '第四层']);

  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ind[^>]*w:firstLine="(\d+)"/)?.[1] || 0)),
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((level) => {
      const numbering = numberingLevel(numberingXml, 'body-outline', level);
      return [
        Number(numbering.match(/<w:ind[^>]*w:left="(\d+)"/)?.[1]),
        Number(numbering.match(/<w:ind[^>]*w:hanging="(\d+)"/)?.[1]),
      ];
    }),
    [
      [240, 240],
      [360, 240],
      [480, 240],
      [720, 240],
    ],
  );
});

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
    [24, 24, 24, 24],
  );
  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ind[^>]*w:firstLine="(\d+)"/)?.[1] || 0)),
    [0, 0, 0, 0],
  );

  assert.deepEqual(
    [0, 1, 2, 3].map((level) => {
      const numbering = numberingLevel(numberingXml, 'body-outline', level);
      return [
        Number(numbering.match(/<w:ind[^>]*w:left="(\d+)"/)?.[1]),
        Number(numbering.match(/<w:ind[^>]*w:hanging="(\d+)"/)?.[1]),
      ];
    }),
    [
      [240, 240],
      [360, 240],
      [480, 240],
      [720, 240],
    ],
  );

  assert.match(numberingLevel(numberingXml, 'body-outline', 0), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="%1、"\/>/);
  assert.match(numberingLevel(numberingXml, 'body-outline', 1), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="（%2）"\/>/);
  assert.match(numberingLevel(numberingXml, 'body-outline', 2), /<w:numFmt w:val="decimal"\/>[\s\S]*<w:lvlText w:val="%3\."\/>/);
  assert.match(numberingLevel(numberingXml, 'body-outline', 3), /<w:numFmt w:val="decimal"\/>[\s\S]*<w:lvlText w:val="（%4）"\/>/);
});

test('Word export repairs non-reset nested heading numbers before Markdown parsing', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '嵌套编号修复测试',
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
      title: '嵌套编号修复',
      content: [
        '1. **存储环节控制**',
        '   1. **载体登记报告：** 项目使用的硬盘。',
        '   2. **分区分类存放：** 数据库成果。',
        '   3. **备份与移交管控：** 所有数据。',
        '2. **复制环节控制**',
        '   4. **复制审批：** 因工作需要。',
        '   5. **复制过程监管：** 复制操作。',
        '3. **传输环节控制**',
        '   6. **传输途径限制：** 数据交换。',
      ].join('\n'),
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const paragraphs = paragraphsContaining(documentXml, [
    '存储环节控制',
    '载体登记报告：',
    '分区分类存放：',
    '备份与移交管控：',
    '复制环节控制',
    '复制审批：',
    '复制过程监管：',
    '传输环节控制',
    '传输途径限制：',
  ]);

  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ilvl w:val="(\d+)"\/>/)?.[1])),
    [0, 1, 1, 1, 0, 1, 1, 0, 1],
  );
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
  assert.doesNotMatch(paragraph, /w:firstLine="/);
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
  assert.match(paragraph, /<w:ind[^>]*w:firstLine="480"/);
});

test('Word export treats Markdown headings inside body content as ordinary body text', async () => {
  const buffer = await buildDocxBuffer({
    project_name: '正文内部标题测试',
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
      headings: [
        { font: '黑体', size: '三号', spacing_before_pt: 10, spacing_after_pt: 10 },
      ],
    },
    outline: [{
      id: '1',
      title: '普通正文',
      content: '# 不应变成黑体三号\n\n这是一段普通正文。',
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const markdownHeadingParagraph = paragraphsContaining(documentXml, ['不应变成黑体三号'])[0];

  assert.doesNotMatch(markdownHeadingParagraph, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(markdownHeadingParagraph, /<w:rFonts[^>]*w:eastAsia="宋体"/);
  assert.match(markdownHeadingParagraph, /<w:sz w:val="24"\/>/);
});

test('Word export preserves HTML tables and block images inside list items', async () => {
  const warnings = [];
  const result = await buildDocxResult({
    project_name: '列表块级内容测试',
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
      title: '列表块级内容',
      content: [
        '1. 含表格与图片',
        '',
        '   <table>',
        '   <thead><tr><th>项目</th><th>说明</th></tr></thead>',
        '   <tbody><tr><td>图片</td><td>应正常导出</td></tr></tbody>',
        '   </table>',
        '',
        `   <img src="${onePixelPngDataUrl}" alt="测试图片" />`,
      ].join('\n'),
    }],
  }, { warnings });

  const zip = new AdmZip(result.buffer);
  const documentXml = readDocxXml(result.buffer, 'word/document.xml');
  const mediaEntries = zip.getEntries().filter((entry) => entry.entryName.startsWith('word/media/'));

  assert.doesNotMatch(warnings.join('\n'), /HTML 标签 <(?:table|thead|tbody|tr|th|td)> 导出时已降级/);
  assert.match(documentXml, /<w:tbl>/);
  assert.ok(mediaEntries.length >= 1, 'expected exported DOCX to contain an image media entry');
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
  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ind[^>]*w:firstLine="(\d+)"/)?.[1] || 0)),
    [0, 0, 0, 0],
  );
  assert.match(numberingLevel(numberingXml, 'body-outline', 0), /<w:numFmt w:val="chineseCounting"\/>[\s\S]*<w:lvlText w:val="（%1）"\/>/);
});

test('Word export defaults missing body outline first-line indents to zero', async () => {
  const legacyBodyOutlineLevels = bodyOutlineLevels.map(({ first_line_indent_chars, ...level }) => level);
  const buffer = await buildDocxBuffer({
    project_name: '旧正文层次字段兼容测试',
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
        body_outline_levels: legacyBodyOutlineLevels,
      },
      headings: [],
    },
    outline: [{
      id: '1',
      title: '旧正文层次字段',
      content: [
        '1. 第一层',
        '   1. 第二层',
        '      1. 第三层',
        '         1. 第四层',
      ].join('\n'),
    }],
  });

  const documentXml = readDocxXml(buffer, 'word/document.xml');
  const paragraphs = paragraphsContaining(documentXml, ['第一层', '第二层', '第三层', '第四层']);

  assert.deepEqual(
    paragraphs.map((paragraph) => Number(paragraph.match(/<w:ind[^>]*w:firstLine="(\d+)"/)?.[1] || 0)),
    [0, 0, 0, 0],
  );
});
