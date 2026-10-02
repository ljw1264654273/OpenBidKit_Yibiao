const { applyRangeEdits } = require('../utils/textEdit.cjs');
const { sourceHash } = require('./historicalSourceArchive.cjs');

function factTokens(value) {
  return [...new Set(String(value || '').match(/20\d{2}年(?:\d{1,2}月(?:\d{1,2}日)?)?|\d+(?:\.\d+)?\s*(?:万元|亿元|元|个月|年|月|日|天|人|台|辆|部|户|宗|套|次|公里|平方米|亩|%|％)|[\p{Script=Han}]{2,12}(?:街道|社区|乡镇|村|镇)/gu) || [])];
}

function countToken(value, token) {
  return String(value || '').split(token).length - 1;
}

function factKind(token) {
  if (/(?:万元|亿元|元)$/u.test(token)) return 'amount';
  if (/人$/u.test(token)) return 'personnel';
  if (/(?:台|辆|部)$/u.test(token)) return 'equipment';
  if (/(?:20\d{2}年|个月|年|月|日|天)/u.test(token)) return 'schedule';
  if (/(?:%|％)$/u.test(token)) return 'percentage';
  if (/(?:户|宗|套|次|公里|平方米|亩)$/u.test(token)) return 'workload';
  return 'location';
}

function hasProtectedMarkdown(value) {
  return /(^|\n)\s*(?:#{1,6}\s|`{3,}|~{3,}|\|)|!\[[^\]]*\]\(|<\/?[a-z][^>]*>/iu.test(value);
}

function markdownProtectedRanges(source) {
  const ranges = [];
  let fence = null;
  for (const match of source.matchAll(/^.*(?:\r?\n|$)/gmu)) {
    const line = match[0];
    if (!line) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line.replace(/\r?\n$/u, ''));
    if (marker && !fence) fence = { marker: marker[1], start: match.index };
    else if (marker && fence && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim()) {
      ranges.push({ start: fence.start, end: match.index + line.length });
      fence = null;
    } else if (!fence && hasProtectedMarkdown(line)) ranges.push({ start: match.index, end: match.index + line.length });
  }
  if (fence) ranges.push({ start: fence.start, end: source.length });
  return ranges;
}

function applyAuthorizedLocalEdits(sourceContent, rules, modelEdits = []) {
  const source = String(sourceContent || '');
  const contentHash = sourceHash(source);
  const protectedRanges = markdownProtectedRanges(source);
  const edits = [];
  const errors = [];
  const fragmentRules = [];
  for (const rule of rules || []) {
    if (rule.targetAction === 'rewrite-fragment') fragmentRules.push(rule);
    if (!['replace', 'remove', 'rewrite-fragment'].includes(rule.targetAction)) continue;
    if (!rule.authorizedRanges?.length) errors.push(`non-local-edit: ${rule.id} 缺少授权范围`);
    for (const range of rule.authorizedRanges || []) {
      const oldValue = String(range.oldValue || '');
      if (!oldValue || !Number.isInteger(range.startOffset) || !Number.isInteger(range.endOffset)
        || range.startOffset < 0 || range.endOffset > source.length
        || source.slice(range.startOffset, range.endOffset) !== oldValue
        || (range.contentHash && range.contentHash !== contentHash)) {
        errors.push(`source-stale: ${rule.id} 的来源证据范围已变化`);
        continue;
      }
      if (rule.targetAction === 'rewrite-fragment') continue;
      const replacement = rule.targetAction === 'replace'
        ? (rule.replacements || []).find((item) => item.oldValue === oldValue) : null;
      if (rule.targetAction === 'replace' && !replacement?.newValue) {
        errors.push(`invalid-edit-structure: ${rule.id} 缺少精确替换映射`);
        continue;
      }
      edits.push({ start: range.startOffset, end: range.endOffset,
        newText: rule.targetAction === 'remove' ? '' : replacement.newValue });
    }
  }
  if (fragmentRules.length && !modelEdits?.length) errors.push('invalid-edit-structure: 返回结果必须包含非空 edits 数组');
  let editedLength = 0;
  const covered = new Set();
  for (const edit of modelEdits || []) {
    const oldText = edit?.old_text ?? edit?.oldText;
    const newText = edit?.new_text ?? edit?.newText;
    if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string') {
      errors.push('invalid-edit-structure: edit 必须包含字符串 old_text 和 new_text');
      continue;
    }
    const start = source.indexOf(oldText);
    if (start < 0) { errors.push('old-text-not-found: Could not find oldText in content'); continue; }
    if (source.indexOf(oldText, start + 1) >= 0) { errors.push('old-text-ambiguous: old_text 多处命中，必须唯一'); continue; }
    const end = start + oldText.length;
    const rule = fragmentRules.find((candidate) => candidate.authorizedRanges?.some((range) => start >= range.startOffset && end <= range.endOffset));
    if (!rule) { errors.push('non-local-edit: 编辑超出授权片段'); continue; }
    if (oldText === newText) { errors.push('no-effective-change: 新旧片段相同'); continue; }
    if (oldText.length / source.length > 0.2 || hasProtectedMarkdown(newText)
      || protectedRanges.some((range) => start < range.end && end > range.start)) {
      errors.push('non-local-edit: 不得替换完整来源或整章，单项范围超过20%或跨 Markdown 保护边界');
      continue;
    }
    editedLength += oldText.length;
    const beforeFacts = factTokens(oldText);
    const afterFacts = factTokens(newText);
    const requirementFacts = factTokens(rule.targetRequirement);
    const evidence = rule.oldContentEvidence?.join('\n') || '';
    const allowedKind = { workload: 'workload', schedule: 'schedule', 'location-target': 'location' }[rule.scope];
    const oldFacts = factTokens(evidence).filter((token) => factKind(token) === allowedKind);
    const newFacts = requirementFacts.filter((token) => factKind(token) === allowedKind);
    const allowedFacts = oldFacts.length === 1 && newFacts.length === 1 ? [...oldFacts, ...newFacts] : [];
    const changedFacts = [...new Set([...beforeFacts, ...afterFacts])].filter((token) => {
      if (countToken(oldText, token) === countToken(newText, token)) return false;
      return !allowedFacts.includes(token);
    });
    if (changedFacts.length) { errors.push(`protected-fact-changed: 不得改动允许范围外的事实：${changedFacts.join('、')}`); continue; }
    const unrelatedSentences = (oldText.match(/[^。！？\n]+[。！？]?/gu) || [])
      .filter((sentence) => !(rule.oldContentEvidence || []).some((term) => sentence.includes(term) || term.includes(sentence)));
    if (unrelatedSentences.some((sentence) => countToken(oldText, sentence) !== countToken(newText, sentence))) {
      errors.push('non-local-edit: 授权片段内未关联句子必须逐字保持不变');
      continue;
    }
    covered.add(rule.id);
    edits.push({ start, end, newText });
  }
  if (editedLength / source.length > 0.35) errors.push('non-local-edit: 编辑合计范围超过35%');
  for (const rule of fragmentRules) {
    if (!covered.has(rule.id)) errors.push(`invalid-edit-structure: ${rule.id} 的授权片段未产生有效编辑`);
  }
  if (errors.length) return { content: source, changed: false, errors };
  const uniqueEdits = [...new Map(edits.map((edit) => [`${edit.start}:${edit.end}:${edit.newText}`, edit])).values()];
  const applied = applyRangeEdits(source, uniqueEdits);
  if (!applied.errors.length) {
    for (const rule of rules || []) {
      if (rule.targetAction === 'remove') {
        for (const evidence of rule.oldContentEvidence || []) {
          if (applied.content.includes(evidence)) errors.push(`residual-old-value: ${evidence} 仍有未删除的来源位置`);
        }
      }
      if (rule.targetAction !== 'replace') continue;
      for (const replacement of rule.replacements || []) {
        if (applied.content.includes(replacement.oldValue)) errors.push(`residual-old-value: ${replacement.oldValue} 仍有未替换的来源位置`);
      }
    }
  }
  if (errors.length) return { content: source, changed: false, errors };
  return { content: applied.content, changed: applied.changed, errors: applied.errors };
}

module.exports = { applyAuthorizedLocalEdits };
