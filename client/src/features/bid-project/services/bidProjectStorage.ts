import type { BidContentDuplicateResult, BidProject, BidProjectCreateOptions, BidProjectImportPreview } from '../types';

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
  exportWord(projectId: string, options?: { requestId?: string }): Promise<{ success: boolean; canceled?: boolean; message?: string; path?: string; warnings?: string[] }> {
    return window.yibiao!.bidProject.exportWord(projectId, options);
  },
};
