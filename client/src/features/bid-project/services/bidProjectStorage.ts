import type { BidContentDuplicateDecision, BidContentDuplicateResult, BidContentDuplicateRewriteRequest, BidContentDuplicateRewriteResult, BidContentDuplicateTargetSide, BidProject, BidProjectCreateOptions, BidProjectDuplicateSummary, BidProjectImportPreview } from '../types';
import type { ExportFormatConfig } from '../../../shared/types/exportFormat';

export const bidProjectStorage = {
  list(filters?: { query?: string; status?: string; type?: string }): Promise<BidProject[]> {
    return window.yibiao?.bidProject.list(filters) || Promise.resolve([]);
  },
  get(projectId: string): Promise<BidProject | null> {
    return window.yibiao?.bidProject.get(projectId) || Promise.resolve(null);
  },
  open(projectId: string): Promise<BidProject> {
    return window.yibiao!.bidProject.open(projectId);
  },
  create(options: BidProjectCreateOptions): Promise<BidProject> {
    return window.yibiao!.bidProject.create(options);
  },
  update(projectId: string, patch: Partial<BidProject>): Promise<BidProject> {
    return window.yibiao!.bidProject.update(projectId, patch);
  },
  remove(projectId: string): Promise<{ success: boolean; message?: string }> {
    return window.yibiao!.bidProject.delete(projectId);
  },
  prepareImport(filePaths?: string[]): Promise<BidProjectImportPreview> {
    return window.yibiao!.bidProject.prepareImport(filePaths);
  },
  compareContent(payload: { leftProjectId: string; rightProjectId: string; sensitivity?: 'low' | 'medium' | 'high' }): Promise<BidContentDuplicateResult> {
    return window.yibiao!.bidProject.compareContent(payload);
  },
  listRecentDuplicateSummaries(projectIds?: string[]): Promise<Record<string, BidProjectDuplicateSummary | null>> {
    return window.yibiao!.bidProject.listRecentDuplicateSummaries(projectIds);
  },
  loadDuplicateResult(resultId: string): Promise<BidContentDuplicateResult | null> {
    return window.yibiao!.bidProject.loadDuplicateResult(resultId);
  },
  loadLatestDuplicateResult(projectId: string): Promise<BidContentDuplicateResult | null> {
    return window.yibiao!.bidProject.loadLatestDuplicateResult(projectId);
  },
  updateDuplicateMatchDecision(payload: { resultId: string; matchId: string; decision: BidContentDuplicateDecision; targetSide: BidContentDuplicateTargetSide; rewriteDraft?: string | null }): Promise<BidContentDuplicateResult> {
    return window.yibiao!.bidProject.updateDuplicateMatchDecision(payload);
  },
  rewriteDuplicateMatch(payload: BidContentDuplicateRewriteRequest): Promise<BidContentDuplicateRewriteResult> {
    return window.yibiao!.bidProject.rewriteDuplicateMatch(payload);
  },
  replaceContent(projectId: string, payload: { nodeId: string; oldText: string; newText: string }): Promise<unknown> {
    return window.yibiao!.bidProject.replaceContent(projectId, payload);
  },
  exportWord(projectId: string, options?: { requestId?: string; exportFormat?: ExportFormatConfig }): Promise<{ success: boolean; canceled?: boolean; message?: string; path?: string; warnings?: string[] }> {
    return window.yibiao!.bidProject.exportWord(projectId, options);
  },
};
