const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const featureDir = __dirname;
const rulesPath = path.join(featureDir, 'mandatoryBidContentRules.ts');
const pagePath = path.join(featureDir, 'pages', 'ExportFormatPage.tsx');
const exportFormatTypesPath = path.join(featureDir, '..', '..', 'shared', 'types', 'exportFormat.ts');
const exportFormatCssPath = path.join(featureDir, '..', '..', 'shared', 'utils', 'exportFormatCss.ts');

test('template settings expose six immutable bid content rules', () => {
  assert.ok(fs.existsSync(rulesPath), 'mandatory rule catalogue should exist');
  const source = fs.readFileSync(rulesPath, 'utf8');
  const ids = Array.from(source.matchAll(/id:\s*'([^']+)'/g), (match) => match[1]);

  assert.deepEqual(ids, [
    'heading-terminal-punctuation',
    'schedule-deadline',
    'bold-lead-in-colon',
    'parallel-section-numbering',
    'body-outline-hierarchy',
    'chinese-typography-spacing',
  ]);
  assert.equal((source.match(/^ {4}mandatory:\s*true,/gm) || []).length, 6);
  assert.match(source, /一、.*（一）.*1．.*（1）/s);
  assert.match(source, /编号与标题文字直接连接/);
  assert.match(source, /中文标点前不保留空格或软换行/);
});

test('ordered-list style label uses the Chinese full-width period', () => {
  const source = fs.readFileSync(exportFormatTypesPath, 'utf8');
  assert.match(source, /value:\s*'decimal-dot',\s*label:\s*'数字编号（1．）'/);
});

test('preview numbering uses Chinese punctuation without marker spacing', () => {
  const source = fs.readFileSync(exportFormatCssPath, 'utf8');
  assert.match(source, /case 'chinese-dot':[\s\S]*?suffix:\s*'"、"'/);
  assert.match(source, /case 'chinese-paren':[\s\S]*?prefix:\s*'"（"',[\s\S]*?suffix:\s*'"）"'/);
  assert.match(source, /case 'decimal-full-paren':[\s\S]*?prefix:\s*'"（"',[\s\S]*?suffix:\s*'"）"'/);
  assert.match(source, /default:\s*\r?\n\s*return \{ counterStyle: 'decimal', prefix: '""', suffix: '"．"' \};/);
  assert.doesNotMatch(source, /suffix:\s*'"[^"']*[、．）.]\s+"'/);
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
