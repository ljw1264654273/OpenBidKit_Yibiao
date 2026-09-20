const assert = require('node:assert/strict');
const test = require('node:test');

const { registerKnowledgeBaseIpc } = require('./knowledgeBaseIpc.cjs');

test('forwards category options and the move sender while keeping legacy arguments optional', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  const calls = [];
  const knowledgeBaseService = {
    list(options) {
      calls.push({ method: 'list', options });
      return { folders: [], documents: [] };
    },
    createFolder(name, knowledgeBaseId) {
      calls.push({ method: 'createFolder', name, knowledgeBaseId });
      return { id: 'folder-1' };
    },
    renameFolder() {},
    reorderFolder() {},
    deleteFolder() {},
    deleteDocument() {},
    moveDocument(...args) {
      calls.push({ method: 'moveDocument', args });
      return { success: true };
    },
    uploadDocuments() {},
    retryDocument() {},
    startMatching() {},
    readMarkdown() {},
    readItems() {},
    readAnalysis() {},
  };

  registerKnowledgeBaseIpc({ ipcMain, knowledgeBaseService });

  await handlers.get('knowledge-base:list')({}, { allKnowledgeBases: true });
  await handlers.get('knowledge-base:create-folder')({}, '企业资料', 'enterprise');
  const sender = { id: 'renderer-1' };
  await handlers.get('knowledge-base:move-document')(
    { sender },
    'doc-1',
    'folder-2',
    null,
    'after',
  );
  await handlers.get('knowledge-base:list')({});

  assert.deepEqual(calls, [
    { method: 'list', options: { allKnowledgeBases: true } },
    { method: 'createFolder', name: '企业资料', knowledgeBaseId: 'enterprise' },
    { method: 'moveDocument', args: ['doc-1', 'folder-2', null, 'after', sender] },
    { method: 'list', options: undefined },
  ]);
});
