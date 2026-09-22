import assert from 'node:assert/strict';
import test from 'node:test';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { DEFAULT_CONTENT_GENERATION_OPTIONS, DEFAULT_PAGE_LADDER_KEY, PAGE_LADDER_KEYS, PAGE_LADDER_PRESETS, createCustomPageOptions, getQuickConfigMissingItems, isQuickConfigComplete, isQuickConfigLocked, isQuickConfigOptionLocked, isValidCustomPageCount, mergeContentGenerationOptionsForQuickConfig, normalizeTableRequirement, resolveContentGenerationOptionsForQuickConfig, resolveCustomPageCount, resolveCustomPageDraft, resolvePageLadderKey } from './quickConfig.ts';
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS } from '../../../shared/types/outline.ts';

test('篇幅预设按 1500、1200、900、500、200 页排列且默认 1200 页', () => {
  assert.deepEqual(PAGE_LADDER_KEYS, ['p1500', 'p1200', 'p900', 'p500', 'p200']);
  assert.equal(DEFAULT_PAGE_LADDER_KEY, 'p1200');
  assert.deepEqual(PAGE_LADDER_PRESETS.p1500.options, {
    minimumWords: 700000,
    maximumWords: 800000,
    sectionWords: 1800,
    strictSectionWords: false,
  });
  assert.deepEqual(PAGE_LADDER_PRESETS.p1200.options, {
    minimumWords: 550000,
    maximumWords: 650000,
    sectionWords: 1800,
    strictSectionWords: false,
  });
  assert.deepEqual(PAGE_LADDER_PRESETS.p900.options, {
    minimumWords: 400000,
    maximumWords: 500000,
    sectionWords: 1800,
    strictSectionWords: false,
  });
  assert.deepEqual(PAGE_LADDER_PRESETS.p500.options, {
    minimumWords: 200000,
    maximumWords: 300000,
    sectionWords: 1800,
    strictSectionWords: false,
  });
  assert.deepEqual(PAGE_LADDER_PRESETS.p200.options, {
    minimumWords: 50000,
    maximumWords: 150000,
    sectionWords: 1800,
    strictSectionWords: false,
  });
  assert.equal(resolvePageLadderKey(PAGE_LADDER_PRESETS.p1200.options), 'p1200');
  assert.equal(resolvePageLadderKey(DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS), 'p1200');
  assert.equal(resolvePageLadderKey({
    minimumWords: 30000,
    maximumWords: 36000,
    sectionWords: 800,
    strictSectionWords: false,
  }), 'custom');
  assert.equal(resolveCustomPageCount(createCustomPageOptions(1000)), 1000);
  assert.equal(isValidCustomPageCount('1200'), true);
  assert.equal(isValidCustomPageCount(0), false);
  assert.equal(isValidCustomPageCount(''), false);
  assert.equal(isValidCustomPageCount('12.5'), false);
  assert.deepEqual(createCustomPageOptions(1000), {
    minimumWords: 500000,
    maximumWords: 500000,
    sectionWords: 1800,
    strictSectionWords: false,
  });
  assert.equal(resolvePageLadderKey({
    minimumWords: 0,
    maximumWords: 0,
    sectionWords: 0,
    strictSectionWords: false,
  }), 'p1200');
  assert.equal(resolvePageLadderKey({
    minimumWords: 0,
    maximumWords: 0,
    sectionWords: 500,
    strictSectionWords: false,
  }), 'p1200');
});

test('自定义页数草稿从已保存配置恢复，非法配置不再回退为 0', () => {
  assert.equal(resolveCustomPageDraft(PAGE_LADDER_PRESETS.p1200.options), '1200');
  assert.equal(resolveCustomPageDraft(createCustomPageOptions(860)), '860');
  assert.equal(resolveCustomPageDraft({
    minimumWords: 0,
    maximumWords: 0,
    sectionWords: 0,
    strictSectionWords: false,
  }), '');
  assert.equal(resolveCustomPageDraft({
    minimumWords: 0,
    maximumWords: 0,
    sectionWords: 0,
    strictSectionWords: false,
  }, '860'), '860');
});

test('表格密度缺失或非法时回退丰富，显式无表格保留', () => {
  assert.equal(normalizeTableRequirement(undefined), 'heavy');
  assert.equal(normalizeTableRequirement('unknown'), 'heavy');
  assert.equal(normalizeTableRequirement('none'), 'none');
});

test('图片默认值使用丰富图文并在运行态遵循图片模型可用性', () => {
  assert.equal(DEFAULT_CONTENT_GENERATION_OPTIONS.imagePreset, 'enhanced');
  const unavailable = resolveContentGenerationOptionsForQuickConfig(undefined, false);
  assert.equal(unavailable.imagePreset, 'enhanced');
  assert.equal(unavailable.useAiImages, false);
  assert.equal(unavailable.useMermaidImages, true);
  assert.equal(unavailable.useHtmlImages, true);

  const explicitlyDisabled = resolveContentGenerationOptionsForQuickConfig({
    imagePreset: 'custom',
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

test('快速配置保存不把图片模型不可用写回持久化图片选项', () => {
  const next = mergeContentGenerationOptionsForQuickConfig({
    imagePreset: 'rich',
    useAiImages: true,
    maxAiImages: 3,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 3,
    useHtmlImages: true,
    maxHtmlImages: 3,
    htmlImageTypes: '甘特图',
    tableRequirement: 'heavy',
    enableConsistencyAudit: true,
    consistencyRepairMode: 'agent',
    enableOriginalPlanCoverageAudit: false,
    originalPlanCoverageRepairMode: 'agent',
  }, {
    tableRequirement: 'light',
  }, false);

  assert.equal(next.imagePreset, 'rich');
  assert.equal(next.useAiImages, true);
  assert.equal(next.maxAiImages, 3);
  assert.equal(next.tableRequirement, 'light');
});

test('正文生成运行、暂停中锁定 STEP 01 危险操作', () => {
  assert.equal(isQuickConfigLocked('running'), true);
  assert.equal(isQuickConfigLocked('pausing'), true);
  assert.equal(isQuickConfigLocked('paused'), true);
  assert.equal(isQuickConfigOptionLocked('running'), true);
  assert.equal(isQuickConfigOptionLocked('pausing'), true);
  assert.equal(isQuickConfigOptionLocked('paused'), false);
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
  assert.deepEqual(incomplete, ['投标范围', '标书篇幅']);
  assert.equal(isQuickConfigComplete({
    pageLadder: 'p1200',
    bidSectionMode: 'multiple',
    selectedBidSectionValid: true,
    contentGenerationOptions: {
      imagePreset: 'basic',
      tableRequirement: 'heavy',
      useAiImages: false,
      useMermaidImages: true,
      useHtmlImages: true,
    },
  }), true);
});
