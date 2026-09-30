const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixtureNames = {
  tender: '招标文件-建湖县人民政府近湖街道办事处（本级）建湖县近湖街道第二轮土地.docx',
  requirements: '采购需求文件.docx',
  scoring: '主观分评分标准.docx',
  proposal: '投标技术方案.V1.0.docx',
};
const expected = require('./fixtures/technical-plan-check/expected.json');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inputFiles() {
  assert.ok(process.env.BID_CHECK_FIXTURE_DIR, 'BID_CHECK_FIXTURE_DIR is required; golden regression must not skip');
  const directory = path.resolve(process.env.BID_CHECK_FIXTURE_DIR);
  return Object.fromEntries(Object.entries(fixtureNames).map(([role, name]) => {
    const filePath = path.join(directory, name);
    assert.ok(fs.existsSync(filePath) && fs.statSync(filePath).isFile(), `Missing golden fixture: ${name}`);
    return [role, { path: filePath, name }];
  }));
}

function fixtureSnapshot(files) {
  const directory = path.dirname(files.proposal.path);
  const protectedReport = path.join(directory, '投标技术方案.V1.0检查记录.docx');
  const paths = Object.values(files).map((file) => file.path);
  if (fs.existsSync(protectedReport)) paths.push(protectedReport);
  return {
    entries: fs.readdirSync(directory).sort(),
    hashes: Object.fromEntries(paths.map((filePath) => [filePath, sha256(fs.readFileSync(filePath))])),
  };
}

function assertReport(outputPath, files, result) {
  const AdmZip = require('adm-zip');
  const cheerio = require('cheerio');
  const zip = new AdmZip(fs.readFileSync(outputPath));
  for (const entry of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) {
    assert.ok(zip.getEntry(entry), `Missing DOCX part: ${entry}`);
  }
  const $ = cheerio.load(zip.readAsText('word/document.xml', 'utf8'), { xmlMode: true });
  const text = $('w\\:t').toArray().map((node) => $(node).text()).join('\n');
  for (const value of [
    '投标技术方案检查记录', ...Object.values(files).map((file) => file.name),
    '一、检查结论汇总', '二、采购需求响应情况', '三、主观分评分标准覆盖情况',
    '四、格式与排版', '五、方案内部问题', '方案内部期限检查',
    '本记录仅列出检查发现，不代表全量响应或覆盖结论。待复核项需结合原文人工确认。时间检查仅为方案内部期限检查。',
    `${expected.summary.total} 条`, `明确问题 ${expected.summary.issue} / 待复核 ${expected.summary.review} / 提示 ${expected.summary.info}`,
    `需求条目 ${expected.requirementCount} 条`, `评分项 ${expected.scoreItemCount} 项`,
    `每条格式规则最多返回 ${expected.formatStats.cap} 条发现；原始发现数 ${expected.formatStats.rawTotal}，返回 ${expected.formatStats.returnedTotal}，截断 ${expected.formatStats.truncatedTotal}。`,
  ]) assert.ok(text.includes(value), `Report omitted: ${value}`);
  assert.ok(!text.includes('全部响应'));
  assert.ok(!text.includes('全部覆盖'));

  function cellText(cell) {
    return $(cell).children('w\\:p').toArray().map((paragraph) => (
      $(paragraph).find('w\\:t').toArray().map((node) => $(node).text()).join('')
    )).join('\n');
  }
  const tables = $('w\\:tbl').toArray().map((table) => (
    $(table).children('w\\:tr').toArray().map((row) => (
      $(row).children('w\\:tc').toArray().map(cellText)
    ))
  ));
  const statsTable = tables.find((rows) => rows[0].join('|') === '规则|原始发现数|返回数量|截断数量');
  assert.deepEqual(statsTable?.slice(1), Object.entries(expected.formatStats.rules).map(([rule, stats]) => (
    [rule, String(stats.rawCount), String(stats.returnedCount), String(stats.truncatedCount)]
  )));
  const findingTables = tables.filter((rows) => rows[0].join('|') === '序号|严重性|检查发现|上下文摘录');
  for (const rows of findingTables) {
    assert.deepEqual(rows.slice(1).map((row) => row[0]), rows.slice(1).map((_, index) => String(index + 1)));
  }
  const actualRows = findingTables.flatMap((rows) => rows.slice(1).map((row) => row.slice(1)));
  const severityLabels = { issue: '明确问题', review: '待复核', info: '提示' };
  const expectedRows = result.findings.map((finding) => {
    const details = [finding.message];
    if (finding.requirement) details.push(`采购需求：${finding.requirement}`);
    if (finding.desc) details.push(`评分项：${finding.desc}`);
    if (finding.score !== undefined && finding.score !== null) details.push(`分值：${finding.score}`);
    if (finding.coverage !== undefined && finding.coverage !== null) details.push(`检索覆盖率：${finding.coverage}`);
    if (finding.missing?.length) details.push(`未检索到的关键内容：${finding.missing.join('；')}`);
    return [severityLabels[finding.severity], details.join('\n'), finding.contexts.join('\n')];
  });
  assert.equal(actualRows.length, expected.summary.total, 'Report must contain every golden finding exactly once');
  // The report groups findings by section/category, so compare complete rows as a multiset.
  assert.deepEqual(actualRows.map((row) => sha256(JSON.stringify(row))).sort(), expectedRows.map((row) => sha256(JSON.stringify(row))).sort());
}

async function runGoldenAssertions() {
  const files = inputFiles();
  const before = fixtureSnapshot(files);
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTaskLogStore } = require('./taskLogStore.cjs');
  const { createTechnicalPlanCheckStore } = require('./technicalPlanCheckStore.cjs');
  const { createTechnicalPlanCheckService } = require('./technicalPlanCheckService.cjs');
  const { runTechnicalPlanCheckTask, CHECK_STAGES } = require('./technicalPlanCheckTask.cjs');
  const { writeTechnicalPlanCheckReport } = require('./technicalPlanCheckReport.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-check-golden-'));
  const app = { getPath: () => directory, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const makeStore = () => createTechnicalPlanCheckStore({ db: database.db, taskLogStore: createTaskLogStore({ db: database.db }) });
    let store = makeStore();
    for (const [role, file] of Object.entries(files)) store.saveSelection(role, file);
    const outputPath = path.join(directory, '黄金回归检查记录.docx');
    store.saveOutputPath(outputPath);
    const service = createTechnicalPlanCheckService({
      app, technicalPlanCheckStore: store,
      configStore: { load: () => ({ components: { file_parser: { provider: 'local' } } }) },
      dialog: {}, shell: {},
    });
    const prepareDocuments = service.prepareDocuments;
    service.prepareDocuments = (state, callback, options) => prepareDocuments(state, (prepared) => {
      assert.deepEqual(Object.fromEntries(Object.entries(prepared.documents).map(([key, lines]) => [key, lines.length])), expected.lineCounts);
      assert.equal(prepared.proposalDocxPath, files.proposal.path);
      return callback(prepared);
    }, options);
    const stages = [];
    let writerResult;
    let writerCompleted = false;
    let successCount = 0;
    const task = { task_id: 'technical-plan-check-golden', type: 'technical-plan-check', status: 'running', progress: 0, logs: [] };
    store.checkpointTask(task, {});
    await runTechnicalPlanCheckTask({
      technicalPlanCheckService: service,
      previousState: store.loadState(),
      taskControl: { signal: new AbortController().signal },
      checkpointTask(patch, workspacePatch) {
        if (patch.status === 'success') {
          assert.equal(writerCompleted, true, 'Success must be persisted only after the real writer returns');
          successCount += 1;
        } else stages.push(patch.stats.stage);
        Object.assign(task, patch);
        const persisted = store.checkpointTask(task, workspacePatch);
        assert.equal(persisted.checkTask.status, patch.status);
        assert.deepEqual(persisted.checkTask.logs, patch.logs);
        assert.deepEqual(persisted.checkTask.stats, patch.stats);
      },
    }, {
      async writeTechnicalPlanCheckReport(options) {
        writerResult = options.result;
        const written = await writeTechnicalPlanCheckReport(options);
        assertReport(written.reportPath, files, options.result);
        writerCompleted = true;
        return written;
      },
    });
    assert.deepEqual(stages, CHECK_STAGES);
    assert.equal(stages.length, 13);
    assert.equal(successCount, 1);
    assert.deepEqual(writerResult.summary, expected.summary);
    assert.equal(writerResult.requirementCount, expected.requirementCount);
    assert.equal(writerResult.scoreItemCount, expected.scoreItemCount);
    assert.deepEqual(writerResult.formatStats, expected.formatStats);
    assert.equal(sha256(JSON.stringify(writerResult.findings)), expected.findingsSHA256, 'Golden findings changed; review rule behavior before updating the fixed baseline');
    const persisted = store.loadState();
    assert.equal(persisted.reportPath, outputPath);
    assert.deepEqual(persisted.summary, expected.summary);
    assert.equal(persisted.checkTask.status, 'success');
    assert.equal(persisted.checkTask.progress, 100);
    assert.deepEqual(persisted.checkTask.logs, [...CHECK_STAGES.map((stage, index) => `${index + 1}/13 ${stage}`), '技术方案检查完成，检查记录已生成']);
    database.close();
    database = createSqliteDatabase(app);
    store = makeStore();
    assert.deepEqual(store.loadState(), persisted, 'SQLite results and all thirteen stage logs must survive reopening');
  } finally {
    database?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(fixtureSnapshot(files), before, 'Golden inputs and existing report must remain unchanged');
  }
}

if (process.argv.includes('--electron-native')) {
  runGoldenAssertions().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => process.exit(process.exitCode || 0));
} else {
  test('external four-document golden regression: real parser, worker, thirteen stages, SQLite and DOCX contents', { timeout: 120000 }, () => {
    inputFiles();
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8', timeout: 110000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron golden regression timed out');
  });
}
