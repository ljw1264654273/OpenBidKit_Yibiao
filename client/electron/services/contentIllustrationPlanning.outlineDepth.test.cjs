const assert = require('node:assert/strict');
const test = require('node:test');

const { buildIllustrationPlanningContext } = require('./contentIllustrationPlanning.cjs');

function sevenLevelOutline(level = 1, prefix = '1') {
  const item = {
    id: prefix,
    title: `${level}级目录`,
    description: `${level}级目录说明`,
    content_mode: 'ai-generate',
  };
  if (level < 7) {
    item.children = [sevenLevelOutline(level + 1, `${prefix}.1`)];
  }
  return item;
}

test('illustration planning preserves true depth for a seventh-level section', () => {
  const id = '1.1.1.1.1.1.1';
  const context = buildIllustrationPlanningContext({
    outlineData: { project_name: '测试项目', outline: [sevenLevelOutline()] },
    sections: { [id]: { status: 'success', content: '第七级正文。' } },
    options: {},
  });
  const markdown = context.files.find((file) => file.path === 'technical-plan.md').content;
  const tree = JSON.parse(context.files.find((file) => file.path === 'outline-tree.json').content);
  let deepest = tree.outline[0];
  while (deepest.children?.length) deepest = deepest.children[0];

  assert.match(markdown, /^###### 1\.1\.1\.1\.1\.1\.1 7级目录$/m);
  assert.equal(context.sectionMap.get(id).depth, 7);
  assert.equal(deepest.id, id);
  assert.equal(deepest.depth, 7);
});
