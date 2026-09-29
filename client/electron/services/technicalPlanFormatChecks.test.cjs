const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const {
  AlignmentType,
  Document,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
} = require('docx');

let scanTechnicalPlanFormat;
try {
  ({ scanTechnicalPlanFormat } = require('./technicalPlanFormatChecks.cjs'));
} catch {
  scanTechnicalPlanFormat = undefined;
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3H5ZAAAAAElFTkSuQmCC',
  'base64',
);

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function paragraphXml(text, options = {}) {
  const {
    alignment = 'both',
    adjustRightInd = '1',
    after = '0',
    before = '0',
    eastAsia = 'SimSun',
    firstLine = '480',
    line = '360',
    lineRule = 'auto',
    numId,
    outlineLevel,
    size = '24',
    snapToGrid = '1',
    style,
  } = options;
  const pProperties = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    numId ? `<w:numPr><w:ilvl w:val="${options.ilvl || '0'}"/><w:numId w:val="${numId}"/></w:numPr>` : '',
    adjustRightInd === null ? '' : `<w:adjustRightInd w:val="${adjustRightInd}"/>`,
    snapToGrid === null ? '' : `<w:snapToGrid w:val="${snapToGrid}"/>`,
    `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="${lineRule}"/>`,
    `<w:ind w:firstLine="${firstLine}"/>`,
    `<w:jc w:val="${alignment}"/>`,
    outlineLevel === undefined ? '' : `<w:outlineLvl w:val="${outlineLevel}"/>`,
  ].join('');
  return `<w:p><w:pPr>${pProperties}</w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="${eastAsia}"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(alignment = 'center') {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="${alignment}"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
}

function numberingXml(includeSecondStyle = false) {
  const secondStyle = includeSecondStyle
    ? '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>${secondStyle}</w:numbering>`;
}

async function createValidFixture(directory, { bodyTexts = ['正文段落用于验证显式格式属性。'] } = {}) {
  const baseDocument = new Document({
    numbering: {
      config: [{
        reference: 'fixture-list',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
        }],
      }],
    },
    sections: [{
      children: [
        new Paragraph({
          children: [new ImageRun({ data: PNG_1X1, transformation: { width: 1, height: 1 } })],
        }),
        new Paragraph({ text: '编号关系占位', numbering: { reference: 'fixture-list', level: 0 } }),
        new Table({
          rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('基底表格')] })] })],
        }),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(baseDocument);
  const zip = new AdmZip(buffer);
  const documentEntry = zip.getEntry('word/document.xml');
  assert.ok(documentEntry, 'docx fixture should contain document.xml');
  const originalXml = documentEntry.getData().toString('utf8');
  const drawingRun = originalXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<w:drawing>[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>/)?.[0];
  const sectionProperties = originalXml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0] || '';
  assert.ok(drawingRun, 'docx fixture should contain a real drawing run');

  const blocks = [
    paragraphXml('项目实施方案', { style: 'Heading1', outlineLevel: '0', alignment: 'left' }),
    paragraphXml('图1 系统结构示意图', { alignment: 'left', firstLine: '0', snapToGrid: '0', adjustRightInd: '0' }),
    paragraphXml('自动编号甲', { alignment: 'left', firstLine: '0', snapToGrid: '0', adjustRightInd: '0', numId: '1' }),
    paragraphXml('自动编号乙', { alignment: 'left', firstLine: '0', snapToGrid: '0', adjustRightInd: '0', numId: '1' }),
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr></w:p>',
    ...bodyTexts.map((text) => paragraphXml(text)),
    tableXml(),
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${drawingRun}</w:p>`,
  ].join('');
  const documentXml = originalXml.replace(
    /<w:body>[\s\S]*?<\/w:body>/,
    `<w:body>${blocks}${sectionProperties}</w:body>`,
  );
  zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  const numberingEntry = zip.getEntry('word/numbering.xml');
  if (numberingEntry) zip.updateFile('word/numbering.xml', Buffer.from(numberingXml(), 'utf8'));
  else zip.addFile('word/numbering.xml', Buffer.from(numberingXml(), 'utf8'));

  const filePath = path.join(directory, '技术方案格式fixture.docx');
  zip.writeZip(filePath);
  return filePath;
}

function updateZipEntry(filePath, entryName, update) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry(entryName);
  assert.ok(entry, `fixture should contain ${entryName}`);
  zip.updateFile(entryName, Buffer.from(update(entry.getData().toString('utf8')), 'utf8'));
  zip.writeZip(filePath);
}

function replaceParagraphContaining(xml, text, update) {
  let matched = false;
  const result = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (matched || !paragraph.includes(`>${escapeXml(text)}<`)) return paragraph;
    matched = true;
    return update(paragraph);
  });
  assert.equal(matched, true, `paragraph not found: ${text}`);
  return result;
}

test('accepts a DOCX whose explicit body, table, image, heading, and numbering properties comply', async (t) => {
  assert.equal(typeof scanTechnicalPlanFormat, 'function');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-format-valid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = await createValidFixture(directory);

  const result = scanTechnicalPlanFormat(filePath, {
    scoreItems: [{ desc: '项目实施方案：组织与技术路线', score: 10 }],
  });

  assert.deepEqual(result.findings, []);
  assert.equal(result.stats.cap, 30);
});

test('reports every stable OOXML format and numbering rule after targeted XML damage', async (t) => {
  assert.equal(typeof scanTechnicalPlanFormat, 'function');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-format-invalid-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = await createValidFixture(directory);

  updateZipEntry(filePath, 'word/document.xml', (xml) => {
    let updated = replaceParagraphContaining(xml, '正文段落用于验证显式格式属性。', (paragraph) => paragraph
      .replace('<w:adjustRightInd w:val="1"/>', '')
      .replace('<w:snapToGrid w:val="1"/>', '<w:snapToGrid w:val="0"/>')
      .replace('<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>', '<w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>')
      .replace('<w:ind w:firstLine="480"/>', '<w:ind w:firstLine="0"/>')
      .replace('<w:jc w:val="both"/>', '<w:jc w:val="left"/>')
      .replace('w:eastAsia="SimSun"', 'w:eastAsia="微软雅黑"')
      .replace('<w:sz w:val="24"/>', '<w:sz w:val="21"/>'));
    updated = replaceParagraphContaining(updated, '项目实施方案', (paragraph) => paragraph.replace('项目实施方案', '组织保障'));
    updated = replaceParagraphContaining(updated, '自动编号乙', (paragraph) => paragraph.replace('<w:numId w:val="1"/>', '<w:numId w:val="2"/>'));
    updated = updated.replace('<w:jc w:val="center"/></w:tblPr>', '<w:jc w:val="left"/></w:tblPr>');
    updated = updated.replace('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>', '<w:p><w:pPr><w:jc w:val="left"/></w:pPr>');
    return updated.replace(
      /<w:sectPr/,
      `${paragraphXml('一、手动编号甲', { alignment: 'left' })}${paragraphXml('1. 手动编号乙', { alignment: 'left' })}<w:sectPr`,
    );
  });
  updateZipEntry(filePath, 'word/numbering.xml', () => numberingXml(true));

  const result = scanTechnicalPlanFormat(filePath, {
    scoreItems: [{ desc: '项目实施方案：组织与技术路线', score: 10 }],
  });
  const ruleIds = new Set(result.findings.map((finding) => finding.ruleId));

  assert.deepEqual(ruleIds, new Set([
    'format.alignment',
    'format.indent',
    'format.spacing',
    'format.line-spacing',
    'format.grid',
    'format.font-size',
    'format.font-family',
    'format.table-center',
    'format.image-center',
    'format.chapter-score',
    'format.numbering-mixed',
    'format.numbering-manual-styles',
    'format.numbering-auto-styles',
  ]));
  for (const finding of result.findings) {
    assert.ok(['issue', 'review'].includes(finding.severity));
    assert.equal(finding.category, '格式与排版');
    assert.ok(Array.isArray(finding.contexts));
  }
});

test('caps each format rule at 30 findings while preserving raw and truncated counts', async (t) => {
  assert.equal(typeof scanTechnicalPlanFormat, 'function');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yibiao-format-cap-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bodyTexts = Array.from({ length: 35 }, (_, index) => `正文批量段落${index + 1}用于验证截断统计。`);
  const filePath = await createValidFixture(directory, { bodyTexts });
  updateZipEntry(filePath, 'word/document.xml', (xml) => xml.replaceAll(
    '<w:jc w:val="both"/>',
    '<w:jc w:val="left"/>',
  ));

  const result = scanTechnicalPlanFormat(filePath, {
    scoreItems: [{ desc: '项目实施方案', score: 10 }],
  });
  const alignmentFindings = result.findings.filter((finding) => finding.ruleId === 'format.alignment');

  assert.equal(alignmentFindings.length, 30);
  assert.deepEqual(result.stats.rules['format.alignment'], {
    rawCount: 35,
    returnedCount: 30,
    truncatedCount: 5,
  });
});
