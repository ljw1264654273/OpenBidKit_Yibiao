const assert = require('node:assert/strict');
const test = require('node:test');

const { runBidSectionExtractionTask } = require('./bidSectionExtractionTask.cjs');

test('多标段识别任务不自动清理已有下游数据', async () => {
  let prepareCalls = 0;
  const checkpoints = [];
  const updates = [];
  const workspaceStore = {
    readOriginalTenderMarkdown: () => [
      '# 招标文件',
      '## 一标段',
      '一标段内容',
      '## 二标段',
      '二标段内容',
    ].join('\n'),
    prepareBidSectionExtraction: () => {
      prepareCalls += 1;
    },
  };
  const aiService = {
    getConfig: () => ({}),
    collectJsonResponse: async () => ({
      sections: [
        { id: 'section-1', index: 1, unit: '标段', title: '一标段', includeRanges: [{ startLine: 2, endLine: 3 }] },
        { id: 'section-2', index: 2, unit: '标段', title: '二标段', includeRanges: [{ startLine: 4, endLine: 5 }] },
      ],
    }),
  };

  await runBidSectionExtractionTask({
    aiService,
    workspaceStore,
    updateTask: (task, patch) => updates.push({ task, patch }),
    checkpointTask: (task, patch) => checkpoints.push({ task, patch }),
  });

  assert.equal(prepareCalls, 0);
  assert.equal(checkpoints.at(-1)?.task.status, 'success');
  assert.equal(checkpoints.at(-1)?.patch.bidSections.length, 2);
  assert.ok(updates.length > 0);
});

test('不足两个有效标段时按单标段成功回落', async () => {
  const checkpoints = [];
  const workspaceStore = {
    readOriginalTenderMarkdown: () => [
      '# 招标文件',
      '12.2 标的物',
      '本项目整体采购，不划分标段。',
    ].join('\n'),
  };
  const aiService = {
    getConfig: () => ({}),
    collectJsonResponse: async () => ({ sections: [] }),
  };

  await runBidSectionExtractionTask({
    aiService,
    workspaceStore,
    updateTask: () => {},
    checkpointTask: (task, patch) => checkpoints.push({ task, patch }),
  });

  assert.equal(checkpoints.at(-1)?.task.status, 'success');
  assert.equal(checkpoints.at(-1)?.task.error, undefined);
  assert.equal(checkpoints.at(-1)?.patch.bidSectionMode, 'single');
  assert.deepEqual(checkpoints.at(-1)?.patch.bidSections, []);
  assert.equal(checkpoints.at(-1)?.patch.bidSectionExtractionStatus, 'success');
  assert.equal(checkpoints.at(-1)?.patch.bidSectionExtractionError, undefined);
});
