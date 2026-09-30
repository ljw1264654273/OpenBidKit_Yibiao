const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  Document, Table, TableRow, TableCell, Paragraph, TextRun, Packer,
  HeadingLevel, WidthType, BorderStyle, VerticalAlign,
} = require('docx');

const SEVERITIES = Object.freeze({
  info: { label: '提示', color: '536471' },
  review: { label: '待复核', color: '9A6700' },
  issue: { label: '明确问题', color: 'B42318' },
});
const FILE_LABELS = Object.freeze({
  tender: '招标文件', requirements: '采购需求文件',
  scoring: '主观分评分标准', proposal: '投标技术方案',
});
const TABLE_WIDTH = 9638;

function paragraph(text, options = {}) {
  return new Paragraph({
    spacing: { after: 100, line: 280 },
    ...options,
    children: [new TextRun({ text: String(text ?? ''), font: '宋体', size: 21, color: '000000', ...options.run })],
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return paragraph(text, { heading: level, keepNext: true, spacing: { before: 240, after: 140 }, run: { bold: true, size: level === HeadingLevel.TITLE ? 36 : 26 } });
}

function table(headers, rows, proportions) {
  const widths = proportions.map((fraction) => Math.floor(TABLE_WIDTH * fraction));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [headers, ...rows].map((values, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: values.map((value, columnIndex) => {
        const cell = typeof value === 'object' && value !== null ? value : { text: value };
        return new TableCell({
          width: { size: widths[columnIndex], type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          shading: rowIndex === 0 ? { fill: 'F2F2F2' } : undefined,
          children: String(cell.text ?? '').split('\n').map((line) => paragraph(line, {
            spacing: { after: 40, line: 260 },
            run: { bold: rowIndex === 0, color: cell.color || '000000' },
          })),
        });
      }),
    })),
  });
}

function findingDetail(finding) {
  const lines = [finding.message];
  if (finding.requirement) lines.push(`采购需求：${finding.requirement}`);
  if (finding.desc) lines.push(`评分项：${finding.desc}`);
  if (finding.score !== undefined && finding.score !== null) lines.push(`分值：${finding.score}`);
  if (finding.coverage !== undefined && finding.coverage !== null) lines.push(`检索覆盖率：${finding.coverage}`);
  if (finding.missing?.length) lines.push(`未检索到的关键内容：${finding.missing.join('；')}`);
  return lines.join('\n');
}

function appendFindings(children, findings) {
  if (!findings.length) {
    children.push(paragraph('本节无检查发现'));
    return;
  }
  children.push(table(['序号', '严重性', '检查发现', '上下文摘录'], findings.map((finding, index) => [
    index + 1,
    { text: SEVERITIES[finding.severity].label, color: SEVERITIES[finding.severity].color },
    findingDetail(finding),
    finding.contexts.join('\n'),
  ]), [0.07, 0.12, 0.46, 0.35]));
}

function buildTechnicalPlanCheckReport({ result, files }) {
  const { findings, summary, formatStats, requirementCount, scoreItemCount } = result;
  const requirements = findings.filter((finding) => finding.ruleId.startsWith('requirement.'));
  const scoring = findings.filter((finding) => finding.ruleId.startsWith('score.'));
  const formatting = findings.filter((finding) => finding.category === '格式与排版');
  const internal = findings.filter((finding) => !requirements.includes(finding) && !scoring.includes(finding) && !formatting.includes(finding));
  const children = [heading('投标技术方案检查记录', HeadingLevel.TITLE)];
  for (const [role, label] of Object.entries(FILE_LABELS)) {
    const file = files[role];
    children.push(paragraph(`${label}：${file.name || path.basename(file.path)}`));
  }
  children.push(paragraph('本记录仅列出检查发现，不代表全量响应或覆盖结论。待复核项需结合原文人工确认。时间检查仅为方案内部期限检查。'));
  children.push(heading('一、检查结论汇总'));
  children.push(table(['检查项', '检查数量', '检查发现'], [
    ['全部检查发现', `${summary.total} 条`, `明确问题 ${summary.issue} / 待复核 ${summary.review} / 提示 ${summary.info}`],
    ['采购需求响应性', `需求条目 ${requirementCount} 条`, `疑似未响应 ${summary.req_unresp} / 部分响应 ${summary.req_part}`],
    ['主观分评分标准覆盖', `评分项 ${scoreItemCount} 项`, `疑似未覆盖 ${summary.score_uncov} / 覆盖不足 ${summary.score_pcov}`],
    ['格式与排版', formatStats ? `原始发现数 ${formatStats.rawTotal} / 返回 ${formatStats.returnedTotal} / 截断 ${formatStats.truncatedTotal}` : '未提供格式统计', `${formatting.length} 条`],
    ['其他检查发现（含格式）', '方案内部检查及格式检查', `${summary.internal_total} 条`],
  ], [0.28, 0.34, 0.38]));
  children.push(heading('二、采购需求响应情况'));
  appendFindings(children, requirements);
  children.push(heading('三、主观分评分标准覆盖情况'));
  appendFindings(children, scoring);
  children.push(heading('四、格式与排版'));
  if (formatStats) {
    children.push(paragraph(`每条格式规则最多返回 ${formatStats.cap} 条发现；原始发现数 ${formatStats.rawTotal}，返回 ${formatStats.returnedTotal}，截断 ${formatStats.truncatedTotal}。`));
    if (Object.keys(formatStats.rules).length) {
      children.push(table(['规则', '原始发现数', '返回数量', '截断数量'], Object.entries(formatStats.rules).map(([ruleId, stats]) => [
        ruleId, stats.rawCount, stats.returnedCount, stats.truncatedCount,
      ]), [0.46, 0.18, 0.18, 0.18]));
    }
  }
  appendFindings(children, formatting);
  children.push(heading('五、方案内部问题'));
  const categories = new Map();
  for (const finding of internal) {
    if (!categories.has(finding.category)) categories.set(finding.category, []);
    categories.get(finding.category).push(finding);
  }
  if (!categories.size) children.push(paragraph('本节无检查发现'));
  for (const [category, categoryFindings] of categories) {
    children.push(heading(category === '时间前后冲突' ? '方案内部期限检查' : category, HeadingLevel.HEADING_2));
    appendFindings(children, categoryFindings);
  }
  return new Document({
    creator: '易标投标工具箱',
    title: '投标技术方案检查记录',
    styles: { default: { document: { run: { font: '宋体', size: 21, color: '000000' } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('技术方案检查报告生成已取消');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  throw error;
}

function normalizedPath(filePath, platform) {
  const resolved = path.resolve(filePath);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function writeTechnicalPlanCheckReport({ result, files, outputPath, signal }, dependencies = {}) {
  const fileSystem = dependencies.fs || fs;
  const pack = dependencies.pack || ((document) => Packer.toBuffer(document));
  const removeBackup = dependencies.removeBackup || ((backup) => fsSync.rmSync(backup, { force: true }));
  const platform = dependencies.platform || process.platform;
  const reportPath = path.resolve(outputPath);
  if (Object.values(files).some((file) => normalizedPath(file.path, platform) === normalizedPath(reportPath, platform))) {
    const error = new Error('检查记录输出路径不能与输入文件相同，请选择其他保存位置');
    error.code = 'REPORT_INPUT_COLLISION';
    throw error;
  }
  const directory = path.dirname(reportPath);
  const name = path.basename(reportPath, path.extname(reportPath));
  const tempPath = path.join(directory, `${name}.tmp-${randomUUID()}.docx`);
  const backupPath = path.join(directory, `${name}.bak-${randomUUID()}.docx`);
  let backedUp = false;
  let installed = false;
  let failure;
  try {
    throwIfAborted(signal);
    const buffer = await pack(buildTechnicalPlanCheckReport({ result, files }));
    throwIfAborted(signal);
    await fileSystem.writeFile(tempPath, buffer, { flag: 'wx' });
    throwIfAborted(signal);
    const written = await fileSystem.readFile(tempPath);
    if (written.length < 4 || written.subarray(0, 4).toString('hex') !== '504b0304') {
      const error = new Error('检查报告生成失败：DOCX 文件无有效 ZIP 头');
      error.code = 'INVALID_REPORT_DOCX';
      throw error;
    }
    throwIfAborted(signal);
    try {
      await fileSystem.rename(reportPath, backupPath);
      backedUp = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    throwIfAborted(signal);
    await fileSystem.rename(tempPath, reportPath);
    installed = true;
    // Rename is asynchronous: cancellation during installation still rolls back.
    throwIfAborted(signal);
    // Final commit boundary: no event-loop yield between this check and return.
    if (backedUp) {
      removeBackup(backupPath);
      backedUp = false;
    }
    return { reportPath };
  } catch (error) {
    failure = error;
    try {
      if (installed) await fileSystem.rm(reportPath, { force: true });
      if (backedUp) {
        await fileSystem.rename(backupPath, reportPath);
        backedUp = false;
      }
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
      if (backedUp) error.backupPath = backupPath;
    }
    throw error;
  } finally {
    // Never remove a backup that could not be restored: it is the old report.
    if (!installed) {
      try {
        await fileSystem.rm(tempPath, { force: true });
      } catch (cleanupError) {
        if (!failure) throw cleanupError;
        failure.cleanupError = cleanupError;
      }
    }
  }
}

module.exports = { buildTechnicalPlanCheckReport, writeTechnicalPlanCheckReport };
