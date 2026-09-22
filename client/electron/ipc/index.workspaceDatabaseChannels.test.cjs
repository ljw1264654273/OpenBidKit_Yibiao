const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.cjs'), 'utf8');
const channelBlock = source.match(/const workspaceDatabaseChannels = \[([\s\S]*?)\n\];/)?.[1] || '';

test('workspace database lifecycle handlers include expansion import channels', () => {
  for (const channel of [
    'bid-project:prepare-expansion-import',
    'bid-project:confirm-expansion-import',
    'bid-project:discard-expansion-import',
  ]) {
    assert.match(channelBlock, new RegExp(`['"]${channel}['"]`), channel);
  }
});
