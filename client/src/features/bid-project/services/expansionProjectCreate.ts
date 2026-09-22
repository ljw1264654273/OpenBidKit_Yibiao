import type {
  BidProject,
  ExpansionImportDocumentPreview,
  ExpansionProjectImportOptions,
  ExpansionProjectImportPreview,
} from '../types';

export function prepareExpansionImport(
  tenderFilePaths?: string[],
  originalPlanFilePaths?: string[],
): Promise<ExpansionProjectImportPreview> {
  return window.yibiao!.bidProject.prepareExpansionImport({
    tenderFilePaths,
    originalPlanFilePaths,
  });
}

export function confirmExpansionImport(
  token: string,
  options?: ExpansionProjectImportOptions,
): Promise<BidProject> {
  return window.yibiao!.bidProject.confirmExpansionImport(token, options);
}

export function discardExpansionImport(token: string): Promise<{ success: boolean; message?: string }> {
  return window.yibiao!.bidProject.discardExpansionImport(token);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim();
}

export function getExpansionProjectDefaultName(preview: ExpansionProjectImportPreview): string {
  const tenderName = preview.tender?.documents?.find((document) => document.success && hasNonEmptyString(document.fileName))?.fileName;
  const originalPlanName = preview.originalPlan?.success && hasNonEmptyString(preview.originalPlan.fileName)
    ? preview.originalPlan.fileName
    : '';
  return stripExtension(tenderName || originalPlanName) || '扩写项目';
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasCompleteDocumentMetadata(document: ExpansionImportDocumentPreview | undefined): boolean {
  if (!document || document.success !== true) {
    return false;
  }

  return hasNonEmptyString(document.fileName)
    && Object.prototype.hasOwnProperty.call(document, 'parserLabel')
    && (document.parserLabel === null || typeof document.parserLabel === 'string')
    && hasNonEmptyString(document.fileHash)
    && hasNonEmptyString(document.contentHash)
    && typeof document.contentPreview === 'string'
    && Number.isFinite(document.markdownChars)
    && document.markdownChars >= 0
    && Number.isFinite(document.size)
    && document.size >= 0
    && hasNonEmptyString(document.modifiedAt);
}

export function canCreateExpansionProject(preview: ExpansionProjectImportPreview): boolean {
  if (!preview || preview.success !== true || preview.canceled !== false || !hasNonEmptyString(preview.token)) {
    return false;
  }

  const { tender } = preview;
  if (!tender
    || tender.success !== true
    || !Number.isInteger(tender.requestedCount)
    || tender.requestedCount <= 0
    || !Array.isArray(tender.errors)
    || tender.errors.length !== 0
    || !Array.isArray(tender.documents)
    || tender.documents.length !== tender.requestedCount) {
    return false;
  }

  return tender.documents.every((document) => hasCompleteDocumentMetadata(document))
    && hasCompleteDocumentMetadata(preview.originalPlan);
}

export function getFilePathsFromFileList(fileList: FileList): string[] {
  return Array.from(fileList)
    .map((file) => window.yibiao?.file.getPathForFile(file) || '')
    .filter(Boolean);
}
