import assert from 'node:assert/strict';
import test from 'node:test';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { DEFAULT_HTML_IMAGE_TYPES, applyImagePreset, inferImagePreset, normalizePersistedContentGenerationOptions, normalizeRuntimeContentGenerationOptions } from './imageConfig.ts';

test('四种图片模式映射为稳定规范值', () => {
  assert.deepEqual(applyImagePreset('enhanced'), {
    imagePreset: 'enhanced',
    useAiImages: true,
    maxAiImages: 10,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 8,
    useHtmlImages: true,
    maxHtmlImages: 8,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  });

  assert.deepEqual(applyImagePreset('rich'), {
    imagePreset: 'rich',
    useAiImages: true,
    maxAiImages: 3,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 3,
    useHtmlImages: true,
    maxHtmlImages: 3,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  });

  assert.deepEqual(applyImagePreset('basic'), {
    imagePreset: 'basic',
    useAiImages: false,
    maxAiImages: 0,
    useMermaidImages: true,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 5,
    useHtmlImages: false,
    maxHtmlImages: 0,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  });

  assert.deepEqual(applyImagePreset('text-only'), {
    imagePreset: 'text-only',
    useAiImages: false,
    maxAiImages: 0,
    useMermaidImages: false,
    useAiRedesignForMermaid: false,
    maxMermaidImages: 0,
    useHtmlImages: false,
    maxHtmlImages: 0,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  });
});

test('持久化图片模式不因叶子数量或图片模型可用性变成自定义', () => {
  const persisted = normalizePersistedContentGenerationOptions({
    ...applyImagePreset('enhanced'),
    useAiRedesignForMermaid: true,
  });
  assert.equal(persisted.imagePreset, 'enhanced');
  assert.equal(persisted.useAiImages, true);
  assert.equal(persisted.maxAiImages, 10);

  const runtime = normalizeRuntimeContentGenerationOptions(persisted, {
    imageModelAvailable: false,
    leafCount: 2,
  });
  assert.equal(runtime.imagePreset, 'enhanced');
  assert.equal(runtime.useAiImages, false);
  assert.equal(runtime.maxAiImages, 2);
  assert.equal(runtime.useMermaidImages, true);
  assert.equal(runtime.maxMermaidImages, 2);
  assert.equal(runtime.useHtmlImages, true);
  assert.equal(runtime.maxHtmlImages, 2);
});

test('历史配置缺少 imagePreset 时精确匹配，否则为 custom', () => {
  assert.equal(inferImagePreset({
    useAiImages: true,
    maxAiImages: 3,
    useMermaidImages: true,
    useAiRedesignForMermaid: true,
    maxMermaidImages: 3,
    useHtmlImages: true,
    maxHtmlImages: 3,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  }), 'rich');

  assert.equal(inferImagePreset({
    useAiImages: true,
    maxAiImages: 2,
    useMermaidImages: true,
    maxMermaidImages: 3,
    useHtmlImages: true,
    maxHtmlImages: 3,
    htmlImageTypes: DEFAULT_HTML_IMAGE_TYPES,
  }), 'custom');
});

test('修改图片开关、数量或 PPT 类型后推导为自定义', () => {
  assert.equal(inferImagePreset({
    ...applyImagePreset('rich'),
    useHtmlImages: false,
  }), 'custom');
  assert.equal(inferImagePreset({
    ...applyImagePreset('rich'),
    maxMermaidImages: 4,
  }), 'custom');
  assert.equal(inferImagePreset({
    ...applyImagePreset('rich'),
    htmlImageTypes: '甘特图',
  }), 'custom');
});
