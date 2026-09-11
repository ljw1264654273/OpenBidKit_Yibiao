const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const featureDir = __dirname;
const rulesPath = path.join(featureDir, 'mandatoryBidContentRules.ts');
const pagePath = path.join(featureDir, 'pages', 'ExportFormatPage.tsx');

test('template settings expose exactly four immutable bid content rules', () => {
  assert.ok(fs.existsSync(rulesPath), 'mandatory rule catalogue should exist');
  const source = fs.readFileSync(rulesPath, 'utf8');
  const ids = Array.from(source.matchAll(/id:\s*'([^']+)'/g), (match) => match[1]);

  assert.deepEqual(ids, [
    'heading-terminal-punctuation',
    'schedule-deadline',
    'bold-lead-in-colon',
    'parallel-section-numbering',
  ]);
  assert.equal((source.match(/^ {4}mandatory:\s*true,/gm) || []).length, 4);
});

test('content rules render as a read-only template tab', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  assert.match(source, /id:\s*'content-rules',\s*label:\s*'内容规范'/);
  assert.match(source, /renderContentRules/);

  const renderStart = source.indexOf('const renderContentRules');
  const renderEnd = source.indexOf('const renderLayoutSettings', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, 'content rules renderer should be defined before layout settings');
  const renderSource = source.slice(renderStart, renderEnd);
  assert.doesNotMatch(renderSource, /<AppSwitch|<input|<select/);
  assert.match(renderSource, /强制执行/);
});
