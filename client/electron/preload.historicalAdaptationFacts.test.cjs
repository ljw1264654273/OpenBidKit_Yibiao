const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const preloadPath = path.join(__dirname, 'preload.cjs');
const preloadSource = fs.readFileSync(preloadPath, 'utf8');

test('preload 暴露全文事实读取和修正保存 API 并转发到对应 IPC 通道', () => {
  const exposed = {};
  const invocations = [];
  const ipcRenderer = {
    invoke: (channel, payload) => {
      invocations.push({ channel, payload });
      return Promise.resolve();
    },
    on: () => undefined,
    removeListener: () => undefined,
    send: () => undefined,
  };
  const context = {
    process: { platform: 'win32' },
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
        ipcRenderer,
        webUtils: { getPathForFile: () => '' },
      };
    },
  };

  vm.runInNewContext(preloadSource, context, { filename: preloadPath });

  const payload = { projectId: 'project-1' };
  assert.equal(typeof exposed.yibiao.technicalPlan.getHistoricalAdaptationContentFacts, 'function');
  assert.equal(typeof exposed.yibiao.technicalPlan.saveHistoricalAdaptationContentFactOverrides, 'function');
  exposed.yibiao.technicalPlan.getHistoricalAdaptationContentFacts(payload);
  exposed.yibiao.technicalPlan.saveHistoricalAdaptationContentFactOverrides(payload);
  assert.deepEqual(invocations.map(({ channel }) => channel), [
    'technical-plan:get-historical-adaptation-content-facts',
    'technical-plan:save-historical-adaptation-content-fact-overrides',
  ]);
});

test('事实查询和保存通道已注册且包含在工作区数据库通道集合中', () => {
  const ipc = fs.readFileSync(path.join(__dirname, 'ipc/technicalPlanIpc.cjs'), 'utf8');
  const channels = fs.readFileSync(path.join(__dirname, 'ipc/index.cjs'), 'utf8');
  const types = fs.readFileSync(path.join(__dirname, '../src/shared/types/ipc.ts'), 'utf8');

  for (const [channel, method] of [
    ['technical-plan:get-historical-adaptation-content-facts', 'getHistoricalAdaptationContentFacts'],
    ['technical-plan:save-historical-adaptation-content-fact-overrides', 'saveHistoricalAdaptationContentFactOverrides'],
  ]) {
    assert.match(ipc, new RegExp(`ipcMain\\.handle\\(['"]${channel}['"]`));
    assert.match(channels, new RegExp(`['"]${channel}['"]`));
    assert.match(types, new RegExp(`${method}:`));
  }
});
