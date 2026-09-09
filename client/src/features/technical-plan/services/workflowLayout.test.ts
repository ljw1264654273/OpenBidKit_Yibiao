import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = (name: string) => {
  const url = new URL(`../components/${name}.tsx`, import.meta.url);
  assert.equal(existsSync(url), true, `${name}.tsx 应存在`);
  return readFileSync(url, 'utf8');
};

test('紧凑任务进度始终显示进度条并通过弹层查看过程', () => {
  const source = componentSource('CompactTaskProgress');

  assert.match(source, /<ProgressBar/);
  assert.match(source, /<Popover\.Trigger asChild>/);
  assert.match(source, /aria-label="查看过程"/);
  assert.match(source, /<Popover\.Content/);
});

test('自适应双栏提供两组标签和容器窄屏切换', () => {
  const source = componentSource('AdaptiveTwoPaneWorkspace');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(source, /role="tablist"/);
  assert.equal((source.match(/role="tab"/g) || []).length, 2);
  assert.equal((source.match(/role="tabpanel"/g) || []).length, 2);
  assert.match(css, /\.adaptive-workspace-shell\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(css, /@container\s*\(max-width:\s*759px\)/);
});

test('招标解析把常显进度和双栏切换放到公共工作区', () => {
  const source = readFileSync(new URL('../pages/BidAnalysisPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<CompactTaskProgress/);
  assert.match(source, /<AdaptiveTwoPaneWorkspace/);
  assert.doesNotMatch(source, /progressCollapsed/);
  assert.match(source, /setWorkspacePane\('content'\)/);
});

test('全局事实使用单一编辑预览工作面并保留当前模式', () => {
  const source = readFileSync(new URL('../pages/GlobalFactsPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<CompactTaskProgress/);
  assert.match(source, /<AdaptiveTwoPaneWorkspace/);
  assert.doesNotMatch(source, /progressCollapsed/);
  assert.match(source, /useState<'edit' \| 'preview'>\('edit'\)/);
  assert.match(source, /editorMode === 'preview' \? '编辑' : '预览'/);
  assert.match(source, /editorMode === 'edit' \? \(/);
});

test('正文生成把现有阶段进度原样放入公共命令区', () => {
  const source = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<CompactTaskProgress/);
  assert.match(source, /value=\{displayProgress\}/);
  assert.match(source, /summary=\{displayProgressCount\}/);
  assert.match(source, /status=\{displayProgressLabel\}/);
  assert.match(source, /tone=\{progressTone\}/);
  assert.match(source, /active=\{progressActive\}/);
  assert.match(source, /<AdaptiveTwoPaneWorkspace/);
  assert.doesNotMatch(source, /statsCollapsed/);
  assert.match(source, /setWorkspacePane\('content'\)/);
});
