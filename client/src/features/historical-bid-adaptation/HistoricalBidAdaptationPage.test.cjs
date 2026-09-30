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

test('页面展示六阶段且新项目只开放上传材料', () => {
  assert.equal(existsSync(pagePath), true, '应提供独立的历史标书适配页面');
  const page = readFileSync(pagePath, 'utf8');

  for (const label of ['上传材料', '招标基线', '差异确认', '目录适配', '正文迁移', '审核导出']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /aria-current=\{current \? 'step' : undefined\}/);
  assert.match(page, /!projectReady && index > 0/);
  assert.match(page, /完成材料上传后开放招标基线/);
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

test('项目创建后开放招标基线并保留材料回看入口', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /import BidAnalysisPage/);
  assert.match(page, /variant="tender-baseline"/);
  assert.match(page, /onClick=\{\(\) => onStageChange\(index\)\}/);
  assert.match(page, /onContinue=\{\(\) => onStageChange\(1\)\}/);
  assert.match(page, /disabled=\{disabled\}/);
});

test('招标基线订阅项目后台任务并合并持久化结果', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /taskBridge\.onTaskEvent/);
  assert.match(page, /eventProjectId !== projectId/);
  assert.match(page, /taskType !== 'bid-analysis'/);
  assert.match(page, /bidAnalysisTasks:/);
  assert.match(page, /taskBridge\.getActiveTasks/);
});

test('招标基线进度更新使用函数式合并以保留实时任务状态', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /onProgressChange=\{\(progress\) => onStateChange\(\(previous\) =>/);
  assert.doesNotMatch(page, /onProgressChange=\{\(progress\) => onStateChange\(\{ \.\.\.state,/);
});

test('完整招标基线开放差异确认且目录适配继续锁定', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /import AdaptationDifferencePage/);
  assert.match(page, /baselineComplete && index === 2/);
  assert.match(page, /index > 2/);
  assert.match(page, /differenceComplete/);
  assert.match(page, /historicalAdaptationDifferenceTask/);
  const component = readFileSync(join(__dirname, 'components/AdaptationDifferencePage.tsx'), 'utf8');
  assert.match(component, /historicalAdaptationDifferences/);
});

test('差异确认页面支持类型筛选编辑及逐项处理', () => {
  const componentPath = join(__dirname, 'components/AdaptationDifferencePage.tsx');
  assert.equal(existsSync(componentPath), true, '应提供独立差异确认组件');
  const component = readFileSync(componentPath, 'utf8');

  for (const label of ['全部差异', '待确认', '删除内容', '名称地点替换', '数据更新', '工期进度更新', '其他人工判断']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /saveHistoricalAdaptationDifferences/);
  assert.match(component, /开始差异分析/);
  assert.match(component, /确认此项/);
  assert.match(component, /无需处理/);
});
