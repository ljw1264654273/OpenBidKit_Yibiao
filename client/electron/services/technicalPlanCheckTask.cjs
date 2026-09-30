const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { summarizeResults } = require('./technicalPlanCheckRules.cjs');
const { writeTechnicalPlanCheckReport } = require('./technicalPlanCheckReport.cjs');

const CHECK_STAGES = Object.freeze([
  '读取招标文件', '读取采购需求文件', '读取主观分评分标准', '读取投标技术方案',
  '检查采购需求响应情况', '检查主观分评分标准覆盖情况', '检查时间前后冲突', '检查计算正确性',
  '检查前后逻辑矛盾', '检查语言表达', '检查不相关内容', '检查格式、排版、章节、序号与英文拼写', '生成检查记录',
]);
const PARSE_STAGE_INDEX = { tender: 0, requirements: 1, scoring: 2, proposal: 3 };
const WORKER_STAGE_INDEX = { requirements: 4, scores: 5, time: 6, calculations: 7, logic: 8, language: 9, relevance: 10, format: 11 };

async function runWorker(payload, { signal, onProgress, WorkerClass }) {
  signal.throwIfAborted();
  const worker = new WorkerClass(path.join(__dirname, 'technicalPlanCheckWorker.cjs'));
  let removeAbortListener;
  try {
    return await new Promise((resolve, reject) => {
      let completed = false;
      function finish(error, result) {
        if (completed) return;
        completed = true;
        if (error) reject(error);
        else resolve(result);
      }
      const onAbort = () => finish(signal.reason || new Error('技术方案检查已取消'));
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      worker.on('message', (message) => {
        if (completed || signal.aborted) return;
        try {
          if (message.type === 'progress') onProgress(message.stage);
          else if (message.type === 'result') finish(null, message.result);
          else if (message.type === 'error') finish(Object.assign(new Error(message.error.message), { code: message.error.code }));
        } catch (error) {
          finish(error);
        }
      });
      worker.once('error', (error) => finish(error));
      worker.once('exit', (code) => {
        if (!completed) finish(new Error(`技术方案检查线程意外退出（${code}）`));
      });
      worker.postMessage({ type: 'run', payload });
    });
  } finally {
    removeAbortListener?.();
    await worker.terminate();
  }
}

async function runTechnicalPlanCheckTask({ technicalPlanCheckService, previousState, taskControl, checkpointTask }, dependencies = {}) {
  const signal = taskControl.signal;
  const logs = [];
  let lastStage = -1;
  function stage(index) {
    if (index === undefined || index <= lastStage || signal.aborted) return;
    lastStage = index;
    logs.push(`${index + 1}/13 ${CHECK_STAGES[index]}`);
    checkpointTask({ status: 'running', progress: Math.round(index / 13 * 100), logs: [...logs], stats: { stage: CHECK_STAGES[index], stageIndex: index + 1, stageCount: 13 } });
  }
  signal.throwIfAborted();
  const result = await technicalPlanCheckService.prepareDocuments(previousState, (prepared) => runWorker(prepared, {
    signal, onProgress: (workerStage) => stage(WORKER_STAGE_INDEX[workerStage]), WorkerClass: dependencies.Worker || Worker,
  }), { signal, onStage: (role) => stage(PARSE_STAGE_INDEX[role]) });
  signal.throwIfAborted();
  if (path.extname(previousState.proposalFile.path).toLowerCase() === '.pdf') {
    result.findings.push({ ruleId: 'check.skipped', severity: 'info', category: '格式检查', message: '投标技术方案为 PDF，已跳过 Word 格式检查；如需检查字体、样式及表格格式，请选择 Word 文件后重新执行', contexts: [] });
    result.summary = summarizeResults(result.findings);
  }
  stage(12);
  const { reportPath } = await (dependencies.writeTechnicalPlanCheckReport || writeTechnicalPlanCheckReport)({
    result,
    files: { tender: previousState.tenderFile, requirements: previousState.requirementsFile, scoring: previousState.scoringFile, proposal: previousState.proposalFile },
    outputPath: previousState.outputPath,
    signal,
  });
  // writer 的提交边界后立即同步 checkpoint，不在报告替换和状态落库之间让出执行权。
  checkpointTask({ status: 'success', progress: 100, logs: [...logs, '技术方案检查完成，检查记录已生成'], stats: { stage: CHECK_STAGES[12], stageIndex: 13, stageCount: 13 } }, { summary: result.summary, reportPath });
}

module.exports = { runTechnicalPlanCheckTask, CHECK_STAGES };
