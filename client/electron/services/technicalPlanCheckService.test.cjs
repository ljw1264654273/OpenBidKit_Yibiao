const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTechnicalPlanCheckService } = require('./technicalPlanCheckService.cjs');

function harness({ provider = 'local', parse, proposal = 'C:/中文目录/方案.docx', platform, shellError = '', retryCallback = false } = {}) {
  let state = {
    tenderFile: { path: 'C:/中文目录/招标.docx', name: '招标.docx' },
    requirementsFile: { path: 'C:/中文目录/需求.docx', name: '需求.docx' },
    scoringFile: { path: 'C:/中文目录/评分.docx', name: '评分.docx' },
    proposalFile: { path: proposal, name: '方案.docx' },
    outputPath: 'C:/中文目录/方案检查记录.docx', reportPath: '',
  };
  const calls = [];
  let selected = { canceled: false, filePaths: ['C:/中文目录/新方案.docx'] };
  let temporaryExists = false;
  let conversionAttempts = 0;
  let onOpen = () => {};
  let createService = createTechnicalPlanCheckService;
  if (platform) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'technicalPlanCheckService.cjs'), 'utf8'), { module, require, process: { platform } });
    createService = module.exports.createTechnicalPlanCheckService;
  }
  const service = createService({
    app: {}, configStore: { load: () => ({ components: { file_parser: { provider } } }) },
    technicalPlanCheckStore: {
      loadState: () => state,
      saveSelection(role, file) {
        state = { ...state, [`${role}File`]: file };
        if (role === 'proposal') state.outputPath = 'C:/中文目录/新方案检查记录.docx';
        return state;
      },
      saveOutputPath(outputPath) { state = { ...state, outputPath }; return state; },
    },
    dialog: {
      showOpenDialog: async (options) => { calls.push(options); onOpen(); return selected; },
      showSaveDialog: async (options) => { calls.push(options); return { canceled: false, filePath: state.outputPath }; },
    },
    shell: { openPath: async (filePath) => { calls.push(filePath); return shellError; } },
    parseDocumentWithConfig: async (app, filePath, config, options) => {
      calls.push({ filePath, config, options });
      return parse ? parse(filePath, config, options) : '正文\n第二行';
    },
    withLegacyWordDocxFile: async (filePath, callback) => {
      temporaryExists = true;
      try {
        for (let backend = 0; backend < (retryCallback ? 2 : 1); backend += 1) {
          conversionAttempts += 1;
          try { return await callback('C:/临时/方案.docx'); } catch (error) {
            if (!retryCallback) throw error;
          }
        }
        throw new Error('所有 Office 转换组件失败');
      } finally { temporaryExists = false; }
    },
  });
  return { service, calls, getState: () => state, setState: (next) => { state = next; }, onOpen: (callback) => { onOpen = callback; }, cancel: () => { selected = { canceled: true, filePaths: [] }; }, temporaryExists: () => temporaryExists, conversionAttempts: () => conversionAttempts };
}

test('system selectors retain state on cancellation and let Store suggest output name', async () => {
  const h = harness();
  await h.service.selectInput('proposal');
  assert.equal(h.getState().outputPath, 'C:/中文目录/新方案检查记录.docx');
  assert.deepEqual(h.calls[0].filters[0].extensions, ['docx', 'pdf', 'doc', 'wps']);
  h.cancel();
  const before = h.getState();
  assert.equal(await h.service.selectInput('tender'), before);
  await h.service.selectOutput();
  assert.equal(h.calls.at(-1).defaultPath, before.outputPath);
});

test('selection and output replacement are blocked while running, including dialog race', async () => {
  const h = harness();
  h.setState({ ...h.getState(), checkTask: { status: 'running' } });
  await assert.rejects(h.service.selectInput('proposal'), /正在/);
  await assert.rejects(h.service.selectOutput(), /正在/);
  const raced = harness();
  raced.onOpen(() => raced.setState({ ...raced.getState(), checkTask: { status: 'running' } }));
  await assert.rejects(raced.service.selectInput('proposal'), /正在/);
  assert.equal(raced.getState().proposalFile.path, 'C:/中文目录/方案.docx');
});

test('text PDF always uses local parser even with remote provider configured', async () => {
  const h = harness({ provider: 'mineru-accurate-api', proposal: 'C:/中文目录/方案.pdf' });
  await h.service.prepareDocuments(h.getState(), async (documents) => {
    assert.deepEqual(documents.documents.proposalLines, ['正文', '第二行']);
    assert.equal(documents.proposalDocxPath, null);
  });
  assert.equal(h.calls.find((call) => call.filePath?.endsWith('.pdf')).config.components.file_parser.provider, 'local');
});

test('normalizes parsed HTML and Markdown through shared document adapter', async () => {
  const h = harness({ parse: () => '# 说明\n<table><tr><td>评分因素</td><td>实施方案<br>重点说明</td><td>10</td></tr></table>' });
  await h.service.prepareDocuments(h.getState(), (prepared) => {
    assert.deepEqual(prepared.documents.scoreLines, ['说明', '评分因素 | 实施方案 重点说明 | 10']);
  });
});

test('only missing PDF text layer falls back to configured OCR provider', async () => {
  const h = harness({ provider: 'mineru-agent-api', proposal: 'C:/中文目录/方案.pdf', parse: (filePath, config) => {
    if (filePath.endsWith('.pdf') && config.components.file_parser.provider === 'local') throw Object.assign(new Error('缺文字层'), { code: 'pdf_text_layer_missing' });
    return 'OCR正文';
  } });
  await h.service.prepareDocuments(h.getState(), async (prepared) => assert.deepEqual(prepared.documents.proposalLines, ['OCR正文']));
  assert.deepEqual(h.calls.filter((call) => call.filePath?.endsWith('.pdf')).map((call) => call.config.components.file_parser.provider), ['local', 'mineru-agent-api']);
  const broken = harness({ provider: 'mineru-agent-api', proposal: 'C:/中文目录/方案.pdf', parse: () => { throw Object.assign(new Error('文件损坏'), { code: 'broken' }); } });
  await assert.rejects(broken.service.prepareDocuments(broken.getState(), () => {}), /文件损坏/);
  assert.equal(broken.calls.length, 1);
});

test('scanned PDF without OCR explains settings, accurate token and Agent errors survive fallback', async () => {
  for (const [provider, message] of [['local', '设置'], ['mineru-accurate-api', '请先在设置中填写 MinerU Token'], ['mineru-agent-api', 'Agent API失败']]) {
    const h = harness({ provider, proposal: 'C:/中文目录/方案.pdf', parse: (filePath, config) => {
      if (!filePath.endsWith('.pdf')) return '参考正文';
      if (config.components.file_parser.provider === 'local') throw Object.assign(new Error('缺文字层'), { code: 'pdf_text_layer_missing' });
      throw new Error(message);
    } });
    await assert.rejects(h.service.prepareDocuments(h.getState(), () => {}), (error) => error.message.includes(message));
  }
});

test('DOC and WPS format scanning finishes inside temporary DOCX callback', async () => {
  for (const extension of ['doc', 'wps']) {
    const h = harness({ proposal: `C:/中文目录/方案.${extension}` });
    await h.service.prepareDocuments(h.getState(), async (prepared) => {
      assert.equal(h.temporaryExists(), true);
      assert.equal(prepared.proposalDocxPath, 'C:/临时/方案.docx');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.temporaryExists(), true);
    });
    assert.equal(h.temporaryExists(), false);
  }
});

for (const extension of ['doc', 'wps']) {
  for (const cancel of [false, true]) {
    test(`${extension.toUpperCase()} callback ${cancel ? 'cancellation' : 'failure'} bypasses conversion retries and preserves error after cleanup`, async () => {
      const h = harness({ proposal: `C:/中文目录/方案.${extension}`, retryCallback: true });
      const controller = new AbortController();
      const error = Object.assign(new Error(cancel ? '取消检查' : '格式检查失败'), { code: cancel ? 'TASK_CANCELLED' : 'CHECK_FAILED' });
      let callbacks = 0;
      await assert.rejects(h.service.prepareDocuments(h.getState(), async () => {
        callbacks += 1;
        assert.equal(h.temporaryExists(), true);
        if (cancel) {
          controller.abort(error);
          controller.signal.throwIfAborted();
        }
        throw error;
      }, { signal: controller.signal }), (actual) => {
        assert.equal(h.temporaryExists(), false);
        return actual === error;
      });
      assert.equal(callbacks, 1);
      assert.equal(h.conversionAttempts(), 1);
    });
  }
}

test('user input validation rejects unsupported documents and Windows output collision', async () => {
  const h = harness({ platform: 'win32' });
  await assert.rejects(h.service.prepareDocuments({ ...h.getState(), outputPath: 'c:\\中文目录\\方案.DOCX' }, () => {}), /输入/);
  await assert.rejects(h.service.prepareDocuments({ ...h.getState(), tenderFile: { path: 'C:/招标.txt' } }, () => {}), /格式/);
  await assert.rejects(h.service.prepareDocuments({ ...h.getState(), scoringFile: null }, () => {}), /评分/);
});

test('non-Windows output paths preserve case and resolve relative segments', async () => {
  const h = harness({ platform: 'linux', proposal: '/中文目录/方案.docx' });
  await assert.rejects(h.service.prepareDocuments({ ...h.getState(), outputPath: '/中文目录/子目录/../方案.docx' }, () => {}), /输入/);
  await h.service.prepareDocuments({ ...h.getState(), proposalFile: { path: '/中文目录/Proposal.docx' }, outputPath: '/中文目录/proposal.docx' }, () => {});
});

test('openReport opens the committed report and reports shell errors', async () => {
  const h = harness();
  await assert.rejects(h.service.openReport(), /检查记录/);
  h.setState({ ...h.getState(), reportPath: 'C:/中文目录/记录.docx' });
  assert.deepEqual(await h.service.openReport(), { success: true });
  assert.equal(h.calls.at(-1), 'C:/中文目录/记录.docx');
  assert.equal(h.service.loadState(), h.getState());
  const broken = harness({ shellError: '文件不存在' });
  broken.setState({ ...broken.getState(), reportPath: 'C:/中文目录/记录.docx' });
  await assert.rejects(broken.service.openReport(), /无法打开检查记录：文件不存在/);
});
