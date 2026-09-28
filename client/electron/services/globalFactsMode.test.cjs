const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeGlobalFactsMode,
  __globalFactsModeResolutionTestRuntime: legacyModeRuntime,
} = require('./globalFactsTask.cjs');
const {
  __globalFactsModeTestRuntime: promptRuntime,
  __globalFactsModeResolutionTestRuntime: v2ModeRuntime,
} = require('./globalFactsTaskV2.cjs');

function createPrompt(globalFactsMode) {
  assert.ok(promptRuntime, 'globalFactsTaskV2 must expose __globalFactsModeTestRuntime');
  assert.equal(typeof promptRuntime.createGlobalFactsPrompt, 'function');
  return promptRuntime.createGlobalFactsPrompt({
    fileCatalog: '- 招标文件.md：招标原文。',
    hasKnowledge: false,
    hasOriginalPlan: false,
    globalFactsMode,
  });
}

function assertNoFabricationRules(prompt) {
  assert.doesNotMatch(prompt, /张伟/);
  assert.doesNotMatch(prompt, /李明/);
  assert.doesNotMatch(prompt, /允许补足/);
  assert.doesNotMatch(prompt, /模拟生成/);
  assert.doesNotMatch(prompt, /杜撰.*事实值/);
  assert.doesNotMatch(prompt, /补足.*具体事实值/);
  assert.doesNotMatch(prompt, /补足.*具体周期/);
}

function assertStandardPrompt(prompt) {
  assert.match(prompt, /标准模式/);
  assert.match(prompt, /严禁.*杜撰具体值/);
  assert.match(prompt, /笼统承诺/);
  assert.match(prompt, /不要编造日期或周期/);
  assert.match(prompt, /不得.*省略|严禁省略/);
  assertNoFabricationRules(prompt);
}

test('global facts mode normalization maps legacy, unknown, and malformed values to omit', () => {
  const omitCases = [
    ['missing', undefined],
    ['legacy fabricate', 'fabricate'],
    ['null', null],
    ['empty string', ''],
    ['whitespace', '   '],
    ['arbitrary string', 'unknown-mode'],
    ['object', { unexpected: true }],
    ['array', ['placeholder']],
  ];
  for (const [label, value] of omitCases) {
    assert.equal(normalizeGlobalFactsMode(value), 'omit', label);
  }
  assert.equal(normalizeGlobalFactsMode('omit'), 'omit');
  assert.equal(normalizeGlobalFactsMode('placeholder'), 'placeholder');
});

test('V2 exposes prompt helpers for the two-mode contract', () => {
  assert.ok(promptRuntime, 'globalFactsTaskV2 must expose __globalFactsModeTestRuntime');
  assert.deepEqual(Object.keys(promptRuntime).sort(), [
    'buildJsonExample',
    'buildMissingValueRule',
    'createGlobalFactsPrompt',
  ]);
  assert.equal(typeof promptRuntime.buildMissingValueRule, 'function');
  assert.equal(typeof promptRuntime.buildJsonExample, 'function');
  assert.equal(typeof promptRuntime.createGlobalFactsPrompt, 'function');
  assert.match(promptRuntime.buildMissingValueRule(undefined), /笼统承诺/);
  assert.doesNotMatch(promptRuntime.buildJsonExample('fabricate'), /张伟|李明/);
});

test('standard mode uses non-fabrication semantics', () => {
  assertStandardPrompt(createPrompt('omit'));
});

test('strict mode uses the exact pending-value placeholder', () => {
  const prompt = createPrompt('placeholder');
  assert.match(prompt, /严谨模式/);
  assert.match(prompt, /【待填写】/);
  assert.match(prompt, /项目经理：【待填写】/);
  assert.match(prompt, /严禁.*省略/);
  assertNoFabricationRules(prompt);
});

test('legacy, missing, and malformed modes fall back to standard prompt semantics', () => {
  for (const value of ['fabricate', undefined, null, '', 'unknown', { unexpected: true }]) {
    assertStandardPrompt(createPrompt(value));
  }
});

test('explicit falsy or malformed payload mode overrides stored placeholder', () => {
  for (const runtime of [legacyModeRuntime, v2ModeRuntime]) {
    assert.ok(runtime, 'global facts task must expose mode resolution test runtime');
    assert.equal(typeof runtime.resolveGlobalFactsMode, 'function');
    for (const value of ['', null, false, 0, { unexpected: true }]) {
      assert.equal(runtime.resolveGlobalFactsMode({ globalFactsMode: value }, 'placeholder'), 'omit');
      assert.equal(runtime.resolveGlobalFactsMode({ global_facts_mode: value }, 'placeholder'), 'omit');
    }
    assert.equal(runtime.resolveGlobalFactsMode({}, 'placeholder'), 'placeholder');
    assert.equal(runtime.resolveGlobalFactsMode({ globalFactsMode: undefined, global_facts_mode: 'placeholder' }, 'placeholder'), 'omit');
  }
});

async function runStoreAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-global-facts-mode-'));
  let database;
  try {
    const app = {
      getPath(name) {
        assert.equal(name, 'userData');
        return userDataPath;
      },
      once() {},
    };
    database = createSqliteDatabase(app);
    const store = createTechnicalPlanStore({
      app,
      db: database.db,
      fileService: {
        async importDocument() {
          return {
            success: true,
            file_content: '# 招标文件\n测试内容',
            file_name: '测试招标文件.md',
            parser_label: '本地解析',
          };
        },
      },
      agentService: { deletePersistentTask() {} },
      taskLogStore: { list: () => [], sync() {} },
      configStore: { load: () => ({}) },
    });

    assert.equal(store.loadTechnicalPlan().globalFactsMode, 'omit');

    assert.deepEqual(store.saveGlobalFactsConfig({ globalFactsMode: 'fabricate' }), { globalFactsMode: 'omit' });
    assert.equal(database.db.prepare('SELECT global_facts_mode FROM technical_plan_meta WHERE id = 1').get().global_facts_mode, 'omit');
    assert.equal(store.loadTechnicalPlan().globalFactsMode, 'omit');

    store.saveGlobalFactsConfig({ globalFactsMode: 'placeholder' });
    assert.equal(store.loadTechnicalPlan().globalFactsMode, 'placeholder');
    await store.importTenderDocument(['fixture.md']);
    assert.equal(database.db.prepare('SELECT global_facts_mode FROM technical_plan_meta WHERE id = 1').get().global_facts_mode, 'omit');
    assert.equal(store.loadTechnicalPlan().globalFactsMode, 'omit');

    store.saveGlobalFactsConfig({ globalFactsMode: 'placeholder' });
    assert.equal(store.loadTechnicalPlan().globalFactsMode, 'placeholder');
    store.clearTechnicalPlan();
    assert.equal(database.db.prepare('SELECT global_facts_mode FROM technical_plan_meta WHERE id = 1').get().global_facts_mode, 'omit');
    assert.equal(store.loadTechnicalPlan().globalFactsMode, 'omit');
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native-store')) {
  runStoreAssertions()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode || 0));
} else {
  test('Store defaults, malformed saves, tender reset, and full reset use omit mode', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native-store'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native global facts mode store test timed out'}`);
  });
}
