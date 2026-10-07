const { createHash } = require('node:crypto');

const vagueTerms = ['可能', '大概', '也许', '应该', '左右', '尽量'];
const placeholders = ['【待核实】', '【待补充】'];

function flattenLeaves(items, parents = [], result = []) {
  for (const item of Array.isArray(items) ? items : []) {
    const path = [...parents, String(item.title || '')].filter(Boolean);
    if (Array.isArray(item.children) && item.children.length) {
      flattenLeaves(item.children, path, result);
    } else {
      result.push({ item, path });
    }
  }
  return result;
}

function normalizeEvidence(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function addFinding(findings, code, severity, node, evidence, title, message) {
  const normalizedEvidence = normalizeEvidence(evidence);
  const id = createHash('sha256')
    .update([code, node?.item?.id || '', normalizedEvidence].join('\u0000'))
    .digest('hex')
    .slice(0, 24);
  findings.push({
    id,
    code,
    severity,
    node_id: node?.item?.id || undefined,
    chapter_path: node?.path.join(' / ') || '全局差异',
    title,
    message,
    evidence: normalizedEvidence,
    resolution: 'open',
    resolution_note: '',
  });
}

function reviewHistoricalAdaptationContent({ outline, contentItems, differences }, previousFindings = []) {
  const leaves = flattenLeaves(outline);
  const itemsById = new Map((contentItems || []).map((item) => [item.node_id, item]));
  const findings = [];
  const rules = require('./historicalAdaptationRuleEngine.cjs').buildHistoricalAdaptationRules(differences);
  const globalTerms = rules.filter((rule) => rule.policy === 'must-replace').flatMap((rule) => rule.oldValues);

  for (const node of leaves) {
    const nodeId = String(node.item.id || '');
    const content = String(node.item.content || '');
    const item = itemsById.get(nodeId);
    // 章节级人工确认允许保留当前正文，终审不应再次把该章节标成阻断问题。
    if (item?.confirmed_at) continue;
    const hasPlaceholder = placeholders.some((placeholder) => content.includes(placeholder));
    const placeholderOnlyReview = item?.status === 'review' && hasPlaceholder && !(item.residuals || []).length;
    if (!item) {
      addFinding(findings, 'chapter-record-missing', 'P0', node, node.path.join(' / '), '缺少迁移记录', '该章节没有正文迁移来源与确认记录。');
    }
    if (!content.trim()) {
      addFinding(findings, 'chapter-empty', 'P0', node, node.path.join(' / '), '章节正文为空', '该章节没有可导出的正文。');
    }
    if (item && item.status !== 'success' && !placeholderOnlyReview) {
      addFinding(findings, 'chapter-not-ready', 'P0', node, item.error || item.status, '章节迁移未完成', '环节五的章节迁移状态不是 success。');
    }

    const blockedTerms = [...new Set([...(item?.blocked_terms || []), ...(item?.residuals || []), ...globalTerms])]
      .filter((term) => String(term || '').trim())
      .filter((term) => content.includes(term));
    if (blockedTerms.length) {
      addFinding(findings, 'historical-residue', 'P0', node, blockedTerms.join('、'), '发现历史残留', `正文仍包含历史地点、日期、工作量或其他阻断项：${blockedTerms.join('、')}。`);
    }

    for (const placeholder of placeholders) {
      if (content.includes(placeholder)) {
        addFinding(findings, 'placeholder', 'P1', node, placeholder, '存在待处理占位符', `正文仍包含${placeholder}，允许先导出 Word，导出后请人工核实或补充。`);
      }
    }

    for (const rule of rules) {
      if (rule.targetAction !== 'remove') continue;
      for (const excerpt of rule.oldContentEvidence) {
        if (content.includes(excerpt)) {
          addFinding(findings, 'deleted-content-residue', 'P0', node, excerpt, '删除内容仍出现在正文', `已确认删除的历史内容仍出现在本章：${excerpt}。`);
        }
      }
    }

    const vagueMatches = vagueTerms.filter((term) => content.includes(term));
    if (vagueMatches.length) {
      addFinding(findings, 'vague-language', 'P1', node, content, '存在模糊表达', `正文包含模糊表达：${vagueMatches.join('、')}。请改为明确承诺或补充核实依据。`);
    }
  }

  const linkedDifferenceIds = new Set((contentItems || []).flatMap((item) => item.difference_ids || []));
  for (const difference of differences || []) {
    if (difference.decision === 'confirmed' && !linkedDifferenceIds.has(difference.id)) {
      addFinding(findings, 'difference-uncovered', 'P1', null, difference.title || difference.id, '差异尚未关联到正文', `已确认差异“${difference.title || difference.id}”未关联到适配正文。`);
    }
    if (difference.decision === 'ignored') {
      addFinding(findings, 'difference-ignored', 'P2', null, difference.title || difference.id, '存在忽略的差异项', `差异“${difference.title || difference.id}”被忽略，请确认该处理仍符合当前项目需要。`);
    }
    if (difference.category === '其他人工判断') {
      addFinding(findings, 'manual-review', 'P2', null, difference.title || difference.id, '需要人工判断', `差异“${difference.title || difference.id}”属于人工判断范围，自动审核不判断其语义正确性。`);
    }
  }

  const previousById = new Map((previousFindings || []).map((finding) => [finding.id, finding]));
  return findings.sort((left, right) => left.severity.localeCompare(right.severity)
    || left.chapter_path.localeCompare(right.chapter_path, 'zh-CN')
    || left.code.localeCompare(right.code)).map((finding) => {
    const previous = previousById.get(finding.id);
    return previous && finding.severity !== 'P0' ? {
      ...finding,
      resolution: previous.resolution || 'open',
      resolution_note: previous.resolution_note || '',
      resolved_at: previous.resolved_at,
    } : finding;
  });
}

module.exports = { reviewHistoricalAdaptationContent };
