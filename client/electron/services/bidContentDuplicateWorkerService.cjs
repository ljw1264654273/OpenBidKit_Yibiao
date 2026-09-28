const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('同源正文查重已取消');
  error.code = 'TASK_CANCELLED';
  return error;
}

function compareBidContentsInWorker(input, { signal, onProgress } = {}) {
  if (signal?.aborted) return Promise.reject(createAbortError(signal));

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'bidContentDuplicateWorker.cjs'));
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
      worker.removeListener('message', handleMessage);
      worker.removeListener('error', handleWorkerError);
      worker.removeListener('exit', handleExit);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate();
      callback(value);
    };
    const handleAbort = () => {
      finish(reject, createAbortError(signal));
    };
    const handleWorkerError = (error) => {
      finish(reject, error);
    };
    const handleExit = (code) => {
      if (!settled) finish(reject, new Error(`正文查重计算线程异常退出（${code}）`));
    };
    const handleMessage = (message) => {
      if (message?.type === 'progress') {
        onProgress?.(message.progress);
        return;
      }
      if (message?.type === 'result') {
        finish(resolve, message.result);
        return;
      }
      if (message?.type === 'error') {
        const error = new Error(message.error?.message || '正文查重计算失败');
        if (message.error?.code) error.code = message.error.code;
        if (message.error?.stack) error.stack = message.error.stack;
        finish(reject, error);
      }
    };

    worker.on('message', handleMessage);
    worker.on('error', handleWorkerError);
    worker.on('exit', handleExit);
    signal?.addEventListener('abort', handleAbort, { once: true });
    worker.postMessage({ input });
  });
}

module.exports = { compareBidContentsInWorker };
