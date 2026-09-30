const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const pagePath = join(__dirname, 'pages/HistoricalBidAdaptationPage.tsx');
const stylePath = join(__dirname, '../../styles/feature-historical-bid-adaptation.css');
const routerPath = join(__dirname, '../../app/AppRouter.tsx');
const menuPath = join(__dirname, '../../app/menuConfig.ts');
const analyticsPath = join(__dirname, '../../../../analytics/dashboard/public/src/pages/traffic.js');

test('历史标书适配以独立一级菜单进入独立页面', () => {
  assert.equal(existsSync(pagePath), true, '应提供独立的历史标书适配页面');
  const router = readFileSync(routerPath, 'utf8');
  const menu = readFileSync(menuPath, 'utf8');
  const analytics = readFileSync(analyticsPath, 'utf8');

  assert.match(menu, /id:\s*'historical-bid-adaptation'[\s\S]*label:\s*'历史标书适配'/);
  assert.match(router, /case\s+'historical-bid-adaptation'/);
  assert.match(analytics, /'historical-bid-adaptation':\s*'历史标书适配'/);
});

test('页面展示六阶段且只开放上传材料', () => {
  assert.equal(existsSync(pagePath), true, '应提供独立的历史标书适配页面');
  const page = readFileSync(pagePath, 'utf8');

  for (const label of ['上传材料', '招标基线', '差异确认', '目录适配', '正文迁移', '审核导出']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /aria-current=\{index === 0 \? 'step' : undefined\}/);
  assert.match(page, /后续环节将在本阶段验收后开放/);
  assert.doesNotMatch(page, /onClick=.*招标基线/);
});

test('页面根容器占满工作区并在内部滚动', () => {
  assert.equal(existsSync(stylePath), true, '应提供历史标书适配页面样式');
  const css = readFileSync(stylePath, 'utf8');
  const pageRule = css.match(/\.historical-adaptation-page\s*\{(?<body>[^}]*)\}/s);

  assert.ok(pageRule?.groups?.body, '应定义历史标书适配页面根容器样式');
  assert.match(pageRule.groups.body, /height:\s*100%;/);
  assert.match(pageRule.groups.body, /min-height:\s*0;/);
  assert.match(pageRule.groups.body, /overflow:\s*auto;/);
});
