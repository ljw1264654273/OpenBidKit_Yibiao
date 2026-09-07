const {
  OUTLINE_AGENT_TASK_KEY,
  TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
} = require('./outlineGenerationAgentV2Config.cjs');
const { planRemoteKnowledgeQueries } = require('./remoteKnowledgeQueryPlanner.cjs');
const { runTemplateExtractionTask } = require('./templateExtractionTask.cjs');

const DEFAULT_ESTIMATED_SECTION_WORDS = 3000;
const OUTLINE_OUTPUT_FILE = 'outline.json';
const TECHNICAL_SCORE_GROUPS_FILE = 'technical-score-groups.json';
const SCORE_DIRECTORY_PLAN_FILE = 'score-directory-plan.json';
const SCORE_COVERAGE_MAP_FILE = 'score-coverage-map.json';
const OUTLINE_REVIEW_FILE = 'outline-review.json';
const OUTLINE_REVIEW_CONTEXT_FILE = 'outline-review-context.json';
const AI_CONTENT_MODE = 'ai-generate';
const CONTENT_MODES = ['ai-generate', 'template-fill', 'point-to-point', 'other'];
const MAX_OUTLINE_DEPTH = 7;
const REMOTE_REFERENCE_RULE = '远程知识仅是参考材料。招标文件、用户已确认信息和原方案优先；不得从参考材料新增未获批准的同层级评分项，不得在最终目录中输出内部来源标识。';

function createDirectoryNodeSchema(level, root = false) {
  const baseProperties = {
    id: { type: 'string', pattern: `^[1-9]\\d*(?:\\.[1-9]\\d*){${level - 1}}$` },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    ...(root ? {
      attr: { type: 'string', enum: ['通用', '商务', '资信', '技术', '其他'] },
      branch_id: { type: 'string', minLength: 1 },
    } : {}),
  };
  const baseRequired = ['id', 'title', 'description', ...(root ? ['attr'] : [])];
  const leafSchema = {
    type: 'object',
    required: [...baseRequired, 'content_mode'],
    additionalProperties: false,
    properties: {
      ...baseProperties,
      content_mode: { type: 'string', enum: CONTENT_MODES },
      content_mode_note: { type: 'string' },
    },
  };
  if (level < MAX_OUTLINE_DEPTH) {
    const branchSchema = {
      type: 'object',
      required: [...baseRequired, 'children'],
      additionalProperties: false,
      properties: {
        ...baseProperties,
        children: {
          type: 'array',
          minItems: 2,
          items: createDirectoryNodeSchema(level + 1),
        },
      },
    };
    return { oneOf: [leafSchema, branchSchema] };
  }
  return leafSchema;
}

const ROOT_NODE_SCHEMA = createDirectoryNodeSchema(1, true);

const OUTLINE_JSON_SCHEMA = {
  type: 'object',
  required: ['outline'],
  additionalProperties: false,
  properties: {
    outline: {
      type: 'array',
      minItems: 1,
      items: ROOT_NODE_SCHEMA,
    },
  },
};

const TECHNICAL_SCORE_GROUPS_SCHEMA = {
  type: 'object',
  required: ['version', 'groups'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: 2 },
    groups: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['requirement_id', 'source_title', 'target_title', 'source_order', 'expected_path', 'criteria'],
        additionalProperties: false,
        properties: {
          requirement_id: { type: 'string', pattern: '^R[1-9]\\d*$' },
          source_title: { type: 'string', minLength: 1 },
          target_title: { type: 'string', minLength: 1 },
          source_order: { type: 'integer', minimum: 1 },
          expected_path: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          criteria: {
            type: 'array',
            items: {
              type: 'object',
              required: ['criterion_id', 'source_text', 'target_title', 'source_order', 'expected_path', 'response_points', 'evaluation_dimensions', 'supplements'],
              additionalProperties: false,
              properties: {
                criterion_id: { type: 'string', pattern: '^R[1-9]\\d*-C[1-9]\\d*$' },
                source_text: { type: 'string', minLength: 1 },
                target_title: { type: 'string', minLength: 1 },
                source_order: { type: 'integer', minimum: 1 },
                expected_path: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } },
                response_points: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['point_id', 'source_text', 'target_title', 'source_order', 'expected_path'],
                    additionalProperties: false,
                    properties: {
                      point_id: { type: 'string', pattern: '^R[1-9]\\d*-C[1-9]\\d*-P[1-9]\\d*$' },
                      source_text: { type: 'string', minLength: 1 },
                      target_title: { type: 'string', minLength: 1 },
                      source_order: { type: 'integer', minimum: 1 },
                      expected_path: { type: 'array', minItems: 3, items: { type: 'string', minLength: 1 } },
                    },
                  },
                },
                evaluation_dimensions: { type: 'array', items: { type: 'string', minLength: 1 } },
                supplements: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['supplement_id', 'title', 'reason', 'supplement_kind', 'parent_source_id', 'source_order'],
                    additionalProperties: false,
                    properties: {
                      supplement_id: { type: 'string', pattern: '^R[1-9]\\d*-C[1-9]\\d*-S[1-9]\\d*$' },
                      title: { type: 'string', minLength: 1 },
                      reason: { type: 'string', minLength: 1 },
                      supplement_kind: { type: 'string', enum: ['overall-introduction', 'other-specific-issues', 'reasonable-suggestion', 'user-approved'] },
                      parent_source_id: { type: 'string', pattern: '^R[1-9]\\d*-C[1-9]\\d*$' },
                      source_order: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SCORE_DIRECTORY_PLAN_SCHEMA = {
  type: 'object',
  required: ['allow_root_changes', 'branches', 'extra_titles'],
  additionalProperties: false,
  properties: {
    allow_root_changes: { type: 'boolean' },
    branches: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['branch_id', 'root_id', 'root_title', 'score_item_level', 'mappings'],
        additionalProperties: false,
        properties: {
          branch_id: { type: 'string', minLength: 1 },
          root_id: { type: 'string', pattern: '^[1-9]\\d*(?:\\.[1-9]\\d*)*$' },
          root_title: { type: 'string', minLength: 1 },
          score_item_level: { type: 'integer', minimum: 1, maximum: MAX_OUTLINE_DEPTH },
          mappings: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['requirement_id', 'target_title'],
              additionalProperties: false,
              properties: {
                requirement_id: { type: 'string', pattern: '^R[1-9]\\d*$' },
                target_title: { type: 'string', minLength: 1 },
                additional_titles: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'string', minLength: 1 },
                },
                adjustment_note: { type: 'string' },
              },
            },
          },
        },
      },
    },
    extra_titles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['branch_id', 'title', 'reason'],
        additionalProperties: false,
        properties: {
          branch_id: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const SCORE_COVERAGE_MAP_SCHEMA = {
  type: 'object',
  required: ['version', 'coverage_mode', 'records'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: 1 },
    coverage_mode: { type: 'string', enum: ['full', 'legacy-structure-only'] },
    records: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source_id', 'source_kind', 'source_text', 'node_ids', 'coverage_location', 'user_override', 'supplement_kind'],
        additionalProperties: false,
        properties: {
          source_id: { type: 'string', pattern: '^(?:R[1-9]\\d*(?:-[CPS][1-9]\\d*)?|U[1-9]\\d*)$' },
          source_kind: { type: 'string', enum: ['requirement', 'criterion', 'response-point', 'professional-supplement', 'user-supplement'] },
          source_text: { type: 'string', minLength: 1 },
          node_ids: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
          coverage_location: { type: 'string', enum: ['title', 'description', 'both', 'none'] },
          user_override: { type: 'string', enum: ['none', 'renamed', 'partially-removed', 'removed', 'added'] },
          supplement_kind: { type: 'string', enum: ['none', 'overall-introduction', 'other-specific-issues', 'reasonable-suggestion', 'user-approved', 'user-added'] },
        },
      },
    },
  },
};

const OUTLINE_REVIEW_SCHEMA = {
  type: 'object',
  required: ['status', 'issues', 'user_feedback', 'summary'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['passed', 'simple_fix', 'user_feedback', 'user_refuse'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['category', 'problem', 'repair', 'confirmation_required'],
        additionalProperties: false,
        properties: {
          category: {
            type: 'string',
            enum: ['score-coverage', 'duplicate-directory', 'professional-structure'],
          },
          problem: { type: 'string', minLength: 1 },
          repair: { type: 'string', minLength: 1 },
          confirmation_required: { type: 'boolean' },
        },
      },
    },
    user_feedback: { type: 'string' },
    summary: { type: 'string', minLength: 1 },
  },
};

function formatProgressTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  return Array.from(title).slice(0, 20).join('');
}

function normalizeWordControlOptions(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const integer = (input) => {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  };
  return {
    minimumWords: integer(raw.minimumWords),
    maximumWords: integer(raw.maximumWords),
    sectionWords: integer(raw.sectionWords),
    strictSectionWords: Boolean(raw.strictSectionWords) && integer(raw.sectionWords) > 0,
  };
}

function deriveTargetLeafCount(options) {
  const sectionWords = options.sectionWords > 0 ? options.sectionWords : DEFAULT_ESTIMATED_SECTION_WORDS;
  if (options.minimumWords > 0 && options.maximumWords > 0) {
    return Math.ceil(((options.minimumWords + options.maximumWords) / 2) / sectionWords);
  }
  if (options.maximumWords > 0) {
    return Math.floor(options.maximumWords / sectionWords) - 2;
  }
  if (options.minimumWords > 0) {
    return Math.ceil(options.minimumWords / sectionWords) + 2;
  }
  return null;
}

function buildCapacityReference(value) {
  return {
    suggested_ai_leaf_count: deriveTargetLeafCount(normalizeWordControlOptions(value)),
    advisory_only: true,
  };
}

// 统一目录层级编号，并按父子节点形态整理目录字段。
function renumberOutline(items, prefix = '') {
  return (items || []).map((item, index) => {
    const id = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    const hasChildren = Array.isArray(item?.children) && item.children.length;
    const next = {
      id,
      title: String(item?.title || '').trim(),
      description: String(item?.description || '').trim(),
      ...(prefix ? {} : { attr: item?.attr }),
      ...(!prefix && String(item?.branch_id || '').trim() ? { branch_id: String(item.branch_id).trim() } : {}),
      ...(!hasChildren ? {
        content_mode: item?.content_mode,
        ...(item?.content_mode === 'other' && String(item?.content_mode_note || '').trim()
          ? { content_mode_note: String(item.content_mode_note).trim() }
          : {}),
      } : {}),
    };
    if (hasChildren) {
      next.children = renumberOutline(item.children, id);
    }
    return next;
  });
}

// 接受 Agent 的完整目录结果，并统一整理层级编号和节点字段。
function buildFinalOutline(candidate) {
  return { outline: renumberOutline(candidate?.outline || []) };
}

// 移除仅供 Agent 工作流关联分支的内部字段，再写入正式业务目录。
function stripOutlineInternalFields(candidate) {
  const strip = (items) => (items || []).map((item) => {
    const { branch_id: _branchId, children, ...rest } = item || {};
    return Array.isArray(children) && children.length
      ? { ...rest, children: strip(children) }
      : rest;
  });
  return { outline: strip(candidate?.outline || []) };
}

// 在子目录生成前，把规划分支标识附加到当前可对应的一级目录。
function attachBranchIdsToRoots(items, scoreDirectoryPlan) {
  const branchesByRootId = new Map();
  (scoreDirectoryPlan?.branches || []).forEach((branch) => {
    const rootId = String(branch.root_id || '').split('.')[0];
    if (!branchesByRootId.has(rootId)) branchesByRootId.set(rootId, branch);
  });
  return (items || []).map((item) => {
    const branch = branchesByRootId.get(item.id);
    return branch?.root_title === item.title ? { ...item, branch_id: branch.branch_id } : item;
  });
}

// 按最终目录中的稳定分支标识同步规划所记录的当前编号和标题。
function synchronizeScoreDirectoryPlan(scoreDirectoryPlan, items) {
  const rootsByBranchId = new Map(
    (items || [])
      .filter((item) => String(item?.branch_id || '').trim())
      .map((item) => [String(item.branch_id).trim(), item]),
  );
  return {
    ...scoreDirectoryPlan,
    branches: (scoreDirectoryPlan?.branches || []).map((branch) => {
      const root = rootsByBranchId.get(branch.branch_id);
      return root ? { ...branch, root_id: root.id, root_title: root.title } : branch;
    }),
  };
}

function countAiLeaves(items) {
  return (items || []).reduce((total, item) => (
    Array.isArray(item?.children) && item.children.length
      ? total + countAiLeaves(item.children)
      : total + (item?.content_mode === AI_CONTENT_MODE ? 1 : 0)
  ), 0);
}

function countLeavesByMode(items, counts = Object.fromEntries(CONTENT_MODES.map((mode) => [mode, 0]))) {
  (items || []).forEach((item) => {
    if (Array.isArray(item?.children) && item.children.length) {
      countLeavesByMode(item.children, counts);
    } else if (CONTENT_MODES.includes(item?.content_mode)) {
      counts[item.content_mode] += 1;
    }
  });
  return counts;
}

// 汇总目录层级、父节点和内容模式等确定性结构信息。
function collectOutlineStructure(items) {
  const result = {
    max_depth: 0,
    parent_count: 0,
    single_child_nodes: [],
    invalid_leaf_content_modes: [],
  };
  const visit = (nodes, depth) => {
    (nodes || []).forEach((item) => {
      result.max_depth = Math.max(result.max_depth, depth);
      const children = Array.isArray(item?.children) ? item.children : [];
      if (children.length) {
        result.parent_count += 1;
        if (children.length < 2) {
          result.single_child_nodes.push({ id: item.id, title: item.title, child_count: children.length });
        }
        visit(children, depth + 1);
      } else if (!CONTENT_MODES.includes(item?.content_mode)) {
        result.invalid_leaf_content_modes.push({ id: item.id, title: item.title, content_mode: item?.content_mode || '' });
      }
    });
  };
  visit(items, 1);
  return result;
}

function collectNodesAtLevel(item, currentDepth, targetDepth, result = []) {
  if (!item) return result;
  if (currentDepth === targetDepth) {
    result.push(item);
    return result;
  }
  if (currentDepth < targetDepth) {
    (item.children || []).forEach((child) => collectNodesAtLevel(child, currentDepth + 1, targetDepth, result));
  }
  return result;
}

// 对照用户确认的评分规划，机械检查目标标题是否位于指定分支和层级。
function collectScoreMappingCoverage(items, scoreDirectoryPlan) {
  const extraTitles = Array.isArray(scoreDirectoryPlan?.extra_titles) ? scoreDirectoryPlan.extra_titles : [];
  const branches = (scoreDirectoryPlan?.branches || []).map((branch) => {
    const root = (items || []).find((item) => item?.branch_id === branch.branch_id);
    const expectedTitles = [
      ...(branch.mappings || []).flatMap((mapping) => [mapping.target_title, ...(mapping.additional_titles || [])]),
      ...extraTitles.filter((item) => item.branch_id === branch.branch_id).map((item) => item.title),
    ].filter(Boolean);
    const uniqueExpectedTitles = [...new Set(expectedTitles)];
    const actualNodes = root ? collectNodesAtLevel(root, 1, branch.score_item_level) : [];
    const actualTitles = actualNodes.map((item) => item.title);
    const actualTitleSet = new Set(actualTitles);
    const expectedTitleSet = new Set(uniqueExpectedTitles);
    return {
      branch_id: branch.branch_id,
      planned_root_id: branch.root_id,
      current_root_id: root?.id || '',
      root_title: root?.title || branch.root_title,
      score_item_level: branch.score_item_level,
      root_found: Boolean(root),
      expected_titles: uniqueExpectedTitles,
      actual_titles: actualTitles,
      missing_titles: uniqueExpectedTitles.filter((title) => !actualTitleSet.has(title)),
      unexpected_titles: actualTitles.filter((title) => !expectedTitleSet.has(title)),
      mappings: (branch.mappings || []).map((mapping) => {
        const titles = [mapping.target_title, ...(mapping.additional_titles || [])].filter(Boolean);
        return {
          requirement_id: mapping.requirement_id,
          expected_titles: titles,
          matched_titles: titles.filter((title) => actualTitleSet.has(title)),
        };
      }),
    };
  });
  return {
    valid: branches.every((branch) => (
      branch.root_found
      && branch.missing_titles.length === 0
      && branch.unexpected_titles.length === 0
    )),
    branches,
  };
}

// 生成供最终 Agent 审核直接采用的宿主程序确定性检查结果。
function buildOutlineReviewContext({ outline, scoreDirectoryPlan, targetLeafCount }) {
  const items = outline?.outline || [];
  const leafCounts = countLeavesByMode(items);
  const structure = collectOutlineStructure(items);
  return {
    leaf_count: {
      suggested: targetLeafCount,
      advisory_only: true,
      current_ai_generate: leafCounts[AI_CONTENT_MODE],
      by_content_mode: leafCounts,
    },
    structure: {
      ...structure,
      valid: structure.max_depth <= MAX_OUTLINE_DEPTH
        && structure.single_child_nodes.length === 0
        && structure.invalid_leaf_content_modes.length === 0,
    },
    score_mapping: collectScoreMappingCoverage(items, scoreDirectoryPlan),
  };
}

function collectScoreSources(scorePlan) {
  const sources = [];
  for (const group of scorePlan?.groups || []) {
    sources.push({ id: group.requirement_id, kind: 'requirement', text: group.source_title, target: group.target_title });
    for (const criterion of group.criteria || []) {
      sources.push({ id: criterion.criterion_id, kind: 'criterion', text: criterion.source_text, target: criterion.target_title });
      for (const point of criterion.response_points || []) {
        sources.push({ id: point.point_id, kind: 'response-point', text: point.source_text, target: point.target_title });
      }
      for (const supplement of criterion.supplements || []) {
        sources.push({ id: supplement.supplement_id, kind: 'professional-supplement', text: supplement.title, target: supplement.title });
      }
    }
  }
  return sources;
}

function flattenOutlineNodes(items, result = new Map()) {
  for (const item of items || []) {
    result.set(String(item?.id || ''), item);
    if (Array.isArray(item?.children)) flattenOutlineNodes(item.children, result);
  }
  return result;
}

function isGenericDescription(value) {
  const text = String(value || '').replace(/\s+/g, '').trim();
  if (!text) return true;
  return /^(?:详细)?(?:介绍|说明|阐述)(?:本节|本章|相关|具体|方案|项目)*(?:内容|情况|要求)[。.]?$/.test(text)
    || /^(?:根据|按照)招标要求(?:进行)?(?:介绍|说明|阐述)[。.]?$/.test(text);
}

function validateFinalOutline({ outline, scorePlan, scoreCoverageMap, baseline = null }) {
  const items = outline?.outline || [];
  const structure = collectOutlineStructure(items);
  const nodes = flattenOutlineNodes(items);
  const mandatoryIssues = [];
  if (structure.max_depth > MAX_OUTLINE_DEPTH) {
    mandatoryIssues.push({ code: 'max-depth', message: `目录最多允许 ${MAX_OUTLINE_DEPTH} 级` });
  }
  for (const node of structure.single_child_nodes) {
    const relation = `${node.id}>${nodes.get(node.id)?.children?.[0]?.id || ''}`;
    if (!baseline?.singleChildRelations?.has?.(relation)) {
      mandatoryIssues.push({ code: 'single-child', node_id: node.id, message: 'Agent 不得生成只有一个子节点的父目录' });
    }
  }
  for (const node of structure.invalid_leaf_content_modes) {
    mandatoryIssues.push({ code: 'invalid-content-mode', node_id: node.id, message: '叶子节点内容模式无效' });
  }
  for (const [nodeId, node] of nodes) {
    if (!isGenericDescription(node.description)) continue;
    const fingerprint = baseline?.nodeFingerprints?.get?.(nodeId);
    const unchanged = fingerprint
      && fingerprint.title === node.title
      && fingerprint.description === node.description;
    if (!unchanged) mandatoryIssues.push({ code: 'generic-description', node_id: nodeId, message: '目录说明为空或过于空泛' });
  }

  if (scoreCoverageMap?.coverage_mode === 'full') {
    const records = Array.isArray(scoreCoverageMap.records) ? scoreCoverageMap.records : [];
    const recordsBySource = new Map();
    for (const record of records) {
      const existing = recordsBySource.get(record.source_id) || [];
      existing.push(record);
      recordsBySource.set(record.source_id, existing);
    }
    for (const source of collectScoreSources(scorePlan)) {
      const matching = recordsBySource.get(source.id) || [];
      if (matching.length !== 1) {
        mandatoryIssues.push({ code: matching.length ? 'score-source-duplicate' : 'score-source-missing', source_id: source.id, message: '评分来源映射不完整' });
        continue;
      }
      const record = matching[0];
      if (record.user_override === 'removed') continue;
      if (!record.node_ids?.length || record.node_ids.some((nodeId) => !nodes.has(nodeId))) {
        mandatoryIssues.push({ code: 'score-node-missing', source_id: source.id, message: '评分来源对应的目录节点不存在' });
      }
    }
  }
  return {
    valid: mandatoryIssues.length === 0,
    mandatoryIssues,
    context: buildOutlineReviewContext({ outline, scoreDirectoryPlan: { branches: [] }, targetLeafCount: null }),
  };
}

function readJson(content, label) {
  try {
    return JSON.parse(String(content || '').trim());
  } catch (error) {
    throw new Error(`${label}不是合法 JSON：${error?.message || String(error)}`);
  }
}

function normalizeReferenceDocumentIds(storedPlan) {
  const ids = storedPlan?.referenceKnowledgeDocumentIds || [];
  return Array.isArray(ids) ? [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))] : [];
}

function buildKnowledgeFiles(knowledgeBaseService, documentIds) {
  if (!knowledgeBaseService?.readReferences) return [];
  return knowledgeBaseService.readReferences(documentIds, { includeMarkdown: true, includeItems: false })
    .map((reference, index) => ({
      path: `参考知识库/参考资料-${index + 1}.md`,
      content: String(reference?.markdown || '').trim(),
    }))
    .filter((file) => file.content);
}

function buildRemoteKnowledgeFile(items = []) {
  const usable = (Array.isArray(items) ? items : []).map((item) => ({
    title: String(item?.title || '远程参考片段').replace(/\s+/g, ' ').trim(),
    content: String(item?.content || item?.resume || '').trim(),
  })).filter((item) => item.content);
  if (!usable.length) return null;
  const sections = usable.map((item, index) => `## 参考片段 ${index + 1}${item.title ? `：${item.title}` : ''}\n\n${item.content}`);
  return {
    path: '远程知识参考.md',
    content: `# 远程知识参考\n\n${REMOTE_REFERENCE_RULE}\n\n${sections.join('\n\n')}`,
  };
}

function createInitialPrompt(taskInstruction, { standaloneTechnical = false, hasRemoteKnowledge = false } = {}) {
  const goal = standaloneTechnical
    ? '我们的目标是为单独装订的技术文件准备一级目录。一级目录必须直接对应技术评分大项。'
    : '我们的目标是为编写响应文件/投标文件准备一级目录。';
  const modeRequirements = standaloneTechnical
    ? `6. 本模式只生成技术文件独立分册：只能保留适合展开技术正文的评分大项，attr 必须为“技术”，content_mode 必须为 ai-generate。
7. 每个一级目录直接对应一个技术评分大项，并保持评分大项的原顺序和正式表述；不得创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”等外层总目录，也不得加入商务、资信、投标函、授权委托书等非技术章节。
8. 完整结构示例：{"outline":[{"id":"1","title":"评分大项一","description":"评分大项一的技术响应范围","attr":"技术","content_mode":"ai-generate"},{"id":"2","title":"评分大项二","description":"评分大项二的技术响应范围","attr":"技术","content_mode":"ai-generate"}]}。`
    : `6. 每个一级目录当前都是叶子节点，必须根据它后续应采用的内容处理方式填写 content_mode：技术方案正文使用 ai-generate；需要从招标文件提取并套用表格或格式的商务、资信材料使用 template-fill；需要在全部正文完成并确定 Word 页码后回填的点对点应答表使用 point-to-point；无法归类的特殊内容使用 other，并在 content_mode_note 说明原因。
7. 完整结构示例：{"outline":[{"id":"1","title":"技术方案","description":"技术方案目录说明","attr":"技术","content_mode":"ai-generate"},{"id":"2","title":"特殊资料","description":"特殊资料目录说明","attr":"其他","content_mode":"other","content_mode_note":"说明特殊处理原因"}]}。content_mode_note 只在 content_mode=other 且确有说明时填写。`;
  return `请只在当前工作目录内工作。

任务：
${goal}
${taskInstruction}

请生成一级目录 JSON，并将结果写入 ${OUTLINE_OUTPUT_FILE}。

字段要求：
1. 顶层必须是对象，唯一字段 outline 是一级目录数组；此阶段暂时不要生成 children。
2. 一级目录 id 是从 1 开始且不重复的连续序号字符串。
3. title 必须是可直接用于投标文件目录的正式标题，不得包含“附件1”“附件一”“第一章”等编号或前缀。
4. description 是目录说明。
5. attr 必须从“通用”“商务”“资信”“技术”“其他”中选择。
${modeRequirements}
8. ${OUTLINE_OUTPUT_FILE} 必须是纯 JSON，不包含 Markdown 代码块或解释文字。
9. 程序已为 ${OUTLINE_OUTPUT_FILE} 预置 Schema。写入后调用 json-validation，只传 {"file_path":"${OUTLINE_OUTPUT_FILE}"}；校验失败后必须先修改文件，再重新校验。${hasRemoteKnowledge ? `\n10. ${REMOTE_REFERENCE_RULE}` : ''}`;
}

function createScorePlanningPrompt({ standaloneTechnical = false, hasRemoteKnowledge = false } = {}) {
  const placementInstruction = standaloneTechnical
    ? `6. 当前采用“技术文件独立成册”：${OUTLINE_OUTPUT_FILE} 中每个一级根节点本身就应对应一个技术评分大项。每个根节点建立一个 branch，score_item_level 固定为 1，mappings 只填写与该根标题对应的评分大项，target_title 必须与 root_title 完全一致；不得再创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”等外层分支。
7. 一级根节点与评分大项默认严格一一对应；发现缺失、重复、合并或顺序不一致时，必须作为一级目录调整向用户说明并取得批准。评分行和响应点用于后续生成根节点以下的目录。`
    : `6. 判断技术方案位于哪些目录分支，以及每个分支内评分大项对应节点应统一处于哪个层级。不同分支可以使用不同层级，范围为一级至七级。优先选择 attr=技术且 content_mode=ai-generate 的一级目录；template-fill、point-to-point 和 other 是特殊处理叶子，不得作为普通技术方案分支展开，除非先向用户说明并取得调整批准。
7. 默认每个评分大项对应一个独立同层级节点；每条独立评分行和 response_points 用于生成更下级目录。`;
  const planExample = standaloneTechnical
    ? `{"branches":[{"branch_id":"B1","root_id":"1","root_title":"评分大项一","score_item_level":1,"mappings":[{"requirement_id":"R1","target_title":"评分大项一"}]}],"extra_titles":[],"allow_root_changes":false}`
    : `{"branches":[{"branch_id":"B1","root_id":"2","root_title":"技术方案","score_item_level":2,"mappings":[{"requirement_id":"R1","target_title":"评分大项目录标题","additional_titles":["经批准拆分出的同级标题"],"adjustment_note":"用户批准的调整说明"}]}],"extra_titles":[{"branch_id":"B1","title":"经批准增加的同层级标题","reason":"增加原因"}],"allow_root_changes":false}`;
  return `用户已经确认最终保留的一级目录，${OUTLINE_OUTPUT_FILE} 已由程序重新整理并编号。工作区也已加入技术评分信息和用户选择的参考资料。${hasRemoteKnowledge ? `\n\n${REMOTE_REFERENCE_RULE}` : ''}

请完成技术评分信息结构化和目录规划。用户最新确认的目录规则和手工决定优先，其次才是评分原文、专业补充和字数容量参考：
1. 阅读 ${OUTLINE_OUTPUT_FILE}、技术评分信息.md，以及存在的原方案.md 和参考知识库目录。
2. 只从技术评分信息.md 的“技术评分项”中提取适合在技术方案中一一响应、展开编写的评分大项。“技术评分要求”只能作为评分标准、扣分规则和编写约束，不得提取为评分项。
如果技术评分信息中没有任何可用于技术方案目录规划的评分项，立即调用 report-failure，说明需要补充或重新解析技术评分信息；不要调用 ask-user 让用户接受空结果，不要生成空结构、编造评分项或删除、清空文件。
3. 将每个评分大项、每条独立评分行和每个明确响应内容写入 ${TECHNICAL_SCORE_GROUPS_FILE}。固定版本为 version=2；评分大项使用 R1，评分行使用 R1-C1，响应点使用 R1-C1-P1，受控补充使用 R1-C1-S1，并分别填写 source_order 和 expected_path。response_points、evaluation_dimensions、supplements 没有内容时使用空数组，不得省略。
4. source_title/source_text 必须保留完整评分原文和原始顺序，不得提前合并近义评分行。target_title 只允许删除“根据投标人对”“依据投标人提供的”“进行打分”“得0至5分”等不影响业务含义的评分外壳；不得删除“项目实施过程中”“服务需求中”等限定词，不得用更短但改变范围的概括标题。
5. “全面性、合理性、科学性、先进性、可行性”等评价词写入 evaluation_dimensions，后续进入对应节点 description，不生成独立目录。只有总体介绍、其他具体问题、合理化建议等确有写作价值的受控专业补充才写入 supplements，并填写具体 reason 和允许的 supplement_kind。
${placementInstruction}
8. 只有以下偏离需要用户批准：合并或拆分评分大项、遗漏评分来源、增加评分项中不存在的同层级大项、改变分支评分项目标层级，以及新增、删除、合并或调整用户已确认的一级目录。评分行以下的适度拆解和受控专业补充不需要再次询问。
9. 存在至少一个有效评分项时，无论是否存在偏离，都必须调用一次 ask-user 让用户确认评分大项所在分支和层级；多个实际确认事项集中询问一次。
10. 根据用户回答写入 ${SCORE_DIRECTORY_PLAN_FILE}。完整字段层级示例：${planExample}。branch_id 后续保持稳定，每个 requirement_id 在 mappings 中恰好出现一次，score_item_level 不得超过七级。
11. 默认锁定一级目录，allow_root_changes=false；只有用户明确批准一级目录调整时才设为 true。
12. 程序已为 ${TECHNICAL_SCORE_GROUPS_FILE} 和 ${SCORE_DIRECTORY_PLAN_FILE} 预置 Schema。分别调用 json-validation 校验；如果材料无法在不编造评分项的情况下通过校验，调用 report-failure。
13. 此阶段不要修改 ${OUTLINE_OUTPUT_FILE}，也不要删除、清空或重命名任何任务文件。`;
}

function createChildrenPrompt({ hasOriginalPlan, originalOnly, targetLeafCount, allowRootChanges, standaloneTechnical }) {
  const branchInstruction = !hasOriginalPlan
    ? '没有原方案时，以技术评分信息.md 为主要依据生成目录。'
    : originalOnly
      ? '已选择仅使用原方案目录：以原方案.md 为主建立规划层级及以下目录，再用技术评分信息.md 补充原方案语义上确实缺失的技术要求，意思相近的内容不要重复添加。'
      : '已提供原方案且允许 AI 补充：以技术评分信息.md 为主，在评分项目录规划指定的层级覆盖关键大项，原方案.md 用于辅助生成更下级目录。';
  const capacityInstruction = targetLeafCount === null
    ? '本次没有字数推算值，请按评分要求和实际材料自然形成目录。'
    : `字数推算值仅作为正文容量参考：当前建议约 ${targetLeafCount} 个 AI 生成叶子。不得为了接近建议数量而合并、删除、拆分或补齐目录。`;
  const rootInstruction = allowRootChanges
    ? `用户已批准 ${SCORE_DIRECTORY_PLAN_FILE} 中记录的一级目录调整，只能按该规划进行必要修改并重新编号。`
    : '一级目录的数量、顺序、id、title、description、attr 均已由用户确认，必须保持不变；未扩展为父节点的一级目录还必须保留其 content_mode。';
  const mappingInstruction = standaloneTechnical
    ? '每个 branch 的 score_item_level=1，现有一级根节点本身就是评分项映射节点。不得在根节点下面再次生成同名评分项；只根据 detail_points、招标要求和专业逻辑生成其二级及以下目录。'
    : '每个 branch 的 mappings 必须在该分支的 score_item_level 层级生成对应节点。';
  const outlineExample = standaloneTechnical
    ? `{"outline":[{"id":"1","title":"评分大项一","description":"评分大项说明","attr":"技术","branch_id":"B1","children":[{"id":"1.1","title":"响应内容一","description":"具体响应内容","content_mode":"ai-generate"},{"id":"1.2","title":"响应内容二","description":"具体响应内容","content_mode":"ai-generate"}]}]}`
    : `{"outline":[{"id":"1","title":"技术应答表","description":"应答表说明","attr":"技术","content_mode":"point-to-point"},{"id":"2","title":"技术方案","description":"技术方案说明","attr":"技术","branch_id":"B1","children":[{"id":"2.1","title":"评分大项","description":"评分大项说明","children":[{"id":"2.1.1","title":"具体方案一","description":"具体方案说明","content_mode":"ai-generate"},{"id":"2.1.2","title":"具体方案二","description":"具体方案说明","content_mode":"ai-generate"}]},{"id":"2.2","title":"另一评分大项","description":"评分大项说明","content_mode":"ai-generate"}]}]}`;
  return `请继续使用当前上下文，为 ${OUTLINE_OUTPUT_FILE} 生成完整目录并同步生成 ${SCORE_COVERAGE_MAP_FILE}。用户最新确认的规则和手工决定是第一标准，其次按评分原文、必要专业结构、字数容量参考的顺序执行。

要求：
1. ${branchInstruction}
2. 以 ${TECHNICAL_SCORE_GROUPS_FILE} 为技术评分项权威清单，以 ${SCORE_DIRECTORY_PLAN_FILE} 为评分项与目录位置的权威规划。
3. ${mappingInstruction} branch_id 是技术分支稳定标识：对应的最终一级目录必须保留同名 branch_id，即使一级目录新增、删除、改名、重排或重新编号也不得改变；非技术分支一级目录不要填写 branch_id。默认每个评分项形成一个独立节点；多个 mapping 使用相同 target_title 表示用户已批准合并，additional_titles 表示用户已批准将该评分项拆成多个同级节点。
4. 先生成评分大项映射节点，再按每条独立评分行生成下级节点，最后按 response_points 生成可独立编写的更具体节点。不得遗漏“建设目标”等明确内容，不得随意合并来自不同评分行的要求。
5. extra_titles 是用户已批准增加的同层级大项；除此之外不得自行增加技术评分项中不存在的同层级标题。
6. “技术评分要求”只能作为评分标准、扣分口径、判定规则和目录说明约束，不能生成独立评分项节点。
7. ${rootInstruction}
8. 未纳入评分项目录规划的一级目录和分支保持原样，不得增加子目录。
9. 如果存在参考知识库或原方案，只能用于完善评分项对应节点的下级结构，不得改变评分项映射或引入未经批准的同层级大项。
10. ${capacityInstruction}
11. 每个最终叶子节点必须填写 content_mode：技术方案正文为 ai-generate；从招标文件提取后按模板填写为 template-fill；需要在 Word 页码确定后回填为 point-to-point；其他特殊内容为 other，并用 content_mode_note 说明。父节点不得包含 content_mode 或 content_mode_note。
12. 任意非叶子节点的 children 至少包含两个节点，不要创建只有一个子节点的冗余层级。
13. 目录层级可变，但最多七级；只有存在至少两个独立、具体、非重复的写作单元时才继续下钻。越往下标题和 description 越具体，不得使用“其他内容”“相关说明”“方案概述”等空泛表述。
14. target_title 只允许删除“根据投标人对”“依据投标人提供的”“进行打分”等评分外壳。不得删除“项目实施过程中”等业务限定词；例如必须写“项目实施过程中的重点、难点问题分析及解决措施”，不能概括为“项目重点难点分析及解决措施”。
15. 评价维度写入对应节点 description，不生成目录。并列的独立写作对象可以拆分，例如“数据保密制度及保证措施”可拆为“数据保密制度”“保证措施”；分析与措施应保持响应闭环。
16. 只允许加入有明确价值的受控补充，例如总体方案要素前的“总体架构设计”，或问题分析下的“其他具体问题分析与应对”“合理化建议”；补充不得替代评分原文节点。
17. title 只写纯标题，不包含章节编号或 Markdown 标记。description 必须写明具体对象、范围、方法、措施、交付物或评价维度，不能只重复标题。
18. ${OUTLINE_OUTPUT_FILE} 的完整结构示例：${outlineExample}。branch_id 只写在评分规划对应的技术一级目录上。
19. 为 ${TECHNICAL_SCORE_GROUPS_FILE} 中每个 R/C/P/S 来源在 ${SCORE_COVERAGE_MAP_FILE} 写且只写一条记录，coverage_mode=full；node_ids 指向承接该来源的正式目录节点，coverage_location 标明 title、description 或 both。评分来源默认 user_override=none，非补充来源 supplement_kind=none。
20. 程序已为 ${OUTLINE_OUTPUT_FILE} 和 ${SCORE_COVERAGE_MAP_FILE} 预置 Schema。覆盖写回两个文件后分别调用 json-validation 校验；失败后必须先修复再继续。`;
}

function createOutlineReviewPrompt({ targetLeafCount, actualLeafCount, allowRootChanges }) {
  const rootRequirement = allowRootChanges
    ? `一级目录只能保持用户已批准的 ${SCORE_DIRECTORY_PLAN_FILE} 规划，不得提出规划之外的新调整。`
    : '一级目录已经由用户确认，数量、顺序、标题、描述和属性不得修改。';
  return `请对当前完整技术方案目录执行最终审核，并在用户确认后完成必要修复。字数推算值只作参考，不是问题，也不得触发询问或调整。

开始审核时一次性并行读取 ${OUTLINE_REVIEW_CONTEXT_FILE}、${OUTLINE_OUTPUT_FILE}、${TECHNICAL_SCORE_GROUPS_FILE}、${SCORE_COVERAGE_MAP_FILE}、技术评分信息.md 和 ${SCORE_DIRECTORY_PLAN_FILE}，不要探索工作区或读取其他文件。${OUTLINE_REVIEW_CONTEXT_FILE} 是宿主程序计算的确定性审核结果，内容模式、最大层级、父节点、单子节点和评分来源映射均直接采用其中结果；你负责修复确定性问题并补充评分语义、原文保真、近义重复和专业合理性审核。

审核维度：
- 评分覆盖：直接以技术评分信息.md 为原始依据，逐项检查其中适合技术方案响应的评分大项是否被目录准确覆盖；结构化评分项和目录规划用于核对已确认的映射，但不能掩盖原始评分信息中的遗漏。
- 原文保真：只删除评分外壳，保留“项目实施过程中”等有含义的限定词；每条明确响应内容必须在标题或 description 中承接。
- 重复目录：检查全部子目录中是否存在重复、近义、含义重叠或仅换一种说法的节点；不同专业分支下确有独立含义的同名标题不应机械判重。
- 专业合理性：评估目录层级、颗粒度、逻辑顺序、标题表达、description、节点归属以及内容处理模式是否适合正式技术投标文件。越往下必须越具体，最多七级。

审核与修复流程：
1. 必须先完整审核并形成问题清单，不得边审核边修改。
2. 如果没有问题，不要修改 ${OUTLINE_OUTPUT_FILE}；写入 ${OUTLINE_REVIEW_FILE}，status=passed、issues=[]、user_feedback=""，summary 说明通过原因。
3. 如果发现问题，先为每个问题记录 category、problem、推荐 repair 和 confirmation_required，不得提前修改目录。
4. 只有不涉及评分来源、目标层级和一级目录的补充节点文案优化或明显空洞 description 修复可设 confirmation_required=false。评分覆盖缺失、评分标题变义、一级目录调整和明显结构重排必须设为 true。
5. 如果全部问题都不需要确认，可以直接执行文案优化或轻微去重，不得调用 ask-user；完成后设置 status=simple_fix、user_feedback=""。静默修复不得改变评分来源映射、评分项目标层级和一级目录。
6. 只要存在一个 confirmation_required=true 的问题，本轮所有问题都不得提前修改。集中调用一次 ask-user，question 使用多行文本完整列出问题及推荐修复方案；提供 2 至 5 个互斥选项，第一项是推荐修复方案，并提供保留当前目录的选项；另提供一个名为“调整修复方案”等明确业务名称的选项并设置 custom=true，让用户说明具体修改要求，其他选项均设置 custom=false。custom=true 的选项最多只能有一个。
7. 根据 ask-user 返回的 answer 执行最终处理：用户要求全部或部分修改时更新 ${OUTLINE_OUTPUT_FILE} 和 ${SCORE_COVERAGE_MAP_FILE} 并设置 status=user_feedback；只有不影响宿主强制校验的可选语义优化允许用户拒绝并设置 status=user_refuse。评分覆盖缺失、映射损坏、超过七级、Agent 生成单子节点或非法内容模式不能以 user_refuse 保存；用户不接受修复时应取消本次任务。
8. ${rootRequirement}
9. 修复必须继续遵守 ${SCORE_DIRECTORY_PLAN_FILE} 中用户确认的评分项映射、目标层级和一级目录调整边界。补回遗漏映射、合并重复目录或优化层级时，不得引入未经用户批准的评分大项规划变更。
10. 技术一级目录必须保留 ${SCORE_DIRECTORY_PLAN_FILE} 中对应的 branch_id。任何修复仍必须保证叶子具有合法 content_mode、父节点不包含 content_mode、父节点至少有两个 children 且目录最多七级。
11. 修复目录后同步更新 ${SCORE_COVERAGE_MAP_FILE}；不得用映射记录掩盖实际缺失的目录要求。
12. 最终将完整问题清单和处理结果写入 ${OUTLINE_REVIEW_FILE}。category 只能是 score-coverage、duplicate-directory、professional-structure；status 按本流程选择 passed、simple_fix、user_feedback 或 user_refuse。
13. 程序已为 ${OUTLINE_OUTPUT_FILE}、${SCORE_COVERAGE_MAP_FILE} 和 ${OUTLINE_REVIEW_FILE} 预置 Schema。分别调用 json-validation 校验；校验失败后必须先修改，再重新校验。`;
}

// 运行 V2 目录业务任务；开发者模式下一级目录确认后并行调度目录任务和独立模版提取任务。
async function runOutlineGenerationTaskV2({ aiService, agentService, ordinaryAgentService, workspaceStore, knowledgeBaseService, knowledgeSession, openXmlHelperService, updateTask, checkpointTask, taskControl, payload }) {
  const storedPlan = workspaceStore.loadTechnicalPlan() || {};
  const restoringOutlineSelection = payload?.agent_resume?.phase === 'outline-selection';
  const standaloneTechnical = storedPlan.outlineMode === 'standalone-technical';
  const hasOriginalPlan = Boolean(storedPlan.originalPlanFile);
  const originalOnly = hasOriginalPlan && storedPlan.outlineExpansionMode === 'original-only';
  const originalPlan = hasOriginalPlan ? workspaceStore.readOriginalPlanMarkdown() : '';
  const responseFileRequirements = storedPlan.bidAnalysisTasks?.responseFileRequirements?.content || '';
  const wordControlOptions = normalizeWordControlOptions(payload?.word_control_options || storedPlan.outlineWordControlOptions);
  let targetLeafCount = deriveTargetLeafCount(wordControlOptions);
  const referenceDocumentIds = normalizeReferenceDocumentIds(storedPlan);
  const knowledgeFiles = buildKnowledgeFiles(knowledgeBaseService, referenceDocumentIds);
  const jsonValidationSchemas = {
    [OUTLINE_OUTPUT_FILE]: OUTLINE_JSON_SCHEMA,
    [TECHNICAL_SCORE_GROUPS_FILE]: TECHNICAL_SCORE_GROUPS_SCHEMA,
    [SCORE_DIRECTORY_PLAN_FILE]: SCORE_DIRECTORY_PLAN_SCHEMA,
    [SCORE_COVERAGE_MAP_FILE]: SCORE_COVERAGE_MAP_SCHEMA,
    [OUTLINE_REVIEW_FILE]: OUTLINE_REVIEW_SCHEMA,
  };

  let initialFiles;
  let taskInstruction;
  if (originalOnly) {
    initialFiles = [{ path: '原方案.md', content: originalPlan }];
    taskInstruction = '只根据原方案材料提取一级目录。';
  } else {
    initialFiles = [
      { path: '响应文件要求.md', content: responseFileRequirements },
      ...(standaloneTechnical ? [{ path: '技术评分信息.md', content: storedPlan.techRequirements || '' }] : []),
      { path: '项目概述.md', content: storedPlan.projectOverview || '' },
      ...(hasOriginalPlan ? [{ path: '原方案.md', content: originalPlan }] : []),
    ];
    taskInstruction = standaloneTechnical
      ? '严格按照技术评分信息.md 中适合技术方案响应的评分大项组织一级目录，只生成技术方案独立分册。评分大项原文、顺序和数量是一级目录的权威依据；响应文件要求.md 只提供装订和响应约束，项目概述.md 仅用于理解背景和术语，原方案.md 仅用于参考下级标题表达。'
      : hasOriginalPlan
        ? '严格按照响应文件要求.md 组织一级目录，它是目录结构和标题来源的唯一依据。项目概述.md 仅用于理解背景和术语，不得据此新增一级目录；原方案.md 仅用于参考标题表达。'
        : '严格按照响应文件要求.md 组织一级目录，它是目录结构和标题来源的唯一依据。项目概述.md 仅用于理解背景和术语，不得据此新增一级目录。';
  }
  let remoteKnowledgeFile = null;
  if (!originalOnly && knowledgeSession?.searchRemote && (!Array.isArray(knowledgeSession.remoteScopes) || knowledgeSession.remoteScopes.length > 0)) {
    const queryPlan = await planRemoteKnowledgeQueries({
      aiService,
      stage: 'outline',
      context: {
        projectOverview: storedPlan.projectOverview || '',
        responseRequirements: responseFileRequirements,
        technicalRequirements: storedPlan.techRequirements || '',
        outlineTarget: taskInstruction,
      },
      signal: taskControl?.signal,
    });
    const remoteItems = await knowledgeSession.searchRemote({
      stage: 'outline',
      queries: queryPlan.queries,
      matchCount: 8,
    });
    remoteKnowledgeFile = buildRemoteKnowledgeFile(remoteItems);
  }
  if (remoteKnowledgeFile) initialFiles.push(remoteKnowledgeFile);

  let logs = restoringOutlineSelection
    ? [...(Array.isArray(storedPlan.outlineGenerationTask?.logs) ? storedPlan.outlineGenerationTask.logs : []), '已恢复一级目录确认状态']
    : ['开始生成一级目录'];
  let currentProgress = restoringOutlineSelection ? Number(storedPlan.outlineGenerationTask?.progress || 30) : 10;
  const initialCheckpoint = checkpointTask({ status: 'running', progress: currentProgress, logs });
  let task = initialCheckpoint.task;
  const templateTaskId = `${task.task_id}-template`;
  let lockedRoots = [];
  let scorePlan = null;
  let scoreDirectoryPlan = null;
  let scoreCoverageMap = null;
  let allowRootChanges = false;
  let finalOutline = null;
  let actualLeafCount = 0;
  let outlineReview = null;

  function updateAgentState(partial = {}, taskPatch = {}) {
    const checkpoint = checkpointTask({
      ...taskPatch,
      stats: {
        ...(task.stats || {}),
        ...(taskPatch.stats || {}),
        agent: {
          ...(task.stats?.agent || {}),
          task_key: OUTLINE_AGENT_TASK_KEY,
          run_id: task.task_id,
          resume_payload: {
            reference_knowledge_document_ids: referenceDocumentIds,
            outline_mode: storedPlan.outlineMode,
            outline_expansion_mode: storedPlan.outlineExpansionMode,
            word_control_options: wordControlOptions,
          },
          ...partial,
        },
      },
    });
    task = checkpoint.task;
  }

  function publish(message, progress, statsPatch = {}) {
    const text = String(message || '').trim();
    if (text && text !== logs[logs.length - 1]) logs = [...logs, text];
    currentProgress = Math.max(currentProgress, progress || currentProgress);
    task = updateTask({
      status: 'running',
      progress: currentProgress,
      logs,
      stats: { ...(task.stats || {}), ...statsPatch },
    });
  }

  function publishAgentActivity(event = {}) {
    const title = formatProgressTitle(event.message);
    if (!title || event.visible === false) return;
    publish(title, Math.max(currentProgress, 20));
  }

  function syncAgentCheckpoint(checkpoint) {
    updateAgentState({
      status: checkpoint.status,
      phase: checkpoint.phase,
      agent_connection: checkpoint.agent_connection,
      session_file: checkpoint.session_file,
    });
  }

  function publishTemplateAgentActivity(event = {}) {
    const title = formatProgressTitle(event.message);
    if (!title || event.visible === false) return;
    publish(`投标模版：${title}`, Math.max(currentProgress, 35));
  }

  function syncTemplateAgentCheckpoint(checkpoint) {
    const next = checkpointTask({
      stats: {
        ...(task.stats || {}),
        template_agent: {
          ...(task.stats?.template_agent || {}),
          task_key: TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
          run_id: templateTaskId,
          status: checkpoint.status,
          phase: checkpoint.phase,
          agent_connection: checkpoint.agent_connection,
          session_file: checkpoint.session_file,
        },
      },
    });
    task = next.task;
  }

  function applyConfirmedSelection(confirmed) {
    const selectedIdSet = new Set(confirmed.selectedIds);
    lockedRoots = renumberOutline(confirmed.items.filter((item) => selectedIdSet.has(item.id)));
    const checkpoint = checkpointTask({
      stats: {
        ...(task.stats || {}),
        outline_selection: {
          items: confirmed.items,
          selected_ids: confirmed.selectedIds,
          confirmed: true,
        },
      },
    });
    task = checkpoint.task;
  }

  function continueWithChildrenGeneration() {
    publish('技术方案目录已确认，开始生成子目录', 55, {
      outline: {
        phase: 'generating',
        current_leaf_count: 0,
        suggested_leaf_count: targetLeafCount,
        leaf_count_advisory_only: true,
      },
    });
    return {
      stage: 'children_generation',
      message: 'Agent 正在生成子目录',
      prompt: createChildrenPrompt({ hasOriginalPlan, originalOnly, targetLeafCount, allowRootChanges, standaloneTechnical }),
      files: [
        { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify({ outline: lockedRoots }, null, 2) },
        {
          path: 'outline-capacity-reference.json',
          content: JSON.stringify(buildCapacityReference(wordControlOptions), null, 2),
        },
      ],
    };
  }

  function continueWithOutlineReview() {
    const preReviewValidation = validateFinalOutline({
      outline: finalOutline,
      scorePlan,
      scoreCoverageMap,
    });
    const reviewContext = {
      ...buildOutlineReviewContext({ outline: finalOutline, scoreDirectoryPlan, targetLeafCount }),
      mandatory_issues: preReviewValidation.mandatoryIssues,
    };
    publish('子目录生成完成，正在准备最终审核', 88, {
      outline: {
        phase: 'reviewing',
        current_leaf_count: actualLeafCount,
        suggested_leaf_count: targetLeafCount,
        leaf_count_advisory_only: true,
      },
    });
    return {
      stage: 'outline_review',
      message: 'Agent 正在审核并修复目录',
      prompt: createOutlineReviewPrompt({ targetLeafCount, actualLeafCount, allowRootChanges }),
      files: [
        { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify(finalOutline, null, 2) },
        { path: TECHNICAL_SCORE_GROUPS_FILE, content: JSON.stringify(scorePlan, null, 2) },
        { path: SCORE_DIRECTORY_PLAN_FILE, content: JSON.stringify(scoreDirectoryPlan, null, 2) },
        { path: SCORE_COVERAGE_MAP_FILE, content: JSON.stringify(scoreCoverageMap, null, 2) },
        { path: OUTLINE_REVIEW_CONTEXT_FILE, content: JSON.stringify(reviewContext, null, 2) },
      ],
    };
  }

  if (!restoringOutlineSelection) {
    updateAgentState({ status: 'running', phase: 'initial-outline', agent_connection: 'running', session_file: '' });
    const initialResult = await agentService.runTask({
      task_id: task.task_id,
      title: '技术方案一级目录生成',
      prompt: createInitialPrompt(taskInstruction, { standaloneTechnical }),
      output_file: OUTLINE_OUTPUT_FILE,
      files: initialFiles,
      signal: taskControl.signal,
      persistent_task: {
        task_key: OUTLINE_AGENT_TASK_KEY,
        mode: 'create',
      },
      initial_stage: 'initial-outline',
      initial_stage_index: 0,
      json_validation_schemas: jsonValidationSchemas,
      max_retries: 0,
      onActivity: publishAgentActivity,
      onCheckpoint: syncAgentCheckpoint,
    });
    const generated = readJson(initialResult.output_content, OUTLINE_OUTPUT_FILE);
    const items = generated.outline || [];
    const defaultSelectedIds = items.filter((item) => item.attr === '技术').map((item) => item.id);
    const selection = { items, selected_ids: defaultSelectedIds, confirmed: false };
    const waitingMessage = '一级目录已生成，等待用户确认';
    if (waitingMessage !== logs[logs.length - 1]) logs = [...logs, waitingMessage];
    currentProgress = Math.max(currentProgress, 30);
    agentService.updatePersistentTask(OUTLINE_AGENT_TASK_KEY, {
      status: 'waiting-outline-selection',
      phase: 'outline-selection',
      agent_connection: 'idle',
      error: null,
    });
    updateAgentState(
      { status: 'waiting-outline-selection', phase: 'outline-selection', agent_connection: 'idle' },
      {
        status: 'running',
        progress: currentProgress,
        logs,
        stats: { outline_selection: selection },
      },
    );
  }

  const confirmed = await taskControl.waitForOutlineSelection();
  applyConfirmedSelection(confirmed);
  const extractTemplate =
    !standaloneTechnical && Boolean(aiService?.isDeveloperMode?.());

  publish(
    extractTemplate
      ? '一级目录已确认，目录生成与投标模版提取并行开始'
      : standaloneTechnical
        ? '一级目录已确认，已跳过投标模版提取，开始生成技术文件目录'
        : '一级目录已确认，开始生成完整目录',
    35,
  );

  try {
  updateAgentState({ status: 'running', phase: 'score-planning', agent_connection: 'idle' });
  agentService.updatePersistentTask(OUTLINE_AGENT_TASK_KEY, {
    status: 'running',
    phase: 'score-planning',
    agent_connection: 'idle',
  });

  if (extractTemplate && workspaceStore.listTenderSourceDocxRelativePaths().length) {
    await ordinaryAgentService.forkPersistentTask(
      OUTLINE_AGENT_TASK_KEY,
      TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
      {
        run_id: templateTaskId,
        title: '投标模版提取',
        status: 'created',
        phase: 'template-extraction',
        agent_connection: 'idle',
      },
    );
  }

  const parallelController = new AbortController();
  const parallelSignal = AbortSignal.any([taskControl.signal, parallelController.signal]);
  let firstParallelFailure = null;
  const observeParallelBranch = (label, promise) => promise.catch((error) => {
    if (!firstParallelFailure && !taskControl.signal.aborted) {
      firstParallelFailure = { label, error };
      const reason = new Error(`${label}失败，已取消同级任务`);
      reason.code = 'TASK_CANCELLED';
      parallelController.abort(reason);
    }
    throw error;
  });

  const templatePromise = extractTemplate
    ? runTemplateExtractionTask({
        agentService: ordinaryAgentService,
        workspaceStore,
        openXmlHelperService,
        taskId: templateTaskId,
        outline: lockedRoots,
        signal: parallelSignal,
        onActivity: publishTemplateAgentActivity,
        onCheckpoint: syncTemplateAgentCheckpoint,
      })
    : null;

  const directoryPromise = agentService.runTask({
    task_id: task.task_id,
    title: '技术方案目录生成 V2',
    prompt: createScorePlanningPrompt({ standaloneTechnical, hasRemoteKnowledge: Boolean(remoteKnowledgeFile) }),
    output_file: OUTLINE_OUTPUT_FILE,
    files: [
      { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify({ outline: lockedRoots }, null, 2) },
      { path: '技术评分信息.md', content: storedPlan.techRequirements || '' },
      ...knowledgeFiles,
      ...(remoteKnowledgeFile ? [remoteKnowledgeFile] : []),
    ],
    signal: parallelSignal,
    persistent_task: {
      task_key: OUTLINE_AGENT_TASK_KEY,
      mode: 'resume',
    },
    initial_stage: 'score-planning',
    initial_stage_index: 2,
    json_validation_schemas: jsonValidationSchemas,
    max_retries: 0,
    onActivity: publishAgentActivity,
    onCheckpoint: syncAgentCheckpoint,
    continueTask: async (candidate, meta) => {
      if (meta.workflow_stage === 'outline_review') {
        const reviewedOutline = readJson(candidate.output_content, OUTLINE_OUTPUT_FILE);
        const normalizedReviewedOutline = buildFinalOutline(reviewedOutline);
        outlineReview = readJson(await meta.readFile(OUTLINE_REVIEW_FILE), OUTLINE_REVIEW_FILE);
        scoreCoverageMap = readJson(await meta.readFile(SCORE_COVERAGE_MAP_FILE), SCORE_COVERAGE_MAP_FILE);
        finalOutline = normalizedReviewedOutline;
        scoreDirectoryPlan = synchronizeScoreDirectoryPlan(scoreDirectoryPlan, finalOutline.outline);
        actualLeafCount = countAiLeaves(finalOutline.outline);
        const finalValidation = validateFinalOutline({
          outline: finalOutline,
          scorePlan,
          scoreCoverageMap,
        });
        if (!finalValidation.valid) {
          const details = finalValidation.mandatoryIssues.map((issue) => issue.message).join('；');
          throw new Error(`目录最终校验未通过：${details}`);
        }
        await meta.writeFiles([
          { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify(finalOutline, null, 2) },
          { path: SCORE_DIRECTORY_PLAN_FILE, content: JSON.stringify(scoreDirectoryPlan, null, 2) },
          { path: SCORE_COVERAGE_MAP_FILE, content: JSON.stringify(scoreCoverageMap, null, 2) },
        ]);
        const reviewMessage = outlineReview.status === 'passed'
          ? '目录审核通过'
          : outlineReview.status === 'simple_fix'
            ? '目录审核完成，Agent 已自动微调简单问题'
            : outlineReview.status === 'user_feedback'
              ? '目录审核完成，已按用户反馈修复'
              : '目录审核完成，用户选择保留当前目录';
        publish(reviewMessage, 95, {
          outline: {
            phase: 'reviewing',
            current_leaf_count: actualLeafCount,
            suggested_leaf_count: targetLeafCount,
            leaf_count_advisory_only: true,
          },
        });
        return { complete: true };
      }

      if (meta.workflow_stage === 'score-planning') {
        scorePlan = readJson(await meta.readFile(TECHNICAL_SCORE_GROUPS_FILE), TECHNICAL_SCORE_GROUPS_FILE);
        scoreDirectoryPlan = readJson(await meta.readFile(SCORE_DIRECTORY_PLAN_FILE), SCORE_DIRECTORY_PLAN_FILE);
        lockedRoots = attachBranchIdsToRoots(lockedRoots, scoreDirectoryPlan);
        allowRootChanges = scoreDirectoryPlan.allow_root_changes === true;
        return continueWithChildrenGeneration();
      }

      const candidateOutline = readJson(candidate.output_content, OUTLINE_OUTPUT_FILE);
      finalOutline = buildFinalOutline(candidateOutline);
      scoreDirectoryPlan = synchronizeScoreDirectoryPlan(scoreDirectoryPlan, finalOutline.outline);
      actualLeafCount = countAiLeaves(finalOutline.outline);
      scoreCoverageMap = readJson(await meta.readFile(SCORE_COVERAGE_MAP_FILE), SCORE_COVERAGE_MAP_FILE);
      return continueWithOutlineReview();
    },
  });

  let directoryReturned = false;
  let templateReturned = !extractTemplate;
  const observedDirectoryPromise = observeParallelBranch('目录生成', directoryPromise).finally(() => {
    directoryReturned = true;
    if (extractTemplate && !templateReturned) publish('目录生成任务已返回，正在等待投标模版提取任务', 95);
  });

  let agentResult;
  let templateResult = null;
  if (extractTemplate) {
    const observedTemplatePromise = observeParallelBranch('投标模版提取', templatePromise).finally(() => {
      templateReturned = true;
      if (!directoryReturned) publish('投标模版提取任务已返回，正在等待目录生成任务', Math.max(currentProgress, 60));
    });
    const [directorySettled, templateSettled] = await Promise.allSettled([
      observedDirectoryPromise,
      observedTemplatePromise,
    ]);
    if (directorySettled.status === 'rejected' || templateSettled.status === 'rejected') {
      try { workspaceStore.clearBidTemplate(); } catch {}
      if (firstParallelFailure) {
        const failure = new Error(`${firstParallelFailure.label}失败：${firstParallelFailure.error?.message || String(firstParallelFailure.error)}`);
        if (firstParallelFailure.error?.code) failure.code = firstParallelFailure.error.code;
        throw failure;
      }
      const directoryError = directorySettled.status === 'rejected' ? directorySettled.reason : null;
      const templateError = templateSettled.status === 'rejected' ? templateSettled.reason : null;
      const messages = [
        directoryError ? `目录生成失败：${directoryError?.message || String(directoryError)}` : '',
        templateError ? `投标模版提取失败：${templateError?.message || String(templateError)}` : '',
      ].filter(Boolean);
      throw new Error(messages.join('；') || '目录生成未完成');
    }

    agentResult = directorySettled.value;
    templateResult = templateSettled.value;
    if (templateResult.status !== 'skipped' && !workspaceStore.hasBidTemplate()) {
      try { workspaceStore.clearBidTemplate(); } catch {}
      throw new Error('投标模版提取任务已返回，但模版和字段清单不完整');
    }
    publish(
      templateResult.status === 'skipped'
        ? '目录生成完成，当前无招标 Word 原件，已跳过投标模版提取'
        : `目录生成与投标模版提取均已完成，共标记 ${templateResult.field_count || 0} 个字段`,
      98,
    );
  } else {
    agentResult = await observedDirectoryPromise;
    publish('目录生成完成', 98);
  }

  if (!finalOutline) {
    throw new Error('目录最终校验未执行，未保存 Agent 直接返回的目录');
  }
  const persistedFinalOutline = stripOutlineInternalFields(finalOutline);
  const completionLog = !extractTemplate
    ? '目录生成与审核完成'
    : templateResult.status === 'skipped'
      ? '目录生成与审核完成，当前无招标 Word 原件'
      : `目录生成、审核与投标模版提取完成，共标记 ${templateResult.field_count || 0} 个字段`;
  const finalLogs = [
    ...logs,
    completionLog,
  ];
  const finalTaskPatch = {
    status: 'success',
    progress: 100,
    error: undefined,
    logs: finalLogs,
    stats: {
      ...(task.stats || {}),
      outline: {
        phase: 'done',
        current_leaf_count: actualLeafCount,
        suggested_leaf_count: targetLeafCount,
        leaf_count_advisory_only: true,
        leaf_counts_by_mode: countLeavesByMode(finalOutline.outline),
      },
      score_coverage_map: scoreCoverageMap,
      ...(extractTemplate ? {
        template_agent: {
          ...(task.stats?.template_agent || {}),
          task_key: TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
          run_id: templateTaskId,
          status: templateResult.status,
          phase: templateResult.status === 'skipped' ? 'skipped' : 'completed',
          agent_connection: 'idle',
          field_count: templateResult.field_count || 0,
          ...(templateResult.session_id ? { session_id: templateResult.session_id } : {}),
        },
      } : { template_agent: undefined }),
    },
  };
  const finalCheckpoint = checkpointTask(finalTaskPatch, {
    bidTemplateExists: !standaloneTechnical && workspaceStore.hasBidTemplate(),
    outlineData: { ...persistedFinalOutline, project_overview: storedPlan.projectOverview || '' },
    outlineWordControlSnapshot: wordControlOptions,
    contentGenerationTask: undefined,
    contentGenerationSections: {},
    contentGenerationPlans: {},
    contentGenerationRuntime: undefined,
    contentIllustrationPlan: undefined,
  });
  task = finalCheckpoint.task;
  agentService.updatePersistentTask(OUTLINE_AGENT_TASK_KEY, {
    status: 'success',
    phase: 'completed',
    agent_connection: 'idle',
    error: null,
    completed_at: new Date().toISOString(),
  });
  } catch (error) {
    const message = error?.message || String(error);
    const status = taskControl.signal.aborted || error?.code === 'AGENT_DISCONNECTED'
      ? 'interrupted'
      : 'error';
    try {
      updateAgentState({
        status,
        agent_connection: 'idle',
        error: message,
      });
    } catch {}
    try {
      agentService.updatePersistentTask(OUTLINE_AGENT_TASK_KEY, {
        status,
        agent_connection: 'idle',
        error: message,
      });
    } catch {}
    try { workspaceStore.clearBidTemplate(); } catch {}
    throw error;
  }
}

module.exports = {
  runOutlineGenerationTaskV2,
  MAX_OUTLINE_DEPTH,
  OUTLINE_OUTPUT_FILE,
  OUTLINE_JSON_SCHEMA,
  TECHNICAL_SCORE_GROUPS_SCHEMA,
  SCORE_DIRECTORY_PLAN_SCHEMA,
  SCORE_COVERAGE_MAP_SCHEMA,
  buildFinalOutline,
  stripOutlineInternalFields,
  readJson,
  formatProgressTitle,
  createInitialPrompt,
  createScorePlanningPrompt,
  createChildrenPrompt,
  buildCapacityReference,
  buildOutlineReviewContext,
  validateFinalOutline,
  buildRemoteKnowledgeFile,
};
