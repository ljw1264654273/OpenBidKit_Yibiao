const assert = require('node:assert/strict');
const test = require('node:test');

test('混合围栏和嵌套短围栏不会把代码内标题当章节', () => {
  const index = buildHistoricalSourceIndex('# 真实章\n正文\n````md\n~~~\n# 假标题\n```\n# 仍是假标题\n````\n# 第二章\n正文');
  assert.deepEqual(index.sections.map((section) => section.heading), ['真实章', '第二章']);
});
const { buildHistoricalSourceIndex, locateHistoricalSection, findAllValueRanges, bindRulesToSourceRanges } = require('./historicalSourceIndex.cjs');

const source = '# 一、实施方案\n## 项目概况\n五峰村与五峰村。\n## 服务保障\n开展农村服务。\n# 二、服务方案\n## 项目概况\n村辖区服务。';

test('同名标题按完整路径定位并保留来源偏移与哈希', () => {
  const index = buildHistoricalSourceIndex(source);
  const first = locateHistoricalSection(index, '实施方案 / 项目概况');
  const second = locateHistoricalSection(index, '服务方案 / 项目概况');
  assert.equal(first.reliable, true);
  assert.equal(second.reliable, true);
  assert.equal(first.content, '五峰村与五峰村。');
  assert.equal(second.content, '村辖区服务。');
  assert.equal(first.sourceVersionHash, index.sourceVersionHash);
  assert.equal(first.contentHash.length, 64);
  assert.equal(locateHistoricalSection(index, '项目概况').reliable, false);
});

test('唯一来源路径允许去掉虚拟历史标书根节点并返回真实路径', () => {
  const index = buildHistoricalSourceIndex('# 总体项目理解\n## 项目概况\n历史正文。');
  const section = locateHistoricalSection(index, '历史标书 / 总体项目理解 / 项目概况');
  assert.equal(section.reliable, true);
  assert.deepEqual(section.path, ['总体项目理解', '项目概况']);
  assert.equal(section.content, '历史正文。');
});

test('历史目录标题存在但正文为空时仍返回唯一来源定位', () => {
  const index = buildHistoricalSourceIndex('# 实施方案\n## 作业流程\n### 整体作业流程\n### 调查作业流程\n调查正文。');
  const section = locateHistoricalSection(index, '原目录 / 实施方案 / 作业流程 / 整体作业流程');
  assert.equal(section.reliable, true);
  assert.equal(section.content, '');
  assert.equal(section.path.join(' / '), '实施方案 / 作业流程 / 整体作业流程');
});

test('完整旧值在同章出现多次时枚举全部独立 occurrence', () => {
  const index = buildHistoricalSourceIndex(source);
  const section = locateHistoricalSection(index, '实施方案 / 项目概况');
  const ranges = findAllValueRanges(section, '五峰村');
  assert.deepEqual(ranges.map((range) => range.occurrence), [1, 2]);
  assert.deepEqual(ranges.map((range) => section.content.slice(range.startOffset, range.endOffset)), ['五峰村', '五峰村']);
  assert.equal(ranges.every((range) => range.sourceVersionHash === index.sourceVersionHash && range.contentHash === section.contentHash), true);
});

test('无源证据或歧义来源的规则只能复核', () => {
  const index = buildHistoricalSourceIndex(source);
  const rule = { id: 'place', targetAction: 'replace', policy: 'must-replace', oldValues: ['五峰村'], replacements: [{ oldValue: '五峰村', newValue: '横泾街道' }] };
  const bound = bindRulesToSourceRanges(index, '实施方案 / 项目概况', [rule]);
  assert.equal(bound[0].authorizedRanges.length, 2);
  assert.equal(bound[0].policy, 'must-replace');
  assert.equal(bindRulesToSourceRanges(index, '项目概况', [rule])[0].policy, 'contextual-review');
  assert.deepEqual(bindRulesToSourceRanges(index, '服务方案 / 项目概况', [rule])[0].authorizedRanges, []);
});
