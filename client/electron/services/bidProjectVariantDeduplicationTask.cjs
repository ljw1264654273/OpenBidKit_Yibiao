const crypto = require('node:crypto');
const {
  compareBidContents,
  normalizeParagraph,
  removeIllustrationBlocks,
  replaceFirstTextOutsideIllustrationBlocks,
  replaceTextPreservingIllustrationBlocks,
  splitBidParagraphs,
} = require('./bidContentDuplicateService.cjs');
const { createBidProjectDuplicateRewriteService } = require('./bidProjectDuplicateRewriteService.cjs');

const MAX_REWRITE_ROUNDS = 5;
const MAX_PROTECTED_REWRITE_ATTEMPTS = 3;

function collectOutlineNodes(items, result = []) {
  for (const item of items || []) {
    result.push(item);
    collectOutlineNodes(item?.children, result);
  }
  return result;
}

function readProjectParagraphs(storeOrState) {
  const state = typeof storeOrState?.loadTechnicalPlan === 'function'
    ? storeOrState.loadTechnicalPlan()
    : storeOrState;
  const paragraphs = [];
  const comparisonParagraphs = [];
  const nodes = collectOutlineNodes(state?.outlineData?.outline || []);
  for (const item of nodes) {
    if (item?.children?.length) continue;
    splitBidParagraphs(item?.content || '').forEach((paragraph, localIndex) => {
      paragraphs.push({
        nodeId: String(item.id || ''),
        title: String(item.title || ''),
        localIndex,
        content: paragraph.text,
      });
      comparisonParagraphs.push(paragraph.sentenceText || paragraph.text);
    });
  }
  return {
    state,
    nodes,
    paragraphs,
    content: comparisonParagraphs.join('\n\n'),
  };
}

function calculateContentFingerprint(storeOrState) {
  const { nodes } = readProjectParagraphs(storeOrState);
  const body = nodes.map((item) => ({
    nodeId: String(item?.id || ''),
    content: removeIllustrationBlocks(item?.content || '').replace(/\r\n?/g, '\n').trim(),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

function extractProtectedFacts(value) {
  const text = String(value || '');
  const patterns = [
    /《[^》]+》/gu,
    /\d{4}年\d{1,2}月\d{1,2}日/gu,
    /\d+(?:\.\d+)?%/gu,
    /\b[A-Z]{2,}(?:\s*[-/]?\s*\d[\w.-]*)+\b/gu,
    /\d+(?:\.\d+)?/gu,
  ];
  return [...new Set(patterns.flatMap((pattern) => text.match(pattern) || []))];
}

function missingProtectedFacts(originalText, rewrittenText) {
  const rewritten = String(rewrittenText || '');
  return extractProtectedFacts(originalText).filter((fact) => !rewritten.includes(fact));
}

function replaceMatchedParagraph(content, oldText, replacement, localIndex) {
  const current = String(content || '');
  const paragraphs = current.split(/\n\s*\n+/);
  const populated = paragraphs.map((paragraph, index) => ({ text: normalizeParagraph(paragraph), index }))
    .filter((paragraph) => paragraph.text);
  const selected = Number.isInteger(localIndex) ? populated[localIndex] : null;
  if (selected && selected.text !== oldText) throw new Error('派生标书正文已发生变化，请重新查重');
  const paragraphIndex = selected?.index ?? paragraphs.findIndex((paragraph) => normalizeParagraph(paragraph) === oldText);
  if (paragraphIndex >= 0) {
    return paragraphs.map((paragraph, index) => (
      index === paragraphIndex
        ? replaceTextPreservingIllustrationBlocks(paragraph, replacement)
        : paragraph
    )).join('\n\n');
  }
  const fallback = replaceFirstTextOutsideIllustrationBlocks(current, oldText, replacement);
  if (fallback === null) throw new Error('派生标书正文已发生变化，请重新查重');
  return fallback;
}

function throwIfCancelled(taskControl) {
  if (!taskControl?.signal?.aborted) return;
  throw taskControl.signal.reason || Object.assign(new Error('同源正文查重已取消'), { code: 'TASK_CANCELLED' });
}

async function readTenderParagraphs(store) {
  const markdown = String(await store.readTenderMarkdown?.() || '');
  return splitBidParagraphs(markdown).map((paragraph) => paragraph.text);
}

async function rewriteWithProtection({ rewriteService, input, taskControl }) {
  let lastMissing = [];
  for (let attempt = 1; attempt <= MAX_PROTECTED_REWRITE_ATTEMPTS; attempt += 1) {
    throwIfCancelled(taskControl);
    const result = await rewriteService.rewriteMatch(input);
    lastMissing = missingProtectedFacts(input.rightText, result.rewrittenText);
    if (!lastMissing.length) return result;
  }
  throw new Error(`AI 改写连续 ${MAX_PROTECTED_REWRITE_ATTEMPTS} 次丢失受保护信息：${lastMissing.join('、')}`);
}

async function runBidProjectVariantDeduplicationTask({
  aiService,
  bidProjectManager,
  updateTask = (patch) => patch,
  checkpointTask = (patch) => ({ task: patch }),
  taskControl,
  payload = {},
}) {
  const projectId = String(payload.projectId || payload.project_id || '').trim();
  const projectStore = bidProjectManager?.getProjectStore?.();
  const derivedProject = bidProjectManager?.getProject?.(projectId);
  if (!derivedProject?.derivedFromProjectId) throw new Error('当前项目不是同源派生标书');
  const sourceProject = bidProjectManager.getProject(derivedProject.derivedFromProjectId);
  if (!sourceProject) throw new Error('第一份标书项目已不存在');
  const sourceStore = bidProjectManager.getTechnicalPlanStore(sourceProject.projectId);
  const derivedStore = bidProjectManager.getTechnicalPlanStore(derivedProject.projectId);
  if (!sourceStore || !derivedStore || !projectStore) throw new Error('标书正文 Store 尚未初始化');

  const rewriteService = createBidProjectDuplicateRewriteService({ aiService });
  const sourceTenderParagraphs = await readTenderParagraphs(sourceStore);
  const derivedTenderParagraphs = await readTenderParagraphs(derivedStore);
  let rewriteRounds = 0;
  let latestResultId = null;
  const logs = ['开始按“同源正文查重”标准检查第二份标书'];
  bidProjectManager.updateProject(projectId, {
    status: 'generating',
    uniquenessStatus: 'checking',
    uniquenessAutoRunRequested: false,
    lastError: null,
  });

  try {
    while (true) {
      throwIfCancelled(taskControl);
      const sourceContent = readProjectParagraphs(sourceStore);
      const derivedContent = readProjectParagraphs(derivedStore);
      if (!sourceContent.content.trim() || !derivedContent.content.trim()) {
        throw new Error('第一份或第二份标书正文为空，无法执行同源正文查重');
      }
      const leftContentFingerprint = calculateContentFingerprint(sourceContent.state);
      const rightContentFingerprint = calculateContentFingerprint(derivedContent.state);
      const comparison = compareBidContents({
        leftContent: sourceContent.content,
        rightContent: derivedContent.content,
        sensitivity: 'medium',
        leftExemptParagraphs: sourceTenderParagraphs,
        rightExemptParagraphs: derivedTenderParagraphs,
      });
      const matches = comparison.matches.map((match) => ({
        ...match,
        leftNodeId: sourceContent.paragraphs[match.leftParagraph.index]?.nodeId,
        rightNodeId: derivedContent.paragraphs[match.rightParagraph.index]?.nodeId,
      }));
      latestResultId = projectStore.saveDuplicateResult({
        leftProjectId: sourceProject.projectId,
        rightProjectId: derivedProject.projectId,
        sensitivity: 'medium',
        threshold: comparison.threshold,
        summary: {
          ...comparison.summary,
          leftContentFingerprint,
          rightContentFingerprint,
        },
        matches,
      });
      const result = {
        ...comparison,
        resultId: latestResultId,
        matches,
        summary: {
          ...comparison.summary,
          leftContentFingerprint,
          rightContentFingerprint,
        },
      };
      const passed = result.summary.duplicateParagraphCount === 0
        && result.summary.exactSentenceCount === 0;
      if (passed) {
        logs.push(rewriteRounds
          ? `第 ${rewriteRounds} 轮改写复检通过，未发现非豁免重复内容`
          : '首次检查通过，未发现非豁免重复内容');
        bidProjectManager.updateProject(projectId, {
          status: 'completed',
          uniquenessStatus: 'passed',
          uniquenessResultId: latestResultId,
          uniquenessAttempts: rewriteRounds,
          uniquenessAutoRunRequested: false,
          lastError: null,
        });
        checkpointTask({ status: 'success', progress: 100, logs, stats: { uniqueness: result.summary } });
        return result;
      }

      if (rewriteRounds >= MAX_REWRITE_ROUNDS) {
        const error = new Error(`自动改写已执行 ${MAX_REWRITE_ROUNDS} 轮，仍有 ${result.summary.duplicateParagraphCount} 组重复内容`);
        error.code = 'VARIANT_DUPLICATION_REMAINS';
        bidProjectManager.updateProject(projectId, {
          status: 'failed',
          uniquenessStatus: 'failed',
          uniquenessResultId: latestResultId,
          uniquenessAttempts: rewriteRounds,
          uniquenessAutoRunRequested: false,
          lastError: error.message,
        });
        throw error;
      }

      rewriteRounds += 1;
      logs.push(`第 ${rewriteRounds} 轮发现 ${matches.length} 组重复，开始改写第二份标书`);
      updateTask({
        status: 'running',
        progress: Math.min(90, 10 + rewriteRounds * 16),
        logs,
        stats: { uniqueness: { round: rewriteRounds, duplicateCount: matches.length } },
      });

      const nodeContents = new Map(derivedContent.nodes.map((node) => [String(node.id || ''), String(node.content || '')]));
      const targetMatches = [...new Map(matches.map((match) => [match.rightParagraph.index, match])).values()];
      for (const [index, match] of targetMatches.entries()) {
        throwIfCancelled(taskControl);
        const targetParagraph = derivedContent.paragraphs[match.rightParagraph.index];
        const nodeId = String(targetParagraph?.nodeId || '');
        if (!nodeId || !nodeContents.has(nodeId)) throw new Error('无法定位第二份标书中的重复正文节点');
        const rewritten = await rewriteWithProtection({
          rewriteService,
          taskControl,
          input: {
            leftProjectName: sourceProject.projectName || '第一份标书',
            rightProjectName: derivedProject.projectName || '第二份标书',
            leftText: match.leftParagraph.text,
            rightText: match.rightParagraph.text,
            targetSide: 'right',
            targetProjectId: derivedProject.projectId,
            referenceProjectId: sourceProject.projectId,
            targetProjectName: derivedProject.projectName || '',
            referenceProjectName: sourceProject.projectName || '',
            signal: taskControl?.signal,
          },
        });
        nodeContents.set(nodeId, replaceMatchedParagraph(
          nodeContents.get(nodeId),
          match.rightParagraph.text,
          rewritten.rewrittenText,
          targetParagraph.localIndex,
        ));
        updateTask({
          status: 'running',
          progress: Math.min(94, 10 + rewriteRounds * 16 + Math.round(((index + 1) / targetMatches.length) * 8)),
          logs,
          stats: { uniqueness: { round: rewriteRounds, duplicateCount: targetMatches.length, rewrittenCount: index + 1 } },
        });
      }
      for (const [nodeId, content] of nodeContents) {
        const original = derivedContent.nodes.find((node) => String(node.id || '') === nodeId)?.content || '';
        if (content === original) continue;
        derivedStore.saveChapterContent({ nodeId, content, reason: 'variant-deduplication' });
      }
      bidProjectManager.updateProject(projectId, {
        status: 'generating',
        uniquenessStatus: 'checking',
        uniquenessResultId: latestResultId,
        uniquenessAttempts: rewriteRounds,
        uniquenessAutoRunRequested: false,
      });
    }
  } catch (error) {
    if (taskControl?.signal?.aborted || error?.code === 'TASK_CANCELLED') {
      bidProjectManager.updateProject(projectId, {
        status: 'incomplete',
        uniquenessStatus: 'pending',
        uniquenessResultId: null,
        uniquenessAttempts: rewriteRounds,
        uniquenessAutoRunRequested: false,
        lastError: null,
      });
    } else if (error?.code !== 'VARIANT_DUPLICATION_REMAINS') {
      bidProjectManager.updateProject(projectId, {
        status: 'failed',
        uniquenessStatus: 'failed',
        uniquenessResultId: latestResultId,
        uniquenessAttempts: rewriteRounds,
        uniquenessAutoRunRequested: false,
        lastError: error?.message || '同源正文查重失败',
      });
    }
    throw error;
  }
}

module.exports = {
  MAX_REWRITE_ROUNDS,
  calculateContentFingerprint,
  extractProtectedFacts,
  missingProtectedFacts,
  readProjectParagraphs,
  replaceMatchedParagraph,
  runBidProjectVariantDeduplicationTask,
};
