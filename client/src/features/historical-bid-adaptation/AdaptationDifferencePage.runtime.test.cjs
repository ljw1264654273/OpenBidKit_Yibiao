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
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(`${process.env.YIBIAO_UI_TEST_URL}/@vite/client`);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const refresh = await import('/@react-refresh');
      refresh.default.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { ToastProvider } = await import('/src/shared/ui/ToastProvider.tsx');
      const { default: DifferencePage } = await import('/src/features/historical-bid-adaptation/components/AdaptationDifferencePage.tsx');
      const errors = [];
      window.addEventListener('error', (event) => errors.push(event.error?.stack || event.message));
      document.body.innerHTML = '<div id="ui-test-root"></div>';
      const differences = Array.from({ length: 8 }, (_, index) => ({
        id: 'review-' + index, category: '其他人工判断', priority: 'medium',
        title: '待复核事项 ' + index, historical_location: '项目概况',
        historical_excerpt: '旧服务要求', tender_requirement: '新服务要求',
        action: '人工核对', note: '', decision: 'pending', content_change_scope: 'none',
        difference_schema_version: 2, target_action: 'review', evidence_kind: 'contextual',
        confidence: 'low', old_content_evidence: [], replacements: [],
      }));
      const root = ReactDOM.createRoot(document.getElementById('ui-test-root'), {
        onUncaughtError: (error) => errors.push(error.stack || String(error)),
      });
      root.render(React.createElement(React.StrictMode, null,
        React.createElement(ToastProvider, null, React.createElement(DifferencePage, {
          projectId: 'runtime-test', project: { projectName: 'Runtime test' },
          state: { historicalAdaptationDifferences: differences },
          onStateChange() {}, onBack() {}, onContinue() {},
        }))));
      const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
      await settle();
      const initialCount = document.querySelectorAll('details[open]').length;
      const toggleCounts = [];
      for (let cycle = 0; cycle < 4; cycle++) {
        document.querySelectorAll('details summary').forEach((summary) => summary.click());
        await settle();
        toggleCounts.push(document.querySelectorAll('details[open]').length);
      }
      const finalCount = document.querySelectorAll('.historical-adaptation-difference-item').length;
      root.unmount();
      return { errors, initialCount, finalCount, toggleCounts };
    })()`);
    console.log(JSON.stringify(result));
    assert.deepEqual(result.errors, [], result.errors.join('\n'));
    assert.equal(result.initialCount, 8, 'All review items should open without crashing');
    assert.equal(result.finalCount, 8, 'Repeated toggles should keep the page mounted');
    assert.deepEqual(result.toggleCounts, [0, 8, 0, 8], 'Each toggle should update the open state');
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
  const test = require('node:test');
  test('第三步多个人工复核项自动展开及反复切换不会白屏', { timeout: 45000 }, async () => {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const value = server.address().port;
        server.close(() => resolve(value));
      });
    });
    const url = `http://127.0.0.1:${port}`;
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-difference-ui-'));
    const clientPath = path.resolve(__dirname, '../../..');
    const vite = spawn(process.execPath, [path.join(clientPath, 'node_modules/vite/bin/vite.js'),
      '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: clientPath, stdio: 'ignore' });
    try {
      const deadline = Date.now() + 20000;
      let ready = false;
      while (Date.now() < deadline && !ready) {
        try { ready = (await fetch(url)).ok; } catch {}
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, 'Isolated Vite test server should start');
      const result = spawnSync(require('electron'), [__filename, '--electron-ui'], {
        env: { ...process.env, YIBIAO_UI_TEST_URL: url, YIBIAO_UI_TEST_USER_DATA: userDataPath },
        encoding: 'utf8', timeout: 20000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron UI test timed out');
    } finally {
      vite.kill();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
}
