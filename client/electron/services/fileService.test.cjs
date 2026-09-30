const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const AdmZip = require('adm-zip');

function parserHarness(provider, { abortAt, signal = true } = {}) {
  const controller = new AbortController();
  const reason = Object.assign(new Error('取消文件解析'), { code: 'TASK_CANCELLED' });
  const calls = [];
  const requestSignals = [];
  let activeRequests = 0;
  let activeTimers = 0;
  let sleeps = 0;
  let pendingPoll = abortAt === 'sleep';
  const accurate = provider === 'mineru-accurate-api';
  const zip = new AdmZip();
  zip.addFile('full.md', Buffer.from('解析正文', 'utf8'));
  const zipBuffer = zip.toBuffer();
  function response(stage) {
    const json = stage === 'create'
      ? { code: 0, data: accurate ? { batch_id: 'batch', file_urls: ['https://upload.test/file'] } : { task_id: 'task', file_url: 'https://upload.test/file' } }
      : { code: 0, data: accurate ? { extract_result: [{ file_name: '方案.docx', state: pendingPoll ? 'running' : 'done', full_zip_url: 'https://download.test/result' }] } : { state: pendingPoll ? 'running' : 'done', markdown_url: 'https://download.test/result' } };
    return {
      ok: true, status: 200, json: async () => json,
      text: async () => {
        if (abortAt === 'final') controller.abort(reason);
        return '解析正文';
      },
      arrayBuffer: async () => {
        if (abortAt === 'final') controller.abort(reason);
        return zipBuffer;
      },
    };
  }
  const fetch = async (url, options = {}) => {
    const stage = url.includes('upload.test') ? 'upload' : url.includes('download.test') ? 'download' : url.includes('file-urls') || url.endsWith('/file') ? 'create' : 'poll';
    calls.push(stage);
    requestSignals.push(options.signal);
    if (stage !== abortAt) return response(stage);
    activeRequests += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null, response(stage)), 30);
      const onAbort = () => finish(options.signal.reason);
      function finish(error, result) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        activeRequests -= 1;
        if (error) reject(error);
        else resolve(result);
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });
      setImmediate(() => controller.abort(reason));
    });
  };
  const timers = new Set();
  function pollSetTimeout(callback) {
    sleeps += 1;
    activeTimers += 1;
    const timer = setTimeout(() => {
      timers.delete(timer);
      activeTimers -= 1;
      pendingPoll = false;
      callback();
    }, 30);
    timers.add(timer);
    if (abortAt === 'sleep') setImmediate(() => controller.abort(reason));
    return timer;
  }
  function pollClearTimeout(timer) {
    if (timers.delete(timer)) activeTimers -= 1;
    clearTimeout(timer);
  }
  const modulePath = path.join(__dirname, 'fileService.cjs');
  const realRequire = createRequire(modulePath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), {
    module, Buffer, fetch, setTimeout: pollSetTimeout, clearTimeout: pollClearTimeout,
    console: { log() {} },
    require: (id) => {
      if (id === 'electron') return { dialog: {} };
      if (id === 'node:fs/promises') return { stat: async () => ({ size: 10, mtime: new Date() }), readFile: async () => Buffer.from('文档') };
      if (id === '../utils/developerLog.cjs') return { createDeveloperLogger: () => ({ write() {} }), compactLogError: (error) => error, textMetrics: () => ({}) };
      return realRequire(id);
    },
  }, { filename: modulePath });
  const parse = () => module.exports.parseDocumentWithConfig({}, 'C:/中文目录/方案.docx', {
    components: { file_parser: { provider, mineru_token: 'test-token' } },
  }, signal ? { signal: controller.signal } : {});
  return { parse, controller, reason, calls, requestSignals, activeRequests: () => activeRequests, activeTimers: () => activeTimers, sleeps: () => sleeps };
}

for (const provider of ['mineru-agent-api', 'mineru-accurate-api']) {
  for (const abortAt of ['create', 'upload', 'poll', 'download']) {
    test(`${provider} aborts active ${abortAt} request without continuing parser`, async () => {
      const h = parserHarness(provider, { abortAt });
      await assert.rejects(h.parse(), (error) => error === h.reason);
      assert.equal(h.calls.at(-1), abortAt);
      assert.ok(h.requestSignals.every((signal) => signal === h.controller.signal));
      assert.equal(h.activeRequests(), 0);
      assert.equal(h.activeTimers(), 0);
    });
  }
  test(`${provider} aborts poll sleep and clears timer without another request`, async () => {
    const h = parserHarness(provider, { abortAt: 'sleep' });
    await assert.rejects(h.parse(), (error) => error === h.reason);
    assert.deepEqual(h.calls, ['create', 'upload', 'poll']);
    assert.equal(h.sleeps(), 1);
    assert.equal(h.activeTimers(), 0);
  });
  test(`${provider} rejects initial cancellation before requests`, async () => {
    const h = parserHarness(provider);
    h.controller.abort(h.reason);
    await assert.rejects(h.parse(), (error) => error === h.reason);
    assert.deepEqual(h.calls, []);
  });
  test(`${provider} rejects cancellation at final parse boundary`, async () => {
    const h = parserHarness(provider, { abortAt: 'final' });
    await assert.rejects(h.parse(), (error) => error === h.reason);
    assert.deepEqual(h.calls, ['create', 'upload', 'poll', 'download']);
  });
  test(`${provider} preserves parsing behavior without optional signal`, async () => {
    const h = parserHarness(provider, { signal: false });
    assert.equal(await h.parse(), '解析正文');
    assert.deepEqual(h.calls, ['create', 'upload', 'poll', 'download']);
    assert.ok(h.requestSignals.every((signal) => signal === undefined));
  });
}
