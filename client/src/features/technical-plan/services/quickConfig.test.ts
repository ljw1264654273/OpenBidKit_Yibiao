import assert from 'node:assert/strict';
import test from 'node:test';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { PAGE_LADDER_PRESETS, getQuickConfigMissingItems, isQuickConfigComplete, isQuickConfigLocked, mergeContentGenerationOptionsForQuickConfig, normalizeTableRequirement, resolveContentGenerationOptionsForQuickConfig, resolvePageLadderKey } from './quickConfig.ts';

test('七档篇幅使用固定四字段映射且旧版配置显示为自定义', () => {
  assert.deepEqual(PAGE_LADDER_PRESETS['p200-350'].options, {
    minimumWords: 100000,
    maximumWords: 175000,
    sectionWords: 1400,
    strictSectionWords: false,
  });
  assert.equal(resolvePageLadderKey(PAGE_LADDER_PRESETS['p200-350'].options), 'p200-350');
  assert.equal(resolvePageLadderKey({
    minimumWords: 30000,
    maximumWords: 36000,
    sectionWords: 800,
    strictSectionWords: false,
  }), 'custom');
  assert.equal(resolvePageLadderKey({
    minimumWords: 0,
    maximumWords: 0,
    sectionWords: 0,
    strictSectionWords: false,
  }), 'unset');
});

test('表格密度缺失或非法时回退丰富，显式无表格保留', () => {
  assert.equal(normalizeTableRequirement(undefined), 'heavy');
  assert.equal(normalizeTableRequirement('unknown'), 'heavy');
  assert.equal(normalizeTableRequirement('none'), 'none');
});

test('图片默认值遵循图片模型可用性并保留显式关闭', () => {
  const unavailable = resolveContentGenerationOptionsForQuickConfig(undefined, false);
  assert.equal(unavailable.useAiImages, false);
  assert.equal(unavailable.useMermaidImages, true);
  assert.equal(unavailable.useHtmlImages, true);

  const explicitlyDisabled = resolveContentGenerationOptionsForQuickConfig({
    useAiImages: false,
    useMermaidImages: false,
    useHtmlImages: false,
  }, true);
  assert.equal(explicitlyDisabled.useAiImages, false);
  assert.equal(explicitlyDisabled.useMermaidImages, false);
  assert.equal(explicitlyDisabled.useHtmlImages, false);
});

test('快速配置更新只替换目标字段并保留其他正文生成配置', () => {
  const current = resolveContentGenerationOptionsForQuickConfig({
    maxAiImages: 2,
    maxMermaidImages: 3,
    maxHtmlImages: 4,
    htmlImageTypes: '甘特图',
    useAiRedesignForMermaid: true,
    enableConsistencyAudit: false,
    consistencyRepairMode: 'normal',
    enableOriginalPlanCoverageAudit: true,
    originalPlanCoverageRepairMode: 'normal',
  }, true);
  const next = mergeContentGenerationOptionsForQuickConfig(current, {
    tableRequirement: 'none',
    useHtmlImages: false,
  }, true);

  assert.equal(next.tableRequirement, 'none');
  assert.equal(next.useHtmlImages, false);
  assert.equal(next.maxAiImages, 2);
  assert.equal(next.maxMermaidImages, 3);
  assert.equal(next.maxHtmlImages, 4);
  assert.equal(next.htmlImageTypes, '甘特图');
  assert.equal(next.useAiRedesignForMermaid, true);
  assert.equal(next.enableConsistencyAudit, false);
  assert.equal(next.enableOriginalPlanCoverageAudit, true);
});

test('正文生成运行、暂停中锁定 STEP 01 危险操作', () => {
  assert.equal(isQuickConfigLocked('running'), true);
  assert.equal(isQuickConfigLocked('pausing'), true);
  assert.equal(isQuickConfigLocked('paused'), true);
  assert.equal(isQuickConfigLocked('success'), false);
  assert.equal(isQuickConfigLocked(undefined), false);
});

test('快速配置未全部设置时返回缺少项，全部设置后才算完成', () => {
  const incomplete = getQuickConfigMissingItems({
    pageLadder: 'unset',
    bidSectionMode: 'multiple',
    selectedBidSectionValid: false,
    contentGenerationOptions: undefined,
  });
  assert.deepEqual(incomplete, ['投标范围', '标书篇幅', '表格密度', 'AI 配图', 'Mermaid 图', 'HTML 图']);
  assert.equal(isQuickConfigComplete({
    pageLadder: 'p50-100',
    bidSectionMode: 'multiple',
    selectedBidSectionValid: true,
    contentGenerationOptions: {
      tableRequirement: 'heavy',
      useAiImages: false,
      useMermaidImages: true,
      useHtmlImages: true,
    },
  }), true);
});
