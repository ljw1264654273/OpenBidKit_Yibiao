const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectLeafKnowledgeFolderIds,
  collectLeafKnowledgeDocumentIds,
  resolveNodeKnowledgeDocumentIds,
  loadAllKnowledgeBaseIndex,
  mergeSectionDocumentIds,
  buildKnowledgeItemIdsBySection,
} = require('./contentGenerationTask.cjs');

test('collects node knowledge folders from each leaf and its ancestors', () => {
  const outline = [
    {
      id: '1',
      title: '父目录',
      knowledge_folder_ids: ['folder-parent'],
      children: [
        { id: '1.1', title: '子目录', knowledge_folder_ids: ['folder-child'] },
        { id: '1.2', title: '兄弟目录' },
      ],
    },
    { id: '2', title: '旁支目录', knowledge_folder_ids: ['folder-sibling'] },
  ];

  const result = collectLeafKnowledgeFolderIds(outline);

  assert.deepEqual(Object.fromEntries(result), {
    '1.1': ['folder-parent', 'folder-child'],
    '1.2': ['folder-parent'],
    2: ['folder-sibling'],
  });
});

test('resolves only successful documents from inherited folders', () => {
  const sectionFolders = new Map([
    ['1.1', ['folder-parent', 'folder-child']],
    ['1.2', ['folder-parent']],
  ]);
  const index = {
    folders: [],
    documents: [
      { id: 'doc-parent', folder_id: 'folder-parent', status: 'success' },
      { id: 'doc-parent-pending', folder_id: 'folder-parent', status: 'pending' },
      { id: 'doc-child', folder_id: 'folder-child', status: 'success' },
      { id: 'doc-sibling', folder_id: 'folder-sibling', status: 'success' },
    ],
  };

  const result = resolveNodeKnowledgeDocumentIds(index, sectionFolders);

  assert.deepEqual(Object.fromEntries(result), {
    '1.1': ['doc-parent', 'doc-child'],
    '1.2': ['doc-parent'],
  });
});

test('loads non-document category folders for dynamic links while direct document ids stay stable', () => {
  const calls = [];
  const index = {
    folders: [{ id: 'folder-enterprise', knowledge_base_id: 'enterprise' }],
    documents: [{ id: 'doc-moved', folder_id: 'folder-enterprise', knowledge_base_id: 'enterprise', status: 'success' }],
  };
  const knowledgeBaseService = {
    list(options) {
      calls.push(options);
      return options?.allKnowledgeBases ? index : { folders: [], documents: [] };
    },
  };
  const folderDocuments = resolveNodeKnowledgeDocumentIds(
    loadAllKnowledgeBaseIndex(knowledgeBaseService),
    new Map([['1.1', ['folder-enterprise']]]),
  );
  const combined = mergeSectionDocumentIds(
    folderDocuments,
    new Map([['1.1', ['doc-direct']]]),
  );

  assert.deepEqual(calls, [{ allKnowledgeBases: true }]);
  assert.deepEqual(Object.fromEntries(folderDocuments), { '1.1': ['doc-moved'] });
  assert.deepEqual(Object.fromEntries(combined), { '1.1': ['doc-moved', 'doc-direct'] });
});

test('collects and merges direct node knowledge documents with folder documents', () => {
  const outline = [
    {
      id: '1',
      title: '父目录',
      knowledge_document_ids: ['doc-global-parent'],
      children: [
        { id: '1.1', title: '子目录', knowledge_document_ids: ['doc-child'] },
        { id: '1.2', title: '兄弟目录' },
      ],
    },
  ];
  const directDocuments = collectLeafKnowledgeDocumentIds(outline);
  const folderDocuments = new Map([
    ['1.1', ['doc-folder', 'doc-child']],
    ['1.2', ['doc-folder']],
  ]);

  const result = mergeSectionDocumentIds(folderDocuments, directDocuments);

  assert.deepEqual(Object.fromEntries(directDocuments), {
    '1.1': ['doc-global-parent', 'doc-child'],
    '1.2': ['doc-global-parent'],
  });
  assert.deepEqual(Object.fromEntries(result), {
    '1.1': ['doc-folder', 'doc-child', 'doc-global-parent'],
    '1.2': ['doc-folder', 'doc-global-parent'],
  });
});

test('maps loaded knowledge item ids to the sections allowed to use their documents', () => {
  const sectionDocuments = new Map([
    ['1.1', ['doc-parent', 'doc-child']],
    ['1.2', ['doc-parent']],
  ]);
  const items = [
    { id: 'doc-parent::item-a', title: '父知识', resume: '父目录资料' },
    { id: 'doc-child::item-b', title: '子知识', resume: '子目录资料' },
    { id: 'doc-sibling::item-c', title: '旁支知识', resume: '旁支资料' },
  ];

  const result = buildKnowledgeItemIdsBySection(items, sectionDocuments);

  assert.deepEqual([...result.get('1.1')], ['doc-parent::item-a', 'doc-child::item-b']);
  assert.deepEqual([...result.get('1.2')], ['doc-parent::item-a']);
});
