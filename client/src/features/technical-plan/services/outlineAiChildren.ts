import type { ChatMessage, OutlineContentMode, OutlineItem, OutlineMinimumDepth } from '../../../shared/types';

const MAX_OUTLINE_DEPTH = 7;
const MAX_SIBLING_COUNT = 8;
const CONTENT_MODES: OutlineContentMode[] = ['ai-generate', 'template-fill', 'point-to-point', 'other'];
const GENERIC_TITLES = new Set([
  '详细说明',
  '相关内容',
  '具体措施',
  '其他内容',
  '其他事项',
  '补充说明',
  '内容说明',
]);

function normalizeOutlineMinimumDepth(value: unknown): OutlineMinimumDepth {
  return value === 3 || value === 4 || value === 5 ? value : 0;
}

function formatOutlineMinimumDepth(value: OutlineMinimumDepth) {
  if (value === 3) return '三级';
  if (value === 4) return '四级';
  if (value === 5) return '五级';
  return '默认';
}

interface GeneratedChild {
  title?: unknown;
  description?: unknown;
  content_mode?: unknown;
  content_mode_note?: unknown;
  children?: unknown;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function readChildren(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { children?: unknown }).children)) {
    return (value as { children: unknown[] }).children;
  }
  return [];
}

function normalizeContentMode(value: unknown): OutlineContentMode {
  return CONTENT_MODES.includes(value as OutlineContentMode)
    ? value as OutlineContentMode
    : 'ai-generate';
}

function normalizeSiblingGroup(
  value: unknown,
  options: {
    parentId: string;
    parentDepth: number;
    minimumDepth: OutlineMinimumDepth;
    startIndex: number;
  },
): OutlineItem[] {
  const rawItems = readChildren(value);
  if (rawItems.length < 2) throw new Error('每个新父目录至少包含两个子目录，不能生成单子节点');
  if (rawItems.length > MAX_SIBLING_COUNT) throw new Error(`同级 AI 子目录最多生成 ${MAX_SIBLING_COUNT} 个`);

  const titles = new Set<string>();
  return rawItems.map((rawItem, index) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem as GeneratedChild : {};
    const title = normalizeText(item.title);
    if (!title) throw new Error('AI 返回了空标题子目录');
    if (GENERIC_TITLES.has(title)) throw new Error(`目录标题过于空泛：${title}`);
    const duplicateKey = title.toLocaleLowerCase('zh-CN');
    if (titles.has(duplicateKey)) throw new Error(`同级目录标题重复：${title}`);
    titles.add(duplicateKey);

    const depth = options.parentDepth + 1;
    if (depth > MAX_OUTLINE_DEPTH) throw new Error('目录最多七级，AI 返回结果已超出限制');
    const id = `${options.parentId}.${options.startIndex + index}`;
    const description = normalizeText(item.description) || title;
    const childItems = readChildren(item.children);
    if (childItems.length) {
      if (depth >= MAX_OUTLINE_DEPTH) throw new Error('目录最多七级，第七级节点不能继续包含 children');
      return {
        id,
        title,
        description,
        children: normalizeSiblingGroup(childItems, {
          parentId: id,
          parentDepth: depth,
          minimumDepth: options.minimumDepth,
          startIndex: 1,
        }),
      };
    }

    const contentMode = normalizeContentMode(item.content_mode);
    if (contentMode === 'ai-generate' && options.minimumDepth > 0 && depth < options.minimumDepth) {
      throw new Error(`AI 正文叶子“${title}”位于第 ${depth} 级，未达到最低${formatOutlineMinimumDepth(options.minimumDepth)}`);
    }
    const contentModeNote = normalizeText(item.content_mode_note);
    return {
      id,
      title,
      description,
      content_mode: contentMode,
      ...(contentMode === 'other' && contentModeNote ? { content_mode_note: contentModeNote } : {}),
    };
  });
}

export function buildOutlineAiChildrenMessages(input: {
  title: string;
  description: string;
  requirement: string;
  parentDepth: number;
  minimumDepth: OutlineMinimumDepth;
}): ChatMessage[] {
  const minimumDepth = normalizeOutlineMinimumDepth(input.minimumDepth);
  const depthRule = minimumDepth > 0
    ? `当前配置要求 AI 正文叶子最低${formatOutlineMinimumDepth(minimumDepth)}，请用实际递归 children 补足层级。`
    : '当前未配置最低层级，可按内容复杂度生成直接叶子或递归子目录。';
  return [
    {
      role: 'system',
      content: `你是专业投标文件目录设计助手。只返回 JSON，不要输出 Markdown 或解释。输出根对象必须包含 children 数组；允许节点递归 children，父节点不写 content_mode，叶子节点必须写 content_mode。每个父节点生成 2 到 8 个具体、互不重复且有独立写作价值的子节点，不得生成单子节点，不得使用“详细说明”“相关内容”“具体措施”等空泛标题。${depthRule} 当前父目录为第 ${input.parentDepth} 级，完整目录最多七级。content_mode 只能是 ai-generate、template-fill、point-to-point、other。`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        current_title: input.title,
        current_description: input.description,
        current_depth: input.parentDepth,
        minimum_ai_leaf_depth: minimumDepth,
        maximum_depth: MAX_OUTLINE_DEPTH,
        user_requirement: input.requirement,
        output_shape: {
          children: [
            {
              title: '具体子目录标题',
              description: '该节点的具体编写范围',
              children: [
                {
                  title: '可独立编写的正文小节',
                  description: '正文小节需要覆盖的对象、方法或交付物',
                  content_mode: 'ai-generate',
                },
              ],
            },
          ],
        },
      }),
    },
  ];
}

export function normalizeGeneratedChildren(
  value: unknown,
  options: {
    parentId: string;
    parentDepth: number;
    minimumDepth: OutlineMinimumDepth;
    startIndex: number;
  },
): OutlineItem[] {
  if (!Number.isInteger(options.parentDepth) || options.parentDepth < 1 || options.parentDepth >= MAX_OUTLINE_DEPTH) {
    throw new Error('当前目录已达到七级，不能继续添加子目录');
  }
  return normalizeSiblingGroup(value, {
    ...options,
    minimumDepth: normalizeOutlineMinimumDepth(options.minimumDepth),
    startIndex: Math.max(1, Math.floor(options.startIndex || 1)),
  });
}
