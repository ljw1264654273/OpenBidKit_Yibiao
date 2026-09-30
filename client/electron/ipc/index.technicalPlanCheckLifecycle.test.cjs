const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const channels = [
  'technical-plan-check:load-state', 'technical-plan-check:select-input',
  'technical-plan-check:select-output', 'technical-plan-check:open-report',
  'tasks:start-technical-plan-check',
];

function createHarness() {
  const handlers = new Map();
  const timers = [];
  const calls = [];
  const dependencies = {};
  let finishTasks;
  const taskSettlement = new Promise((resolve) => { finishTasks = resolve; });
  const taskService = { close: () => { calls.push('tasks:close'); return taskSettlement; } };
  const sqliteDatabase = { db: {}, close: () => calls.push('sqlite:close') };
  const checkStore = {};
  const checkService = {};
  const configStore = { load: () => ({}), save: () => ({}) };
  const factories = {
    createSqliteDatabase: () => sqliteDatabase,
    createTaskLogStore: () => ({ marker: 'task-log' }),
    createTechnicalPlanCheckStore: (options) => { dependencies.store = options; return checkStore; },
    createTechnicalPlanCheckService: (options) => { dependencies.service = options; return checkService; },
    createTaskService: (options) => { dependencies.task = options; return taskService; },
    createTemplateStore: () => ({ ensureBuiltInTemplate() {} }),
    createConfigStore: () => configStore,
    createRemoteKnowledgeDecisionService: () => ({ dispose: () => calls.push('remote:dispose') }),
    createAgentService: () => ({ close: async () => calls.push('agent:close') }),
    createAutoConfirmationService: () => ({ close: () => calls.push('confirmation:close') }),
    createOpenXmlHelperService: () => ({ close: async () => calls.push('openxml:close') }),
    checkRequiredOnlineServices: async () => {},
    registerTechnicalPlanCheckIpc: (options) => { dependencies.ipc = options; },
  };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: (channel) => handlers.delete(channel), on() {}, removeAllListeners() {},
  };
  const app = { relaunch: () => calls.push('app:relaunch'), exit: () => calls.push('app:exit') };
  const mainWindow = { isDestroyed: () => false,
    webContents: { isDestroyed: () => false, isLoading: () => false, send() {} } };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, 'index.cjs'), 'utf8');
  vm.runInNewContext(`${source}\nmodule.exports.workspaceServices = registerWorkspaceDatabaseServices;\nmodule.exports.pending = registerPendingWorkspaceDatabaseIpc;\nmodule.exports.unavailable = registerUnavailableWorkspaceDatabaseIpc;`, {
    module, process: { argv: ['electron', 'app'] }, URL,
    console: { warn() {}, error() {} },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    require: (name) => name === 'electron' ? { ipcMain, dialog: {}, shell: {}, clipboard: {} }
      : name.endsWith('.json') ? { config: {} }
        : new Proxy({}, { get: (_target, key) => factories[key] || (() => ({})) }),
  });
  function register() {
    return module.exports.registerIpcHandlers({ app, mainWindow, quitAndInstall: () => calls.push('app:install') });
  }
  function initialize() {
    timers.find(({ delay }) => delay === 120).callback();
  }
  return { handlers, timers, calls, dependencies, taskService, sqliteDatabase, checkStore,
    checkService, app, configStore, exports: module.exports, finishTasks, register, initialize };
}

test('workspace registration injects check store/service and returns task/database lifecycle handles', () => {
  const h = createHarness();
  const result = h.exports.workspaceServices({ app: h.app, configStore: h.configStore, updateStatus() {} });
  assert.equal(result.taskService, h.taskService);
  assert.equal(result.sqliteDatabase, h.sqliteDatabase);
  assert.equal(h.dependencies.store.db, h.sqliteDatabase.db);
  assert.equal(h.dependencies.store.taskLogStore.marker, 'task-log');
  assert.equal(h.dependencies.service.app, h.app);
  assert.equal(h.dependencies.service.configStore, h.configStore);
  assert.equal(h.dependencies.service.technicalPlanCheckStore, h.checkStore);
  assert.equal(h.dependencies.task.technicalPlanCheckStore, h.checkStore);
  assert.equal(h.dependencies.task.technicalPlanCheckService, h.checkService);
  assert.equal(h.dependencies.ipc.technicalPlanCheckService, h.checkService);
});

test('pending and unavailable handlers cover all five check commands', () => {
  const h = createHarness();
  h.exports.pending(() => ({ message: 'pending database' }));
  for (const channel of channels) {
    assert.equal(typeof h.handlers.get(channel), 'function', channel);
    assert.throws(h.handlers.get(channel), /pending database/);
  }
  h.exports.unavailable(new Error('database unavailable'));
  for (const channel of channels) assert.throws(h.handlers.get(channel), /database unavailable/);
});

for (const trigger of ['normal quit', 'app:quit-and-install', 'app:start-gpu-hardware-acceleration-trial', 'app:relaunch-with-gpu-hardware-acceleration-disabled']) {
  test(`${trigger} waits for task settlement before closing agent and database`, async () => {
    const h = createHarness();
    const services = h.register();
    h.initialize();
    const closing = trigger === 'normal quit' ? services.closeServices() : h.handlers.get(trigger)();
    await Promise.resolve();
    assert.ok(h.calls.includes('tasks:close'));
    assert.ok(!h.calls.includes('agent:close'));
    assert.ok(!h.calls.includes('sqlite:close'));
    h.finishTasks();
    await closing;
    assert.ok(h.calls.indexOf('tasks:close') < h.calls.indexOf('agent:close'));
    assert.ok(h.calls.indexOf('tasks:close') < h.calls.indexOf('sqlite:close'));
    assert.ok(h.calls.includes('remote:dispose'));
    assert.ok(h.calls.includes('confirmation:close'));
    assert.ok(h.calls.includes('openxml:close'));
    assert.equal(h.calls.filter((call) => call === 'sqlite:close').length, 1);
  });
}

test('closing before delayed initialization prevents creation of database services', async () => {
  const h = createHarness();
  const services = h.register();
  h.finishTasks();
  await services.closeServices();
  h.initialize();
  assert.equal(h.dependencies.task, undefined);
  assert.ok(!h.calls.includes('sqlite:close'));
});

test('concurrent closes share task settlement and close handles once', async () => {
  const h = createHarness();
  const services = h.register();
  h.initialize();
  const first = services.closeServices();
  const second = services.closeServices();
  h.finishTasks();
  await Promise.all([first, second]);
  assert.equal(h.calls.filter((call) => call === 'tasks:close').length, 1);
  assert.equal(h.calls.filter((call) => call === 'sqlite:close').length, 1);
});
