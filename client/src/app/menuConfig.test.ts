import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';

test('main menu follows the requested bid workflow order and labels', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/menuConfig.ts'), 'utf8');
  const ids = [
    'bid-projects',
    'new-bid',
    'existing-plan-expansion',
    'historical-bid-adaptation',
    'template-settings',
    'bid-knowledge-base',
    'technical-plan-check',
    'bid-check',
  ];
  const positions = ids.map((id) => source.indexOf(`id: '${id}'`));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.match(source, /id:\s*'bid-projects',[\s\S]*?label:\s*'标书目录'/);
  assert.match(source, /id:\s*'new-bid',[\s\S]*?label:\s*'新建标书'/);
  assert.match(source, /id:\s*'existing-plan-expansion',[\s\S]*?label:\s*'方案扩写'/);
  assert.match(source, /id:\s*'historical-bid-adaptation',[\s\S]*?label:\s*'以标写标'/);
  assert.match(source, /id:\s*'template-settings',[\s\S]*?label:\s*'模版设置'/);
});

test('knowledge base categories are children of one top-level menu in requested order', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/menuConfig.ts'), 'utf8');
  const catalogSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/knowledge-base/knowledgeBaseCatalog.ts'),
    'utf8',
  );
  const children = [
    'document-knowledge-base',
    'national-standard-knowledge-base',
    'provincial-standard-knowledge-base',
    'municipal-standard-knowledge-base',
    'industry-standard-knowledge-base',
    'enterprise-knowledge-base',
    'remote-knowledge-base',
  ];
  const knowledgeMenu = source.match(/id:\s*'bid-knowledge-base',[\s\S]*?\n  \},/)?.[0];

  assert.ok(knowledgeMenu, '应提供标书知识库一级目录');
  assert.match(knowledgeMenu, /\.\.\.KNOWLEDGE_BASE_CATALOG\.map/);
  const positions = children.slice(0, 6).map((id) => catalogSource.indexOf(`navigationId: '${id}'`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.ok(knowledgeMenu.indexOf('...KNOWLEDGE_BASE_CATALOG.map') < knowledgeMenu.indexOf("id: 'remote-knowledge-base'"));
  assert.match(knowledgeMenu, /label:\s*'标书知识库'/);
  assert.doesNotMatch(source, /id:\s*'image-knowledge-base'/);
});

test('new bid is a standalone route to the existing bid import flow', () => {
  const router = fs.readFileSync(path.join(process.cwd(), 'src/app/AppRouter.tsx'), 'utf8');
  assert.match(router, /case\s+'new-bid':[\s\S]*?BidProjectCreatePage/);
});

test('document shortcut remains visible but no longer opens an external page', () => {
  const sidebar = fs.readFileSync(path.join(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
  assert.match(sidebar, /<strong>文档<\/strong>/);
  assert.doesNotMatch(sidebar, /USER_GUIDE_URL|openExternalUrl\(USER_GUIDE_URL\)/);
});

test('menu route labels stay aligned with analytics dashboard labels', () => {
  const dashboard = fs.readFileSync(path.join(process.cwd(), '../analytics/dashboard/public/src/pages/traffic.js'), 'utf8');
  assert.match(dashboard, /'bid-projects':\s*'标书目录'/);
  assert.match(dashboard, /'new-bid':\s*'新建标书'/);
  assert.match(dashboard, /'existing-plan-expansion':\s*'方案扩写'/);
  assert.match(dashboard, /'historical-bid-adaptation':\s*'以标写标'/);
  assert.match(dashboard, /'bid-knowledge-base':\s*'标书知识库'/);
});
