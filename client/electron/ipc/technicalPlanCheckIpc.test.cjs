const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function loadIpc(file, ipcMain) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    module, require: () => ({ ipcMain }),
  }, { filename: file });
  return module.exports;
}

function createHarness(service) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), on() {} };
  const file = path.join(__dirname, 'technicalPlanCheckIpc.cjs');
  assert.ok(fs.existsSync(file), 'technical plan check IPC is implemented');
  loadIpc('technicalPlanCheckIpc.cjs', ipcMain).registerTechnicalPlanCheckIpc({ technicalPlanCheckService: service });
  return handlers;
}

test('feature IPC forwards load and selections as bare snapshots without progress channels', async () => {
  const snapshot = { tenderFile: null, reportPath: '' };
  const roles = [];
  const handlers = createHarness({
    loadState: () => snapshot,
    selectInput: (role) => { roles.push(role); return snapshot; },
    selectOutput: () => snapshot,
    openReport: () => ({ success: true }),
  });
  assert.deepEqual([...handlers.keys()], [
    'technical-plan-check:load-state', 'technical-plan-check:select-input',
    'technical-plan-check:select-output', 'technical-plan-check:open-report',
  ]);
  assert.equal(await handlers.get('technical-plan-check:load-state')(), snapshot);
  assert.equal(await handlers.get('technical-plan-check:select-input')({}, 'proposal'), snapshot);
  assert.equal(await handlers.get('technical-plan-check:select-output')(), snapshot);
  assert.deepEqual(roles, ['proposal']);
  assert.equal((await handlers.get('technical-plan-check:open-report')()).success, true);
});

test('only opening report wraps errors; snapshot and selection errors propagate', async () => {
  const failure = new Error('report unavailable');
  const fail = () => { throw failure; };
  const handlers = createHarness({ loadState: fail, selectInput: fail, selectOutput: fail, openReport: fail });
  for (const channel of ['load-state', 'select-input', 'select-output']) {
    await assert.rejects(async () => handlers.get(`technical-plan-check:${channel}`)({}, 'tender'), failure);
  }
  const result = await handlers.get('technical-plan-check:open-report')();
  assert.equal(result.success, false);
  assert.equal(result.message, failure.message);
});

test('task start subscribes sender before service start and returns service result', () => {
  const handlers = new Map();
  const sender = {};
  const calls = [];
  const result = { task_id: 'check-1' };
  const { registerTaskIpc } = loadIpc('taskIpc.cjs', { handle: (channel, handler) => handlers.set(channel, handler), on() {} });
  registerTaskIpc({ taskService: {
    subscribe: (value) => calls.push(['subscribe', value]),
    startTechnicalPlanCheck: () => { calls.push(['start']); return result; },
  } });
  const handler = handlers.get('tasks:start-technical-plan-check');
  assert.equal(typeof handler, 'function');
  assert.equal(handler({ sender }), result);
  assert.deepEqual(calls, [['subscribe', sender], ['start']]);
});

test('preload exposes matching feature commands and task start without a progress event', async () => {
  const invocations = [];
  let bridge;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8'), {
    process: { platform: 'win32' },
    require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { if (name === 'yibiao') bridge = value; } },
      ipcRenderer: { invoke: (...args) => { invocations.push(args); return Promise.resolve('snapshot'); } } }),
  });
  assert.ok(bridge.technicalPlanCheck);
  assert.deepEqual(Object.keys(bridge.technicalPlanCheck), ['loadState', 'selectInput', 'selectOutput', 'openReport']);
  await bridge.technicalPlanCheck.loadState();
  await bridge.technicalPlanCheck.selectInput('scoring');
  await bridge.technicalPlanCheck.selectOutput();
  await bridge.technicalPlanCheck.openReport();
  await bridge.tasks.startTechnicalPlanCheck();
  assert.deepEqual(invocations, [
    ['technical-plan-check:load-state'], ['technical-plan-check:select-input', 'scoring'],
    ['technical-plan-check:select-output'], ['technical-plan-check:open-report'], ['tasks:start-technical-plan-check'],
  ]);
});
