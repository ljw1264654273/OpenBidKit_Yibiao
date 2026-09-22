import type { KnowledgeBaseIndex, KnowledgeDocument, KnowledgeFolder } from '../../knowledge-base/types';

export function getFoldersForKnowledgeBase(index: KnowledgeBaseIndex, knowledgeBaseId: string): KnowledgeFolder[] {
  if (!knowledgeBaseId) return [];
  return index.folders.filter((folder) => folder.knowledge_base_id === knowledgeBaseId);
}

export function getDocumentsForFolder(index: KnowledgeBaseIndex, folderId: string): KnowledgeDocument[] {
  if (!folderId) return [];
  return index.documents.filter((document) => document.folder_id === folderId && document.status === 'success');
}

export function mergeFolderDocumentSelection(
  index: KnowledgeBaseIndex,
  folderId: string,
  currentDocumentIds: string[],
  selectedDocumentIds: string[],
): string[] {
  if (!folderId || !index.folders.some((folder) => folder.id === folderId)) {
    return [];
  }

  const folderDocumentIds = new Set(
    index.documents
      .filter((document) => document.folder_id === folderId)
      .map((document) => document.id),
  );
  const selectableDocumentIds = new Set(getDocumentsForFolder(index, folderId).map((document) => document.id));
  const retainedDocumentIds = currentDocumentIds.filter((id) => !folderDocumentIds.has(id));
  const acceptedSelectedDocumentIds = selectedDocumentIds.filter((id) => selectableDocumentIds.has(id));

  return [...new Set([...retainedDocumentIds, ...acceptedSelectedDocumentIds])];
}
