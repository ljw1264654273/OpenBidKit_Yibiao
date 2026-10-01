import type { HistoricalAdaptationDifference } from '../technical-plan/types';

export function buildBulkConfirmedDifferences(
  differences: HistoricalAdaptationDifference[],
  drafts: Record<string, HistoricalAdaptationDifference>,
) {
  return differences.map((item) => item.decision === 'pending'
    ? { ...(drafts[item.id] || item), decision: 'confirmed' as const }
    : item);
}
