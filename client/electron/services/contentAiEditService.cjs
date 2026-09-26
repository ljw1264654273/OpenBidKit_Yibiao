const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  getBidProjectTechnicalPlanDir,
  getTechnicalPlanGeneratedIllustrationsDir,
} = require('../utils/paths.cjs');

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DATA_URL_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i;

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeCaption(value) {
  return normalizeText(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\[\]()*]/g, '')
    .trim();
}

function getCandidateDirectory(app, projectId) {
  if (!projectId) {
    return path.join(getTechnicalPlanGeneratedIllustrationsDir(app), 'inline-candidates');
  }
  return path.join(getBidProjectTechnicalPlanDir(app, projectId), 'generated-illustrations', 'inline-candidates');
}

function encodeAssetPath(parts) {
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

function buildInlineImageMarkdown({ candidateId, assetUrl, imageTitle, caption }) {
  const normalizedTitle = sanitizeCaption(imageTitle) || '正文插图';
  const normalizedCaption = sanitizeCaption(caption) || normalizedTitle;
  return [
    `<!-- yibiao-inline-image:start id="${candidateId}" -->`,
    `![${normalizedTitle}](${assetUrl})`,
    '',
    `*<!-- yibiao-figure-caption -->${normalizedCaption}*`,
    '<!-- yibiao-inline-image:end -->',
  ].join('\n');
}

function collectOutlineContent(items, result = []) {
  for (const item of Array.isArray(items) ? items : []) {
    result.push(String(item?.content || ''));
    collectOutlineContent(item?.children, result);
  }
  return result;
}

function buildTextEditMessages(payload, mode) {
  const content = String(payload.content || '');
  const start = Math.max(0, Math.min(content.length, Number(payload.selectionStart) || 0));
  const end = Math.max(start, Math.min(content.length, Number(payload.selectionEnd) || start));
  const selectedText = content.slice(start, end);
  const before = content.slice(Math.max(0, start - 1800), start);
  const after = content.slice(end, Math.min(content.length, end + 1800));
  const instruction = normalizeText(payload.instruction) || (mode === 'rewrite' ? '保持原意并提升专业性' : '结合上下文自然续写');
  const common = [
    `章节：${normalizeText(payload.nodeTitle) || payload.nodeId || '未命名章节'}`,
    payload.nodeDescription ? `章节说明：${normalizeText(payload.nodeDescription)}` : '',
    `用户要求：${instruction}`,
  ].filter(Boolean);

  if (mode === 'rewrite') {
    return [
      {
        role: 'system',
        content: [
          '你是投标技术方案正文编辑助手。',
          '仅改写用户指定的选中文字，不返回完整章节，不添加章节标题，不使用 Markdown 代码围栏。',
          '保留原文中的项目事实、数字、对象名称和承诺边界，不虚构资质、人员、证书或未提供事实。',
          '只返回 JSON：{"replacementText":"替换文本"}。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          ...common,
          `选中文字：\n${selectedText}`,
          `选区前文：\n${before}`,
          `选区后文：\n${after}`,
        ].join('\n\n'),
      },
    ];
  }

  return [
    {
      role: 'system',
      content: [
        '你是投标技术方案正文续写助手。',
        '仅返回应插入光标位置的新增正文，不复述前文，不改写后文，不添加章节标题，不使用 Markdown 代码围栏。',
        '保持现有 Markdown 段落或列表结构，不虚构资质、人员、证书或未提供事实。',
        '只返回 JSON：{"insertionText":"新增正文"}。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        ...common,
        `光标前文：\n${before}`,
        `光标后文：\n${after}`,
      ].join('\n\n'),
    },
  ];
}

function normalizeTextCandidate(value, mode) {
  const source = value?.result && typeof value.result === 'object' ? value.result : value || {};
  const text = normalizeText(mode === 'rewrite'
    ? source.replacementText ?? source.replacement_text ?? source.text
    : source.insertionText ?? source.insertion_text ?? source.text);
  return mode === 'rewrite'
    ? { mode, replacementText: text }
    : { mode, insertionText: text };
}

function validateTextCandidate(candidate, mode) {
  const text = mode === 'rewrite' ? candidate?.replacementText : candidate?.insertionText;
  if (!normalizeText(text) || /```/.test(text)) {
    throw new Error(mode === 'rewrite' ? '模型未返回有效改写内容' : '模型未返回有效续写内容');
  }
}

function buildImagePrompt(payload) {
  const content = String(payload.content || '');
  const offset = Math.max(0, Math.min(content.length, Number(payload.insertionOffset) || 0));
  const context = content.slice(Math.max(0, offset - 1800), Math.min(content.length, offset + 1800));
  return [
    `请生成用于中文投标技术方案的专业配图，图片标题为“${sanitizeCaption(payload.imageTitle)}”。`,
    payload.imageDescription ? `图片需要表达：${normalizeText(payload.imageDescription)}` : '',
    payload.nodeTitle ? `所属章节：${normalizeText(payload.nodeTitle)}` : '',
    payload.nodeDescription ? `章节说明：${normalizeText(payload.nodeDescription)}` : '',
    context ? `光标附近正文：\n${context}` : '',
    payload.style ? `补充风格要求：${normalizeText(payload.style)}` : '',
    '画面结构清晰、专业克制、适合插入正式投标文件；不要出现水印、品牌标识、无关文字或夸张营销元素。',
  ].filter(Boolean).join('\n\n');
}

function createContentAiEditService({ app, aiService, technicalPlanStore, resolveTechnicalPlanStore } = {}) {
  const candidates = new Map();

  function resolveStore(payload) {
    return resolveTechnicalPlanStore?.(payload) || technicalPlanStore;
  }

  function createCandidate({ projectId, buffer, extension, imageTitle, caption }) {
    const candidateId = crypto.randomUUID();
    const normalizedExtension = extension === '.jpeg' ? '.jpg' : extension;
    const directory = getCandidateDirectory(app, projectId);
    fs.mkdirSync(directory, { recursive: true });
    const fileName = `${candidateId}${normalizedExtension}`;
    const filePath = path.join(directory, fileName);
    fs.writeFileSync(filePath, buffer);
    const assetUrl = `yibiao-asset://generated-images/${encodeAssetPath([
      'technical-plan',
      'illustrations',
      'inline-candidates',
      fileName,
    ])}`;
    const normalizedTitle = sanitizeCaption(imageTitle) || '正文插图';
    const normalizedCaption = sanitizeCaption(caption) || normalizedTitle;
    const candidate = {
      candidateId,
      assetUrl,
      imageTitle: normalizedTitle,
      caption: normalizedCaption,
      markdown: buildInlineImageMarkdown({
        candidateId,
        assetUrl,
        imageTitle: normalizedTitle,
        caption: normalizedCaption,
      }),
      filePath,
    };
    candidates.set(candidateId, { ...candidate, projectId: String(projectId || '') });
    return candidate;
  }

  async function aiEditContent(payload) {
    const mode = payload?.mode === 'rewrite' ? 'rewrite' : 'continue';
    const result = await aiService.collectJsonResponse({
      messages: buildTextEditMessages(payload || {}, mode),
      logTitle: `${mode === 'rewrite' ? '正文局部改写' : '正文光标续写'}-${payload?.nodeId || 'unknown'}`,
      progressLabel: mode === 'rewrite' ? '正文局部改写' : '正文光标续写',
      failureMessage: mode === 'rewrite' ? '模型返回的局部改写格式无效' : '模型返回的续写格式无效',
      normalizer: (value) => normalizeTextCandidate(value, mode),
      validator: (candidate) => validateTextCandidate(candidate, mode),
    });
    validateTextCandidate(result, mode);
    return mode === 'rewrite'
      ? { mode, replacementText: result.replacementText }
      : { mode, insertionText: result.insertionText };
  }

  async function generateInlineImage(payload) {
    const title = sanitizeCaption(payload?.imageTitle);
    if (!title) throw new Error('请输入图片标题');
    const generated = await aiService.generateImage({
      title,
      logTitle: `正文即时配图-${payload?.nodeId || 'unknown'}-${title}`,
      prompt: buildImagePrompt(payload || {}),
      style: payload?.style || 'engineering_diagram',
    });
    if (!generated?.file_path || !fs.existsSync(generated.file_path)) {
      throw new Error('生图模型未返回可用的本地图片');
    }
    const extension = path.extname(generated.file_path).toLowerCase()
      || (generated.mime_type === 'image/jpeg' ? '.jpg' : generated.mime_type === 'image/webp' ? '.webp' : '.png');
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) throw new Error('AI 图片格式不受支持');
    const candidate = createCandidate({
      projectId: payload?.projectId,
      buffer: fs.readFileSync(generated.file_path),
      extension,
      imageTitle: title,
      caption: payload?.caption || title,
    });
    try {
      fs.rmSync(generated.file_path, { force: true });
    } catch {
      // 候选已复制到项目目录，源生图清理失败不影响用户继续使用。
    }
    return candidate;
  }

  async function importInlineImage(payload) {
    const source = payload?.source || {};
    const title = sanitizeCaption(payload?.imageTitle);
    if (!title) throw new Error('请输入图片标题');
    if (source.filePath) {
      const extension = path.extname(source.filePath).toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        throw new Error('仅支持 PNG、JPG、JPEG 或 WebP 图片');
      }
      if (!fs.existsSync(source.filePath)) throw new Error('选择的图片文件不存在');
      return createCandidate({
        projectId: payload?.projectId,
        buffer: fs.readFileSync(source.filePath),
        extension,
        imageTitle: title,
        caption: payload?.caption || title,
      });
    }

    const match = String(source.dataUrl || '').match(DATA_URL_IMAGE_PATTERN);
    if (!match) throw new Error('剪贴板图片数据无效');
    const subtype = match[1].toLowerCase();
    return createCandidate({
      projectId: payload?.projectId,
      buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
      extension: subtype === 'jpeg' || subtype === 'jpg' ? '.jpg' : `.${subtype}`,
      imageTitle: title,
      caption: payload?.caption || title,
    });
  }

  async function releaseInlineImageCandidate(payload) {
    const candidateId = String(payload?.candidateId || '');
    const candidate = candidates.get(candidateId);
    if (!candidate) return { success: true, released: false };
    const state = resolveStore(payload)?.loadTechnicalPlan?.() || {};
    const contents = collectOutlineContent(state?.outlineData?.outline);
    if (contents.some((content) => content.includes(candidate.assetUrl))) {
      candidates.delete(candidateId);
      return { success: true, released: false, reason: 'referenced' };
    }
    try {
      fs.rmSync(candidate.filePath, { force: true });
    } finally {
      candidates.delete(candidateId);
    }
    return { success: true, released: true };
  }

  return {
    aiEditContent,
    generateInlineImage,
    getImageModelAvailability: () => aiService.getImageModelAvailability?.() || { available: true, status: 'available', message: '' },
    importInlineImage,
    releaseInlineImageCandidate,
  };
}

module.exports = {
  buildInlineImageMarkdown,
  createContentAiEditService,
};
