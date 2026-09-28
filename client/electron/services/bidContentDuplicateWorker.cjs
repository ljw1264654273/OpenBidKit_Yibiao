const { parentPort } = require('node:worker_threads');
const { compareBidContents } = require('./bidContentDuplicateService.cjs');

parentPort.once('message', ({ input }) => {
  try {
    const result = compareBidContents(input, {
      onProgress: (progress) => {
        parentPort.postMessage({ type: 'progress', progress });
      },
    });
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: {
        message: error?.message || '正文查重计算失败',
        code: error?.code,
        stack: error?.stack,
      },
    });
  }
});
