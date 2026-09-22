import assert from 'node:assert/strict';
import test from 'node:test';
import type { BidProject } from '../types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { BID_PROJECT_PAGE_SIZE, filterBidProjects, getBidProjectCounts, paginateBidProjects } from './bidProjectList.ts';

function project(
  projectId: string,
  status: BidProject['status'],
  projectName: string,
  projectType: BidProject['projectType'] = 'technical-plan',
): BidProject {
  return {
    projectId,
    projectName,
    projectType,
    status,
    sourceSequence: 1,
    sourceFileSize: 0,
    currentStep: 'document-analysis',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

const projects = [
  project('1', 'generating', '生成中的项目'),
  project('2', 'incomplete', '未完成项目'),
  project('3', 'completed', '已完成项目'),
  project('4', 'failed', '失败项目'),
  project('5', 'completed', '已完成项目扩写', 'existing-plan-expansion'),
];

test('项目统计始终基于全量项目，不受当前筛选条件影响', () => {
  assert.deepEqual(getBidProjectCounts(projects), {
    all: 5,
    generating: 1,
    incomplete: 1,
    completed: 2,
  });
});

test('状态、关键词和类型筛选只返回匹配列表，不改变全量统计职责', () => {
  const result = filterBidProjects(projects, {
    query: '完成',
    status: 'completed',
    type: 'technical-plan',
  });

  assert.deepEqual(result.map((item) => item.projectId), ['3']);
  assert.deepEqual(getBidProjectCounts(projects).all, 5);
});

test('列表默认每页显示六个项目并正确裁剪页码', () => {
  const items = Array.from({ length: 13 }, (_, index) => project(String(index + 1), 'incomplete', `项目 ${index + 1}`));

  assert.equal(BID_PROJECT_PAGE_SIZE, 6);
  assert.deepEqual(paginateBidProjects(items, 1), {
    items: items.slice(0, 6),
    page: 1,
    pageCount: 3,
  });
  assert.deepEqual(paginateBidProjects(items, 3), {
    items: items.slice(12),
    page: 3,
    pageCount: 3,
  });
  assert.deepEqual(paginateBidProjects(items, 99), {
    items: items.slice(12),
    page: 3,
    pageCount: 3,
  });
});
