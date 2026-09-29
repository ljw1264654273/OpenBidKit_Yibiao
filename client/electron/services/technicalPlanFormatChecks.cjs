const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const { RULE_SEVERITY } = require('./technicalPlanCheckRules.cjs');

const CATEGORY = '格式与排版';
const CAPTION_RE = /(?:示意图|流程图|实例|截图|分布图|区位图|成果图|归户表|公示表|汇总表|统计表|调查表)/;
const MANUAL_HEADING_RE = /^\s*(?:第[一二三四五六七八九十]+章|第\d+章|[一二三四五六七八九十]+[、.]|\d+[、.]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])/;
const MANUAL_NUMBER_RE = /^\s*(?:[一二三四五六七八九十]+[、.]|\d+[、.]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩])/;
const TRUE_VALUES = new Set(['1', 'true', 'on']);

function readXml(zip, entryName, { required = true } = {}) {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    if (!required) return '';
    const error = new Error(`DOCX 缺少 ${entryName}`);
    error.code = 'DOCX_ENTRY_MISSING';
    throw error;
  }
  return entry.getData().toString('utf8');
}

function loadXml(xml) {
  return cheerio.load(xml || '<root/>', { xmlMode: true, decodeEntities: true });
}

function attr(node, name) {
  return node?.attribs?.[name];
}

function firstDirect($, node, selector) {
  return node ? $(node).children(selector).first()[0] : undefined;
}

function paragraphProperties($, paragraph) {
  return firstDirect($, paragraph, 'w\\:pPr');
}

function paragraphText($, paragraph) {
  return $(paragraph).find('w\\:t').toArray().map((node) => $(node).text()).join('');
}

function explicitBoolean($, pProperties, selector) {
  const element = firstDirect($, pProperties, selector);
  if (!element) return undefined;
  const value = attr(element, 'w:val');
  return value === undefined || TRUE_VALUES.has(String(value).toLowerCase());
}

function styleDefinitions(stylesXml) {
  const $ = loadXml(stylesXml);
  const styles = new Map();
  $('w\\:style').each((_, style) => {
    const styleId = attr(style, 'w:styleId');
    if (!styleId) return;
    const nameElement = firstDirect($, style, 'w\\:name');
    const pProperties = firstDirect($, style, 'w\\:pPr');
    const outlineElement = firstDirect($, pProperties, 'w\\:outlineLvl');
    styles.set(styleId, {
      name: attr(nameElement, 'w:val') || '',
      outlineLevel: attr(outlineElement, 'w:val'),
    });
  });
  return styles;
}

function paragraphStyle($, paragraph, styles) {
  const pProperties = paragraphProperties($, paragraph);
  const styleElement = firstDirect($, pProperties, 'w\\:pStyle');
  const styleId = attr(styleElement, 'w:val') || '';
  return { styleId, ...(styles.get(styleId) || {}) };
}

function isHeadingParagraph($, paragraph, styles) {
  const style = paragraphStyle($, paragraph, styles);
  if (/^(?:Heading|标题|TOC|目录|Subtitle|副标题)/i.test(style.name || style.styleId)) return true;
  const pProperties = paragraphProperties($, paragraph);
  return Boolean(firstDirect($, pProperties, 'w\\:outlineLvl')) || style.outlineLevel !== undefined;
}

function isCaptionParagraph($, paragraph, styles) {
  const text = paragraphText($, paragraph).trim();
  if (!text) return true;
  const style = paragraphStyle($, paragraph, styles);
  if (/^(?:Caption|题注)/i.test(style.name || style.styleId)) return true;
  if (/^(?:注：|说明：|式中|其中|这里)/.test(text)) return true;
  return text.length < 80 && (/^[表图]/.test(text) || CAPTION_RE.test(text));
}

function autoNumberInfo($, paragraph) {
  const pProperties = paragraphProperties($, paragraph);
  const numProperties = firstDirect($, pProperties, 'w\\:numPr');
  if (!numProperties) return null;
  const numIdElement = firstDirect($, numProperties, 'w\\:numId');
  if (!numIdElement) return null;
  const levelElement = firstDirect($, numProperties, 'w\\:ilvl');
  return {
    numId: attr(numIdElement, 'w:val') || '0',
    level: attr(levelElement, 'w:val') || '0',
  };
}

function isBodyParagraph($, paragraph, styles) {
  const text = paragraphText($, paragraph).trim();
  if (!text || isHeadingParagraph($, paragraph, styles) || isCaptionParagraph($, paragraph, styles)) return false;
  return !MANUAL_HEADING_RE.test(text) && !autoNumberInfo($, paragraph);
}

function runFontSize($, run) {
  const rProperties = firstDirect($, run, 'w\\:rPr');
  const size = firstDirect($, rProperties, 'w\\:sz') || firstDirect($, rProperties, 'w\\:szCs');
  const value = Number(attr(size, 'w:val'));
  return Number.isFinite(value) ? value / 2 : undefined;
}

function runEastAsiaFont($, run) {
  const rProperties = firstDirect($, run, 'w\\:rPr');
  const fonts = firstDirect($, rProperties, 'w\\:rFonts');
  return attr(fonts, 'w:eastAsia');
}

function estimatedFontSize($, paragraph) {
  for (const run of $(paragraph).find('w\\:r').toArray()) {
    if (!$(run).find('w\\:t').text().trim()) continue;
    const size = runFontSize($, run);
    if (size) return size;
  }
  return 12;
}

function cleanHeading(text) {
  return String(text || '')
    .replace(/^\s*(?:第[一二三四五六七八九十]+章|第\d+章)\s*/, '')
    .replace(/^\s*(?:[一二三四五六七八九十]+|\d+)(?:、|[.．])\s*/, '')
    .replace(/^\s*[（(]\d+[）)]\s*/, '')
    .trim();
}

function scoreItemLabel(item) {
  const description = typeof item === 'object' && item !== null
    ? item.desc ?? item.description ?? ''
    : item;
  return String(description || '').split(/[:：；;，,]/, 1)[0].trim();
}

function sequenceRatio(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  let previous = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return (2 * previous[b.length]) / (a.length + b.length);
}

function numberingDefinitions(numberingXml) {
  const $ = loadXml(numberingXml);
  const numToAbstract = new Map();
  const levels = new Map();
  $('w\\:num').each((_, number) => {
    const numId = attr(number, 'w:numId');
    const abstractElement = firstDirect($, number, 'w\\:abstractNumId');
    if (numId) numToAbstract.set(numId, attr(abstractElement, 'w:val') || numId);
  });
  $('w\\:abstractNum').each((_, abstractNumber) => {
    const abstractId = attr(abstractNumber, 'w:abstractNumId') || '';
    $(abstractNumber).children('w\\:lvl').each((__, level) => {
      const levelId = attr(level, 'w:ilvl') || '0';
      const formatElement = firstDirect($, level, 'w\\:numFmt');
      const textElement = firstDirect($, level, 'w\\:lvlText');
      levels.set(`${abstractId}:${levelId}`, {
        format: attr(formatElement, 'w:val') || '',
        text: attr(textElement, 'w:val') || '',
      });
    });
  });
  return { numToAbstract, levels };
}

function numberingStyle(info, definitions) {
  const abstractId = definitions.numToAbstract.get(info.numId) || info.numId;
  const level = definitions.levels.get(`${abstractId}:${info.level}`) || {};
  return `${abstractId}:${info.level}:${level.format || ''}:${level.text || ''}`;
}

function createCollector(cap) {
  const findings = [];
  const counts = new Map();
  const add = (ruleId, message, contexts = [], details = {}) => {
    const rawCount = (counts.get(ruleId) || 0) + 1;
    counts.set(ruleId, rawCount);
    if (rawCount > cap) return;
    findings.push({
      ruleId,
      severity: RULE_SEVERITY[ruleId],
      category: CATEGORY,
      message,
      contexts: Array.isArray(contexts) ? contexts : [],
      ...details,
    });
  };
  const stats = () => {
    const rules = {};
    let rawTotal = 0;
    let truncatedTotal = 0;
    for (const [ruleId, rawCount] of counts) {
      const returnedCount = Math.min(rawCount, cap);
      const truncatedCount = rawCount - returnedCount;
      rawTotal += rawCount;
      truncatedTotal += truncatedCount;
      rules[ruleId] = { rawCount, returnedCount, truncatedCount };
    }
    return { cap, rawTotal, returnedTotal: findings.length, truncatedTotal, rules };
  };
  return { findings, add, stats };
}

function scanTechnicalPlanFormat(proposalDocxPath, options = {}) {
  const cap = Number.isInteger(options.cap) && options.cap > 0 ? options.cap : 30;
  const collector = createCollector(cap);
  const zip = new AdmZip(proposalDocxPath);
  const documentXml = readXml(zip, 'word/document.xml');
  const stylesXml = readXml(zip, 'word/styles.xml', { required: false });
  const numberingXml = readXml(zip, 'word/numbering.xml', { required: false });
  const $ = loadXml(documentXml);
  const styles = styleDefinitions(stylesXml);
  const bodyParagraphs = $('w\\:body > w\\:p').toArray();

  bodyParagraphs.forEach((paragraph, paragraphIndex) => {
    if (!isBodyParagraph($, paragraph, styles)) return;
    const text = paragraphText($, paragraph).trim();
    const context = text.slice(0, 120);
    const pProperties = paragraphProperties($, paragraph);
    const alignmentElement = firstDirect($, pProperties, 'w\\:jc');
    const alignment = attr(alignmentElement, 'w:val');
    if (alignment !== 'both') {
      collector.add('format.alignment', `正文未显式设置为两端对齐：${text.slice(0, 50)}`, [context], { paragraphIndex, alignment: alignment || null });
    }

    const indentElement = firstDirect($, pProperties, 'w\\:ind');
    const firstLine = Number(attr(indentElement, 'w:firstLine'));
    const fontSize = estimatedFontSize($, paragraph);
    const expectedFirstLine = fontSize * 40;
    const tolerance = fontSize * 20 * 0.65;
    if (!Number.isFinite(firstLine) || Math.abs(firstLine - expectedFirstLine) > tolerance) {
      collector.add('format.indent', `正文首行缩进不是约两个字符：${text.slice(0, 60)}`, [context], {
        paragraphIndex,
        firstLine: Number.isFinite(firstLine) ? firstLine : null,
        expectedFirstLine,
      });
    }

    const spacingElement = firstDirect($, pProperties, 'w\\:spacing');
    const before = Number(attr(spacingElement, 'w:before') || 0);
    const after = Number(attr(spacingElement, 'w:after') || 0);
    if (Math.abs(before) > 2 || Math.abs(after) > 2) {
      collector.add('format.spacing', `正文段前或段后间距不为 0：${text.slice(0, 60)}`, [context], { paragraphIndex, before, after });
    }
    const lineValue = attr(spacingElement, 'w:line');
    if (lineValue !== undefined) {
      const lineRule = attr(spacingElement, 'w:lineRule') || 'auto';
      const multiple = lineRule === 'auto' ? Number(lineValue) / 240 : NaN;
      if (!Number.isFinite(multiple) || Math.abs(multiple - 1.5) > 0.05) {
        collector.add('format.line-spacing', `正文行距不是 1.5 倍：${text.slice(0, 60)}`, [context], {
          paragraphIndex,
          line: Number(lineValue),
          lineRule,
        });
      }
    }
    const snapToGrid = explicitBoolean($, pProperties, 'w\\:snapToGrid');
    const adjustRightInd = explicitBoolean($, pProperties, 'w\\:adjustRightInd');
    if (snapToGrid !== true || adjustRightInd !== true) {
      collector.add('format.grid', `正文未显式启用与网格对齐和自动调整右缩进：${text.slice(0, 60)}`, [context], {
        paragraphIndex,
        snapToGrid: snapToGrid ?? null,
        adjustRightInd: adjustRightInd ?? null,
      });
    }

    for (const run of $(paragraph).find('w\\:r').toArray()) {
      const runText = $(run).find('w\\:t').text();
      if (!/[\u4e00-\u9fa5]/.test(runText)) continue;
      const size = runFontSize($, run);
      if (size !== undefined && Math.abs(size - 12) > 0.5) {
        collector.add('format.font-size', `正文字号不是小四（12 pt），当前 ${size.toFixed(1)} pt`, [context], { paragraphIndex, size });
      }
      const eastAsia = runEastAsiaFont($, run);
      if (eastAsia && !['宋体', 'SimSun'].includes(eastAsia)) {
        collector.add('format.font-family', `正文字体不是宋体，当前东亚字体为 ${eastAsia}`, [context], { paragraphIndex, fontFamily: eastAsia });
      }
    }
  });

  $('w\\:body > w\\:tbl').each((tableIndex, table) => {
    const tableProperties = firstDirect($, table, 'w\\:tblPr');
    const alignmentElement = firstDirect($, tableProperties, 'w\\:jc');
    const alignment = attr(alignmentElement, 'w:val');
    if (alignment !== 'center') {
      collector.add('format.table-center', `第 ${tableIndex + 1} 个表格未显式居中`, [], { tableIndex, alignment: alignment || null });
    }
  });

  bodyParagraphs.forEach((paragraph, paragraphIndex) => {
    if (!$(paragraph).find('w\\:drawing, w\\:pict').length) return;
    const pProperties = paragraphProperties($, paragraph);
    const alignmentElement = firstDirect($, pProperties, 'w\\:jc');
    const alignment = attr(alignmentElement, 'w:val');
    if (alignment !== 'center') {
      collector.add('format.image-center', '图片所在段落未显式居中', [paragraphText($, paragraph).trim().slice(0, 120)], { paragraphIndex, alignment: alignment || null });
    }
  });

  const headings = bodyParagraphs
    .filter((paragraph) => isHeadingParagraph($, paragraph, styles))
    .map((paragraph) => cleanHeading(paragraphText($, paragraph)))
    .filter(Boolean);
  const headingText = headings.join('\n');
  for (const item of options.scoreItems || []) {
    const label = scoreItemLabel(item);
    if (!label || headingText.includes(label) || sequenceRatio(label, headingText) >= 0.3) continue;
    collector.add(
      'format.chapter-score',
      `评分项“${label.slice(0, 50)}”在方案章节标题中未找到明显对应章节`,
      headingText ? [headingText.slice(0, 200)] : [],
      { scoreLabel: label },
    );
  }

  const definitions = numberingDefinitions(numberingXml);
  const autoStyles = new Set();
  const manualStyles = new Set();
  let autoCount = 0;
  let manualCount = 0;
  for (const paragraph of bodyParagraphs) {
    const text = paragraphText($, paragraph).trim();
    const info = autoNumberInfo($, paragraph);
    if (info) {
      autoCount += 1;
      autoStyles.add(numberingStyle(info, definitions));
    }
    const manualMatch = text.match(MANUAL_NUMBER_RE);
    if (manualMatch) {
      manualCount += 1;
      manualStyles.add(manualMatch[0].trim());
    }
  }
  if (autoCount && manualCount) {
    collector.add('format.numbering-mixed', `方案中同时存在自动编号（${autoCount} 处）与手动编号（${manualCount} 处）`, [], { autoCount, manualCount });
  }
  if (manualStyles.size > 1) {
    collector.add('format.numbering-manual-styles', `手动序号格式不统一，共发现 ${manualStyles.size} 种`, [...manualStyles].slice(0, 5), { styles: [...manualStyles] });
  }
  if (autoStyles.size > 1) {
    collector.add('format.numbering-auto-styles', `自动编号使用了 ${autoStyles.size} 组不同样式或层级`, [...autoStyles].slice(0, 5), { styles: [...autoStyles] });
  }

  return { findings: collector.findings, stats: collector.stats() };
}

module.exports = { scanTechnicalPlanFormat };
