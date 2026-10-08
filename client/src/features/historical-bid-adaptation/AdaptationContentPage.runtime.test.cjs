const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

async function runInElectron() {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', process.env.YIBIAO_UI_TEST_USER_DATA);
  let window;
  let exitCode = 0;
  try {
    await app.whenReady();
    window = new BrowserWindow({ show: false, width: 990, height: 850, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(`${process.env.YIBIAO_UI_TEST_URL}/@vite/client`);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const refresh = await import('/@react-refresh');
      refresh.default.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { ToastProvider } = await import('/src/shared/ui/ToastProvider.tsx');
      const { default: ContentPage } = await import('/src/features/historical-bid-adaptation/components/AdaptationContentPage.tsx');
      const errors = [];
      window.addEventListener('error', (event) => errors.push(event.error?.stack || event.message));
      const state = {
        outlineData: { outline: [{ id: '1', title: '概况', content: '项目名称：' }] },
        historicalAdaptationContentItems: [{ node_id: '1', status: 'success', residuals: [], difference_ids: [] }],
        historicalAdaptationOutlineChanges: [], historicalAdaptationDifferences: [],
        historicalAdaptationContentCheck: { status: 'error', stage: 'facts', error: '全文事实表缺少关键名称事实',
          findings: [{ id: 'global', severity: 'P0', blocking: true, node_ids: [], message: '自动一致性检查未完成，请人工处理' }] },
      };
      let overrides = [];
      let starts = 0;
      let failStart = false;
      const saves = [];
      window.yibiao = {
        technicalPlan: {
          getHistoricalAdaptationSourceSection: async () => ({ available: false, error: '无历史来源' }),
          getHistoricalAdaptationContentFacts: async () => ({ ok: false, code: 'unavailable', message: '未完成事实提取',
            contentHash: 'content', inputsHash: 'inputs', protocolHash: 'protocol', facts: [], overrides }),
          saveHistoricalAdaptationContentFactOverrides: async (payload) => {
            saves.push(payload);
            const next = new Map(overrides.map((item) => [item.fact_key, item]));
            for (const item of payload.overrides) { if (item.canonical_value) next.set(item.fact_key, item); else next.delete(item.fact_key); }
            overrides = [...next.values()];
            return { ok: true, overrides, contentHash: 'content', inputsHash: 'inputs', protocolHash: 'protocol' };
          },
          loadState: async () => state,
        },
        tasks: { startHistoricalAdaptationContentCheck: async () => { starts++; if (failStart) throw new Error('网络未连接'); } },
      };
      document.body.innerHTML = '<div id="ui-test-root"></div>';
      const root = ReactDOM.createRoot(document.getElementById('ui-test-root'), { onUncaughtError: (error) => errors.push(error.stack || String(error)) });
      root.render(React.createElement(ToastProvider, null, React.createElement(ContentPage, {
        projectId: 'runtime', project: null, state, onStateChange() {}, onPreparePlan: async () => state, onDirtyChange() {}, onBack() {},
      })));
      const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
      const clickText = (text) => Array.from(document.querySelectorAll('button')).find((button) => button.textContent === text)?.click();
      const setInput = (element, value) => {
        if (!element) throw new Error('Expected editable fact input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const mountDeadline = Date.now() + 15000;
      while (!document.querySelector('.adaptation-content-check-findings button') && !errors.length && Date.now() < mountDeadline) await settle();
      const blocker = document.querySelector('.adaptation-content-check-findings button');
      if (!blocker) throw new Error(errors.join(' / ') || 'Content page did not mount: ' + document.body.textContent);
      blocker.click();
      await settle();
      const blockerOpened = Boolean(document.querySelector('[role="dialog"]'));
      if (!blockerOpened) { root.unmount(); return { errors, blockerOpened }; }
      setInput(document.querySelector('.historical-adaptation-fact-add input'), '人工确认项目');
      await settle();
      clickText('添加事实');
      await settle();
      clickText('保存修正并重新检查');
      await settle();
      // 读取失败快照时也必须展示之前补录的值，并允许继续编辑。
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      clickText('查看全文事实');
      await settle();
      const persistedValue = document.querySelector('.historical-adaptation-fact-entry input')?.value;
      failStart = true;
      setInput(document.querySelector('.historical-adaptation-fact-entry input'), '人工确认项目二');
      await settle();
      clickText('保存修正并重新检查');
      await settle();
      const savedButStartFailed = document.body.textContent.includes('事实修正已保存，但重新检查启动失败');
      const stateAfterSave = document.querySelector('.historical-adaptation-fact-entry input')?.value;
      failStart = false;
      setInput(document.querySelector('.historical-adaptation-fact-entry input'), '');
      await settle();
      clickText('保存修正并重新检查');
      await settle();
      const deleted = overrides.length === 0;
      if (${Boolean(process.env.YIBIAO_UI_TEST_SCREENSHOT_DIR)}) {
        document.querySelectorAll('.app-toast-close').forEach((button) => button.click());
        await settle();
        setInput(document.querySelector('.historical-adaptation-fact-add input'), '横泾街道房地一体农村不动产登记服务项目');
        await settle();
        clickText('添加事实');
        await settle();
      }
      return { errors, blockerOpened, persistedValue, saves, starts, savedButStartFailed, stateAfterSave, deleted };
    })()`);
    assert.deepEqual(result.errors, [], result.errors.join('\n'));
    assert.equal(result.blockerOpened, true, 'Global blocker must open the fact repair dialog');
    assert.equal(result.persistedValue, '人工确认项目');
    assert.equal(result.saves[0].overrides[0].fact_key, 'name:project_name:项目名称');
    assert.equal(result.saves[0].expectedContentHash, 'content');
    assert.equal(result.saves[0].expectedInputsHash, 'inputs');
    assert.equal(result.starts, 3);
    assert.equal(result.savedButStartFailed, true);
    assert.equal(result.stateAfterSave, '人工确认项目二');
    assert.equal(result.deleted, true, 'Clearing a manual addition must remove it');
    if (process.env.YIBIAO_UI_TEST_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.YIBIAO_UI_TEST_SCREENSHOT_DIR, { recursive: true });
      for (const width of [1000, 420]) {
        window.setSize(width, 850);
        await new Promise((resolve) => setTimeout(resolve, 200));
        fs.writeFileSync(path.join(process.env.YIBIAO_UI_TEST_SCREENSHOT_DIR, `fact-repair-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    window?.destroy();
    app.exit(exitCode);
  }
}

if (process.argv.includes('--electron-ui')) {
  void runInElectron();
} else {
  require('node:test')('全局阻断可打开补录，保存、重读、启动失败与删除形成处理闭环', { timeout: 45000 }, async () => {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
    });
    const url = `http://127.0.0.1:${port}`;
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-fact-repair-ui-'));
    const clientPath = path.resolve(__dirname, '../../..');
    const vite = spawn(process.execPath, [path.join(clientPath, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: clientPath, stdio: 'ignore' });
    try {
      const deadline = Date.now() + 20000;
      let ready = false;
      while (Date.now() < deadline && !ready) {
        try { ready = (await fetch(url)).ok; } catch {}
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, 'Isolated Vite test server should start');
      const result = spawnSync(require('electron'), [__filename, '--electron-ui'], {
        env: { ...process.env, YIBIAO_UI_TEST_URL: url, YIBIAO_UI_TEST_USER_DATA: userDataPath }, encoding: 'utf8', timeout: 25000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron UI test timed out');
    } finally {
      vite.kill();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
}
