import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { OutlineItem } from '../../../shared/types';
import type { ScoreCoverageRecord } from '../types';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { buildOutlineSourceViewItems, collectOutlineSourceRecords, injectMarkdownSourceAnchor, injectOutlineSourceAnchorMarkers, locateOutlineSourceText } from './outlineSourceMatcher.ts';

const outline: OutlineItem[] = [{
  id: '1',
  title: '父级目录',
  description: '',
  children: [{
    id: '1.1',
    title: '子级目录',
    description: '',
  }],
}];

function record(overrides: Partial<ScoreCoverageRecord> & Pick<ScoreCoverageRecord, 'source_id'>): ScoreCoverageRecord {
  return {
    source_kind: 'response-point',
    source_text: overrides.source_id,
    node_ids: ['1.1'],
    coverage_location: 'description',
    user_override: 'none',
    supplement_kind: 'none',
    ...overrides,
  };
}

test('父级聚合后代招标来源并保留原记录顺序', () => {
  const records = [
    record({ source_id: 'child-response' }),
    record({ source_id: 'elsewhere', node_ids: ['2'] }),
    record({ source_id: 'child-requirement', source_kind: 'requirement' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1', records);

  assert.equal(result.scope, 'descendants');
  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['child-response', 'child-requirement']);
  assert.deepEqual(result.supplementRecords, []);
});

test('直属目录来源优先于后代来源', () => {
  const records = [
    record({ source_id: 'child-response' }),
    record({ source_id: 'parent-criterion', source_kind: 'criterion', node_ids: ['1'] }),
  ];

  const result = collectOutlineSourceRecords(outline, '1', records);

  assert.equal(result.scope, 'direct');
  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['parent-criterion']);
});

test('按 source_id 去重但保留相同文本的不同来源', () => {
  const records = [
    record({ source_id: 'same-id', source_text: '重复文本' }),
    record({ source_id: 'same-id', source_text: '不同记录文本' }),
    record({ source_id: 'different-id', source_text: '重复文本' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1.1', records);

  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['same-id', 'different-id']);
  assert.deepEqual(result.tenderRecords.map((item) => item.source_text), ['重复文本', '重复文本']);
});

test('将专业补充和用户补充分别归入补充来源', () => {
  const records = [
    record({ source_id: 'tender', source_kind: 'response-point' }),
    record({ source_id: 'professional', source_kind: 'professional-supplement' }),
    record({ source_id: 'user', source_kind: 'user-supplement' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1.1', records);

  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['tender']);
  assert.deepEqual(result.supplementRecords.map((item) => item.source_id), ['professional', 'user']);
});

test('排除无目录、未覆盖和已移除的记录', () => {
  const records = [
    record({ source_id: 'empty-node-ids', node_ids: [] }),
    record({ source_id: 'none-location', coverage_location: 'none' }),
    record({ source_id: 'removed', user_override: 'removed' }),
    record({ source_id: 'malformed-removed', node_ids: ['1.1'], coverage_location: 'description', user_override: 'removed' }),
    record({ source_id: 'kept' }),
  ];

  const result = collectOutlineSourceRecords(outline, '1.1', records);

  assert.equal(result.scope, 'direct');
  assert.deepEqual(result.tenderRecords.map((item) => item.source_id), ['kept']);
});

test('空的匹配范围返回 none', () => {
  const result = collectOutlineSourceRecords(outline, 'missing', [record({ source_id: 'child' })]);

  assert.equal(result.scope, 'none');
  assert.deepEqual(result.tenderRecords, []);
  assert.deepEqual(result.supplementRecords, []);
});

test('空白规范化匹配映射回原始 Markdown 范围', () => {
  const markdown = '前置段落。\n\n本段包含  供应商\n\n应提供资质材料。\n\n后置段落。';
  const sourceText = '供应商 应提供资质材料';

  const result = locateOutlineSourceText(markdown, sourceText);
  const matchStart = markdown.indexOf('供应商');

  assert.deepEqual(result, {
    status: 'located',
    sourceText,
    matchStart,
    matchEnd: matchStart + '供应商\n\n应提供资质材料'.length,
    contextStart: 0,
    contextEnd: markdown.length,
    contextBefore: '前置段落。\n\n本段包含  ',
    matchedText: '供应商\n\n应提供资质材料',
    contextAfter: '。\n\n后置段落。',
  });
});

test('精确匹配优先保留原始文本范围', () => {
  const markdown = '第一段 A\n\nB。\n\n需提交 A  B 两份材料。\n\n第三段。';
  const sourceText = 'A  B';

  const result = locateOutlineSourceText(markdown, sourceText);
  const matchStart = markdown.lastIndexOf(sourceText);

  assert.equal(result.status, 'located');
  assert.equal(result.matchStart, matchStart);
  assert.equal(result.matchEnd, matchStart + sourceText.length);
  assert.equal(result.matchedText, sourceText);
});

test('重复来源不再静默定位到第一次出现', () => {
  const sourceText = '总体方案';
  const result = locateOutlineSourceText('总体方案。\n\n总体方案。', sourceText);

  assert.deepEqual(result, {
    status: 'unlocated',
    sourceText,
    reason: 'ambiguous',
  });
});

test('相互重叠的重复来源不回退到第一次出现', () => {
  assert.deepEqual(locateOutlineSourceText('哈哈哈', '哈哈'), {
    status: 'unlocated',
    sourceText: '哈哈',
    reason: 'ambiguous',
  });
});

test('来源带评分映射前缀和句末标点时仍可唯一定位原文', () => {
  const markdown = '评分内容：政策背景、项目技术要求理解进行打分。';
  const sourceText = 'R1-C1-P1：政策背景、项目技术要求理解。';

  const result = locateOutlineSourceText(markdown, sourceText);

  assert.equal(result.status, 'located');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '政策背景、项目技术要求理解');
});

test('一级评分大项优先在评分表项目单元格中定位', () => {
  const markdown = '响应文件目录：项目总体方案。\n<table><tbody><tr><td rowspan="3"><p>项目总体</p><p>方案</p></td><td><p>项目总体方案设计的科学性</p></td></tr></tbody></table>';
  const result = locateOutlineSourceText(markdown, '项目总体方案', 'requirement');

  assert.equal(result.status, 'located');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '项目总体</p><p>方案');
});

test('一级评分大项允许评分方式后缀并忽略评分目录中的同名文本', () => {
  const markdown = '响应文件目录：人员配置情况（格式见第六章）。\n<table><tbody><tr><td rowspan="4"><p>人员配置情况（客观分）</p></td><td><p>项目负责人</p></td></tr></tbody></table>';
  const result = locateOutlineSourceText(markdown, '人员配置情况', 'requirement');

  assert.equal(result.status, 'located');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd), '人员配置情况');
});

test('有效持久锚点可以精确选择重复来源中的指定位置', () => {
  const markdown = '总体方案。\n\n中间内容。\n\n总体方案。';
  const secondStart = markdown.lastIndexOf('总体方案');
  const result = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'anchored-source',
    source_text: '总体方案',
    source_location_status: 'located',
    source_anchor: {
      document_hash: 'current-hash',
      block_id: 'paragraph-000003',
      match_start: secondStart,
      match_end: secondStart + '总体方案'.length,
      context_start: markdown.indexOf('中间内容'),
      context_end: markdown.length,
      match_method: 'exact',
    },
  } as any)], markdown, 'current-hash');

  assert.equal(result.items[0].status, 'located');
  assert.equal(result.items[0].contextBefore.includes('中间内容'), true);
  assert.equal(result.items[0].matchedText, '总体方案');
  assert.equal(result.items[0].contextAfter, '。');

  const marked = injectOutlineSourceAnchorMarkers(markdown, result.items);
  assert.equal(
    marked,
    `${markdown.slice(0, secondStart)}<span data-outline-source-anchor="primary-start" class="outline-source-anchor-marker"></span>总体方案<span data-outline-source-anchor="primary-end"></span>${markdown.slice(secondStart + '总体方案'.length)}`,
  );
});

test('全文锚点可以按当前关联来源序号切换', () => {
  const markdown = '第一处总体方案。\n\n第二处总体方案。';
  const first = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'first',
    source_text: '第一处总体方案',
  })], markdown).items[0];
  const second = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'second',
    source_text: '第二处总体方案',
  })], markdown).items[0];

  const marked = injectOutlineSourceAnchorMarkers(markdown, [first, second], 1);

  assert.ok(marked.indexOf('第一处总体方案') < marked.indexOf('primary-start'));
  assert.ok(marked.indexOf('primary-start') < marked.indexOf('第二处总体方案'));
});

test('原文范围标记精确包围大小写和跨段落来源', () => {
  const markdown = 'api。\n\nAPI\n\n实施方案。';
  const start = markdown.indexOf('API');
  const end = markdown.indexOf('实施方案') + '实施方案'.length;

  assert.equal(
    injectMarkdownSourceAnchor(markdown, start, end),
    `api。\n\n<span data-outline-source-anchor="primary-start" class="outline-source-anchor-marker"></span>API\n\n实施方案<span data-outline-source-anchor="primary-end"></span>。`,
  );
});

test('文档哈希变化后拒绝旧锚点且不回退到重复首项', () => {
  const markdown = '总体方案。\n\n总体方案。';
  const result = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'stale-source',
    source_text: '总体方案',
    source_location_status: 'located',
    source_anchor: {
      document_hash: 'old-hash',
      block_id: 'paragraph-000001',
      match_start: 0,
      match_end: '总体方案'.length,
      context_start: 0,
      context_end: markdown.length,
      match_method: 'exact',
    },
  } as any)], markdown, 'new-hash');

  assert.equal(result.items[0].status, 'unlocated');
  assert.equal(result.items[0].locationReason, 'stale-anchor');
});

test('跳过匹配前后的空白段落以保留相邻正文', () => {
  const markdown = 'first\n\n \n\nsecond\n\n\t\n\nthird';
  const sourceText = 'second';

  const result = locateOutlineSourceText(markdown, sourceText);

  assert.equal(result.status, 'located');
  assert.equal(result.contextBefore.includes('first'), true);
  assert.equal(result.contextAfter.includes('third'), true);
  assert.equal(result.matchedText, sourceText);
  assert.equal(
    result.contextBefore + result.matchedText + result.contextAfter,
    markdown.slice(result.contextStart, result.contextEnd),
  );
});

test('段落分隔符末尾的匹配仍保留相邻上下文和有效范围', () => {
  const markdown = 'first\n\nsecond\n\nthird\n\nfourth\n\nfifth';
  const sourceText = 'fourth\n';

  const result = locateOutlineSourceText(markdown, sourceText);

  assert.equal(result.status, 'located');
  assert.ok(result.contextStart <= result.matchStart);
  assert.ok(result.contextEnd >= result.matchEnd);
  assert.equal(result.contextBefore.includes('third'), true);
  assert.equal(result.contextAfter.includes('fifth'), true);
  assert.equal(result.matchedText, markdown.slice(result.matchStart, result.matchEnd));
  assert.equal(
    result.contextBefore + result.matchedText + result.contextAfter,
    markdown.slice(result.contextStart, result.contextEnd),
  );
});

test('文档末尾分隔符内的匹配保留完整原始范围', () => {
  const markdown = 'first\n\nsecond\n\n';
  const sourceText = 'second\n';

  const result = locateOutlineSourceText(markdown, sourceText);

  assert.equal(result.status, 'located');
  assert.ok(result.contextStart <= result.matchStart);
  assert.ok(result.contextEnd >= result.matchEnd);
  assert.equal(result.contextBefore.includes('first'), true);
  assert.equal(result.matchedText, markdown.slice(result.matchStart, result.matchEnd));
  assert.equal(
    result.contextBefore + result.matchedText + result.contextAfter,
    markdown.slice(result.contextStart, result.contextEnd),
  );
});

test('文档开头分隔符内的匹配保留完整原始范围', () => {
  const markdown = '\n\nfirst\n\nsecond';
  const sourceText = '\n\nfirst';

  const result = locateOutlineSourceText(markdown, sourceText);

  assert.equal(result.status, 'located');
  assert.ok(result.contextStart <= result.matchStart);
  assert.ok(result.contextEnd >= result.matchEnd);
  assert.equal(result.contextAfter.includes('second'), true);
  assert.equal(result.matchedText, markdown.slice(result.matchStart, result.matchEnd));
  assert.equal(
    result.contextBefore + result.matchedText + result.contextAfter,
    markdown.slice(result.contextStart, result.contextEnd),
  );
});

test('未匹配来源只返回已保存文本且不猜测相近段落', () => {
  const sourceText = '供应商应提交完全不同的证明材料';

  const result = locateOutlineSourceText('供应商应提交证明材料。', sourceText);

  assert.deepEqual(result, { status: 'unlocated', sourceText, reason: 'not-found' });
});

test('构建已定位的招标来源展示项', () => {
  const markdown = '前置内容。\n\n供应商应提交资质证明。\n\n后置内容。';

  const result = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'requirement-1',
    source_kind: 'requirement',
    source_text: '供应商应提交资质证明',
  })], markdown);

  assert.equal(result.scope, 'direct');
  assert.equal(result.supplementKind, undefined);
  assert.deepEqual(result.items, [{
    sourceId: 'requirement-1',
    kind: 'requirement',
    status: 'located',
    sourceText: '供应商应提交资质证明',
    contextBefore: '前置内容。\n\n',
    matchedText: '供应商应提交资质证明',
    contextAfter: '。\n\n后置内容。',
    matchStart: markdown.indexOf('供应商应提交资质证明'),
    matchEnd: markdown.indexOf('供应商应提交资质证明') + '供应商应提交资质证明'.length,
  }]);
});

test('未定位的招标来源展示项只保留存储原文', () => {
  const result = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'criterion-1',
    source_kind: 'criterion',
    source_text: '完全不同的评分标准',
  })], '正文没有对应内容。');

  assert.deepEqual(result.items, [{
    sourceId: 'criterion-1',
    kind: 'criterion',
    status: 'unlocated',
    sourceText: '完全不同的评分标准',
    contextBefore: '',
    matchedText: '完全不同的评分标准',
    contextAfter: '',
    locationReason: 'not-found',
  }]);
});

test('只有专业补充时返回专业补充状态且不返回招标来源', () => {
  const result = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'professional-1',
    source_kind: 'professional-supplement',
    source_text: '行业建议',
  })], '行业建议');

  assert.deepEqual(result, { items: [], supplementKind: 'professional', scope: 'direct' });
});

test('只有用户补充时返回用户补充状态且不返回招标来源', () => {
  const result = buildOutlineSourceViewItems(outline, '1.1', [record({
    source_id: 'user-1',
    source_kind: 'user-supplement',
    source_text: '用户补充',
  })], '用户补充');

  assert.deepEqual(result, { items: [], supplementKind: 'user', scope: 'direct' });
});

test('父级目录展示后代招标来源并保留后代聚合范围', () => {
  const result = buildOutlineSourceViewItems(outline, '1', [record({
    source_id: 'child-response',
    source_text: '子级响应要点',
  })], '子级响应要点');

  assert.equal(result.scope, 'descendants');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sourceId, 'child-response');
  assert.equal(result.items[0].status, 'located');
});

test('多条来源同时匹配时保留精确、空白归一化和未定位语义', () => {
  const markdown = '第一段。\n\n供应商应提供  有效\n\n资质证明。\n\n第三段。';
  const result = buildOutlineSourceViewItems(outline, '1.1', [
    record({ source_id: 'exact', source_kind: 'requirement', source_text: '第一段' }),
    record({ source_id: 'normalized', source_kind: 'criterion', source_text: '供应商应提供 有效 资质证明' }),
    record({ source_id: 'missing', source_text: '不存在的响应要点' }),
  ], markdown);

  assert.deepEqual(result.items.map((item) => ({
    sourceId: item.sourceId,
    status: item.status,
    matchedText: item.matchedText,
  })), [
    { sourceId: 'exact', status: 'located', matchedText: '第一段' },
    { sourceId: 'normalized', status: 'located', matchedText: '供应商应提供  有效\n\n资质证明' },
    { sourceId: 'missing', status: 'unlocated', matchedText: '不存在的响应要点' },
  ]);
});

test('原文面板展示完整招标原文并支持多处来源切换', () => {
  const panelPath = new URL('../components/TenderSourcePanel.tsx', import.meta.url);
  const panelSource = readFileSync(panelPath, 'utf8');

  assert.match(panelSource, /activeSourceIndex|setActiveSourceIndex/);
  assert.match(panelSource, /上一处招标原文/);
  assert.match(panelSource, /下一处招标原文/);
  assert.match(panelSource, /injectOutlineSourceAnchorMarkers\(markdown, locatedItems, safeActiveSourceIndex\)/);
  assert.match(panelSource, /<MarkdownRenderer allowRawHtml highlightSourceAnchor=/);
  assert.match(panelSource, /markdown/);
});

test('招标原文全屏内容保留共享 Markdown 滚动容器样式', () => {
  const panelSource = readFileSync(new URL('../components/TenderSourcePanel.tsx', import.meta.url), 'utf8');

  assert.match(
    panelSource,
    /fullscreenClassName="markdown-viewer outline-source-panel-fullscreen-viewer"/,
  );
});

test('招标 Markdown 在解析和目录两步加载并提供显式重试状态', () => {
  const homeSource = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');

  assert.match(homeSource, /state\.step !== 'document-analysis' && state\.step !== 'outline-generation'/);
  assert.match(homeSource, /const loadTenderMarkdown = useCallback\(/);
  assert.match(homeSource, /setTenderMarkdownLoading/);
  assert.match(homeSource, /setTenderMarkdownError/);
  assert.match(homeSource, /contentHash \|\| .*updatedAt/);
  const outlineProps = homeSource.slice(homeSource.indexOf('<OutlineEditPage'), homeSource.indexOf("{state.step === 'global-facts'"));
  assert.match(outlineProps, /tenderMarkdown=\{tenderMarkdown\}/);
  assert.match(outlineProps, /tenderMarkdownLoading=\{tenderMarkdownLoading\}/);
  assert.match(outlineProps, /tenderMarkdownError=\{tenderMarkdownError\}/);
  assert.match(outlineProps, /onReloadTenderMarkdown=\{loadTenderMarkdown\}/);
});

test('目录页把保存的覆盖记录和 Markdown 状态接入原文面板', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /import TenderSourcePanel from/);
  assert.match(pageSource, /score_coverage_map\?\.records/);
  assert.match(pageSource, /<TenderSourcePanel/);
  assert.match(pageSource, /markdown=\{tenderMarkdown\}/);
  assert.match(pageSource, /loading=\{tenderMarkdownLoading\}/);
  assert.match(pageSource, /error=\{tenderMarkdownError\}/);
  assert.match(pageSource, /onRetry=\{onReloadTenderMarkdown\}/);
  assert.match(pageSource, /collectOutlineSourceRecords\(/);
  assert.match(pageSource, /setActiveWorkspacePane\('source'\)/);
  assert.doesNotMatch(pageSource, /<aside className="outline-progress-panel">/);
});

test('目录调整事件按字段存在语义同步最新覆盖映射快照', () => {
  const homeSource = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const adjustmentBranch = homeSource.slice(homeSource.indexOf("if (taskType === 'outline-adjustment')"), homeSource.indexOf("if (taskType === 'global-facts-generation')"));

  assert.match(adjustmentBranch, /outlineGenerationTask: hasOwnField\(technicalPlan, 'outlineGenerationTask'\) \? trimTaskLogs\(technicalPlan\.outlineGenerationTask\) : prev\.outlineGenerationTask/);
});

test('放弃排序恢复开始时的持久目录选择且每轮重新捕获', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const startSorting = pageSource.slice(pageSource.indexOf('const startSorting ='), pageSource.indexOf('const discardSorting ='));
  const discardSorting = pageSource.slice(pageSource.indexOf('const discardSorting ='), pageSource.indexOf('const saveSorting ='));

  assert.match(pageSource, /const sortingSelectedItemIdRef = useRef<string \| null>\(null\)/);
  assert.match(startSorting, /sortingSelectedItemIdRef\.current = selectedItem\?\.id \?\? null;/);
  assert.match(discardSorting, /setSelectedItemId\(sortingSelectedItemIdRef\.current\);\s*finishSorting\(\);/);
  assert.match(pageSource, /const finishSorting = \(\) => \{[\s\S]*?sortingSelectedItemIdRef\.current = null;/);
});

test('成功保存排序只清理排序快照并保留重编号后的选择', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const finishSorting = pageSource.slice(pageSource.indexOf('const finishSorting ='), pageSource.indexOf('const discardSorting ='));
  const saveSuccess = pageSource.slice(pageSource.indexOf('await onOutlineSaved({', pageSource.indexOf('const saveSorting =')), pageSource.indexOf("showToast('目录排序已保存'"));

  assert.match(saveSuccess, /finishSorting\(\);/);
  assert.doesNotMatch(saveSuccess, /discardSorting\(\)/);
  assert.doesNotMatch(finishSorting, /setSelectedItemId\(/);
});

test('放弃排序恢复独立捕获的展开状态而保存排序保留重编号后的展开状态', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const startSorting = pageSource.slice(pageSource.indexOf('const startSorting ='), pageSource.indexOf('const finishSorting ='));
  const finishSorting = pageSource.slice(pageSource.indexOf('const finishSorting ='), pageSource.indexOf('const discardSorting ='));
  const discardSorting = pageSource.slice(pageSource.indexOf('const discardSorting ='), pageSource.indexOf('const saveSorting ='));

  assert.match(startSorting, /sortingExpandedItemsRef\.current = new Set\(expandedItems\);/);
  assert.match(discardSorting, /setExpandedItems\(sortingExpandedItemsRef\.current\);[\s\S]*?finishSorting\(\);/);
  assert.match(finishSorting, /sortingExpandedItemsRef\.current = new Set\(\);/);
  assert.doesNotMatch(finishSorting, /setExpandedItems\(/);
});

test('目录工作区提供三组关联标签和面板并保留紧凑进度浮层', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /outline-workspace-tabs/);
  assert.match(pageSource, /outline-source-panel/);
  assert.match(pageSource, /outline-process-popover/);
  assert.match(pageSource, /\[progressCollapsed, setProgressCollapsed\] = useState\(true\)/);
  assert.equal((pageSource.match(/<button\b[^>]*\brole="tab"/g) || []).length, 3);
  assert.equal((pageSource.match(/role="tabpanel"/g) || []).length, 3);
  for (const pane of ['source', 'tree', 'detail']) {
    assert.match(pageSource, new RegExp(`id="outline-${pane}-tab"`));
    assert.match(pageSource, new RegExp(`aria-controls="outline-${pane}-panel"`));
    assert.match(pageSource, new RegExp(`aria-selected=\\{activeWorkspacePane === '${pane}'\\}`));
    assert.match(pageSource, new RegExp(`id="outline-${pane}-panel"`));
    assert.match(pageSource, new RegExp(`aria-labelledby="outline-${pane}-tab"`));
  }
  assert.match(pageSource, /aria-expanded=\{!progressCollapsed\}/);
  assert.match(pageSource, /aria-controls="outline-process-popover"/);
  assert.match(pageSource, /progressLogs\.map\(/);
  assert.match(pageSource, /\[progressCollapsed, progressLogs\.length\]/);
});

test('目录工作区桌面端支持拖拽调宽、隐藏和恢复分屏', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const cssSource = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\.outline-workspace-shell\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(pageSource, /const \[visibleWorkspacePanes, setVisibleWorkspacePanes\]/);
  assert.match(pageSource, /className="outline-workspace-restore-bar"/);
  assert.match(pageSource, /className="outline-workspace-divider"/);
  assert.match(pageSource, /onPointerDown=\{\(event\) => startWorkspaceResize/);
  assert.equal((pageSource.match(/className="outline-pane-hide-action"/g) || []).length, 3);
  assert.match(cssSource, /\.outline-workspace-shell > \.outline-generation-workspace\s*\{[^}]*display:\s*flex;/s);
  assert.match(cssSource, /\.outline-workspace-divider\s*\{[^}]*cursor:\s*col-resize;/s);
  assert.match(cssSource, /\.outline-workspace-restore-bar\s*\{/);
  assert.match(cssSource, /\.outline-pane-hide-action\s*\{/);
  assert.match(cssSource, /@container \(max-width: 899px\)/);
  assert.match(cssSource, /\.outline-generation-workspace > \[role="tabpanel"\]:not\(\.is-active-pane\)\s*\{\s*display:\s*none;/);
  assert.match(cssSource, /\.outline-process-popover\s*\{[^}]*position:\s*absolute;/);
  assert.match(cssSource, /\.outline-workspace-shell \.outline-tree-item\.is-sorting\s*\{\s*grid-template-columns:\s*20px 44px minmax\(0, 1fr\);/);
});

test('详情跳转原文仅在标签实际可见时于渲染后交接焦点', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /const sourceTabRef = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(pageSource, /const pendingSourceFocusRef = useRef\(false\)/);
  assert.match(pageSource, /const showSourcePane = \(\) => \{\s*pendingSourceFocusRef\.current = sourceTabRef\.current\?\.offsetParent != null;\s*setActiveWorkspacePane\('source'\);/);
  assert.match(pageSource, /useEffect\(\(\) => \{\s*if \(!pendingSourceFocusRef\.current \|\| activeWorkspacePane !== 'source'\) return;\s*pendingSourceFocusRef\.current = false;\s*if \(sourceTabRef\.current\?\.offsetParent != null\) \{\s*sourceTabRef\.current\.focus\(\);\s*\}\s*\}, \[activeWorkspacePane\]\)/);
  assert.match(pageSource, /ref=\{sourceTabRef\}[^>]*id="outline-source-tab"/);
  assert.match(pageSource, /className="text-button outline-detail-source-action"\s*disabled=\{sorting\}\s*onClick=\{showSourcePane\}/);
});

test('过程浮层关闭和 Escape 统一在卸载后恢复触发按钮焦点', () => {
  const pageSource = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /const processTriggerRef = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(pageSource, /const restoreProcessFocusRef = useRef\(false\)/);
  assert.match(pageSource, /const closeProcessPopover = \(\) => \{\s*restoreProcessFocusRef\.current = true;\s*setProgressCollapsed\(true\);/);
  assert.match(pageSource, /useEffect\(\(\) => \{\s*if \(!progressCollapsed \|\| !restoreProcessFocusRef\.current\) return;\s*restoreProcessFocusRef\.current = false;\s*processTriggerRef\.current\?\.focus\(\);\s*\}, \[progressCollapsed\]\)/);
  assert.match(pageSource, /ref=\{processTriggerRef\}\s*className="secondary-action outline-process-action"/);
  const processTrigger = pageSource.slice(pageSource.indexOf('ref={processTriggerRef}'), pageSource.indexOf('            过程'));
  assert.match(processTrigger, /onKeyDown=\{\(event\) => \{\s*if \(event\.key === 'Escape' && !progressCollapsed\) \{[\s\S]*?closeProcessPopover\(\);/);
  assert.match(pageSource, /if \(event\.key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*closeProcessPopover\(\);/);
  assert.match(pageSource, /onClick=\{closeProcessPopover\}>收起<\/button>/);
});
