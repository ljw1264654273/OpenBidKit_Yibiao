const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeGlobalFactsMode } = require('./globalFactsTask.cjs');
const { __globalFactsModeTestRuntime: promptRuntime } = require('./globalFactsTaskV2.cjs');

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
  assert.doesNotMatch(prompt, /补足具体事实值/);
  assert.doesNotMatch(prompt, /补足具体周期/);
}

function assertStandardPrompt(prompt) {
  assert.match(prompt, /严禁.*杜撰具体值/);
  assert.match(prompt, /笼统承诺/);
  assert.match(prompt, /不要编造日期或周期/);
  assert.match(prompt, /不得.*省略|严禁省略/);
  assertNoFabricationRules(prompt);
}

test('global facts mode normalization keeps only omit and placeholder', () => {
  assert.equal(normalizeGlobalFactsMode(undefined), 'omit');
  assert.equal(normalizeGlobalFactsMode('fabricate'), 'omit');
  assert.equal(normalizeGlobalFactsMode('omit'), 'omit');
  assert.equal(normalizeGlobalFactsMode('placeholder'), 'placeholder');
});

test('V2 exposes prompt helpers for the two-mode contract', () => {
  assert.ok(promptRuntime, 'globalFactsTaskV2 must expose __globalFactsModeTestRuntime');
  assert.equal(typeof promptRuntime.createGlobalFactsPrompt, 'function');
});

test('standard mode uses non-fabrication semantics', () => {
  assertStandardPrompt(createPrompt('omit'));
});

test('strict mode uses the exact pending-value placeholder', () => {
  const prompt = createPrompt('placeholder');
  assert.match(prompt, /【待填写】/);
  assert.match(prompt, /严禁.*省略/);
  assertNoFabricationRules(prompt);
});

test('legacy, missing, and malformed modes fall back to standard prompt semantics', () => {
  for (const value of ['fabricate', undefined, null, '', 'unknown', { unexpected: true }]) {
    assertStandardPrompt(createPrompt(value));
  }
});
