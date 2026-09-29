const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'technicalPlanCheckWorker.cjs');

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const messages = [];
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      callback(value);
    };
    worker.on('message', (message) => {
      messages.push(message);
      if (message?.type === 'result' || message?.type === 'error') {
        finish(resolve, { message, messages });
      }
    });
    worker.on('error', (error) => finish(reject, error));
    worker.on('exit', (code) => {
      if (!settled) finish(reject, new Error(`worker exited before a terminal message (${code})`));
    });
    worker.postMessage({ type: 'run', payload });
  });
}

test('emits progress and a summarized result from the real worker thread', async () => {
  const { message, messages } = await runWorker({
    documents: {
      tenderLines: ['本项目位于南京市。'],
      requirementLines: ['必须提供 3 台服务器。'],
      scoreLines: ['| 项目实施方案 | 10 |'],
      proposalLines: [
        '项目实施方案覆盖组织、质量和技术路线，必须提供 3 台服务器。',
        '本项目工期为 10 天。',
        '本项目工期为 20 天。',
        '校核算式 2 + 2 = 5。',
      ],
    },
  });

  assert.equal(message.type, 'result');
  assert.ok(messages.some((item) => item.type === 'progress'));
  assert.equal(messages[0].type, 'progress');
  assert.ok(message.result.findings.some((finding) => finding.ruleId === 'calculation.mismatch'));
  assert.equal(message.result.summary.total, message.result.findings.length);
  assert.equal(message.result.formatStats, null);
});

test('serializes worker failures with stable error fields', async () => {
  const missingPath = path.join(__dirname, '不存在的技术方案.docx');
  const { message } = await runWorker({
    documents: {
      tenderLines: [],
      requirementLines: [],
      scoreLines: [],
      proposalLines: [],
    },
    proposalDocxPath: missingPath,
  });

  assert.equal(message.type, 'error');
  assert.equal(typeof message.error.name, 'string');
  assert.match(message.error.message, /不存在的技术方案|ENOENT|no such file|ADM-ZIP|Invalid filename/i);
  assert.equal(typeof message.error.stack, 'string');
  assert.ok(Object.hasOwn(message.error, 'code'));
});

test('does not emit a result after the worker is terminated on first progress', async () => {
  const worker = new Worker(WORKER_PATH);
  const messages = [];
  const proposalLines = Array.from({ length: 30000 }, (_, index) => (
    `第${index + 1}行包含项目组织、人员、设备、工期、质量、安全和验收说明，算式 ${index} + 1 = ${index + 1}。`
  ));

  const exitPromise = new Promise((resolve, reject) => {
    worker.on('message', (message) => {
      messages.push(message);
      if (messages.length === 1) void worker.terminate();
    });
    worker.on('error', reject);
    worker.on('exit', resolve);
  });
  worker.postMessage({
    type: 'run',
    payload: {
      documents: {
        tenderLines: [],
        requirementLines: [],
        scoreLines: [],
        proposalLines,
      },
    },
  });

  await exitPromise;
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(messages[0]?.type, 'progress');
  assert.equal(messages.some((message) => message.type === 'result'), false);
});
