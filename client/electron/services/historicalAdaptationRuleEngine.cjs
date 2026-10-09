function text(value) {
  return String(value || '').trim();
}

function buildHistoricalAdaptationRules(differences) {
  const rules = [];
  for (const difference of Array.isArray(differences) ? differences : []) {
    if (difference?.decision !== 'confirmed' || difference.difference_schema_version !== 2) continue;
    const targetAction = difference.target_action;
    const evidenceKind = difference.evidence_kind;
    const confidence = difference.confidence;
    const replacements = (Array.isArray(difference.replacements) ? difference.replacements : [])
      .map((item) => ({ oldValue: text(item?.old_value), newValue: text(item?.new_value) }))
      .filter((item) => item.oldValue && item.newValue && item.oldValue !== item.newValue);
    const newValuesByOldValue = new Map();
    const hasConflictingReplacement = replacements.some((replacement) => {
      const previous = newValuesByOldValue.get(replacement.oldValue);
      newValuesByOldValue.set(replacement.oldValue, replacement.newValue);
      return Boolean(previous && previous !== replacement.newValue);
    });
    if (hasConflictingReplacement) continue;
    const oldContentEvidence = [...new Set((Array.isArray(difference.old_content_evidence)
      ? difference.old_content_evidence : []).map(text).filter(Boolean))];
    if (targetAction === 'replace' && (evidenceKind !== 'exact-value' || !replacements.length)) continue;
    if ((targetAction === 'remove' || targetAction === 'rewrite-fragment')
      && (evidenceKind !== 'locked-range' || !oldContentEvidence.length || replacements.length)) continue;
    if (targetAction === 'review' && (evidenceKind !== 'contextual' || replacements.length)) continue;
    if (!['replace', 'remove', 'rewrite-fragment', 'review'].includes(targetAction)) continue;
    const instruction = [difference.action, difference.note].map(text).join('\n');
    const nestedEvidence = replacements.some((item, index) => replacements.some((other, otherIndex) =>
      index !== otherIndex && item.oldValue !== other.oldValue && item.oldValue.includes(other.oldValue)));
    const semanticInstruction = /重写|重新编写|重新撰写|按[^\n。；]*(?:实际|情况)[^\n。；]*编写|删除[^\n]*(?:地理|行政|人口|概况)/u.test(instruction);
    const paragraphRewrite = targetAction === 'replace' && (semanticInstruction || nestedEvidence)
      || targetAction === 'rewrite-fragment' && /完整段落|整段|(?:地理|行政|人口|概况)/u.test(instruction) && semanticInstruction;
    rules.push({
      id: text(difference.id), differenceId: text(difference.id),
      scope: text(difference.content_change_scope),
      policy: targetAction === 'replace' ? 'must-replace' : 'contextual-review',
      paragraphRewrite,
      evidenceKind, confidence,
      oldValues: [...new Set(replacements.map((item) => item.oldValue))],
      oldContentEvidence,
      replacements,
      authorizedRanges: [],
      targetAction: paragraphRewrite ? 'rewrite-fragment' : targetAction,
      targetRequirement: text(difference.tender_requirement),
      evidence: text(difference.historical_excerpt),
    });
  }
  const mappedRules = rules.filter((rule) => rule.policy === 'must-replace');
  for (const rule of mappedRules) {
    if (!mappedRules.some((other) => other !== rule && rule.oldValues.some((value) =>
      other.oldValues.some((otherValue) => value !== otherValue && (value.includes(otherValue) || otherValue.includes(value)))))) continue;
    rule.paragraphRewrite = true;
    rule.targetAction = 'rewrite-fragment';
  }
  return rules;
}

function summarizeRuleDistribution(rules, items = []) {
  const values = Array.isArray(rules) ? rules : [];
  const reliable = items.filter((item) => item.source_content_hash);
  const lowConfidence = values.filter((rule) => rule.evidenceKind === 'contextual' || rule.confidence === 'low');
  const counts = lowConfidence.map((rule) => ({ id: rule.id,
    count: reliable.filter((item) => item.authorized_ranges?.some((range) => range.differenceId === rule.id)).length }));
  const lowLocalCount = reliable.filter((item) => item.recommended_mode === 'local-rewrite'
    && counts.some((rule) => item.authorized_ranges?.some((range) => range.differenceId === rule.id))).length;
  return {
    total: values.length,
    mustReplace: values.filter((rule) => rule.policy === 'must-replace').length,
    contextualReview: values.filter((rule) => rule.policy === 'contextual-review').length,
    reliableCount: reliable.length,
    blocked: reliable.length > 0 && (counts.some((rule) => rule.count / reliable.length > 0.3) || lowLocalCount / reliable.length > 0.5),
    lowConfidenceHits: counts,
  };
}

module.exports = { buildHistoricalAdaptationRules, summarizeRuleDistribution };
