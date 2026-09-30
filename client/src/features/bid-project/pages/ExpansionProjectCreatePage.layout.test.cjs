const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const expansionStylesPath = join(
  __dirname,
  '../../../styles/feature-bid-project-expansion.css',
);
const expansionPagePath = join(__dirname, 'ExpansionProjectCreatePage.tsx');

test('扩写项目创建页占满主内容壳层的可用宽度', () => {
  const css = readFileSync(expansionStylesPath, 'utf8');
  const pageRule = css.match(/\.expansion-create-page\s*\{(?<body>[^}]*)\}/s);

  assert.ok(pageRule?.groups?.body, '应定义扩写项目创建页根容器样式');
  assert.match(pageRule.groups.body, /width:\s*100%;/);
  assert.match(pageRule.groups.body, /min-width:\s*0;/);
});

test('扩写项目创建页在 React 严格模式二次挂载时恢复异步更新标记', () => {
  const page = readFileSync(expansionPagePath, 'utf8');
  assert.match(page, /useEffect\(\(\) => \{\s*mountedRef\.current = true;/);
});
