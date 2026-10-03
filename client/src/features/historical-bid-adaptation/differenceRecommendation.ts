import type {
  HistoricalAdaptationDifference,
  HistoricalAdaptationTargetAction,
} from '../technical-plan/types';

export interface HistoricalAdaptationDifferenceRecommendation {
  action: HistoricalAdaptationTargetAction;
  title: string;
  summary: string;
  impact: string;
  requiresAdvancedReview: boolean;
}

function clean(value: string | undefined): string {
  return String(value || '').trim();
}

function validReplacement(item: HistoricalAdaptationDifference) {
  return (item.replacements || []).filter((replacement) => (
    clean(replacement.old_value)
    && clean(replacement.new_value)
    && clean(replacement.old_value) !== clean(replacement.new_value)
  ));
}

function hasConflictingReplacement(replacements: ReturnType<typeof validReplacement>): boolean {
  const newValuesByOldValue = new Map<string, string>();
  for (const replacement of replacements) {
    const oldValue = clean(replacement.old_value);
    const newValue = clean(replacement.new_value);
    const previous = newValuesByOldValue.get(oldValue);
    if (previous && previous !== newValue) return true;
    newValuesByOldValue.set(oldValue, newValue);
  }
  return false;
}

export function buildDifferenceRecommendation(
  item: HistoricalAdaptationDifference,
): HistoricalAdaptationDifferenceRecommendation {
  const replacements = validReplacement(item);
  const targetAction = item.target_action;

  if (targetAction === 'replace'
    && item.evidence_kind === 'exact-value'
    && replacements.length > 0
    && !hasConflictingReplacement(replacements)) {
    const mappingText = replacements
      .slice(0, 3)
      .map((replacement) => `“${clean(replacement.old_value)}”替换为“${clean(replacement.new_value)}”`)
      .join('；');
    const extraCount = replacements.length - Math.min(replacements.length, 3);
    return {
      action: 'replace',
      title: '系统推荐：确定替换',
      summary: `${mappingText}${extraCount > 0 ? `；另有 ${extraCount} 组替换` : ''}。确认后只替换这些明确旧值，其他文字保持不变。`,
      impact: `正文影响：${item.content_change_scope === 'location-target' ? '地点、行政层级或实施对象' : item.content_change_scope === 'workload' ? '工作量和数量' : item.content_change_scope === 'schedule' ? '工期和进度' : '已明确的事实值'}。`,
      requiresAdvancedReview: false,
    };
  }

  if (targetAction === 'remove' && item.evidence_kind === 'locked-range' && (item.old_content_evidence || []).length > 0) {
    const evidence = clean(item.old_content_evidence?.[0]) || '已锁定的旧内容';
    return {
      action: 'remove',
      title: '系统推荐：删除旧内容',
      summary: `确认后删除已定位的完整旧内容“${evidence}”，不会扩大到其他章节。`,
      impact: '正文影响：仅删除已锁定的完整旧内容。',
      requiresAdvancedReview: false,
    };
  }

  if (targetAction === 'rewrite-fragment' && item.evidence_kind === 'locked-range' && (item.old_content_evidence || []).length > 0) {
    return {
      action: 'rewrite-fragment',
      title: '系统推荐：局部重写',
      summary: '确认后只处理已定位的片段，并按招标基线要求调整；不会整章重写。',
      impact: '正文影响：仅定位片段，片段外内容保持不变。',
      requiresAdvancedReview: false,
    };
  }

  return {
    action: 'review',
    title: '系统推荐：仅人工复核',
    summary: '当前没有完整的旧值和新值映射，系统不会猜测替换内容或删除范围。',
    impact: '正文影响：不会自动修改正文，需在高级编辑中补充证据后再确认。',
    requiresAdvancedReview: true,
  };
}
