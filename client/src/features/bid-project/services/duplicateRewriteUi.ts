import type {
  BidContentDuplicateMatch,
  BidContentDuplicateTargetSide,
  BidProjectDuplicateSummary,
} from '../types';

export interface RewriteTarget {
  projectId: string;
  nodeId?: string;
  oldText: string;
  projectLabel: string;
}

export function getRewriteTarget(
  match: BidContentDuplicateMatch,
  targetSide: Exclude<BidContentDuplicateTargetSide, 'none'>,
  leftProjectId: string,
  rightProjectId: string,
  leftProjectLabel = '左侧文件',
  rightProjectLabel = '右侧文件',
): RewriteTarget {
  if (targetSide === 'left') {
    return {
      projectId: leftProjectId,
      nodeId: match.leftNodeId,
      oldText: match.leftParagraph.text,
      projectLabel: leftProjectLabel,
    };
  }
  return {
    projectId: rightProjectId,
    nodeId: match.rightNodeId,
    oldText: match.rightParagraph.text,
    projectLabel: rightProjectLabel,
  };
}

export function canConfirmRewrite(draft: string | undefined): boolean {
  return Boolean(String(draft || '').trim());
}

export function formatDuplicateSummary(summary: BidProjectDuplicateSummary | null | undefined): string {
  if (!summary) return '暂无查重结果';
  const updatedAt = new Date(summary.updatedAt);
  const updatedLabel = Number.isNaN(updatedAt.getTime())
    ? ''
    : ` · ${updatedAt.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  return `${summary.duplicateParagraphCount} 组重复 · 最高 ${Math.round(summary.maxSimilarity * 100)}%${updatedLabel}`;
}

export function buildIgnoredDecisionPatch(resultId: string, matchId: string) {
  return {
    resultId,
    matchId,
    decision: 'ignored' as const,
    targetSide: 'none' as const,
  };
}
