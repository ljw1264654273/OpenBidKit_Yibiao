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
