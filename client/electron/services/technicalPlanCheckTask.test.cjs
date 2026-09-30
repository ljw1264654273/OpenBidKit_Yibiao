const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runTechnicalPlanCheckTask, CHECK_STAGES } = require('./technicalPlanCheckTask.cjs');
const { summarizeResults } = require('./technicalPlanCheckRules.cjs');

const workerStages = ['started', 'requirements', 'scores', 'time', 'calculations', 'logic', 'language', 'relevance', 'format', 'completed'];
function harness({ pdf = false, workerError = false, held = false } = {}) {
  const controller = new AbortController();
  const updates = [];
  const checkpoints = [];
  let worker;
  let reports = 0;
  let terminated = false;
  const context = {
    previousState: { tenderFile: { path: 't.docx' }, requirementsFile: { path: 'r.docx' }, scoringFile: { path: 's.docx' }, proposalFile: { path: pdf ? 'p.pdf' : 'p.docx' }, outputPath: 'record.docx' },
    taskControl: { signal: controller.signal },
    updateTask: (patch) => updates.push(patch),
    checkpointTask: (task, patch) => checkpoints.push({ task, patch }),
    technicalPlanCheckService: { prepareDocuments: async (state, callback, { onStage }) => {
      for (const role of ['tender', 'requirements', 'scoring', 'proposal']) onStage(role);
      return callback({ documents: { tenderLines: ['招标'], requirementLines: ['需求'], scoreLines: ['评分'], proposalLines: ['不记录正文'] }, proposalDocxPath: pdf ? null : 'p.docx' });
    } },
  };
  class Worker extends EventEmitter {
    constructor() { super(); worker = this; }
    postMessage(message) {
      assert.equal(message.type, 'run');
      assert.deepEqual(message.payload.documents.proposalLines, ['不记录正文']);
      if (held) return;
      queueMicrotask(() => {
        for (const stage of workerStages) this.emit('message', { type: 'progress', stage });
        this.emit('message', workerError ? { type: 'error', error: { message: '格式扫描失败' } } : { type: 'result', result: { findings: [], summary: summarizeResults([]), formatStats: null, requirementCount: 1, scoreItemCount: 1 } });
      });
    }
    async terminate() { terminated = true; return 0; }
  }
  const dependencies = { Worker, writeTechnicalPlanCheckReport: async ({ result, signal }) => {
    assert.equal(signal, controller.signal);
    reports += 1;
    if (pdf) assert.equal(result.findings[0].ruleId, 'check.skipped');
    return { reportPath: 'record.docx' };
  } };
  return { context, dependencies, controller, updates, checkpoints, getWorker: () => worker, reports: () => reports, terminated: () => terminated };
}

test('runs thirteen stages in order and commits summary/report once after writer', async () => {
  const h = harness();
  await runTechnicalPlanCheckTask(h.context, h.dependencies);
  assert.equal(CHECK_STAGES.length, 13);
  assert.deepEqual(CHECK_STAGES, [
    '读取招标文件', '读取采购需求文件', '读取主观分评分标准', '读取投标技术方案',
    '检查采购需求响应情况', '检查主观分评分标准覆盖情况', '检查时间前后冲突', '检查计算正确性',
    '检查前后逻辑矛盾', '检查语言表达', '检查不相关内容', '检查格式、排版、章节、序号与英文拼写', '生成检查记录',
  ]);
  assert.deepEqual(h.checkpoints.filter(({ task }) => task.status === 'running').map(({ task }) => task.stats.stage), CHECK_STAGES);
  assert.equal(h.reports(), 1);
  assert.equal(h.checkpoints.filter(({ task }) => task.status === 'success').length, 1);
  assert.equal(h.checkpoints.at(-1).patch.reportPath, 'record.docx');
  assert.equal(h.checkpoints.at(-1).patch.summary.total, 0);
  assert.equal(h.checkpoints.some(({ task }) => task.logs?.join('').includes('不记录正文')), false);
  assert.equal(h.terminated(), true);
});

test('PDF adds stable skipped-format info and recalculates summary', async () => {
  const h = harness({ pdf: true });
  await runTechnicalPlanCheckTask(h.context, h.dependencies);
  assert.equal(h.checkpoints.at(-1).patch.summary.info, 1);
  assert.equal(h.checkpoints.at(-1).patch.summary.total, 1);
});

test('cancellation terminates worker without further checkpoints or report replacement', async () => {
  const h = harness({ held: true });
  const running = runTechnicalPlanCheckTask(h.context, h.dependencies);
  await new Promise((resolve) => setImmediate(resolve));
  const checkpointCount = h.checkpoints.length;
  assert.equal(checkpointCount, 4);
  h.controller.abort(Object.assign(new Error('取消检查'), { code: 'TASK_CANCELLED' }));
  await assert.rejects(running, /取消检查/);
  assert.equal(h.terminated(), true);
  assert.equal(h.reports(), 0);
  assert.equal(h.checkpoints.length, checkpointCount);
});

test('worker failure keeps completed stage logs for managed error checkpoint', async () => {
  const h = harness({ workerError: true });
  await assert.rejects(runTechnicalPlanCheckTask(h.context, h.dependencies), /格式扫描失败/);
  assert.equal(h.checkpoints.at(-1).task.logs.length, 12);
  assert.equal(h.checkpoints.every(({ task }) => task.status === 'running'), true);
  assert.equal(h.reports(), 0);
});

test('dispatches the real worker and records PDF skipped format result', async () => {
  const h = harness({ pdf: true });
  let reportResult;
  await runTechnicalPlanCheckTask(h.context, { writeTechnicalPlanCheckReport: async ({ result }) => {
    reportResult = result;
    return { reportPath: 'record.docx' };
  } });
  assert.ok(reportResult.findings.some((finding) => finding.ruleId === 'check.skipped' && finding.severity === 'info'));
  assert.deepEqual(h.checkpoints.at(-1).patch.summary, summarizeResults(reportResult.findings));
  assert.deepEqual(h.checkpoints.filter(({ task }) => task.status === 'running').map(({ task }) => task.stats.stage), CHECK_STAGES);
});
