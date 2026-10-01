const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { registerExportIpc } = require('./exportIpc.cjs');
const { buildDocxResult } = require('../services/exportService.cjs');

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function createIpcStub() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
}

test('通用 Word 导出根据项目上下文补齐项目级图片目录', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-export-ipc-'));
  const ipc = createIpcStub();
  let receivedPayload = null;
  const imagePath = path.join(
    userDataDir,
    'workspace',
    'bid-projects',
    'project-1',
    'technical-plan',
    'generated-illustrations',
    'revision-1',
    'item-1.png',
  );
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, onePixelPng);

  try {
    registerExportIpc({
      app: { getPath: () => userDataDir },
      ipcMain: ipc,
      exportService: {
        exportWord: async (payload) => {
          receivedPayload = payload;
          return buildDocxResult(payload);
        },
      },
    });

    const result = await ipc.handlers.get('export:word')(
      { sender: { send() {} } },
      {
        project_name: '项目级图片导出',
        project_id: 'project-1',
        outline: [{
          id: '1',
          title: '项目组织机构架构图',
          content: '![项目组织机构架构图](yibiao-asset://generated-images/technical-plan/illustrations/revision-1/item-1.png)',
        }],
      },
    );

    assert.equal(
      receivedPayload.project_technical_plan_dir,
      path.join(userDataDir, 'workspace', 'bid-projects', 'project-1', 'technical-plan'),
    );
    assert.deepEqual(result.warnings, []);
    assert.ok(new AdmZip(result.buffer).getEntries().some((entry) => entry.entryName.startsWith('word/media/')));
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('历史标书适配导出必须经过 Main 侧终审门禁', async () => {
  const ipc = createIpcStub();
  let exports = 0;
  let checkedProjectId = '';
  const store = {
    assertHistoricalAdaptationExportAllowed() {
      checkedProjectId = 'project-review';
    },
  };
  registerExportIpc({
    app: { getPath: () => os.tmpdir() },
    ipcMain: ipc,
    bidProjectManager: { getTechnicalPlanStore: (projectId) => projectId === 'project-review' ? store : null },
    exportService: { exportWord: async () => { exports += 1; return { success: true }; } },
  });

  await ipc.handlers.get('export:word')(
    { sender: { send() {} } },
    { project_id: 'project-review', historical_adaptation: true, outline: [] },
  );
  assert.equal(checkedProjectId, 'project-review');
  assert.equal(exports, 1);

  await assert.rejects(ipc.handlers.get('export:word')(
    { sender: { send() {} } },
    { project_id: 'missing-project', historical_adaptation: true, outline: [] },
  ), /未找到历史标书适配项目/);
  assert.equal(exports, 1);
});
