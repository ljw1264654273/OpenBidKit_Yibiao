const test = require('node:test');
const assert = require('node:assert/strict');
const { compareBidContents } = require('./bidContentDuplicateService.cjs');

let compareBidContentsInWorker;
try {
  ({ compareBidContentsInWorker } = require('./bidContentDuplicateWorkerService.cjs'));
} catch {
  compareBidContentsInWorker = undefined;
}

function buildContent(prefix, count = 36) {
  return Array.from({ length: count }, (_, index) => (
    `${prefix}${index}围绕项目组织、质量安全、进度资源、风险处置和验收移交建立全过程闭环机制，责任人员根据执行记录安排后续工作。`
  )).join('\n\n');
}

test('compares in a worker while the caller event loop remains responsive', async () => {
  assert.equal(typeof compareBidContentsInWorker, 'function');
  const input = {
    leftContent: buildContent('甲方方案'),
    rightContent: buildContent('乙方方案'),
    sensitivity: 'medium',
  };
  const progress = [];
  let immediateRan = false;

  const workerResultPromise = compareBidContentsInWorker(input, {
    onProgress: (value) => progress.push(value),
  });
  setImmediate(() => {
    immediateRan = true;
  });

  const workerResult = await workerResultPromise;
  const syncResult = compareBidContents(input);

  assert.equal(immediateRan, true);
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(workerResult, syncResult);
});

test('terminates worker comparison when the managed task is cancelled', async () => {
  assert.equal(typeof compareBidContentsInWorker, 'function');
  const controller = new AbortController();
  const reason = Object.assign(new Error('用户取消查重'), { code: 'TASK_CANCELLED' });
  const promise = compareBidContentsInWorker({
    leftContent: buildContent('甲方方案', 80),
    rightContent: buildContent('乙方方案', 80),
    sensitivity: 'medium',
  }, { signal: controller.signal });

  controller.abort(reason);

  await assert.rejects(() => promise, /用户取消查重/);
});
