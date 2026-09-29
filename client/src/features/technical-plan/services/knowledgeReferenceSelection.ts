import type { KnowledgeBaseId } from '../../knowledge-base/knowledgeBaseCatalog';
import type { KnowledgeBaseIndex, KnowledgeDocument, KnowledgeFolder } from '../../knowledge-base/types';

const KNOWLEDGE_BASE_LABELS: Record<KnowledgeBaseId, string> = {
  document: '文档知识库',
  'national-standard': '国标文档',
  'provincial-standard': '省标文档',
  'municipal-standard': '市标文档',
  'industry-standard': '行业标文档',
  enterprise: '企业文档',
};

export type KnowledgeReferenceCategoryFilter = KnowledgeBaseId | 'all';

export interface KnowledgeReferenceFilters {
  knowledgeBaseId: KnowledgeReferenceCategoryFilter;
  province: string;
  city: string;
  keyword: string;
}

export interface KnowledgeReferenceFolderGroup {
  folder: KnowledgeFolder;
  documents: KnowledgeDocument[];
}

export interface KnowledgeSelectionSummaryItem {
  key: string;
  label: string;
  documentIds: string[];
  documentCount: number;
}

function normalizeKeyword(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function includesKeyword(value: string | null | undefined, keyword: string): boolean {
  return normalizeKeyword(value || '').includes(keyword);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function filterKnowledgeReferenceGroups(
  index: KnowledgeBaseIndex,
  filters: KnowledgeReferenceFilters,
): KnowledgeReferenceFolderGroup[] {
  const keyword = normalizeKeyword(filters.keyword);
  const availableDocuments = index.documents.filter((document) => document.status === 'success');

  return index.folders.flatMap((folder) => {
    if (filters.knowledgeBaseId !== 'all' && folder.knowledge_base_id !== filters.knowledgeBaseId) return [];
    if (filters.province && folder.province !== filters.province) return [];
    if (filters.city && folder.city !== filters.city) return [];

    const folderDocuments = availableDocuments.filter((document) => document.folder_id === folder.id);
    if (!folderDocuments.length) return [];
    if (!keyword) return [{ folder, documents: folderDocuments }];

    const folderMatched = [folder.name, folder.province, folder.city].some((value) => includesKeyword(value, keyword));
    const documents = folderMatched
      ? folderDocuments
      : folderDocuments.filter((document) => includesKeyword(document.file_name, keyword));
    return documents.length ? [{ folder, documents }] : [];
  });
}

export function getKnowledgeLocationOptions(
  index: KnowledgeBaseIndex,
  knowledgeBaseId: KnowledgeReferenceCategoryFilter,
): { provinces: string[]; cities: string[] } {
  const folders = index.folders.filter((folder) => knowledgeBaseId === 'all' || folder.knowledge_base_id === knowledgeBaseId);
  return {
    provinces: uniqueIds(folders.map((folder) => folder.province || '')),
    cities: uniqueIds(folders.map((folder) => folder.city || '')),
  };
}

export function toggleDocumentKnowledgeSelection(selectedIds: string[], documentId: string): string[] {
  return selectedIds.includes(documentId)
    ? selectedIds.filter((id) => id !== documentId)
    : uniqueIds([...selectedIds, documentId]);
}

export function toggleFolderKnowledgeSelection(selectedIds: string[], documents: KnowledgeDocument[]): string[] {
  const documentIds = uniqueIds(documents.filter((document) => document.status === 'success').map((document) => document.id));
  const allSelected = documentIds.length > 0 && documentIds.every((id) => selectedIds.includes(id));
  return allSelected
    ? selectedIds.filter((id) => !documentIds.includes(id))
    : uniqueIds([...selectedIds, ...documentIds]);
}

export function toggleVisibleKnowledgeSelection(
  selectedIds: string[],
  groups: KnowledgeReferenceFolderGroup[],
): string[] {
  return toggleFolderKnowledgeSelection(selectedIds, groups.flatMap((group) => group.documents));
}

export function buildKnowledgeSelectionSummary(
  index: KnowledgeBaseIndex,
  selectedIds: string[],
): KnowledgeSelectionSummaryItem[] {
  const documentById = new Map(index.documents.map((document) => [document.id, document]));
  const folderById = new Map(index.folders.map((folder) => [folder.id, folder]));
  const groups = new Map<string, KnowledgeSelectionSummaryItem>();

  uniqueIds(selectedIds).forEach((documentId) => {
    const document = documentById.get(documentId);
    if (!document) return;
    const folder = folderById.get(document.folder_id);
    if (!folder) return;
    const key = `folder:${folder.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.documentIds.push(documentId);
      existing.documentCount += 1;
      return;
    }
    groups.set(key, {
      key,
      label: `${KNOWLEDGE_BASE_LABELS[folder.knowledge_base_id] || '知识库'} / ${folder.name}`,
      documentIds: [documentId],
      documentCount: 1,
    });
  });

  return [...groups.values()];
}
