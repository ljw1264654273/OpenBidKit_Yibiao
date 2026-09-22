import type {
  BackgroundTaskStatus,
  BidSectionMode,
  ContentGenerationOptions,
  ContentTableRequirement,
} from '../types';
import type { OutlineWordControlOptions } from '../../../shared/types';

export type PageLadderKey =
  | 'p1500'
  | 'p1200'
  | 'p900'
  | 'p500'
  | 'p200';

export type PageLadderState = PageLadderKey | 'unset' | 'custom';

export const PAGE_LADDER_KEYS = ['p1500', 'p1200', 'p900', 'p500', 'p200'] as const;
export const DEFAULT_PAGE_LADDER_KEY: PageLadderKey = 'p1200';

export interface PageLadderPreset {
  label: string;
  description: string;
  options: OutlineWordControlOptions;
}

export const PAGE_LADDER_PRESETS: Record<PageLadderKey, PageLadderPreset> = {
  p1500: {
    label: '1500页',
    description: '70 - 80 万字（约 1400 - 1600 页）',
    options: { minimumWords: 700000, maximumWords: 800000, sectionWords: 1800, strictSectionWords: false },
  },
  p1200: {
    label: '1200页',
    description: '55 - 65 万字（约 1100 - 1300 页）',
    options: { minimumWords: 550000, maximumWords: 650000, sectionWords: 1800, strictSectionWords: false },
  },
  p900: {
    label: '900页',
    description: '40 - 50 万字（约 800 - 1000 页）',
    options: { minimumWords: 400000, maximumWords: 500000, sectionWords: 1800, strictSectionWords: false },
  },
  p500: {
    label: '500页',
    description: '20 - 30 万字（约 400 - 600 页）',
    options: { minimumWords: 200000, maximumWords: 300000, sectionWords: 1800, strictSectionWords: false },
  },
  p200: {
    label: '200页',
    description: '5 - 15 万字（约 100 - 300 页）',
    options: { minimumWords: 50000, maximumWords: 150000, sectionWords: 1800, strictSectionWords: false },
  },
};

export const QUICK_CONFIG_STORAGE_KEY = 'yibiao.technical-plan.step01.quick-config-expanded';
const WORDS_PER_PAGE = 500;

const DEFAULT_HTML_IMAGE_TYPES = '甘特图、进度网络图、组织架构图、泳道图、RACI 职责矩阵、风险矩阵、系统架构与拓扑图、WBS 工作分解结构图、鱼骨图、柱状图、折线图、饼图';

export const DEFAULT_CONTENT_GENERATION_OPTIONS: ContentGenerationOptions = {
  imagePreset: 'enhanced',
  useAiImages: true,
  maxAiImages: 10,
  useMermaidImages: true,
  useAiRedesignForMermaid: false,
  maxMermaidImages: 8,
  useHtmlImages: true,
  maxHtmlImages: 8,
  htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  tableRequirement: 'heavy',
  enableConsistencyAudit: true,
  consistencyRepairMode: 'agent',
  enableOriginalPlanCoverageAudit: false,
  originalPlanCoverageRepairMode: 'agent',
};

function sameWordControlOptions(left: OutlineWordControlOptions, right: OutlineWordControlOptions) {
  return left.minimumWords === right.minimumWords
    && left.maximumWords === right.maximumWords
    && left.sectionWords === right.sectionWords
    && left.strictSectionWords === right.strictSectionWords;
}

function normalizeImageCount(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Math.max(0, Number.isFinite(numeric) ? Math.round(numeric) : fallback);
}

export function resolvePageLadderKey(options: OutlineWordControlOptions): PageLadderState {
  if (
    options.minimumWords === 0
    && options.maximumWords === 0
  ) {
    return DEFAULT_PAGE_LADDER_KEY;
  }

  const match = (Object.entries(PAGE_LADDER_PRESETS) as Array<[PageLadderKey, PageLadderPreset]>)
    .find(([, preset]) => sameWordControlOptions(options, preset.options));
  return match?.[0] || 'custom';
}

export function createCustomPageOptions(pageCount: number): OutlineWordControlOptions {
  const normalizedPageCount = Math.max(1, Math.round(Number(pageCount) || 1));
  const words = normalizedPageCount * WORDS_PER_PAGE;
  return {
    minimumWords: words,
    maximumWords: words,
    sectionWords: 1800,
    strictSectionWords: false,
  };
}

export function isValidCustomPageCount(value: unknown) {
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(numeric) && numeric > 0;
}

export function resolveCustomPageCount(options: OutlineWordControlOptions): number | null {
  if (
    options.minimumWords <= 0
    || options.maximumWords <= 0
    || options.minimumWords !== options.maximumWords
    || options.minimumWords % WORDS_PER_PAGE !== 0
  ) {
    return null;
  }
  return options.minimumWords / WORDS_PER_PAGE;
}

export function resolveCustomPageDraft(options: OutlineWordControlOptions, currentDraft = ''): string {
  const persistedPageCount = resolveCustomPageCount(options);
  if (persistedPageCount !== null) {
    return String(persistedPageCount);
  }
  const preset = (Object.entries(PAGE_LADDER_PRESETS) as Array<[PageLadderKey, PageLadderPreset]>)
    .find(([, definition]) => sameWordControlOptions(options, definition.options));
  if (preset) {
    return preset[0].slice(1);
  }
  return isValidCustomPageCount(currentDraft) ? String(Number(currentDraft)) : '';
}

export function normalizeTableRequirement(value: unknown): ContentTableRequirement {
  return value === 'none' || value === 'light' || value === 'moderate' || value === 'heavy'
    ? value
    : 'heavy';
}

export function resolveContentGenerationOptionsForQuickConfig(
  options: Partial<ContentGenerationOptions> | undefined,
  imageModelAvailable: boolean,
): ContentGenerationOptions {
  const source = options || {};
  const maxAiImages = normalizeImageCount(source.maxAiImages, DEFAULT_CONTENT_GENERATION_OPTIONS.maxAiImages);
  const maxMermaidImages = normalizeImageCount(source.maxMermaidImages, DEFAULT_CONTENT_GENERATION_OPTIONS.maxMermaidImages);
  const maxHtmlImages = normalizeImageCount(source.maxHtmlImages, DEFAULT_CONTENT_GENERATION_OPTIONS.maxHtmlImages);
  return {
    ...DEFAULT_CONTENT_GENERATION_OPTIONS,
    ...source,
    imagePreset: source.imagePreset || DEFAULT_CONTENT_GENERATION_OPTIONS.imagePreset,
    useAiImages: Boolean(source.useAiImages ?? DEFAULT_CONTENT_GENERATION_OPTIONS.useAiImages) && imageModelAvailable,
    maxAiImages,
    useMermaidImages: Boolean(source.useMermaidImages ?? DEFAULT_CONTENT_GENERATION_OPTIONS.useMermaidImages),
    maxMermaidImages,
    useHtmlImages: Boolean(source.useHtmlImages ?? DEFAULT_CONTENT_GENERATION_OPTIONS.useHtmlImages),
    maxHtmlImages,
    htmlImageTypes: typeof source.htmlImageTypes === 'string' && source.htmlImageTypes.trim()
      ? source.htmlImageTypes
      : DEFAULT_HTML_IMAGE_TYPES,
    tableRequirement: normalizeTableRequirement(source.tableRequirement),
    consistencyRepairMode: source.consistencyRepairMode === 'normal' ? 'normal' : 'agent',
    originalPlanCoverageRepairMode: source.originalPlanCoverageRepairMode === 'normal' ? 'normal' : 'agent',
  };
}

export function mergeContentGenerationOptionsForQuickConfig(
  current: Partial<ContentGenerationOptions> | undefined,
  patch: Partial<ContentGenerationOptions>,
  _imageModelAvailable: boolean,
): ContentGenerationOptions {
  const source = { ...current, ...patch };
  const maxAiImages = normalizeImageCount(source.maxAiImages, DEFAULT_CONTENT_GENERATION_OPTIONS.maxAiImages);
  const maxMermaidImages = normalizeImageCount(source.maxMermaidImages, DEFAULT_CONTENT_GENERATION_OPTIONS.maxMermaidImages);
  const maxHtmlImages = normalizeImageCount(source.maxHtmlImages, DEFAULT_CONTENT_GENERATION_OPTIONS.maxHtmlImages);
  const consistencyRepairMode = source.consistencyRepairMode === 'normal' ? 'normal' : 'agent';
  const originalPlanCoverageRepairMode = source.originalPlanCoverageRepairMode === 'normal' ? 'normal' : 'agent';
  return {
    ...DEFAULT_CONTENT_GENERATION_OPTIONS,
    ...source,
    imagePreset: source.imagePreset || DEFAULT_CONTENT_GENERATION_OPTIONS.imagePreset,
    maxAiImages,
    maxMermaidImages,
    maxHtmlImages,
    htmlImageTypes: typeof source.htmlImageTypes === 'string' && source.htmlImageTypes.trim()
      ? source.htmlImageTypes
      : DEFAULT_HTML_IMAGE_TYPES,
    tableRequirement: normalizeTableRequirement(source.tableRequirement),
    consistencyRepairMode,
    originalPlanCoverageRepairMode,
  };
}

export function isQuickConfigLocked(status?: BackgroundTaskStatus) {
  return status === 'running' || status === 'pausing' || status === 'paused';
}

export function isQuickConfigOptionLocked(status?: BackgroundTaskStatus) {
  return status === 'running' || status === 'pausing';
}

interface QuickConfigReadinessInput {
  pageLadder: PageLadderState;
  bidSectionMode: BidSectionMode;
  selectedBidSectionValid: boolean;
  contentGenerationOptions?: Partial<ContentGenerationOptions>;
}

export function getQuickConfigMissingItems({
  pageLadder,
  bidSectionMode,
  selectedBidSectionValid,
  contentGenerationOptions,
}: QuickConfigReadinessInput) {
  const missingItems: string[] = [];
  if (bidSectionMode === 'multiple' && !selectedBidSectionValid) {
    missingItems.push('投标范围');
  }
  if (pageLadder === 'unset') {
    missingItems.push('标书篇幅');
  }
  return missingItems;
}

export function isQuickConfigComplete(input: QuickConfigReadinessInput) {
  return getQuickConfigMissingItems(input).length === 0;
}
