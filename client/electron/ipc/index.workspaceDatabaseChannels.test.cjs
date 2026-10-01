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
    'technical-plan:prepare-historical-adaptation-content-plan',
    'technical-plan:save-historical-adaptation-content-strategy',
    'technical-plan:reset-historical-adaptation-content-strategies',
    'technical-plan:get-historical-adaptation-content-readiness',
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
