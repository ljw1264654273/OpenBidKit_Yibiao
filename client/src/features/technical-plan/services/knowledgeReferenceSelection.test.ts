import assert from 'node:assert/strict';
import test from 'node:test';

import type { KnowledgeBaseIndex, KnowledgeDocument, KnowledgeFolder } from '../../knowledge-base/types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { buildKnowledgeSelectionSummary, filterKnowledgeReferenceGroups, getKnowledgeLocationOptions, toggleFolderKnowledgeSelection, toggleVisibleKnowledgeSelection } from './knowledgeReferenceSelection.ts';

const folder = (
  id: string,
  name: string,
  knowledgeBaseId: KnowledgeFolder['knowledge_base_id'],
  province: string | null,
  city: string | null,
): KnowledgeFolder => ({
  id,
  name,
  knowledge_base_id: knowledgeBaseId,
  province,
  city,
  created_at: '',
  updated_at: '',
});

const document = (
  id: string,
  folderId: string,
  knowledgeBaseId: KnowledgeDocument['knowledge_base_id'],
  fileName: string,
  status: KnowledgeDocument['status'] = 'success',
): KnowledgeDocument => ({
  id,
  folder_id: folderId,
  knowledge_base_id: knowledgeBaseId,
  file_name: fileName,
  status,
  progress: 0,
  message: '',
  item_count: 0,
  created_at: '',
  updated_at: '',
});

const index: KnowledgeBaseIndex = {
  folders: [
    folder('doc-js', '施工组织设计', 'document', '江苏省', '南京市'),
    folder('province-js', '江苏省建筑标准', 'provincial-standard', '江苏省', null),
    folder('province-zj', '浙江省建筑标准', 'provincial-standard', '浙江省', null),
    folder('national', '建筑工程国标', 'national-standard', null, null),
  ],
  documents: [
    document('doc-1', 'doc-js', 'document', '南京项目施工组织设计.docx'),
    document('doc-pending', 'doc-js', 'document', '处理中资料.docx', 'matching'),
    document('js-1', 'province-js', 'provincial-standard', '江苏省绿色施工标准.pdf'),
    document('js-2', 'province-js', 'provincial-standard', '江苏省安全生产标准.pdf'),
    document('zj-1', 'province-zj', 'provincial-standard', '浙江省绿色施工标准.pdf'),
    document('gb-1', 'national', 'national-standard', 'GB 50300.pdf'),
  ],
};

test('按知识库类型、归属地和关键词筛选，并只返回已完成文档', () => {
  const groups = filterKnowledgeReferenceGroups(index, {
    knowledgeBaseId: 'provincial-standard',
    province: '江苏省',
    city: '',
    keyword: '绿色',
  });

  assert.deepEqual(groups.map((group) => ({
    folderId: group.folder.id,
    documentIds: group.documents.map((item) => item.id),
  })), [
    { folderId: 'province-js', documentIds: ['js-1'] },
  ]);
});

test('关键词命中文件夹时返回该文件夹全部可用文档', () => {
  const groups = filterKnowledgeReferenceGroups(index, {
    knowledgeBaseId: 'all',
    province: '',
    city: '',
    keyword: '施工组织',
  });

  assert.deepEqual(groups[0]?.documents.map((item) => item.id), ['doc-1']);
});

test('归属地选项随知识库类型变化并去重', () => {
  assert.deepEqual(getKnowledgeLocationOptions(index, 'provincial-standard'), {
    provinces: ['江苏省', '浙江省'],
    cities: [],
  });
  assert.deepEqual(getKnowledgeLocationOptions(index, 'document'), {
    provinces: ['江苏省'],
    cities: ['南京市'],
  });
});

test('文件夹批量选择会添加或移除该文件夹全部可用文档，并保留其他选择', () => {
  assert.deepEqual(
    toggleFolderKnowledgeSelection(['gb-1'], index.documents.filter((item) => item.folder_id === 'province-js')),
    ['gb-1', 'js-1', 'js-2'],
  );
  assert.deepEqual(
    toggleFolderKnowledgeSelection(['gb-1', 'js-1', 'js-2'], index.documents.filter((item) => item.folder_id === 'province-js')),
    ['gb-1'],
  );
});

test('选择当前筛选结果会去重，全部已选时再次操作会整体取消', () => {
  const visible = filterKnowledgeReferenceGroups(index, {
    knowledgeBaseId: 'provincial-standard',
    province: '江苏省',
    city: '',
    keyword: '',
  });

  assert.deepEqual(toggleVisibleKnowledgeSelection(['gb-1'], visible), ['gb-1', 'js-1', 'js-2']);
  assert.deepEqual(toggleVisibleKnowledgeSelection(['gb-1', 'js-1', 'js-2'], visible), ['gb-1']);
});

test('选择摘要按知识库类型和文件夹分组并忽略已失效文档', () => {
  const summary = buildKnowledgeSelectionSummary(index, ['js-1', 'js-2', 'gb-1', 'missing']);

  assert.deepEqual(summary, [
    {
      key: 'folder:province-js',
      label: '省标文档 / 江苏省建筑标准',
      documentIds: ['js-1', 'js-2'],
      documentCount: 2,
    },
    {
      key: 'folder:national',
      label: '国标文档 / 建筑工程国标',
      documentIds: ['gb-1'],
      documentCount: 1,
    },
  ]);
});
