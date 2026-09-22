import type { ContentGenerationOptions, ContentImagePreset } from '../types';

export const DEFAULT_HTML_IMAGE_TYPES = '甘特图、进度网络图、组织架构图、泳道图、RACI 职责矩阵、风险矩阵、系统架构与拓扑图、WBS 工作分解结构图、鱼骨图、柱状图、折线图、饼图';

export const IMAGE_PRESET_LABELS: Record<ContentImagePreset, string> = {
  enhanced: '丰富图文',
  rich: '丰富图文',
  basic: '基础配图',
  'text-only': '纯文字',
  custom: '自定义',
};

export const QUICK_CONFIG_IMAGE_OPTIONS = [
  {
    preset: 'enhanced',
    label: '丰富图文',
    description: '适量实拍图、PPT 插图、页面丰富',
  },
  {
    preset: 'basic',
    label: '基础配图',
    description: '适量流程图配图，内容简洁清晰',
  },
  {
    preset: 'text-only',
    label: '纯文字',
    description: '无配图，仅文字方案',
  },
] as const;

type ImageOptionFields = Pick<
  ContentGenerationOptions,
  | 'imagePreset'
  | 'useAiImages'
  | 'maxAiImages'
  | 'useMermaidImages'
  | 'useAiRedesignForMermaid'
  | 'maxMermaidImages'
  | 'useHtmlImages'
  | 'maxHtmlImages'
  | 'htmlImageTypes'
>;

const IMAGE_PRESET_DEFINITIONS: Record<Exclude<ContentImagePreset, 'custom'>, ImageOptionFields> = {
  enhanced: {
    imagePreset: 'enhanced',
    useAiImages: true,
    maxAiImages: 10,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 8,
    useHtmlImages: true,
    maxHtmlImages: 8,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  },
  rich: {
    imagePreset: 'rich',
    useAiImages: true,
    maxAiImages: 3,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 3,
    useHtmlImages: true,
    maxHtmlImages: 3,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  },
  basic: {
    imagePreset: 'basic',
    useAiImages: false,
    maxAiImages: 0,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 5,
    useHtmlImages: false,
    maxHtmlImages: 0,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  },
  'text-only': {
    imagePreset: 'text-only',
    useAiImages: false,
    maxAiImages: 0,
    useMermaidImages: false,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 0,
    useHtmlImages: false,
    maxHtmlImages: 0,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  },
};

const IMAGE_PRESET_KEYS = Object.keys(IMAGE_PRESET_DEFINITIONS) as Array<Exclude<ContentImagePreset, 'custom'>>;

function normalizeCount(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Math.max(0, Number.isFinite(numeric) ? Math.round(numeric) : fallback);
}

function normalizeKnownPreset(value: unknown): ContentImagePreset | undefined {
  if (value === 'enhanced' || value === 'rich' || value === 'basic' || value === 'text-only' || value === 'custom') {
    return value;
  }
  return undefined;
}

export function getImagePresetDefinition(preset: Exclude<ContentImagePreset, 'custom'>): ImageOptionFields {
  return { ...IMAGE_PRESET_DEFINITIONS[preset] };
}

export function applyImagePreset(preset: Exclude<ContentImagePreset, 'custom'>): ImageOptionFields {
  return getImagePresetDefinition(preset);
}

export function inferImagePreset(options: Partial<ContentGenerationOptions> | undefined): ContentImagePreset {
  if (!options) {
    return 'custom';
  }
  const explicitPreset = normalizeKnownPreset(options.imagePreset);
  if (explicitPreset && explicitPreset !== 'custom') {
    const presetDefinition = IMAGE_PRESET_DEFINITIONS[explicitPreset];
    if (!isImageOptionChanged(presetDefinition, options)) {
      return explicitPreset;
    }
  }

  const matchedPreset = IMAGE_PRESET_KEYS.find((preset) => !isImageOptionChanged(IMAGE_PRESET_DEFINITIONS[preset], options));
  return matchedPreset || 'custom';
}

export function normalizePersistedContentGenerationOptions(
  options: Partial<ContentGenerationOptions> | undefined,
): ImageOptionFields {
  const source = options || {};
  const fallbackPreset = normalizeKnownPreset(source.imagePreset);
  const fallback = fallbackPreset && fallbackPreset !== 'custom'
    ? IMAGE_PRESET_DEFINITIONS[fallbackPreset]
    : IMAGE_PRESET_DEFINITIONS.enhanced;
  const normalized: ImageOptionFields = {
    imagePreset: normalizeKnownPreset(source.imagePreset),
    useAiImages: Boolean(source.useAiImages ?? fallback.useAiImages),
    maxAiImages: normalizeCount(source.maxAiImages, fallback.maxAiImages),
    useMermaidImages: Boolean(source.useMermaidImages ?? fallback.useMermaidImages),
    useAiRedesignForMermaid: Boolean(source.useAiRedesignForMermaid ?? fallback.useAiRedesignForMermaid),
    maxMermaidImages: normalizeCount(source.maxMermaidImages, fallback.maxMermaidImages),
    useHtmlImages: Boolean(source.useHtmlImages ?? fallback.useHtmlImages),
    maxHtmlImages: normalizeCount(source.maxHtmlImages, fallback.maxHtmlImages),
    htmlImageTypes: typeof source.htmlImageTypes === 'string' && source.htmlImageTypes.trim()
      ? source.htmlImageTypes
      : DEFAULT_HTML_IMAGE_TYPES,
  };
  normalized.imagePreset = inferImagePreset(normalized);
  return normalized;
}

export function normalizeRuntimeContentGenerationOptions<T extends Partial<ContentGenerationOptions>>(
  options: T,
  runtime: { imageModelAvailable: boolean; leafCount?: number },
): T & ImageOptionFields {
  const leafLimit = Math.max(0, Math.round(runtime.leafCount ?? Number.POSITIVE_INFINITY));
  const persisted = normalizePersistedContentGenerationOptions(options);
  const limitCount = (count: number) => (Number.isFinite(leafLimit) ? Math.min(count, leafLimit) : count);
  return {
    ...options,
    ...persisted,
    useAiImages: persisted.useAiImages && runtime.imageModelAvailable,
    maxAiImages: limitCount(persisted.maxAiImages),
    maxMermaidImages: limitCount(persisted.maxMermaidImages),
    maxHtmlImages: limitCount(persisted.maxHtmlImages),
  };
}

export function isImageOptionChanged(
  base: Pick<ContentGenerationOptions, 'useAiImages' | 'maxAiImages' | 'useMermaidImages' | 'maxMermaidImages' | 'useHtmlImages' | 'maxHtmlImages' | 'htmlImageTypes'>,
  next: Partial<ContentGenerationOptions>,
) {
  return Boolean(base.useAiImages) !== Boolean(next.useAiImages)
    || normalizeCount(next.maxAiImages, -1) !== base.maxAiImages
    || Boolean(base.useMermaidImages) !== Boolean(next.useMermaidImages)
    || normalizeCount(next.maxMermaidImages, -1) !== base.maxMermaidImages
    || Boolean(base.useHtmlImages) !== Boolean(next.useHtmlImages)
    || normalizeCount(next.maxHtmlImages, -1) !== base.maxHtmlImages
    || (next.htmlImageTypes || DEFAULT_HTML_IMAGE_TYPES) !== base.htmlImageTypes;
}
