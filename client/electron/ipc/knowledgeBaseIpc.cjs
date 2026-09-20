const { ipcMain } = require('electron');

function registerKnowledgeBaseIpc({ knowledgeBaseService, ipcMain: ipcMainOverride }) {
  const ipc = ipcMainOverride || ipcMain;
  ipc.handle('knowledge-base:list', (_event, options) => knowledgeBaseService.list(options));
  ipc.handle('knowledge-base:create-folder', (_event, name, knowledgeBaseId) => knowledgeBaseService.createFolder(name, knowledgeBaseId));
  ipc.handle('knowledge-base:rename-folder', (_event, folderId, name) => knowledgeBaseService.renameFolder(folderId, name));
  ipc.handle('knowledge-base:reorder-folder', (_event, draggedFolderId, targetFolderId, position) => knowledgeBaseService.reorderFolder(draggedFolderId, targetFolderId, position));
  ipc.handle('knowledge-base:delete-folder', (_event, folderId) => knowledgeBaseService.deleteFolder(folderId));
  ipc.handle('knowledge-base:delete-document', (_event, documentId) => knowledgeBaseService.deleteDocument(documentId));
  ipc.handle('knowledge-base:move-document', (event, documentId, targetFolderId, targetDocumentId, position) => knowledgeBaseService.moveDocument(documentId, targetFolderId, targetDocumentId, position, event.sender));
  ipc.handle('knowledge-base:upload-documents', (event, folderId) => knowledgeBaseService.uploadDocuments(folderId, event.sender));
  ipc.handle('knowledge-base:retry-document', (event, documentId) => knowledgeBaseService.retryDocument(documentId, event.sender));
  // batchSize 已忽略，服务端按模型上下文自动分段匹配
  ipc.handle('knowledge-base:start-matching', (event, documentId, batchSize) => knowledgeBaseService.startMatching(documentId, batchSize, event.sender));
  ipc.handle('knowledge-base:read-markdown', (_event, documentId) => knowledgeBaseService.readMarkdown(documentId));
  ipc.handle('knowledge-base:read-items', (_event, documentId) => knowledgeBaseService.readItems(documentId));
  ipc.handle('knowledge-base:read-analysis', (_event, documentId) => knowledgeBaseService.readAnalysis(documentId));
}

module.exports = { registerKnowledgeBaseIpc };
