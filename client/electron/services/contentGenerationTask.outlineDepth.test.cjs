const assert = require('node:assert/strict');
const test = require('node:test');

const { renderAgentTechnicalPlanOutline } = require('./contentGenerationTask.cjs');

function sevenLevelOutline(level = 1, prefix = '1') {
  const item = {
    id: prefix,
    title: `${level}级目录`,
  };
  if (level < 7) {
    item.children = [sevenLevelOutline(level + 1, `${prefix}.1`)];
  }
  return item;
}

test('content consistency input preserves a seventh-level section ID', () => {
  const id = '1.1.1.1.1.1.1';
  const sectionIndex = new Map([[id, { originalContent: '第七级正文。' }]]);

  const markdown = renderAgentTechnicalPlanOutline([sevenLevelOutline()], sectionIndex).join('\n');

  assert.match(markdown, /^###### 1\.1\.1\.1\.1\.1\.1 7级目录$/m);
  assert.match(markdown, /yibiao-section-start id="1\.1\.1\.1\.1\.1\.1"/);
  assert.match(markdown, /yibiao-section-end id="1\.1\.1\.1\.1\.1\.1"/);
});
