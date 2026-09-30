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

test('招标基线模式固定完整解析并使用环节二文案', () => {
  const page = readFileSync(join(__dirname, '../../technical-plan/pages/BidAnalysisPage.tsx'), 'utf8');

  assert.match(page, /variant\?: 'default' \| 'tender-baseline'/);
  assert.match(page, /const isTenderBaseline = variant === 'tender-baseline'/);
  assert.match(page, /isTenderBaseline \? allBidAnalysisTaskIds/);
  assert.match(page, /isTenderBaseline \? '环节二' : 'STEP 02'/);
  assert.match(page, /isTenderBaseline \? '招标基线'/);
  assert.match(page, /!isTenderBaseline &&/);
});

test('招标基线不会把未提取到占位结果判定为完成', () => {
  const page = readFileSync(join(__dirname, '../../technical-plan/pages/BidAnalysisPage.tsx'), 'utf8');

  assert.match(page, /requiredTasks\.every\(\(task\) =>[\s\S]*!isMissingBidAnalysisResult\(task, tasks\[task\.id\]\?\.content\)/);
});
