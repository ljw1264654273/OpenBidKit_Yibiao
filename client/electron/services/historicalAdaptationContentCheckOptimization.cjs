const { stableHash } = require('./historicalAdaptationFactRegistry.cjs');

const OPTIMIZATION_VERSION = 1;

function chapterCacheKey(context, chapter, summary) {
  return stableHash({ version: OPTIMIZATION_VERSION, chapter, summary,
    baseline: context.baseline, baselineFacts: context.baselineFacts,
    globalFacts: context.globalFacts, differences: context.differences,
    deterministicFacts: context.deterministicFacts });
}

function semanticCacheKey(request) {
  return stableHash({ version: OPTIMIZATION_VERSION, messages: request.messages, response_format: request.response_format });
}

function roundProgress(progress, round) {
  if (progress === 100) return 100;
  if (progress <= 5 && round === 0) return progress;
  // 每轮事实/语义的 10–65 映射到检查区间；70–85 留给下一轮之前的修复。
  const [start, end, repairEnd] = [[5, 60, 64], [64, 80, 84], [84, 99, 99]][round];
  if (progress <= 65) return Math.round(start + Math.max(0, progress - 10) / 55 * (end - start));
  return Math.round(end + Math.min(1, (progress - 65) / 20) * (repairEnd - end));
}

module.exports = { OPTIMIZATION_VERSION, chapterCacheKey, semanticCacheKey, roundProgress };
