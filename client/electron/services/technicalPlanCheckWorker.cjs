const { parentPort } = require('node:worker_threads');
const {
  extractRequirements,
  checkRequirements,
  extractScoreItems,
  checkScoreItems,
  checkTimeConflicts,
  checkCalculations,
  checkLogicConflicts,
  checkLanguage,
  checkPlaceRelevance,
  summarizeResults,
} = require('./technicalPlanCheckRules.cjs');
const { scanTechnicalPlanFormat } = require('./technicalPlanFormatChecks.cjs');

function asLines(value) {
  return Array.isArray(value) ? value.map((line) => String(line || '')) : [];
}

function postProgress(stage, progress) {
  parentPort.postMessage({ type: 'progress', stage, progress });
}

function runChecks(payload = {}) {
  const documents = payload.documents || {};
  const tenderLines = asLines(documents.tenderLines);
  const requirementLines = asLines(documents.requirementLines);
  const scoreLines = asLines(documents.scoreLines);
  const proposalLines = asLines(documents.proposalLines);
  const proposalText = proposalLines.join('\n');
  const findings = [];

  postProgress('started', 0);

  const requirements = extractRequirements(requirementLines);
  findings.push(...checkRequirements(requirements, proposalText));
  postProgress('requirements', 15);

  const scoreItems = extractScoreItems(scoreLines);
  findings.push(...checkScoreItems(scoreItems, proposalText));
  postProgress('scores', 30);

  findings.push(...checkTimeConflicts(proposalLines));
  postProgress('time', 42);

  findings.push(...checkCalculations(proposalLines));
  postProgress('calculations', 54);

  findings.push(...checkLogicConflicts(proposalLines));
  postProgress('logic', 66);

  findings.push(...checkLanguage(proposalLines));
  postProgress('language', 78);

  findings.push(...checkPlaceRelevance(proposalLines, [
    tenderLines,
    requirementLines,
    scoreLines,
  ]));
  postProgress('relevance', 88);

  let formatStats = null;
  if (payload.proposalDocxPath) {
    const formatResult = scanTechnicalPlanFormat(payload.proposalDocxPath, {
      scoreItems,
      proposalLines,
      referenceLines: [...tenderLines, ...requirementLines, ...scoreLines],
    });
    findings.push(...formatResult.findings);
    formatStats = formatResult.stats;
  }
  postProgress('format', 96);

  const result = {
    findings,
    summary: summarizeResults(findings),
    formatStats,
    requirementCount: requirements.length,
    scoreItemCount: scoreItems.length,
  };
  postProgress('completed', 100);
  return result;
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || '技术方案检查线程执行失败',
    stack: error?.stack || '',
    code: error?.code ?? null,
  };
}

parentPort.once('message', (message) => {
  try {
    if (message?.type !== 'run') {
      const error = new Error('技术方案检查线程收到未知请求');
      error.code = 'INVALID_WORKER_REQUEST';
      throw error;
    }
    const result = runChecks(message.payload);
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: serializeError(error) });
  }
});

module.exports = { runChecks, serializeError };
