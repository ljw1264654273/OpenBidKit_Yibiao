import assert from 'node:assert/strict';
import test from 'node:test';

import type { KnowledgeBaseId } from '../../knowledge-base/knowledgeBaseCatalog';
import type { KnowledgeBaseIndex, KnowledgeDocument, KnowledgeFolder } from '../../knowledge-base/types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { getDocumentsForFolder, getFoldersForKnowledgeBase, mergeFolderDocumentSelection } from './nodeKnowledgeSelection.ts';

const folder = (id: string, knowledgeBaseId: KnowledgeFolder['knowledge_base_id']): KnowledgeFolder => ({
  id,
  name: id,
  knowledge_base_id: knowledgeBaseId,
  created_at: '',
  updated_at: '',
});

const document = (
  id: string,
  folderId: string,
  knowledgeBaseId: KnowledgeBaseId,
  status: KnowledgeDocument['status'],
): KnowledgeDocument => ({
  id,
  folder_id: folderId,
  knowledge_base_id: knowledgeBaseId,
  file_name: `${id}.md`,
  status,
  progress: 0,
  message: '',
  item_count: 0,
  created_at: '',
  updated_at: '',
});

const index: KnowledgeBaseIndex = {
  folders: [
    folder('folder-a-1', 'document'),
    folder('folder-b-1', 'enterprise'),
    folder('folder-a-2', 'document'),
  ],
  documents: [
    document('doc-a-pending', 'folder-a-1', 'document', 'pending'),
    document('doc-a-success-1', 'folder-a-1', 'document', 'success'),
    document('doc-b-success', 'folder-b-1', 'enterprise', 'success'),
    document('doc-a-error', 'folder-a-1', 'document', 'error'),
    document('doc-a-success-2', 'folder-a-1', 'document', 'success'),
  ],
};

test('按一级知识库过滤目录并保持 index 顺序，空 id 返回空数组', () => {
  assert.deepEqual(
    getFoldersForKnowledgeBase(index, 'document').map((item) => item.id),
    ['folder-a-1', 'folder-a-2'],
  );
  assert.deepEqual(getFoldersForKnowledgeBase(index, ''), []);
});

test('按目录过滤并只返回 success 文档，保持 index 顺序，空 id 返回空数组', () => {
  assert.deepEqual(
    getDocumentsForFolder(index, 'folder-a-1').map((item) => item.id),
    ['doc-a-success-1', 'doc-a-success-2'],
  );
  assert.deepEqual(getDocumentsForFolder(index, ''), []);
});

test('替换当前目录的文档关联，保留其他目录、移除旧状态文档并去重', () => {
  assert.deepEqual(
    mergeFolderDocumentSelection(
      index,
      'folder-a-1',
      ['doc-b-success', 'doc-a-pending', 'doc-a-success-1', 'doc-a-error'],
      ['doc-a-success-2', 'doc-a-success-2', 'doc-a-pending'],
    ),
    ['doc-b-success', 'doc-a-success-2'],
  );
});

test('未知目录不改变已有关联', () => {
  assert.deepEqual(
    mergeFolderDocumentSelection(index, 'folder-unknown', ['provincial-ready', 'provincial-ready'], ['doc-a-success-1']),
    ['provincial-ready'],
  );
});

test('空目录 ID 返回空数组', () => {
  assert.deepEqual(
    mergeFolderDocumentSelection(index, '', ['provincial-ready'], ['doc-a-success-1']),
    [],
  );
});
