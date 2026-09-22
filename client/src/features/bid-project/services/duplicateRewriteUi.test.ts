import assert from 'node:assert/strict';
import test from 'node:test';
import type { BidContentDuplicateMatch } from '../types';

async function loadHelpers() {
  const modulePath = './duplicateRewriteUi.ts';
  return import(modulePath);
}

const match: BidContentDuplicateMatch = {
  id: 'match-1',
  similarity: 0.876,
  level: 'high',
  leftParagraph: { index: 2, text: '左侧原文' },
  rightParagraph: { index: 7, text: '右侧原文' },
  leftNodeId: 'left-node',
  rightNodeId: 'right-node',
  suggestion: { title: '改写', reason: '重复', instruction: '重新组织表达' },
};

test('returns the selected left or right rewrite target as one consistent shape', async () => {
  const {
    getRewriteTarget,
  } = await loadHelpers();
  assert.deepEqual(getRewriteTarget(match, 'left', 'left-project', 'right-project', '方案甲', '方案乙'), {
    projectId: 'left-project',
    nodeId: 'left-node',
    oldText: '左侧原文',
    projectLabel: '方案甲',
  });
  assert.deepEqual(getRewriteTarget(match, 'right', 'left-project', 'right-project', '方案甲', '方案乙'), {
    projectId: 'right-project',
    nodeId: 'right-node',
    oldText: '右侧原文',
    projectLabel: '方案乙',
  });
});

test('rejects empty rewrite drafts and formats the latest duplicate summary', async () => {
  const {
    canConfirmRewrite,
    formatDuplicateSummary,
  } = await loadHelpers();
  assert.equal(canConfirmRewrite('   '), false);
  assert.equal(canConfirmRewrite('改写后的正文'), true);
  const summary = {
    projectId: 'project',
    resultId: 'result',
    otherProjectId: 'other',
    otherProjectName: '参考方案',
    sensitivity: 'medium',
    threshold: 0.64,
    duplicateParagraphCount: 3,
    maxSimilarity: 0.876,
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
  assert.equal(
    formatDuplicateSummary(summary),
    `3 组重复 · 最高 88% · ${new Date(summary.updatedAt).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`,
  );
});

test('builds a persisted no-rewrite decision patch', async () => {
  const { buildIgnoredDecisionPatch } = await loadHelpers();
  assert.deepEqual(buildIgnoredDecisionPatch('result-1', 'match-1'), {
    resultId: 'result-1',
    matchId: 'match-1',
    decision: 'ignored',
    targetSide: 'none',
  });
});

test('keeps the list page on manual comparison instead of auto-running the compare effect', async () => {
  const fs = await import('node:fs/promises');
  const workspacePage = await fs.readFile(new URL('../pages/BidProjectWorkspacePage.tsx', import.meta.url), 'utf8');
  const compareBar = await fs.readFile(new URL('../components/BidProjectCompareBar.tsx', import.meta.url), 'utf8');
  const row = await fs.readFile(new URL('../components/BidProjectRow.tsx', import.meta.url), 'utf8');

  assert.match(compareBar, /开始对比/);
  assert.match(workspacePage, /listRecentDuplicateSummaries/);
  assert.match(workspacePage, /同一招标文件生成的两份标书/);
  assert.match(workspacePage, /compareRequestRef/);
  assert.doesNotMatch(workspacePage, /autoComparedGroups/);
  assert.doesNotMatch(workspacePage, /group\.length\s*>=\s*2/);
  assert.match(row, /查看查重结果/);
});

test('列表导出先选择模板，并复用导出完成后的打开文件流程', async () => {
  const fs = await import('node:fs/promises');
  const workspacePage = await fs.readFile(new URL('../pages/BidProjectWorkspacePage.tsx', import.meta.url), 'utf8');
  const dialog = await fs.readFile(new URL('../../export-format/components/WordExportDialog.tsx', import.meta.url), 'utf8');

  assert.match(workspacePage, /<WordExportDialog/);
  assert.match(workspacePage, /setExportTarget\(project\)/);
  assert.match(workspacePage, /exportTarget\.projectId, \{ requestId, exportFormat \}/);
  assert.match(dialog, /<Dialog\.Title>选择导出模板<\/Dialog\.Title>/);
  assert.match(dialog, /打开文件/);
});

test('列表页只有生成完成的标书允许导出', async () => {
  const fs = await import('node:fs/promises');
  const workspacePage = await fs.readFile(new URL('../pages/BidProjectWorkspacePage.tsx', import.meta.url), 'utf8');
  const row = await fs.readFile(new URL('../components/BidProjectRow.tsx', import.meta.url), 'utf8');
  const sharedStyles = await fs.readFile(new URL('../../../styles/shared-components.css', import.meta.url), 'utf8');

  assert.match(row, /disabled=\{project\.status !== 'completed'\}/);
  assert.match(row, /标书生成完成后才可导出/);
  assert.match(workspacePage, /project\.status !== 'completed'/);
  assert.match(workspacePage, /标书生成完成后才可导出/);
  assert.match(sharedStyles, /\.text-button:disabled/);
  assert.match(sharedStyles, /\.text-button:disabled[\s\S]*cursor:\s*not-allowed/);
  assert.match(sharedStyles, /\.text-button:disabled[\s\S]*opacity:/);
});

test('查看最近查重结果先打开加载态，并直接使用列表摘要中的结果 ID', async () => {
  const fs = await import('node:fs/promises');
  const workspacePage = await fs.readFile(new URL('../pages/BidProjectWorkspacePage.tsx', import.meta.url), 'utf8');
  const dialog = await fs.readFile(new URL('../components/BidProjectDuplicateResultDialog.tsx', import.meta.url), 'utf8');

  assert.match(workspacePage, /setDuplicateResultDialogOpen\(true\)/);
  assert.match(workspacePage, /loadDuplicateResultPage\(duplicateSummary\.resultId/);
  assert.match(workspacePage, /duplicateResultLoading/);
  assert.match(dialog, /正在读取查重结果/);
  assert.match(dialog, /resultLoading\??: boolean/);
});

test('查重结果弹窗只展示当前页并支持继续加载下一页', async () => {
  const fs = await import('node:fs/promises');
  const dialog = await fs.readFile(new URL('../components/BidProjectDuplicateResultDialog.tsx', import.meta.url), 'utf8');
  const workspacePage = await fs.readFile(new URL('../pages/BidProjectWorkspacePage.tsx', import.meta.url), 'utf8');

  assert.match(dialog, /onLoadPage/);
  assert.match(dialog, /totalMatches/);
  assert.match(dialog, /下一页/);
  assert.match(workspacePage, /loadDuplicateResultPage/);
});

test('查重结果弹窗支持在当前文件对上重新对比，并在对比期间禁止关闭', async () => {
  const fs = await import('node:fs/promises');
  const dialog = await fs.readFile(new URL('../components/BidProjectDuplicateResultDialog.tsx', import.meta.url), 'utf8');

  assert.match(dialog, /重新对比/);
  assert.match(dialog, /onRecompare/);
  assert.match(dialog, /resultLoading\s*\|\|\s*!leftProject\s*\|\|\s*!rightProject/);
  assert.match(dialog, /if \(!nextOpen && resultLoading\) return/);
});

test('标书列表查重摘要查询不读取完整匹配正文 JSON', async () => {
  const fs = await import('node:fs/promises');
  const store = await fs.readFile(new URL('../../../../electron/services/bidProjectStore.cjs', import.meta.url), 'utf8');

  assert.doesNotMatch(store, /SELECT\s+r\.\*/);
  assert.match(store, /r\.summary_json/);
  assert.match(store, /r\.result_id/);
});
