const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.cjs'), 'utf8');
const channelBlock = source.match(/const workspaceDatabaseChannels = \[([\s\S]*?)\n\];/)?.[1] || '';

test('workspace database lifecycle includes technical plan check commands', () => {
  for (const channel of [
    'technical-plan-check:load-state', 'technical-plan-check:select-input',
    'technical-plan-check:select-output', 'technical-plan-check:open-report',
    'tasks:start-technical-plan-check',
  ]) {
    assert.match(channelBlock, new RegExp(`['"]${channel}['"]`), channel);
  }
});

test('workspace database lifecycle handlers include expansion import channels', () => {
  for (const channel of [
    'bid-project:prepare-expansion-import',
    'bid-project:confirm-expansion-import',
    'bid-project:discard-expansion-import',
  ]) {
    assert.match(channelBlock, new RegExp(`['"]${channel}['"]`), channel);
  }
});

test('workspace database lifecycle handlers include content AI edit channels', () => {
  for (const channel of [
    'technical-plan:ai-edit-content',
    'technical-plan:generate-inline-image',
    'technical-plan:import-inline-image',
    'technical-plan:release-inline-image-candidate',
  ]) {
    assert.match(channelBlock, new RegExp(`['"]${channel}['"]`), channel);
  }
});

test('workspace database lifecycle includes historical adaptation difference, outline and content channels', () => {
  for (const channel of [
    'tasks:start-historical-adaptation-difference',
    'technical-plan:save-historical-adaptation-differences',
    'tasks:start-historical-adaptation-outline',
    'technical-plan:save-historical-adaptation-outline',
    'technical-plan:confirm-historical-adaptation-outline',
    'tasks:start-historical-adaptation-content',
    'tasks:retry-historical-adaptation-content',
    'technical-plan:prepare-historical-adaptation-content-plan',
    'technical-plan:save-historical-adaptation-content-strategy',
    'technical-plan:reset-historical-adaptation-content-strategies',
    'technical-plan:get-historical-adaptation-content-readiness',
    'technical-plan:get-historical-adaptation-source-section',
    'tasks:start-historical-adaptation-content-check',
    'technical-plan:save-historical-adaptation-chapter-content',
    'technical-plan:confirm-historical-adaptation-content-item',
    'technical-plan:confirm-historical-adaptation-content',
    'technical-plan:run-historical-adaptation-review',
    'technical-plan:set-historical-adaptation-review-finding',
    'technical-plan:confirm-historical-adaptation-review',
    'technical-plan:assert-historical-adaptation-export-allowed',
  ]) {
    assert.match(channelBlock, new RegExp(`['"]${channel}['"]`), channel);
  }
});

test('historical adaptation prepare subscribes before launching and new commands forward payloads', () => {
  const technicalPlanIpc = fs.readFileSync(path.join(__dirname, 'technicalPlanIpc.cjs'), 'utf8');
  const taskIpc = fs.readFileSync(path.join(__dirname, 'taskIpc.cjs'), 'utf8');
  assert.match(technicalPlanIpc, /handle\('technical-plan:prepare-historical-adaptation-content-plan', \(event, payload\) => \{\s*taskService.subscribe\(event.sender\);\s*return taskService.prepareHistoricalAdaptationContentPlan\(payload\);/);
  assert.match(technicalPlanIpc, /handle\('technical-plan:get-historical-adaptation-source-section', .*resolveStore\(payload\).getHistoricalAdaptationSourceSection\(payload\)/);
  assert.match(taskIpc, /handle\('tasks:retry-historical-adaptation-content', \(event, payload\) => \{\s*taskService.subscribe\(event.sender\);\s*return taskService.retryHistoricalAdaptationContent\(payload\);/);
});

test('preload and Renderer types expose historical adaptation source, retry and singleton events', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8');
  const types = fs.readFileSync(path.join(__dirname, '../../src/shared/types/ipc.ts'), 'utf8');
  for (const method of ['getHistoricalAdaptationSourceSection', 'retryHistoricalAdaptationContent']) {
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(types, new RegExp(`${method}:`));
  }
  for (const field of ['contentItemPatch', 'outlineContentPatch']) assert.match(types, new RegExp(`${field}\\?:`));
  const featureTypes = fs.readFileSync(path.join(__dirname, '../../src/features/technical-plan/types.ts'), 'utf8');
  for (const field of ['source_section_id', 'source_version_hash', 'source_content_hash', 'plan_id', 'error_code']) {
    assert.match(featureTypes, new RegExp(`${field}\\??:`));
  }
});
