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
