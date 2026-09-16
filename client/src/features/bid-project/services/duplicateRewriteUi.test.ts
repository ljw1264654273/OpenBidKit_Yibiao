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
