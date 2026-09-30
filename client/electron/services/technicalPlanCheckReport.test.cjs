const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const cheerio = require('cheerio');
const { Packer } = require('docx');
const {
  buildTechnicalPlanCheckReport,
  writeTechnicalPlanCheckReport,
} = require('./technicalPlanCheckReport.cjs');

const files = {
  tender: { path: '招标 文件.docx', name: '招标 文件.docx' },
  requirements: { path: '采购需求.docx', name: '采购需求.docx' },
  scoring: { path: '主观分标准.docx', name: '主观分标准.docx' },
  proposal: { path: '技术方案.docx', name: '技术方案.docx' },
};
const result = {
  findings: [
    { ruleId: 'requirement.partial', severity: 'review', category: '采购需求响应性', message: '需求响应不足', contexts: ['需求摘录'], requirement: '需配备人员', missing: ['人员'], coverage: 0.4 },
    { ruleId: 'score.missing', severity: 'review', category: '主观分评分标准覆盖', message: '评分未覆盖', contexts: ['评分摘录'], desc: '质量保障方案', score: 5, missing: ['保障'] },
    { ruleId: 'format.alignment', severity: 'issue', category: '格式与排版', message: '段落对齐不一致', contexts: ['第3段'] },
    { ruleId: 'time.inconsistent', severity: 'review', category: '时间前后冲突', message: '方案内部期限不一致', contexts: ['30天', '45天'] },
    { ruleId: 'check.statistics', severity: 'info', category: '语言表达', message: '统计说明', contexts: [] },
  ],
  summary: { total: 5, issue: 1, review: 3, info: 1, req_unresp: 0, req_part: 1, score_uncov: 1, score_pcov: 0, internal_total: 3 },
  formatStats: { cap: 100, rawTotal: 103, returnedTotal: 1, truncatedTotal: 102, rules: { 'format.alignment': { rawCount: 103, returnedCount: 1, truncatedCount: 102 } } },
  requirementCount: 4,
  scoreItemCount: 3,
};

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '技术方案报告 测试-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    directory,
    outputPath: path.join(directory, '检查 记录.docx'),
    files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { ...file, path: path.join(directory, file.path) }])),
  };
}

async function reportXml(options) {
  const buffer = await Packer.toBuffer(buildTechnicalPlanCheckReport(options));
  assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304');
  return new AdmZip(buffer).readAsText('word/document.xml', 'utf8');
}

function xmlText(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('w\\:t').toArray().map((node) => $(node).text()).join('\n');
}

test('真实 DOCX 包含标题、四个来源、汇总表、各章节与三级严重性中文文案', async () => {
  const xml = await reportXml({ result, files });
  const text = xmlText(xml);
  for (const expected of [
    '投标技术方案检查记录', ...Object.values(files).map((file) => file.name),
    '检查结论汇总', '采购需求响应情况', '主观分评分标准覆盖情况', '格式与排版',
    '方案内部问题', '提示', '待复核', '明确问题', '需配备人员', '质量保障方案',
    '需求响应不足', '统计说明', '方案内部期限不一致', '30天', '45天', '原始发现数', '103', '102',
  ]) assert.ok(text.includes(expected), expected);
  assert.ok((xml.match(/<w:tbl>/g) || []).length >= 5);
  assert.ok(text.includes('方案内部期限检查'));
  assert.ok(!text.includes('含与招标文件交叉核对'));
  assert.ok(!text.includes('全部响应'));
});

test('没有发现时仅记录无检查发现，不生成成功响应条目', async () => {
  const text = xmlText(await reportXml({ files, result: { ...result, findings: [], formatStats: null } }));
  assert.ok(text.includes('本节无检查发现'));
  assert.ok(text.includes('仅列出检查发现，不代表全量响应或覆盖结论'));
  assert.ok(!text.includes('全部响应'));
  assert.ok(!text.includes('全部覆盖'));
});

test('未命名来源使用路径文件名，特殊字符保存在真实 DOCX 文本中', async () => {
  const specialFiles = { ...files, tender: { path: path.join('中文 空格', '招标&A<1>.docx') } };
  const text = xmlText(await reportXml({ result, files: specialFiles }));
  assert.ok(text.includes('招标&A<1>.docx'));
});

test('真实文件系统生成合法 DOCX，并完整替换旧报告且不残留临时或备份', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const written = await writeTechnicalPlanCheckReport({ ...options, result });
  assert.deepEqual(written, { reportPath: options.outputPath });
  const zip = new AdmZip(await fs.readFile(options.outputPath));
  assert.ok(xmlText(zip.readAsText('word/document.xml', 'utf8')).includes('投标技术方案检查记录'));
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

for (const key of Object.keys(files)) {
  test(`输出等于 ${key} 输入时拒绝且不改变原文件`, async (t) => {
    const options = await fixture(t);
    const outputPath = options.files[key].path;
    await fs.writeFile(outputPath, '输入文件原文', 'utf8');
    await assert.rejects(writeTechnicalPlanCheckReport({ ...options, outputPath, result }), { code: 'REPORT_INPUT_COLLISION' });
    assert.equal(await fs.readFile(outputPath, 'utf8'), '输入文件原文');
    assert.deepEqual(await fs.readdir(options.directory), [path.basename(outputPath)]);
  });
}

test('Windows 路径规范化拒绝中文、空格、大小写和相对路径变体碰撞', async (t) => {
  const options = await fixture(t);
  options.files.proposal.path = path.join(options.directory, '方案 File.DOCX');
  const outputPath = path.join(options.directory, '.', '方案 file.docx');
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, outputPath, result }, { platform: 'win32' }), { code: 'REPORT_INPUT_COLLISION' });
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('打包失败不会创建目标或残留临时文件', async (t) => {
  const options = await fixture(t);
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result }, { pack: async () => { throw new Error('打包失败'); } }), /打包失败/);
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('临时文件部分写入失败会清理临时文件并保留旧报告', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const failingFs = { ...fs, writeFile: async (...args) => { await fs.writeFile(...args); throw new Error('写入失败'); } };
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result }, { fs: failingFs }), /写入失败/);
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

test('无 ZIP 头的生成结果被拒绝，旧报告和目录保持不变', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result }, { pack: async () => Buffer.from('not docx') }), { code: 'INVALID_REPORT_DOCX' });
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

test('替换失败恢复旧报告并清理临时和备份', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const failingFs = { ...fs, rename: async (source, target) => {
    if (source.includes('.tmp-') && target === options.outputPath) throw new Error('替换失败');
    return fs.rename(source, target);
  } };
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result }, { fs: failingFs, platform: 'win32' }), /替换失败/);
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

test('恢复也失败时保留唯一旧报告备份，并返回备份路径', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const failingFs = { ...fs, rename: async (source, target) => {
    if (target === options.outputPath) throw new Error('目标持续占用');
    return fs.rename(source, target);
  } };
  let failure;
  try { await writeTechnicalPlanCheckReport({ ...options, result }, { fs: failingFs, platform: 'win32' }); } catch (error) { failure = error; }
  assert.ok(failure.backupPath);
  assert.equal(await fs.readFile(failure.backupPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), [path.basename(failure.backupPath)]);
});

test('打包异步等待期间取消不会生成报告', async (t) => {
  const options = await fixture(t);
  const controller = new AbortController();
  let continuePack;
  const packed = new Promise((resolve) => { continuePack = resolve; });
  const pending = writeTechnicalPlanCheckReport({ ...options, result, signal: controller.signal }, { pack: async (document) => { await packed; return Packer.toBuffer(document); } });
  controller.abort();
  continuePack();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('临时文件写入结束时取消不替换旧报告', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const controller = new AbortController();
  const cancellingFs = { ...fs, writeFile: async (...args) => { await fs.writeFile(...args); controller.abort(); } };
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result, signal: controller.signal }, { fs: cancellingFs }), { name: 'AbortError' });
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

for (const stage of ['backup', 'install']) {
  test(`${stage} 重命名异步取消时回滚旧报告`, async (t) => {
    const options = await fixture(t);
    await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
    const controller = new AbortController();
    const cancellingFs = { ...fs, rename: async (source, target) => {
      await fs.rename(source, target);
      if ((stage === 'backup' && target.includes('.bak-')) || (stage === 'install' && source.includes('.tmp-'))) controller.abort();
    } };
    await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result, signal: controller.signal }, { fs: cancellingFs, platform: 'win32' }), { name: 'AbortError' });
    assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
    assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
  });
}

test('新目标安装时取消会删除新报告而不留下临时文件', async (t) => {
  const options = await fixture(t);
  const controller = new AbortController();
  const cancellingFs = { ...fs, rename: async (source, target) => { await fs.rename(source, target); controller.abort(); } };
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result, signal: controller.signal }, { fs: cancellingFs }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(options.directory), []);
});

test('备份重命名失败时旧报告仍完整且临时文件清理完成', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const failingFs = { ...fs, rename: async (source, target) => {
    if (source === options.outputPath) throw new Error('旧报告被占用');
    return fs.rename(source, target);
  } };
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result }, { fs: failingFs }), /旧报告被占用/);
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

test('清理失败不掩盖原始替换错误及唯一备份位置', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const failingFs = { ...fs,
    rename: async (source, target) => {
      if (target === options.outputPath) throw new Error('目标持续占用');
      return fs.rename(source, target);
    },
    rm: async (filePath, rmOptions) => {
      if (filePath.includes('.tmp-')) throw new Error('临时文件被占用');
      return fs.rm(filePath, rmOptions);
    },
  };
  let failure;
  try { await writeTechnicalPlanCheckReport({ ...options, result }, { fs: failingFs }); } catch (error) { failure = error; }
  assert.equal(failure.message, '目标持续占用');
  assert.equal(failure.cleanupError.message, '临时文件被占用');
  assert.equal(await fs.readFile(failure.backupPath, 'utf8'), '旧报告内容');
  assert.equal((await fs.readdir(options.directory)).length, 2);
});

test('最终备份清理失败时恢复旧报告', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  await assert.rejects(writeTechnicalPlanCheckReport({ ...options, result }, {
    removeBackup: () => { throw new Error('备份删除失败'); },
  }), /备份删除失败/);
  assert.equal(await fs.readFile(options.outputPath, 'utf8'), '旧报告内容');
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});

test('最后 signal 检查之后同步删除备份并返回，不让出事件循环清理文件', async (t) => {
  const options = await fixture(t);
  await fs.writeFile(options.outputPath, '旧报告内容', 'utf8');
  const controller = new AbortController();
  let synchronouslyRemoved = false;
  const strictFs = { ...fs, rm: async (filePath, rmOptions) => {
    if (filePath.includes('.bak-')) throw new Error('不允许异步清理备份');
    return fs.rm(filePath, rmOptions);
  } };
  const written = await writeTechnicalPlanCheckReport({ ...options, result, signal: controller.signal }, {
    fs: strictFs,
    removeBackup: (backupPath) => {
      assert.equal(controller.signal.aborted, false);
      fsSync.rmSync(backupPath, { force: true });
      synchronouslyRemoved = true;
    },
  });
  assert.equal(synchronouslyRemoved, true);
  assert.deepEqual(written, { reportPath: options.outputPath });
  assert.deepEqual(await fs.readdir(options.directory), ['检查 记录.docx']);
});
