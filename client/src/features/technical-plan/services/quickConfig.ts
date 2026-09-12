import type {
  BackgroundTaskStatus,
  BidSectionMode,
  ContentGenerationOptions,
  ContentTableRequirement,
} from '../types';
import type { OutlineWordControlOptions } from '../../../shared/types';

export type PageLadderKey =
  | 'p50-100'
  | 'p100-200'
  | 'p200-350'
  | 'p350-500'
  | 'p500-800'
  | 'p800-1200'
  | 'p1200-1500';

export type PageLadderState = PageLadderKey | 'unset' | 'custom';

export interface PageLadderPreset {
  label: string;
  description: string;
  options: OutlineWordControlOptions;
}

export const PAGE_LADDER_PRESETS: Record<PageLadderKey, PageLadderPreset> = {
  'p50-100': {
    label: '约50-100页',
    description: '2.5 - 5 万字',
    options: { minimumWords: 25000, maximumWords: 50000, sectionWords: 500, strictSectionWords: false },
  },
  'p100-200': {
    label: '约100-200页',
    description: '5 - 10 万字',
    options: { minimumWords: 50000, maximumWords: 100000, sectionWords: 800, strictSectionWords: false },
  },
  'p200-350': {
    label: '约200-350页',
    description: '10 - 17.5 万字',
    options: { minimumWords: 100000, maximumWords: 175000, sectionWords: 1400, strictSectionWords: false },
  },
  'p350-500': {
    label: '约350-500页',
    description: '17.5 - 25 万字',
    options: { minimumWords: 175000, maximumWords: 250000, sectionWords: 1800, strictSectionWords: false },
  },
  'p500-800': {
    label: '约500-800页',
    description: '25 - 40 万字',
    options: { minimumWords: 250000, maximumWords: 400000, sectionWords: 1800, strictSectionWords: false },
  },
  'p800-1200': {
    label: '约800-1200页',
    description: '40 - 60 万字',
    options: { minimumWords: 400000, maximumWords: 600000, sectionWords: 1800, strictSectionWords: false },
  },
  'p1200-1500': {
    label: '约1200-1500页',
    description: '60 - 75 万字',
    options: { minimumWords: 600000, maximumWords: 750000, sectionWords: 1800, strictSectionWords: false },
  },
};

export const QUICK_CONFIG_STORAGE_KEY = 'yibiao.technical-plan.step01.quick-config-expanded';

const DEFAULT_HTML_IMAGE_TYPES = '甘特图、进度网络图、组织架构图、泳道图、RACI 职责矩阵、风险矩阵、系统架构与拓扑图、WBS 工作分解结构图、鱼骨图、柱状图、折线图、饼图';

const DEFAULT_CONTENT_GENERATION_OPTIONS: ContentGenerationOptions = {
  useAiImages: false,
  maxAiImages: 6,
  useMermaidImages: true,
  useAiRedesignForMermaid: false,
  maxMermaidImages: 5,
  useHtmlImages: true,
  maxHtmlImages: 10,
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

export function resolvePageLadderKey(options: OutlineWordControlOptions): PageLadderState {
  if (
    options.minimumWords === 0
    && options.maximumWords === 0
    && options.sectionWords === 0
    && options.strictSectionWords === false
  ) {
    return 'unset';
  }

  const match = (Object.entries(PAGE_LADDER_PRESETS) as Array<[PageLadderKey, PageLadderPreset]>)
    .find(([, preset]) => sameWordControlOptions(options, preset.options));
  return match?.[0] || 'custom';
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
  return {
    ...DEFAULT_CONTENT_GENERATION_OPTIONS,
    ...source,
    useAiImages: Boolean(source.useAiImages ?? imageModelAvailable) && imageModelAvailable,
    useMermaidImages: Boolean(source.useMermaidImages ?? DEFAULT_CONTENT_GENERATION_OPTIONS.useMermaidImages),
    useHtmlImages: Boolean(source.useHtmlImages ?? DEFAULT_CONTENT_GENERATION_OPTIONS.useHtmlImages),
    tableRequirement: normalizeTableRequirement(source.tableRequirement),
    consistencyRepairMode: source.consistencyRepairMode === 'normal' ? 'normal' : 'agent',
    originalPlanCoverageRepairMode: source.originalPlanCoverageRepairMode === 'normal' ? 'normal' : 'agent',
  };
}

export function mergeContentGenerationOptionsForQuickConfig(
  current: Partial<ContentGenerationOptions> | undefined,
  patch: Partial<ContentGenerationOptions>,
  imageModelAvailable: boolean,
) {
  return resolveContentGenerationOptionsForQuickConfig(
    { ...current, ...patch },
    imageModelAvailable,
  );
}

export function isQuickConfigLocked(status?: BackgroundTaskStatus) {
  return status === 'running' || status === 'pausing' || status === 'paused';
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
  if (!contentGenerationOptions || contentGenerationOptions.tableRequirement === undefined) {
    missingItems.push('表格密度');
  }
  if (!contentGenerationOptions || typeof contentGenerationOptions.useAiImages !== 'boolean') {
    missingItems.push('AI 配图');
  }
  if (!contentGenerationOptions || typeof contentGenerationOptions.useMermaidImages !== 'boolean') {
    missingItems.push('Mermaid 图');
  }
  if (!contentGenerationOptions || typeof contentGenerationOptions.useHtmlImages !== 'boolean') {
    missingItems.push('HTML 图');
  }
  return missingItems;
}

export function isQuickConfigComplete(input: QuickConfigReadinessInput) {
  return getQuickConfigMissingItems(input).length === 0;
}
