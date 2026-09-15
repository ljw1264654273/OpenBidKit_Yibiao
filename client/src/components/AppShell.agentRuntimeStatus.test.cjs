const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const appShellPath = join(__dirname, 'AppShell.tsx');

test('AppShell does not render the global Agent runtime status bar', () => {
  const source = readFileSync(appShellPath, 'utf8');

  assert.equal(source.includes('AgentRuntimeStatusBar'), false);
});
