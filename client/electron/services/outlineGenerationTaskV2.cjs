const {
  OUTLINE_AGENT_TASK_KEY,
  TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
} = require('./outlineGenerationAgentV2Config.cjs');
const { isDeepStrictEqual } = require('node:util');
const { planRemoteKnowledgeQueries } = require('./remoteKnowledgeQueryPlanner.cjs');
const { runTemplateExtractionTask } = require('./templateExtractionTask.cjs');
const { normalizeOutlineHeadingTitles } = require('./mandatoryBidContentRules.cjs');

const DEFAULT_ESTIMATED_SECTION_WORDS = 1500;
const OUTLINE_OUTPUT_FILE = 'outline.json';
const TECHNICAL_SCORE_GROUPS_FILE = 'technical-score-groups.json';
const SCORE_DIRECTORY_PLAN_FILE = 'score-directory-plan.json';
const SCORE_COVERAGE_MAP_FILE = 'score-coverage-map.json';
const LEAF_ALLOCATION_FILE = 'leaf-allocation.json';
const LEAF_ALLOCATION_CONTEXT_FILE = 'leaf-allocation-context.json';
const OUTLINE_REVIEW_FILE = 'outline-review.json';
const OUTLINE_REVIEW_CONTEXT_FILE = 'outline-review-context.json';
const AI_CONTENT_MODE = 'ai-generate';
const CONTENT_MODES = ['ai-generate', 'template-fill', 'point-to-point', 'other'];
const MAX_OUTLINE_REVIEW_CORRECTIONS = 2;
const MAX_OUTLINE_DEPTH = 7;
const REMOTE_REFERENCE_RULE = '远程知识仅是参考材料。招标文件、用户已确认信息和原方案优先；不得从参考材料新增未获批准的同层级评分项，不得在最终目录中输出内部来源标识。';

function createDirectoryNodeSchema(level, root = false, working = false) {
  const baseProperties = {
    id: { type: 'string', pattern: `^[1-9]\\d*(?:\\.[1-9]\\d*){${level - 1}}$` },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    ...(root ? {
      attr: { type: 'string', enum: ['通用', '商务', '资信', '技术', '其他'] },
      branch_id: { type: 'string', minLength: 1 },
    } : {}),
    ...(working ? { origin_id: { type: 'string', minLength: 1 } } : {}),
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
          minItems: 1,
          items: createDirectoryNodeSchema(level + 1, false, working),
        },
      },
    };
    return { oneOf: [leafSchema, branchSchema] };
  }
  return leafSchema;
}

const ROOT_NODE_SCHEMA = createDirectoryNodeSchema(1, true);
const WORKING_ROOT_NODE_SCHEMA = createDirectoryNodeSchema(1, true, true);

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

const OUTLINE_WORKING_JSON_SCHEMA = {
  ...OUTLINE_JSON_SCHEMA,
  properties: {
    outline: {
      ...OUTLINE_JSON_SCHEMA.properties.outline,
      items: WORKING_ROOT_NODE_SCHEMA,
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
        required: ['requirement_id', 'source_title', 'target_title', 'source_order', 'expected_path', 'source_number', 'parent_number', 'parent_name', 'parent_type', 'hierarchy_evidence_type', 'hierarchy_evidence', 'criteria'],
        additionalProperties: false,
        properties: {
          requirement_id: { type: 'string', pattern: '^R[1-9]\\d*$' },
          source_title: { type: 'string', minLength: 1 },
          target_title: { type: 'string', minLength: 1 },
          source_order: { type: 'integer', minimum: 1 },
          expected_path: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          source_number: { type: ['string', 'null'] },
          parent_number: { type: ['string', 'null'] },
          parent_name: { type: ['string', 'null'] },
          parent_type: { type: 'string', enum: ['score-container', 'business-group', 'none'] },
          hierarchy_evidence_type: { type: 'string', enum: ['merged-cell', 'numbering', 'parent-row', 'subtotal-row', 'none'] },
          hierarchy_evidence: { type: ['string', 'null'] },
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
            enum: ['leaf-count', 'score-coverage', 'duplicate-directory', 'professional-structure'],
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

function createLeafAllocationSchema(minimumLeafCount = 2) {
  return {
    oneOf: [
      {
        type: 'object',
        required: ['mode', 'target_ai_leaf_count', 'fixed_ai_leaf_count', 'allocatable_ai_leaf_count', 'allocations'],
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['allocated'] },
          target_ai_leaf_count: { type: 'integer', minimum: 1 },
          fixed_ai_leaf_count: { type: 'integer', minimum: 0 },
          allocatable_ai_leaf_count: { type: 'integer', minimum: 1 },
          allocations: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['branch_id', 'leaf_count'],
              additionalProperties: false,
              properties: {
                branch_id: { type: 'string', minLength: 1 },
                leaf_count: { type: 'integer', minimum: minimumLeafCount },
              },
            },
          },
        },
      },
      {
        type: 'object',
        required: ['mode', 'target_ai_leaf_count', 'fixed_ai_leaf_count', 'allocatable_ai_leaf_count', 'allocations'],
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['agent-decides'] },
          target_ai_leaf_count: { type: 'null' },
          fixed_ai_leaf_count: { type: 'integer', minimum: 0 },
          allocatable_ai_leaf_count: { type: 'null' },
          allocations: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['branch_id'],
              additionalProperties: false,
              properties: {
                branch_id: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    ],
  };
}

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

function deriveStrictMaximumLeafCount(options) {
  if (!options?.strictSectionWords || options.maximumWords <= 0 || options.sectionWords <= 0) return null;
  const sectionMinimumWords = Math.ceil(options.sectionWords * 0.8);
  return Math.floor(options.maximumWords / sectionMinimumWords);
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

// 总字数仅作为目录颗粒度的软约束，允许 Agent 在目标附近优先保证专业结构完整。
function deriveAcceptableLeafRange(targetLeafCount, { soft = false, maximum = null } = {}) {
  if (targetLeafCount === null) return { minimum: null, maximum: null };
  const tolerance = soft ? Math.max(2, Math.ceil(targetLeafCount * 0.1)) : 2;
  const upperBound = Number.isInteger(maximum) && maximum > 0
    ? Math.min(targetLeafCount + tolerance, maximum)
    : targetLeafCount + tolerance;
  return {
    minimum: Math.max(1, targetLeafCount - tolerance),
    maximum: upperBound,
  };
}

// 每个评分条目至少包含两个评分要点，并为其中需要继续展开的要点预留正文小节。
function deriveSemanticMinimumLeafTarget(scoreDirectoryPlan, fixedAiLeafCount = 0) {
  const mappedScoreItemCount = (scoreDirectoryPlan?.branches || []).reduce((total, branch) => {
    const uniqueTitles = new Set((branch?.mappings || []).flatMap((mapping) => [
      mapping?.target_title,
      ...(Array.isArray(mapping?.additional_titles) ? mapping.additional_titles : []),
    ]).map((title) => String(title || '').trim()).filter(Boolean));
    return total + uniqueTitles.size;
  }, 0);
  return Math.max(0, Number(fixedAiLeafCount) || 0) + (mappedScoreItemCount * 3);
}

function isLeafCountWithinRange(targetLeafCount, actualLeafCount, options) {
  if (targetLeafCount === null) return true;
  const range = deriveAcceptableLeafRange(targetLeafCount, options);
  return actualLeafCount >= range.minimum && actualLeafCount <= range.maximum;
}

// 独立成册时兼顾技术分支覆盖与评分条目的递进展开下限。
function enforceMinimumLeafTarget(targetLeafCount, fixedAiLeafCount, technicalBranchCount, wordControlOptions = {}, semanticMinimumLeafCount = 0) {
  if (targetLeafCount === null) return null;
  const minimumLeafCount = Math.max(fixedAiLeafCount + technicalBranchCount, semanticMinimumLeafCount);
  const adjustedTarget = Math.max(targetLeafCount, minimumLeafCount);
  if (wordControlOptions.strictSectionWords && wordControlOptions.maximumWords > 0) {
    const sectionMinimumWords = Math.ceil(wordControlOptions.sectionWords * 0.8);
    const maximumLeafCount = Math.floor(wordControlOptions.maximumWords / sectionMinimumWords);
    if (maximumLeafCount < minimumLeafCount) {
      throw new Error(
        `当前严格字数配置最多容纳 ${maximumLeafCount} 个 AI 生成小节，但独立成册目录至少需要 ${minimumLeafCount} 个。请提高全文最大字数、降低单节字数或减少技术评分分支后重新生成目录。`,
      );
    }
    return Math.min(adjustedTarget, maximumLeafCount);
  }
  return adjustedTarget;
}

function buildCapacityReference(value) {
  return {
    suggested_ai_leaf_count: deriveTargetLeafCount(normalizeWordControlOptions(value)),
    advisory_only: true,
  };
}

// 统一目录层级编号，并按父子节点形态整理目录字段。
function renumberOutline(items, prefix = '', preserveOriginIds = false) {
  return (items || []).map((item, index) => {
    const id = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    const hasChildren = Array.isArray(item?.children) && item.children.length;
    const next = {
      id,
      title: cleanScoreHierarchyTitle(item?.title),
      description: String(item?.description || '').trim(),
      ...(prefix ? {} : { attr: item?.attr }),
      ...(!prefix && String(item?.branch_id || '').trim() ? { branch_id: String(item.branch_id).trim() } : {}),
      ...(preserveOriginIds && String(item?.origin_id || '').trim() ? { origin_id: String(item.origin_id).trim() } : {}),
      ...(!hasChildren ? {
        content_mode: item?.content_mode,
        ...(item?.content_mode === 'other' && String(item?.content_mode_note || '').trim()
          ? { content_mode_note: String(item.content_mode_note).trim() }
          : {}),
      } : {}),
    };
    if (hasChildren) {
      next.children = renumberOutline(item.children, id, preserveOriginIds);
    }
    return next;
  });
}

// 接受 Agent 的完整目录结果，并统一整理层级编号和节点字段。
function buildFinalOutline(candidate, { preserveOriginIds = false } = {}) {
  return { outline: renumberOutline(candidate?.outline || [], '', preserveOriginIds) };
}

// 移除仅供 Agent 工作流关联分支的内部字段，再写入正式业务目录。
function stripOutlineInternalFields(candidate) {
  const strip = (items) => (items || []).map((item) => {
    const { branch_id: _branchId, origin_id: _originId, children, ...rest } = item || {};
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

// 独立成册模式的最终审核不得改写已经确认的评分规划。
function mergeReviewedScoreDirectoryPlan(confirmedPlan, reviewedPlan, { standaloneTechnical = false } = {}) {
  if (!standaloneTechnical) return confirmedPlan;

  const confirmedSnapshot = JSON.parse(JSON.stringify(confirmedPlan));
  const reviewedSnapshot = JSON.parse(JSON.stringify(reviewedPlan));
  if (!isDeepStrictEqual(confirmedSnapshot, reviewedSnapshot)) {
    throw new Error('目录最终审核不得修改已确认的评分规划');
  }
  return confirmedPlan;
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
          result.single_child_nodes.push({
            id: item.id,
            origin_id: item.origin_id,
            title: item.title,
            child_count: children.length,
            child_id: children[0]?.id || '',
            child_origin_id: children[0]?.origin_id || '',
          });
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
    const matchingRoots = (items || []).filter((item) => item?.branch_id === branch.branch_id);
    const root = matchingRoots[0];
    const expectedTitles = [
      ...(branch.mappings || []).flatMap((mapping) => [mapping.target_title, ...(mapping.additional_titles || [])]),
      ...extraTitles.filter((item) => item.branch_id === branch.branch_id).map((item) => item.title),
    ].filter(Boolean);
    const uniqueExpectedTitles = [...new Set(expectedTitles)];
    const actualNodes = root ? collectNodesAtLevel(root, 1, branch.score_item_level) : [];
    const actualTitles = actualNodes.map((item) => item.title);
    const duplicateTitles = [...new Set(actualTitles.filter((title, index) => actualTitles.indexOf(title) !== index))];
    const actualTitleSet = new Set(actualTitles);
    const expectedTitleSet = new Set(uniqueExpectedTitles);
    return {
      branch_id: branch.branch_id,
      planned_root_id: branch.root_id,
      current_root_id: root?.id || '',
      root_title: root?.title || branch.root_title,
      score_item_level: branch.score_item_level,
      root_found: Boolean(root),
      root_count: matchingRoots.length,
      duplicate_root_ids: matchingRoots.length > 1 ? matchingRoots.map((item) => item.id) : [],
      expected_titles: uniqueExpectedTitles,
      actual_titles: actualTitles,
      missing_titles: uniqueExpectedTitles.filter((title) => !actualTitleSet.has(title)),
      unexpected_titles: actualTitles.filter((title) => !expectedTitleSet.has(title)),
      duplicate_titles: duplicateTitles,
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
      && branch.root_count === 1
      && branch.missing_titles.length === 0
      && branch.unexpected_titles.length === 0
      && branch.duplicate_titles.length === 0
    )),
    branches,
  };
}

function collectTitleStyleIssues(items, excludedNodeIds = new Set()) {
  const issues = [];
  const leadingFillerPattern = /^(?:对(?:.+的(?:理解|分析|说明|阐述|介绍)|(?:本|该)?(?:项目|工程|方案|需求|技术要求|服务要求|实施要求|建设要求|采购要求|招标要求|施工组织|质量控制|进度控制|安全管理|运维服务).*(?:理解|分析|说明|阐述|介绍))$|根据|依据|结合(?!部)|围绕|按照|针对(?!性))/;
  const trailingFillerPattern = /(?:进行|予以)(?:分析|说明|阐述|介绍|评审|打分)$/;
  const scoringSentencePattern = /(?:进行评审|进行打分|得\d+(?:\.\d+)?分)/;
  const visit = (nodes) => {
    (nodes || []).forEach((item) => {
      const title = String(item?.title || '').trim();
      if (!excludedNodeIds.has(item?.id)
        && (leadingFillerPattern.test(title) || trailingFillerPattern.test(title) || scoringSentencePattern.test(title))) {
        issues.push({ id: item.id, title });
      }
      visit(item?.children);
    });
  };
  visit(items);
  return issues;
}

// 同一父节点下大量使用“甲与乙”通常是模型机械压缩标题，而不是人工目录的自然表达。
function collectMechanicalConnectorGroups(items, { currentDepth = 1, excludedChildDepth = null } = {}) {
  const groups = [];
  const visit = (nodes, depth) => {
    (nodes || []).forEach((item) => {
      const children = Array.isArray(item?.children) ? item.children : [];
      if (children.length >= 3 && depth + 1 !== excludedChildDepth) {
        const connectorTitleCount = children.filter((child) => String(child?.title || '').includes('与')).length;
        if (connectorTitleCount >= 3 && connectorTitleCount / children.length >= 0.6) {
          groups.push({
            id: item?.id || '',
            title: item?.title || '',
            child_count: children.length,
            connector_title_count: connectorTitleCount,
          });
        }
      }
      visit(children, depth + 1);
    });
  };
  visit(items, currentDepth);
  return groups;
}

// 评分条目下面先展开评分要点，评分要点再展开为可以独立编写的正文小节。
function collectProfessionalStructure(items, scoreDirectoryPlan, { enabled = false } = {}) {
  const underexpandedScoreNodes = [];
  const shallowScoreNodes = [];
  const invalidScoreItemLevels = [];
  const unplannedRootNodes = [];
  const duplicateBranchRoots = [];
  const mechanicalConnectorGroups = [];
  const sourceTitleNodeIds = new Set();
  if (!enabled) {
    return {
      valid: true,
      underexpanded_score_nodes: [],
      shallow_score_nodes: [],
      invalid_score_item_levels: [],
      unplanned_root_nodes: [],
      duplicate_branch_roots: [],
      mechanical_connector_groups: [],
      title_style_issues: [],
    };
  }
  const rootsByBranchId = new Map();
  (items || []).forEach((item) => {
    const branchId = String(item?.branch_id || '').trim();
    if (!branchId) return;
    const branchRoots = rootsByBranchId.get(branchId) || [];
    branchRoots.push(item);
    rootsByBranchId.set(branchId, branchRoots);
  });
  const plannedBranchIds = new Set((scoreDirectoryPlan?.branches || []).map((branch) => branch.branch_id));
  (items || []).forEach((root) => {
    if (!root?.branch_id || !plannedBranchIds.has(root.branch_id)) {
      unplannedRootNodes.push({ id: root?.id || '', title: root?.title || '', branch_id: root?.branch_id || '' });
    }
  });
  rootsByBranchId.forEach((roots, branchId) => {
    if (plannedBranchIds.has(branchId) && roots.length > 1) {
      duplicateBranchRoots.push({ branch_id: branchId, root_ids: roots.map((root) => root.id) });
    }
  });

  (scoreDirectoryPlan?.branches || []).forEach((branch) => {
    if (branch.score_item_level > 4) {
      invalidScoreItemLevels.push({ branch_id: branch.branch_id, score_item_level: branch.score_item_level });
      return;
    }
    const root = rootsByBranchId.get(branch.branch_id)?.[0];
    if (!root) return;
    const scoreNodes = collectNodesAtLevel(root, 1, branch.score_item_level);
    mechanicalConnectorGroups.push(...collectMechanicalConnectorGroups([root], {
      currentDepth: 1,
      excludedChildDepth: branch.score_item_level,
    }));
    const scoreNodesByTitle = new Map(scoreNodes.map((item) => [item.title, item]));
    const expectedTitles = (branch.mappings || []).flatMap((mapping) => [
      mapping.target_title,
      ...(mapping.additional_titles || []),
    ]).filter(Boolean);

    expectedTitles.forEach((title) => {
      const scoreNode = scoreNodesByTitle.get(title);
      if (!scoreNode) return;
      sourceTitleNodeIds.add(scoreNode.id);
      const details = Array.isArray(scoreNode.children) ? scoreNode.children : [];
      if (details.length < 2) {
        underexpandedScoreNodes.push({ id: scoreNode.id, title: scoreNode.title, child_count: details.length });
        return;
      }
      const expandedDetails = details.filter((detail) => Array.isArray(detail?.children) && detail.children.length >= 2);
      if (!expandedDetails.length) {
        shallowScoreNodes.push({ id: scoreNode.id, title: scoreNode.title, detail_count: details.length });
      }
    });
  });

  const titleStyleIssues = collectTitleStyleIssues(items, sourceTitleNodeIds);
  return {
    valid: underexpandedScoreNodes.length === 0
      && shallowScoreNodes.length === 0
      && invalidScoreItemLevels.length === 0
      && unplannedRootNodes.length === 0
      && duplicateBranchRoots.length === 0
      && mechanicalConnectorGroups.length === 0
      && titleStyleIssues.length === 0,
    underexpanded_score_nodes: underexpandedScoreNodes,
    shallow_score_nodes: shallowScoreNodes,
    invalid_score_item_levels: invalidScoreItemLevels,
    unplanned_root_nodes: unplannedRootNodes,
    duplicate_branch_roots: duplicateBranchRoots,
    mechanical_connector_groups: mechanicalConnectorGroups,
    title_style_issues: titleStyleIssues,
  };
}

// 生成供最终 Agent 审核直接采用的宿主程序确定性检查结果。
function buildOutlineReviewContext({
  outline,
  scoreDirectoryPlan,
  targetLeafCount,
  standaloneTechnical = false,
  acceptedLeafCount = null,
  maximumLeafCount = null,
}) {
  const items = outline?.outline || [];
  const leafCounts = countLeavesByMode(items);
  const structure = collectOutlineStructure(items);
  const sourceRequiredSingletonRootIds = new Set(
    standaloneTechnical
      ? (scoreDirectoryPlan?.branches || [])
        .filter((branch) => branch.score_item_level > 1 && branch.mappings?.length === 1)
        .map((branch) => branch.root_id)
      : [],
  );
  const singleChildNodes = structure.single_child_nodes
    .filter((node) => !sourceRequiredSingletonRootIds.has(node.id));
  const acceptableRange = deriveAcceptableLeafRange(targetLeafCount, {
    soft: standaloneTechnical,
    maximum: maximumLeafCount,
  });
  const withinAcceptableRange = isLeafCountWithinRange(targetLeafCount, leafCounts[AI_CONTENT_MODE], {
    soft: standaloneTechnical,
    maximum: maximumLeafCount,
  });
  const acceptedByUser = Number.isInteger(acceptedLeafCount)
    && acceptedLeafCount === leafCounts[AI_CONTENT_MODE];
  const withinStrictCapacity = !Number.isInteger(maximumLeafCount)
    || maximumLeafCount <= 0
    || leafCounts[AI_CONTENT_MODE] <= maximumLeafCount;
  return {
    leaf_count: {
      suggested: targetLeafCount,
      advisory_only: true,
      current_ai_generate: leafCounts[AI_CONTENT_MODE],
      acceptable_min: acceptableRange.minimum,
      acceptable_max: acceptableRange.maximum,
      within_acceptable_range: withinAcceptableRange,
      accepted_by_user: acceptedByUser,
      accepted_count: Number.isInteger(acceptedLeafCount) ? acceptedLeafCount : null,
      strict_maximum: maximumLeafCount,
      within_strict_capacity: withinStrictCapacity,
      valid: withinStrictCapacity && (withinAcceptableRange || acceptedByUser),
      by_content_mode: leafCounts,
    },
    structure: {
      ...structure,
      single_child_nodes: singleChildNodes,
      valid: structure.max_depth <= MAX_OUTLINE_DEPTH
        && singleChildNodes.length === 0
        && structure.invalid_leaf_content_modes.length === 0,
    },
    score_mapping: collectScoreMappingCoverage(items, scoreDirectoryPlan),
    professional_structure: collectProfessionalStructure(items, scoreDirectoryPlan, { enabled: standaloneTechnical }),
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

// 兼容旧版 Agent 将同一评分组的响应点写成 R1-P1 的来源编号。
function normalizeScoreCoverageMap(scoreCoverageMap, scorePlan) {
  if (scoreCoverageMap?.coverage_mode !== 'full' || !Array.isArray(scoreCoverageMap.records)) {
    return scoreCoverageMap;
  }
  const expectedIds = new Set(collectScoreSources(scorePlan).map((source) => source.id));
  const legacyAliases = new Map();
  for (const group of scorePlan?.groups || []) {
    let pointIndex = 0;
    let supplementIndex = 0;
    for (const criterion of group.criteria || []) {
      for (const point of criterion.response_points || []) {
        pointIndex += 1;
        if (point.point_id) {
          const alias = `${group.requirement_id}-P${pointIndex}`;
          legacyAliases.set(alias, legacyAliases.has(alias) ? null : point.point_id);
        }
      }
      for (const supplement of criterion.supplements || []) {
        supplementIndex += 1;
        if (supplement.supplement_id) {
          const alias = `${group.requirement_id}-S${supplementIndex}`;
          legacyAliases.set(alias, legacyAliases.has(alias) ? null : supplement.supplement_id);
        }
      }
    }
  }
  let changed = false;
  const records = scoreCoverageMap.records.map((record) => {
    const sourceId = String(record?.source_id || '');
    const canonicalId = expectedIds.has(sourceId) ? sourceId : legacyAliases.get(sourceId);
    if (!canonicalId || canonicalId === sourceId) return record;
    changed = true;
    return { ...record, source_id: canonicalId };
  });
  return changed ? { ...scoreCoverageMap, records } : scoreCoverageMap;
}

function flattenOutlineNodes(items, result = new Map(), parentOriginId = '') {
  for (const item of items || []) {
    result.set(String(item?.id || ''), { ...item, parent_origin_id: parentOriginId });
    if (Array.isArray(item?.children)) {
      flattenOutlineNodes(item.children, result, String(item?.origin_id || item?.id || ''));
    }
  }
  return result;
}

function isGenericDescription(value) {
  const text = String(value || '').replace(/\s+/g, '').trim();
  if (!text) return true;
  return /^(?:相关说明|具体内容|方案概述)[。.]?$/.test(text)
    || /^(?:详细)?(?:介绍|说明|阐述)(?:本节|本章|相关|具体|方案|项目)*(?:内容|情况|要求)[。.]?$/.test(text)
    || /^(?:根据|按照)招标要求(?:进行)?(?:介绍|说明|阐述)[。.]?$/.test(text);
}

function validateFinalOutline({ outline, scorePlan, scoreCoverageMap, baseline = null, requiredCoverageRecords = [] }) {
  const items = outline?.outline || [];
  const structure = collectOutlineStructure(items);
  const nodes = flattenOutlineNodes(items);
  const normalizedScoreCoverageMap = normalizeScoreCoverageMap(scoreCoverageMap, scorePlan);
  const mandatoryIssues = [];
  if (structure.max_depth > MAX_OUTLINE_DEPTH) {
    mandatoryIssues.push({ code: 'max-depth', message: `目录最多允许 ${MAX_OUTLINE_DEPTH} 级` });
  }
  for (const node of structure.single_child_nodes) {
    const relation = `${node.origin_id || node.id}>${node.child_origin_id || node.child_id}`;
    if (!baseline?.singleChildRelations?.has?.(relation)) {
      mandatoryIssues.push({ code: 'single-child', node_id: node.id, message: 'Agent 不得生成只有一个子节点的父目录' });
    }
  }
  for (const node of structure.invalid_leaf_content_modes) {
    mandatoryIssues.push({ code: 'invalid-content-mode', node_id: node.id, message: '叶子节点内容模式无效' });
  }
  for (const [nodeId, node] of nodes) {
    if (!isGenericDescription(node.description)) continue;
    const fingerprint = baseline?.nodeFingerprints?.get?.(node.origin_id || nodeId);
    const unchanged = fingerprint
      && fingerprint.title === node.title
      && fingerprint.description === node.description
      && fingerprint.parentOriginId === node.parent_origin_id;
    if (!unchanged) mandatoryIssues.push({ code: 'generic-description', node_id: nodeId, message: '目录说明为空或过于空泛' });
  }

  if (normalizedScoreCoverageMap?.coverage_mode === 'full') {
    const records = Array.isArray(normalizedScoreCoverageMap.records) ? normalizedScoreCoverageMap.records : [];
    const recordsBySource = new Map();
    for (const record of records) {
      const existing = recordsBySource.get(record.source_id) || [];
      existing.push(record);
      recordsBySource.set(record.source_id, existing);
    }
    const plannedSources = collectScoreSources(scorePlan);
    const expectedSources = plannedSources.length
      ? plannedSources
      : (requiredCoverageRecords || []).map((record) => ({
        id: record.source_id,
        kind: record.source_kind,
        text: record.source_text,
      }));
    for (const source of expectedSources) {
      const matching = recordsBySource.get(source.id) || [];
      if (matching.length !== 1) {
        mandatoryIssues.push({
          code: matching.length ? 'score-source-duplicate' : 'score-source-missing',
          source_id: source.id,
          message: `评分来源映射不完整（来源 ${source.id}）`,
        });
        continue;
      }
      const record = matching[0];
      if (record.user_override === 'removed') continue;
      if (!record.node_ids?.length || record.node_ids.some((nodeId) => !nodes.has(nodeId))) {
        mandatoryIssues.push({ code: 'score-node-missing', source_id: source.id, message: '评分来源对应的目录节点不存在' });
      }
    }
    for (const [sourceId, matching] of recordsBySource) {
      if (matching.length > 1 && !expectedSources.some((source) => source.id === sourceId)) {
        mandatoryIssues.push({ code: 'score-source-duplicate', source_id: sourceId, message: '评分来源映射重复' });
      }
      for (const record of matching) {
        if (record.user_override === 'removed') continue;
        if (!record.node_ids?.length || record.node_ids.some((nodeId) => !nodes.has(nodeId))) {
          if (!mandatoryIssues.some((issue) => issue.code === 'score-node-missing' && issue.source_id === sourceId)) {
            mandatoryIssues.push({ code: 'score-node-missing', source_id: sourceId, message: '评分来源对应的目录节点不存在' });
          }
        }
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

function cleanScoreHierarchyTitle(value) {
  return String(value || '')
    .replace(/^[\s#*]+|[\s#*]+$/g, '')
    .replace(/[（(]\s*(?:\d+(?:\.\d+)?\s*(?:分|%)|[主客]观(?:分|评分))\s*[)）]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOutlineScoreMetadataTitles(items) {
  return (items || []).map((item) => {
    const children = Array.isArray(item?.children) ? item.children : null;
    return {
      ...item,
      title: cleanScoreHierarchyTitle(item?.title),
      ...(children ? { children: normalizeOutlineScoreMetadataTitles(children) } : {}),
    };
  });
}

function normalizeScoreDirectoryPlanTitles(plan) {
  return {
    ...plan,
    branches: (plan?.branches || []).map((branch) => ({
      ...branch,
      root_title: cleanScoreHierarchyTitle(branch?.root_title),
      mappings: (branch?.mappings || []).map((mapping) => ({
        ...mapping,
        target_title: cleanScoreHierarchyTitle(mapping?.target_title),
        ...(Array.isArray(mapping?.additional_titles)
          ? { additional_titles: mapping.additional_titles.map(cleanScoreHierarchyTitle) }
          : {}),
      })),
    })),
    extra_titles: (plan?.extra_titles || []).map((item) => ({
      ...item,
      title: cleanScoreHierarchyTitle(item?.title),
    })),
  };
}

function normalizeScoreHierarchyTitle(value) {
  return cleanScoreHierarchyTitle(value).replace(/\s+/g, '');
}

function readScoreHierarchyField(block, label) {
  return block.match(new RegExp(`【${label}】\\s*[：:]\\s*([^\\r\\n]+)`, 'u'))?.[1]?.trim() || '';
}

function normalizeScoreParentType(value) {
  const type = String(value || '').replace(/／/gu, '/').replace(/\s+/gu, '');
  if (type === '业务分组') return 'business-group';
  if (type === '评分维度/汇总容器') return 'score-container';
  if (type === '无') return 'none';
  return 'unknown';
}

function normalizeScoreHierarchyEvidenceType(value) {
  const type = String(value || '').replace(/\s+/gu, '');
  if (type === '合并单元格') return 'merged-cell';
  if (type === '编号层级') return 'numbering';
  if (type === '独立父级行') return 'parent-row';
  if (type === '汇总行') return 'subtotal-row';
  if (type === '无') return 'none';
  return 'unknown';
}

function isDirectNumberParent(sourceNumber, parentNumber) {
  const sourceParts = String(sourceNumber || '').trim().split(/[.．]/u).filter(Boolean);
  const parentParts = String(parentNumber || '').trim().split(/[.．]/u).filter(Boolean);
  return parentParts.length > 0
    && sourceParts.length === parentParts.length + 1
    && parentParts.every((part, index) => part === sourceParts[index]);
}

function hasValidBusinessHierarchyEvidence({ evidenceType, evidence, sourceNumber, parentNumber }) {
  if (evidenceType === 'merged-cell') {
    const rowspan = String(evidence || '').match(/rowspan\s*[=:：]?\s*(\d+)/iu)?.[1];
    return Number(rowspan) >= 2;
  }
  if (evidenceType === 'numbering') {
    return isDirectNumberParent(sourceNumber, parentNumber);
  }
  if (evidenceType === 'parent-row') {
    return /(?:独立)?父级行|上级行|第\s*\d+\s*行|row\s*[=:：#]?\s*\d+/iu.test(String(evidence || ''));
  }
  return false;
}

function cleanNullableScoreHierarchyValue(value) {
  const cleaned = cleanScoreHierarchyTitle(value);
  return cleaned && !/^(?:无|没有提及|未提及)$/u.test(normalizeScoreHierarchyTitle(cleaned))
    ? cleaned
    : null;
}

function deriveTechnicalScoreHierarchy(markdown) {
  const technicalSection = String(markdown || '')
    .split(/^##\s*技术评分项\s*$/mu)[1]
    ?.split(/^##\s+/mu)[0] || '';
  const titleMarkers = [...technicalSection.matchAll(/(?:\*\*)?【评分项名称】\s*[：:]/gu)];
  const blockStarts = titleMarkers.map((marker, index) => {
    const previousTitleIndex = index > 0 ? titleMarkers[index - 1].index : 0;
    const precedingText = technicalSection.slice(previousTitleIndex, marker.index);
    const numberFieldOffset = precedingText.lastIndexOf('【评分项编号】');
    return numberFieldOffset >= 0 ? previousTitleIndex + numberFieldOffset : marker.index;
  });
  const blocks = blockStarts.map((start, index) => (
    technicalSection.slice(start, blockStarts[index + 1] ?? technicalSection.length)
  ));
  const items = blocks.map((block) => {
    const rawTitle = readScoreHierarchyField(block, '评分项名称');
    const sourceNumber = readScoreHierarchyField(block, '评分项编号');
    const parentNumber = readScoreHierarchyField(block, '直接上级编号');
    const directParentName = cleanNullableScoreHierarchyValue(readScoreHierarchyField(block, '直接上级名称'));
    const parentType = normalizeScoreParentType(readScoreHierarchyField(block, '直接上级类型'));
    const hierarchyEvidenceType = normalizeScoreHierarchyEvidenceType(readScoreHierarchyField(block, '层级依据类型'));
    const hierarchyEvidence = readScoreHierarchyField(block, '层级依据说明');
    const parentGroup = parentType === 'business-group'
      && hasValidBusinessHierarchyEvidence({
        evidenceType: hierarchyEvidenceType,
        evidence: hierarchyEvidence,
        sourceNumber,
        parentNumber,
      })
      && directParentName
      ? directParentName
      : null;
    return {
      sourceNumber: cleanNullableScoreHierarchyValue(sourceNumber),
      title: cleanScoreHierarchyTitle(rawTitle),
      parentNumber: cleanNullableScoreHierarchyValue(parentNumber),
      directParentName,
      parentType,
      hierarchyEvidenceType,
      hierarchyEvidence: cleanNullableScoreHierarchyValue(hierarchyEvidence),
      parentGroup,
      rootTitle: parentGroup || cleanScoreHierarchyTitle(rawTitle),
    };
  }).filter((item) => item.title && item.rootTitle);
  const groupRootIndexes = new Map();
  const rootTitles = [];
  items.forEach((item) => {
    if (!item.parentGroup) {
      item.rootIndex = rootTitles.length;
      rootTitles.push(item.rootTitle);
      return;
    }
    const groupKey = item.parentNumber
      ? `number:${normalizeScoreHierarchyTitle(item.parentNumber)}|title:${normalizeScoreHierarchyTitle(item.parentGroup)}`
      : `title:${normalizeScoreHierarchyTitle(item.parentGroup)}`;
    if (!groupRootIndexes.has(groupKey)) {
      groupRootIndexes.set(groupKey, rootTitles.length);
      rootTitles.push(item.parentGroup);
    }
    item.rootIndex = groupRootIndexes.get(groupKey);
  });
  return {
    items,
    rootTitles,
  };
}

function assertStandaloneTechnicalRoots(roots, hierarchy) {
  const expected = hierarchy?.rootTitles || [];
  if (!expected.length) return;
  const actual = (Array.isArray(roots) ? roots : []).map((root) => normalizeScoreHierarchyTitle(root?.title));
  const matches = actual.length === expected.length
    && actual.every((title, index) => title === normalizeScoreHierarchyTitle(expected[index]));
  if (!matches) {
    throw new Error(`独立技术文件一级目录必须严格对应原有评分层级并保持顺序：期望 ${expected.length} 个（${expected.join('、')}），实际 ${actual.length} 个（${actual.join('、')}）。不得推断、合并、遗漏或重排评分项。`);
  }
}

function assertStandaloneScoreDirectoryPlan(plan, hierarchy, roots, { hasUserAdjustmentApproval = false } = {}) {
  const expectedRoots = hierarchy?.rootTitles || [];
  if (!expectedRoots.length) return;
  const rootTitles = (Array.isArray(roots) ? roots : []).map((root) => normalizeScoreHierarchyTitle(root?.title));
  const rootsStillFollowSource = rootTitles.length === expectedRoots.length
    && rootTitles.every((title, index) => title === normalizeScoreHierarchyTitle(expectedRoots[index]));
  if (!rootsStillFollowSource) return;

  const branches = Array.isArray(plan?.branches) ? plan.branches : [];
  const requestsAdjustment = plan?.allow_root_changes === true
    || (Array.isArray(plan?.extra_titles) && plan.extra_titles.length > 0)
    || branches.some((branch) => branch.mappings?.some((mapping) => (
      String(mapping?.adjustment_note || '').trim()
      || (Array.isArray(mapping?.additional_titles) && mapping.additional_titles.length > 0)
    )));
  if (requestsAdjustment && !hasUserAdjustmentApproval) {
    throw new Error('独立技术文件评分规划包含目录调整，但缺少实际用户调整批准记录。');
  }
  const mappingsByRequirementId = new Map();
  branches.forEach((branch) => {
    (Array.isArray(branch?.mappings) ? branch.mappings : []).forEach((mapping) => {
      if (mapping?.requirement_id) mappingsByRequirementId.set(mapping.requirement_id, mapping);
    });
  });
  const targetTitleCounts = new Map();
  mappingsByRequirementId.forEach((mapping) => {
    const key = normalizeScoreHierarchyTitle(mapping?.target_title);
    targetTitleCounts.set(key, (targetTitleCounts.get(key) || 0) + 1);
  });
  const titlesFollowSource = hierarchy.items.every((item, itemIndex) => {
    const mapping = mappingsByRequirementId.get(`R${itemIndex + 1}`);
    if (!mapping) return false;
    if (normalizeScoreHierarchyTitle(mapping.target_title) === normalizeScoreHierarchyTitle(item.title)) return true;
    const approvedSplit = Array.isArray(mapping.additional_titles)
      && mapping.additional_titles.length > 0
      && String(mapping.adjustment_note || '').trim();
    const approvedMerge = (targetTitleCounts.get(normalizeScoreHierarchyTitle(mapping.target_title)) || 0) > 1
      && String(mapping.adjustment_note || '').trim();
    return Boolean(approvedSplit || approvedMerge);
  });
  if (!titlesFollowSource) {
    throw new Error('独立技术文件评分项标题必须逐字对应原文；只有明确记录 adjustment_note 的已批准拆分或合并可以改变标题。');
  }

  if (requestsAdjustment) return;

  const valid = branches.length === expectedRoots.length && expectedRoots.every((rootTitle, rootIndex) => {
    const root = roots[rootIndex];
    const branch = branches[rootIndex];
    const expectedItems = hierarchy.items
      .map((item, itemIndex) => ({ ...item, requirementId: `R${itemIndex + 1}` }))
      .filter((item) => item.rootIndex === rootIndex);
    const expectedLevel = expectedItems.some((item) => item.parentGroup) ? 2 : 1;
    const mappings = Array.isArray(branch?.mappings) ? branch.mappings : [];
    const targetTitles = mappings.map((mapping) => normalizeScoreHierarchyTitle(mapping?.target_title));
    return branch?.root_id === root?.id
      && normalizeScoreHierarchyTitle(branch?.root_title) === normalizeScoreHierarchyTitle(rootTitle)
      && branch?.score_item_level === expectedLevel
      && mappings.length === expectedItems.length
      && mappings.every((mapping, mappingIndex) => mapping?.requirement_id === expectedItems[mappingIndex].requirementId)
      && new Set(targetTitles).size === targetTitles.length;
  });
  if (!valid) {
    throw new Error('独立技术文件评分规划必须保持招标文件原有评分层级：明确分组下的评分项使用二级，无明确分组的评分项使用一级；不得自行合并、遗漏或重排。');
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

function createInitialPrompt(taskInstruction, { standaloneTechnical = false, hasRemoteKnowledge = false, expectedRootTitles = [] } = {}) {
  const goal = standaloneTechnical
    ? '我们的目标是按招标文件原有技术评分层级，为单独装订的技术文件准备一级目录。'
    : '我们的目标是为编写响应文件/投标文件准备一级目录。';
  const modeRequirements = standaloneTechnical
    ? `6. 本模式只生成技术文件独立分册，attr 必须为“技术”，content_mode 必须为 ai-generate；不得加入商务、资信、投标函、授权委托书等非技术章节。
7. 一级目录只服从技术评分信息.md 的结构化层级字段：直接上级类型为“业务分组”，层级依据类型为“合并单元格”“编号层级”或“独立父级行”，且层级依据说明可核验时，以直接上级名称作为一级目录；直接上级类型为“评分维度/汇总容器”“无”、缺少类型或缺少有效层级依据类型时，每个技术评分项分别作为一级目录。不得根据父级标题字样、语义、相邻关系或所谓共同主题推断、合并、遗漏或重排评分项。${expectedRootTitles.length ? ` 本次一级目录必须依次且完整使用：${expectedRootTitles.join('、')}。` : ''}
8. 一级目录 title 必须逐字使用上述评分分组或评分项名称，但标题末尾仅表示评分方式的“（客观分）”“（主观分）”必须去掉；除此之外不得同义替换、删词、缩写或进行措辞优化。“项目实施方案”不得缩写为“实施方案”。仅后续生成的评分项下级目录可以进行专业化标题整理。
9. 完整结构示例：{"outline":[{"id":"1","title":"组织实施方案","description":"招标文件原有业务分组","attr":"技术","content_mode":"ai-generate"},{"id":"2","title":"质量保证方案","description":"无上级业务分组的独立评分项","attr":"技术","content_mode":"ai-generate"}]}。示例只说明字段格式，实际标题、数量和顺序必须服从技术评分信息.md。`
    : `6. 每个一级目录当前都是叶子节点，必须根据它后续应采用的内容处理方式填写 content_mode：技术方案正文使用 ai-generate；需要从招标文件提取并套用表格或格式的商务、资信材料使用 template-fill；需要在全部正文完成并确定 Word 页码后回填的点对点应答表使用 point-to-point；无法归类的特殊内容使用 other，并在 content_mode_note 说明原因。
7. 完整结构示例：{"outline":[{"id":"1","title":"技术方案","description":"技术方案目录说明","attr":"技术","content_mode":"ai-generate"},{"id":"2","title":"特殊资料","description":"特殊资料目录说明","attr":"其他","content_mode":"other","content_mode_note":"说明特殊处理原因"}]}。content_mode_note 只在 content_mode=other 且确有说明时填写。`;
  const finalStepNumber = standaloneTechnical ? 10 : 8;
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
${finalStepNumber}. ${OUTLINE_OUTPUT_FILE} 必须是纯 JSON，不包含 Markdown 代码块或解释文字。
${finalStepNumber + 1}. 程序已为 ${OUTLINE_OUTPUT_FILE} 预置 Schema。写入后调用 json-validation，只传 {"file_path":"${OUTLINE_OUTPUT_FILE}"}；校验失败后必须先修改文件，再重新校验。${hasRemoteKnowledge ? `\n${finalStepNumber + 2}. ${REMOTE_REFERENCE_RULE}` : ''}`;
}

function createLeafAllocationPrompt({ standaloneTechnical = false } = {}) {
  const allocationInstruction = standaloneTechnical
    ? '每个 branch 至少按其中 mappings 的评分条目数量 × 3 分配叶子，为每个评分条目预留“至少两个评分要点，并将其中需要展开的要点继续拆成正文小节”的基本空间；禁止形成只有一个子节点的冗余层级。'
    : '每个目录至少分配 2 个。';
  return `请继续使用当前 Pi Session 已读取的技术评分信息、知识库、原方案和目录规划，为多个技术一级目录分配“AI生成”叶子数量。

要求：
1. 阅读 ${OUTLINE_OUTPUT_FILE}、${TECHNICAL_SCORE_GROUPS_FILE}、${SCORE_DIRECTORY_PLAN_FILE} 和 ${LEAF_ALLOCATION_CONTEXT_FILE}。
2. 综合各一级目录负责的评分项数量、评分细项数量、内容复杂度以及已读取的参考资料，合理分配 allocatable_ai_leaf_count。
3. allocations 必须恰好覆盖 context 中 technical_branches 的全部 branch_id，每个 branch_id 只出现一次。${allocationInstruction}branch_id 是不会因目录重新编号而变化的内部稳定标识。
4. 所有 leaf_count 之和必须等于 allocatable_ai_leaf_count。
5. 将结果写入 ${LEAF_ALLOCATION_FILE}，保留 context 中的 mode、target_ai_leaf_count、fixed_ai_leaf_count 和 allocatable_ai_leaf_count。
6. 不要修改 ${OUTLINE_OUTPUT_FILE}、${TECHNICAL_SCORE_GROUPS_FILE} 或 ${SCORE_DIRECTORY_PLAN_FILE}。
7. 输出格式为 {"mode":"allocated","target_ai_leaf_count":20,"fixed_ai_leaf_count":1,"allocatable_ai_leaf_count":19,"allocations":[{"branch_id":"B1","leaf_count":10},{"branch_id":"B2","leaf_count":9}]}。
8. 程序已为 ${LEAF_ALLOCATION_FILE} 预置 Schema。完成后调用 json-validation 校验，只传 file_path；校验失败后必须先修改文件，再重新校验。`;
}

function createScorePlanningPrompt({ standaloneTechnical = false, hasRemoteKnowledge = false } = {}) {
  const scoreGroupInstruction = standaloneTechnical
    ? `将每个评分大项、每条独立评分行和每个明确响应内容写入 ${TECHNICAL_SCORE_GROUPS_FILE}。固定版本为 version=2；评分大项使用 R1，评分行使用 R1-C1，响应点使用 R1-C1-P1，受控补充使用 R1-C1-S1，并分别填写 source_order 和 expected_path。每个 group 还必须填写 source_number、parent_number、parent_name、parent_type、hierarchy_evidence_type 和 hierarchy_evidence，完整结构片段为 {"version":2,"groups":[{"requirement_id":"R1","source_title":"项目理解","target_title":"项目理解","source_order":1,"expected_path":["项目总体方案","项目理解"],"source_number":"2.1","parent_number":"2","parent_name":"项目总体方案","parent_type":"business-group","hierarchy_evidence_type":"merged-cell","hierarchy_evidence":"rowspan=3","criteria":[]}]}。source_title、source_number、parent_number、parent_name、parent_type、hierarchy_evidence_type 和 hierarchy_evidence 必须逐项复制或转换技术评分信息.md 中对应的结构化字段；source_title 和 parent_name 末尾仅表示评分方式的“（客观分）”“（主观分）”必须去掉。parent_type 只使用 score-container、business-group、none，hierarchy_evidence_type 只使用 merged-cell、numbering、parent-row、subtotal-row、none。除此之外不得同义替换、删词、缩写或进行措辞优化，“项目实施方案”不得改写为“实施方案”。不得根据标题字样、语义或相邻关系反向推断父级类型或层级依据类型。target_title 必须逐字使用对应 group.title 所代表的评分项原文标题；criteria、response_points、evaluation_dimensions、supplements 没有内容时使用空数组，不得省略。评分标准中的明确响应内容写入 criteria/response_points；不承载正文内容的评价等级不得写入 detail_points 或 response_points。若评分项同时要求“项目实施过程中的重点、难点问题分析及解决措施”，应按问题类别组织为“重点问题分析及解决措施”“难点问题分析及解决措施”，并在材料支持时补充“其他具体问题分析与应对”“合理化建议”；不要机械拆成“问题分析”和“解决措施与对策”。`
    : `将每个评分大项、每条独立评分行和每个明确响应内容写入 ${TECHNICAL_SCORE_GROUPS_FILE}。固定版本为 version=2；评分大项使用 R1，评分行使用 R1-C1，响应点使用 R1-C1-P1，受控补充使用 R1-C1-S1，并分别填写 source_order 和 expected_path。source_number、parent_number、parent_name、hierarchy_evidence 可填 null，parent_type 和 hierarchy_evidence_type 填 none；criteria、response_points、evaluation_dimensions、supplements 没有内容时使用空数组，不得省略。`;
  const placementInstruction = standaloneTechnical
    ? `6. 当前采用“技术文件独立成册”：${OUTLINE_OUTPUT_FILE} 的一级根节点已经按招标文件原有评分层级确认。仅当多个评分条目在原文中具有同一个明确业务分组时，才映射到该分组对应的同一个 branch 并使用 score_item_level=2；原文没有明确业务分组时，每个评分条目各自对应一个一级根节点、一个 branch，并使用 score_item_level=1。不得根据语义或相邻关系推断分组，不得自行合并、拆分、遗漏或重排，也不得再创建“技术方案”“项目管理方案”“监理大纲”“监理大纲（暗标）”“施工组织设计”“技术标”等外层分支。
7. mapping 的 target_title 必须逐字使用对应 group.title 所代表的 target_title；未经用户批准拆分时不得填写 additional_titles。评分行和 response_points 用于后续生成评分项以下的目录。`
    : `6. 判断技术方案位于哪些目录分支，以及每个分支内评分大项对应节点应统一处于哪个层级。不同分支可以使用不同层级，范围为一级至七级。优先选择 attr=技术且 content_mode=ai-generate 的一级目录；template-fill、point-to-point 和 other 是特殊处理叶子，不得作为普通技术方案分支展开，除非先向用户说明并取得调整批准。
7. 默认每个评分大项对应一个独立同层级节点；每条独立评分行和 response_points 用于生成更下级目录。`;
  const planExample = standaloneTechnical
    ? `{"branches":[{"branch_id":"B1","root_id":"1","root_title":"项目总体方案","score_item_level":2,"mappings":[{"requirement_id":"R1","target_title":"项目理解"},{"requirement_id":"R2","target_title":"总体方案设计"}]},{"branch_id":"B2","root_id":"2","root_title":"质量保证方案","score_item_level":1,"mappings":[{"requirement_id":"R3","target_title":"质量保证方案"}]}],"extra_titles":[],"allow_root_changes":false}`
    : `{"branches":[{"branch_id":"B1","root_id":"2","root_title":"技术方案","score_item_level":2,"mappings":[{"requirement_id":"R1","target_title":"评分大项目录标题","additional_titles":["经批准拆分出的同级标题"],"adjustment_note":"用户批准的调整说明"}]}],"extra_titles":[{"branch_id":"B1","title":"经批准增加的同层级标题","reason":"增加原因"}],"allow_root_changes":false}`;
  return `用户已经确认最终保留的一级目录，${OUTLINE_OUTPUT_FILE} 已由程序重新整理并编号。工作区也已加入技术评分信息和用户选择的参考资料。${hasRemoteKnowledge ? `\n\n${REMOTE_REFERENCE_RULE}` : ''}

请完成技术评分信息结构化和目录规划。用户最新确认的目录规则和手工决定优先，其次才是评分原文、专业补充和字数容量参考：
1. 阅读 ${OUTLINE_OUTPUT_FILE}、技术评分信息.md，以及存在的原方案.md 和参考知识库目录。
2. 只从技术评分信息.md 的“技术评分项”中提取适合在技术方案中一一响应、展开编写的评分大项。“技术评分要求”只能作为评分标准、扣分规则和编写约束，不得提取为评分项。
如果技术评分信息中没有任何可用于技术方案目录规划的评分项，立即调用 report-failure，说明需要补充或重新解析技术评分信息；不要调用 ask-user 让用户接受空结果，不要生成空结构、编造评分项或删除、清空文件。
  3. ${scoreGroupInstruction}
4. source_title/source_text 必须保留完整评分原文和原始顺序，不得提前合并近义评分行。target_title 只允许删除“根据投标人对”“依据投标人提供的”“进行打分”“得0至5分”等不影响业务含义的评分外壳；不得删除“项目实施过程中”“服务需求中”等限定词，不得用更短但改变范围的概括标题。
5. “全面性、合理性、科学性、先进性、可行性”等评价词写入 evaluation_dimensions，后续进入对应节点 description，不生成独立目录。只有总体介绍、其他具体问题、合理化建议等确有写作价值的受控专业补充才写入 supplements，并填写具体 reason 和允许的 supplement_kind。
${placementInstruction}
8. 只有以下偏离需要用户批准：合并或拆分评分项、遗漏评分来源或评分项对应节点、增加评分项中不存在的同层级大项、改变分支评分项目标层级，以及新增、删除、合并或调整用户已确认的一级目录。评分项名称和结构化父级字段不得规范化或改写；评分行以下的适度拆解和受控专业补充不需要再次询问。
9. 存在至少一个有效评分项时，无论是否存在偏离，都必须调用一次 ask-user 让用户确认。没有偏离时，question 只说明技术方案所在目录和评分项所在层级，最多使用两句话且不要使用列表；选项固定为“按原评分层级生成”（custom=false）和“调整目录安排”（custom=true）。存在偏离时，question 补充实际需要批准的偏离及影响，存在多个事项时使用简单 Markdown 分行列出；选项固定为“按上述调整生成”（custom=false）、“保持原评分层级”（custom=false）和“调整目录安排”（custom=true）。不得改名、增删或调整这些选项顺序。
10. 根据用户回答写入 ${SCORE_DIRECTORY_PLAN_FILE}。完整字段层级示例：${planExample}。branches 中每个分支填写唯一且后续保持不变的 branch_id，并用当前 ${OUTLINE_OUTPUT_FILE} 中尚未调整的一级目录编号和标题填写 root_id、root_title；让每个 requirement_id 在 mappings 中恰好出现一次，score_item_level 不得超过七级。后续新增、重排或改名一级目录时，branch_id 仍用于稳定关联同一技术分支，不能随 root_id 改变；默认一一对应，经用户批准合并时多个 mapping 可以使用相同 target_title，经用户批准拆分时才填写 additional_titles 和 adjustment_note。extra_titles 必须位于根对象，经批准增加同层级大项时才写入条目，否则使用空数组。
11. 默认锁定一级目录，allow_root_changes=false；只有用户明确批准一级目录调整时才设为 true。
12. 程序已为 ${TECHNICAL_SCORE_GROUPS_FILE} 和 ${SCORE_DIRECTORY_PLAN_FILE} 预置 Schema。分别调用 json-validation 校验，只传 file_path；校验失败后必须先修改对应文件，再重新校验；如果材料无法在不编造评分项的情况下通过校验，调用 report-failure。
13. 此阶段不要修改 ${OUTLINE_OUTPUT_FILE}，也不要删除、清空或重命名任何任务文件。`;
}

function createChildrenPrompt({ hasOriginalPlan, originalOnly, targetLeafCount, allowRootChanges, standaloneTechnical }) {
  const branchInstruction = !hasOriginalPlan
    ? '没有原方案时，以技术评分信息.md 为主要依据生成目录。'
    : originalOnly
      ? '已选择仅使用原方案目录：以原方案.md 为主建立规划层级及以下目录，再用技术评分信息.md 补充原方案语义上确实缺失的技术要求，意思相近的内容不要重复添加。'
      : '已提供原方案且允许 AI 补充：以技术评分信息.md 为主，在评分项目录规划指定的层级覆盖关键大项，原方案.md 用于辅助生成更下级目录。';
  const capacityInstruction = targetLeafCount === null
    ? '本次未设置总字数目标，请根据材料复杂度自主确定合理的“AI生成”叶子节点数量。'
    : standaloneTechnical
      ? `将 ${LEAF_ALLOCATION_FILE} 中的分配作为正文颗粒度软目标，使最终完整目录的 content_mode=ai-generate 叶子节点数量处于目标 ${targetLeafCount} 附近；评分语义完整和专业展开优先于精确凑数。`
      : `严格参考 ${LEAF_ALLOCATION_FILE} 中的分配，最终完整目录必须正好生成 ${targetLeafCount} 个 content_mode=ai-generate 叶子节点。`;
  const rootInstruction = allowRootChanges
    ? `用户已批准 ${SCORE_DIRECTORY_PLAN_FILE} 中记录的一级目录调整，只能按该规划进行必要修改并重新编号。`
    : '一级目录的数量、顺序、id、title、description、attr 均已由用户确认，必须保持不变；未扩展为父节点的一级目录还必须保留其 content_mode。';
  const mappingInstruction = standaloneTechnical
    ? '严格按照每个 branch 的 score_item_level 放置评分条目：有明确业务分组时，一级目录是原文分组、评分条目位于其下；无明确业务分组时，一级目录本身就是评分条目。评分条目下先生成评分要点，评分要点再继续展开为可独立编写的正文小节。'
    : '每个 branch 的 mappings 必须在该分支的 score_item_level 层级生成对应节点。';
  const standaloneLeafInstruction = standaloneTechnical
    ? '每个评分条目至少生成两个评分要点；宽泛评分要点必须继续拆成至少两个可写正文小节，内容单一、边界清楚的评分要点可以直接作为正文叶子，但每个评分条目至少有一个评分要点继续展开。确有更复杂内容时继续动态展开到五级、六级或七级，不要求所有分支深度一致。'
    : '';
  const titleInstruction = standaloneTechnical
    ? 'title 只写纯标题，不包含章节编号或 Markdown 标记；标题使用简洁的名词性短语。一个标题原则上只表达一个核心主题；可以独立编写的多个对象优先拆成同级节点，不得批量压缩为“甲与乙”“甲及乙”或“甲、乙”式标题。子目录继承父目录语境，不重复添加父级已明确的“理解”“分析”“措施”“要求”等后缀；例如“项目技术要求理解”下应优先生成“采购内容”和“实施范围”，而不是“采购内容与实施范围理解”。固定术语、不可拆分的业务关系或确实需要共同论述时可保留连接词。去掉开头或结尾不承载业务含义的“对”“根据”“依据”“结合”“围绕”“按照”“针对”以及“进行说明”“进行阐述”“进行评审”“进行打分”等表达；保留“政策依据”“需求分析”“难点分析”“解决措施”“结合部施工”等有专业含义的词。'
    : 'title 只写纯标题，不包含章节编号或 Markdown 标记。';
  const professionalStructureInstruction = standaloneTechnical
    ? '独立技术文件遵循“原文业务分组（如有）→ 评分条目 → 评分要点 → 可独立编写的正文小节”的递进结构。无原文业务分组时从一级评分条目直接向下展开。宽泛的“政策背景”“工作思路”“技术要求理解”等评分要点必须结合材料继续展开；内容单一且边界清楚的要点可以直接编写正文。每个评分条目至少有一个评分要点继续展开，直到末级节点主题边界清楚。'
    : '按照评分项目录规划生成必要层级，不额外套用独立成册的四层结构。';
  const outlineExample = standaloneTechnical
    ? `{"outline":[{"id":"1","title":"项目总体方案","description":"总体方案业务主题","attr":"技术","branch_id":"B1","children":[{"id":"1.1","title":"项目理解","description":"项目理解评分条目","children":[{"id":"1.1.1","title":"政策背景","description":"政策背景评分要点","children":[{"id":"1.1.1.1","title":"土地承包经营历史沿革","description":"历史沿革正文小节","content_mode":"ai-generate"},{"id":"1.1.1.2","title":"国家政策","description":"国家政策正文小节","content_mode":"ai-generate"}]},{"id":"1.1.2","title":"项目技术要求理解","description":"技术要求评分要点","children":[{"id":"1.1.2.1","title":"项目基本情况","description":"项目情况正文小节","content_mode":"ai-generate"},{"id":"1.1.2.2","title":"采购内容","description":"采购内容正文小节","content_mode":"ai-generate"}]}]}]}]}`
    : `{"outline":[{"id":"1","title":"技术应答表","description":"应答表说明","attr":"技术","content_mode":"point-to-point"},{"id":"2","title":"技术方案","description":"技术方案说明","attr":"技术","branch_id":"B1","children":[{"id":"2.1","title":"评分大项","description":"评分大项说明","children":[{"id":"2.1.1","title":"具体方案一","description":"具体方案说明","content_mode":"ai-generate"},{"id":"2.1.2","title":"具体方案二","description":"具体方案说明","content_mode":"ai-generate"}]},{"id":"2.2","title":"另一评分大项","description":"评分大项说明","content_mode":"ai-generate"}]}]}`;
  return `请继续使用当前上下文，为 ${OUTLINE_OUTPUT_FILE} 生成完整目录并同步生成 ${SCORE_COVERAGE_MAP_FILE}。用户最新确认的规则和手工决定是第一标准，其次按评分原文、必要专业结构、字数容量参考的顺序执行。

要求：
1. ${branchInstruction}
2. 以 ${TECHNICAL_SCORE_GROUPS_FILE} 为技术评分项权威清单，以 ${SCORE_DIRECTORY_PLAN_FILE} 为评分项与目录位置的权威规划。
3. ${mappingInstruction} branch_id 是技术分支稳定标识：对应的最终一级目录必须保留同名 branch_id，即使一级目录新增、删除、改名、重排或重新编号也不得改变；非技术分支一级目录不要填写 branch_id。默认每个评分项形成一个独立节点；多个 mapping 使用相同 target_title 表示用户已批准合并，additional_titles 表示用户已批准将该评分项拆成多个同级节点。
4. mappings 中的 target_title 和 additional_titles 是评分项对应节点的已确认标题，必须逐字使用，不得同义替换、删词、缩写或进行措辞优化；标题专业化规则只适用于评分项以下的评分行、响应点和正文小节。先生成评分大项映射节点，再按每条独立评分行生成下级节点，最后按 response_points 生成可独立编写的更具体节点；不得遗漏“建设目标”等明确内容，不得随意合并来自不同评分行的要求。
5. extra_titles 是用户已批准增加的同层级大项；除此之外不得自行增加技术评分项中不存在的同层级标题。
6. “技术评分要求”只能作为评分标准、扣分口径、判定规则和目录说明约束，不能生成独立评分项节点。
7. ${rootInstruction}
8. 未纳入评分项目录规划的一级目录和分支保持原样，不得增加子目录。
9. 如果存在参考知识库或原方案，只能用于完善评分项对应节点的下级结构，不得改变评分项映射或引入未经批准的同层级大项。
10. ${capacityInstruction}
11. 每个最终叶子节点必须填写 content_mode：技术方案正文为 ai-generate；从招标文件提取后按模板填写为 template-fill；需要在 Word 页码确定后回填为 point-to-point；其他特殊内容为 other，并用 content_mode_note 说明。父节点不得包含 content_mode 或 content_mode_note。
12. 任意非叶子节点的 children 原则上至少包含两个节点，不要创建只有一个子节点的冗余层级；唯一例外是招标文件原有业务分组本身只统领一个评分条目，此时必须保留该来源层级。
13. 目录层级可变，但最多七级；只有存在至少两个独立、具体、非重复的写作单元时才继续下钻。一级目录包含 attr，子目录不包含 attr。所有 id 必须使用层级点号编号并与实际父子位置一致。
14. ${titleInstruction}
15. ${standaloneLeafInstruction}${professionalStructureInstruction}
16. 评分原文 target_title 只允许删除不影响业务含义的评分外壳，不得删除“项目实施过程中”“服务需求中”等范围限定词；评价维度写入对应节点 description，不生成独立目录。
17. 只允许加入有明确写作价值的受控补充，例如总体架构设计、其他具体问题分析与应对或合理化建议；补充不得替代评分原文节点。
18. description 必须写明具体对象、范围、方法、措施、交付物或评价维度，不能只重复标题。
19. ${OUTLINE_OUTPUT_FILE} 的完整结构示例：${outlineExample}。branch_id 只写在评分规划对应的技术一级目录上；示例只说明字段位置和编号方式，实际层级与标题必须按任务材料生成。
20. 为 ${TECHNICAL_SCORE_GROUPS_FILE} 中每个 R/C/P/S 来源在 ${SCORE_COVERAGE_MAP_FILE} 写且只写一条记录，source_id 必须逐字复制来源对象的 ID（例如响应点必须写 R1-C1-P1，不得简写为 R1-P1），coverage_mode=full；node_ids 指向承接该来源的正式目录节点，coverage_location 标明 title、description 或 both。评分来源默认 user_override=none，非补充来源 supplement_kind=none。
21. 程序已为 ${OUTLINE_OUTPUT_FILE} 和 ${SCORE_COVERAGE_MAP_FILE} 预置 Schema。覆盖写回两个文件后分别调用 json-validation 校验，只传 file_path；校验失败后必须先修复再继续。`;
}

function createLeafAdjustmentPrompt(targetLeafCount, actualLeafCount, { standaloneTechnical = false, maximumLeafCount = null } = {}) {
  const acceptableRange = deriveAcceptableLeafRange(targetLeafCount, {
    soft: standaloneTechnical,
    maximum: maximumLeafCount,
  });
  const targetDescription = standaloneTechnical
    ? `颗粒度目标是 ${targetLeafCount} 个，可接受范围是 ${acceptableRange.minimum} 至 ${acceptableRange.maximum} 个`
    : `精确目标是 ${targetLeafCount} 个`;
  const adjustmentGoal = standaloneTechnical ? '进入可接受范围' : '达到目标数量';
  return `程序计算当前完整目录共有 ${actualLeafCount} 个“AI生成”叶子节点，${targetDescription}。

请先调用一次 ask-user，说明目标数、当前数、差距及目录质量影响，只能按以下顺序提供三个固定选项，不得改名、增删或调整顺序：
1. “接受当前结果”，custom=false：保持当前目录并进入最终审核。
2. “允许 Agent 自行调整”，custom=false：由你在不破坏目录质量的前提下合理调整一次。
3. “自定义需求”，custom=true：按用户填写的具体要求调整。

根据本轮 ask-user 回答处理：
1. 用户选择“接受当前结果”时，不要修改 ${OUTLINE_OUTPUT_FILE}。
2. 用户选择“允许 Agent 自行调整”或“自定义需求”时，必须继续遵循 ${SCORE_DIRECTORY_PLAN_FILE}：不得删除、移动或改变评分项对应节点的目标层级，不得新增未经批准的同层级大项；优先调整评分项节点下面的更深层目录。
3. 只通过合理调整 ai-generate 叶子的目录结构${adjustmentGoal}，不得为了凑数把 template-fill、point-to-point 或 other 改成 ai-generate，也不得改变非 AI 叶子的处理模式；评分条目、评分要点和可写正文小节的专业结构优先于数量目标。
4. 调整后仍须保持完整根结构 {"outline":[一级目录节点]}，id 必须使用与父子位置一致的层级点号编号；技术一级目录必须保留 ${SCORE_DIRECTORY_PLAN_FILE} 中对应的 branch_id，不能因增删、移动或重新编号而改变；父节点只含 children，不含 content_mode，叶子节点只含 content_mode，不含 children。
5. 不要机械增加重复、空泛或近义目录。程序已为 ${OUTLINE_OUTPUT_FILE} 预置 Schema；完成调整后覆盖写回该文件，并调用 json-validation 校验，只传 file_path；校验失败后必须先修改文件，再重新校验。`;
}

function createOutlineReviewPrompt({
  targetLeafCount,
  actualLeafCount,
  allowRootChanges,
  standaloneTechnical = false,
  acceptedLeafCount = null,
  maximumLeafCount = null,
}) {
  const acceptableRange = deriveAcceptableLeafRange(targetLeafCount, {
    soft: standaloneTechnical,
    maximum: maximumLeafCount,
  });
  const leafCountAccepted = Number.isInteger(acceptedLeafCount) && acceptedLeafCount === actualLeafCount;
  const leafCountReview = leafCountAccepted
    ? `\n- “AI生成”叶子数量：用户已在上一阶段接受当前 ${actualLeafCount} 个，记录该偏差但不要再次询问或阻断审核。`
    : targetLeafCount === null
    ? ''
    : `\n- “AI生成”叶子数量：程序计算颗粒度目标为 ${targetLeafCount} 个，当前为 ${actualLeafCount} 个，可接受范围为 ${acceptableRange.minimum} 至 ${acceptableRange.maximum} 个。只统计 content_mode=ai-generate 的最终叶子节点；专业结构优先，修复后在不破坏评分语义的前提下保持在此范围内。`;
  const rootRequirement = allowRootChanges
    ? `一级目录只能保持用户已批准的 ${SCORE_DIRECTORY_PLAN_FILE} 规划，不得提出规划之外的新调整。`
    : '一级目录已经由用户确认，数量、顺序、标题、描述和属性不得修改。';
  const standaloneReviewDimensions = standaloneTechnical
    ? `
- 递进展开：独立技术文件应遵循“原文业务分组（如有）→ 评分条目 → 评分要点 → 可独立编写的正文小节”；无原文业务分组时从一级评分条目直接向下展开。评分条目至少包含两个评分要点，宽泛评分要点必须继续拆成正文小节；每个评分条目至少有一个评分要点继续展开，复杂内容可以继续加深。
- 标题精简：标题使用名词性短语，一个标题只表达一个核心主题，子目录不重复父级语义。不得在同一组下机械重复使用“甲与乙”式标题，但固定术语和确需合并论述的标题不应机械拆分。删除不承载业务含义的“对、根据、依据、结合、围绕、按照、针对”等开头和“进行说明、进行阐述、进行评审、进行打分”等结尾，但保留“政策依据、需求分析、难点分析、解决措施、结合部施工”等专业词。`
    : '';
  const leafConfirmationRule = leafCountAccepted
    ? '用户已接受的当前叶子数量偏差不得再列为问题或触发 ask-user；但严格字数上限不能被用户接受绕过。'
    : '叶子数量超出合理范围必须设为 true。';
  const silentFixLeafRule = leafCountAccepted
    ? '静默修复不得改变 AI 生成叶子数量。'
    : '静默修复不得使 AI 生成叶子数量超出程序给出的合理范围。';
  const scoreTitleNormalizationRule = standaloneTechnical
    ? `评分项标题必须逐字保持技术评分信息.md 中的名称，不得修改 ${SCORE_DIRECTORY_PLAN_FILE} 中 mapping 的 target_title 或 additional_titles，也不得改写 ${OUTLINE_OUTPUT_FILE} 中对应的评分节点标题。标题或说明的专业化优化只允许用于评分项以下的评分要点和正文小节。`
    : `评分项映射节点的标题规范化不得静默执行；不得修改 ${SCORE_DIRECTORY_PLAN_FILE}，且不得改动与其 target_title 或 additional_titles 对应的目录节点标题。`;
  const scorePlanFixRule = standaloneTechnical
    ? `静默修复不得改变评分项 requirement_id、target_title、additional_titles、映射关系、标题数量、目标层级和一级目录。`
    : `静默修复不得改变评分项映射节点、目标层级和一级目录，也不得修改 ${SCORE_DIRECTORY_PLAN_FILE}。`;
  const scorePlanBoundaryRule = standaloneTechnical
    ? `${SCORE_DIRECTORY_PLAN_FILE} 是已确认的只读规划，不得修改其中的 target_title、additional_titles 或其他字段。`
    : `本模式不开放评分规划标题同步，${SCORE_DIRECTORY_PLAN_FILE} 必须保持只读。`;
  const validationRule = standaloneTechnical
    ? `程序已为 ${OUTLINE_OUTPUT_FILE}、${SCORE_COVERAGE_MAP_FILE}、${SCORE_DIRECTORY_PLAN_FILE} 和 ${OUTLINE_REVIEW_FILE} 预置 Schema。分别调用 json-validation 校验，只传 file_path；校验失败后必须先修改对应文件，再重新校验。`
    : `程序已为 ${OUTLINE_OUTPUT_FILE}、${SCORE_COVERAGE_MAP_FILE} 和 ${OUTLINE_REVIEW_FILE} 预置 Schema。分别调用 json-validation 校验，只传 file_path；校验失败后必须先修改对应文件，再重新校验。不得修改 ${SCORE_DIRECTORY_PLAN_FILE}。`;
  return `请对当前完整技术方案目录执行最终审核，并在用户确认后完成必要修复。

开始审核时一次性并行读取 ${OUTLINE_REVIEW_CONTEXT_FILE}、${OUTLINE_OUTPUT_FILE}、${TECHNICAL_SCORE_GROUPS_FILE}、${SCORE_COVERAGE_MAP_FILE}、技术评分信息.md 和 ${SCORE_DIRECTORY_PLAN_FILE}，不要探索工作区或读取其他文件。${OUTLINE_REVIEW_CONTEXT_FILE} 是宿主程序计算的确定性审核结果，叶子数量、内容模式数量、最大层级、父节点数量、单子节点、评分来源映射、评分节点机械映射、评分层级展开和标题风格问题均直接采用其中结果，不要重新统计、编写脚本或执行额外结构检查；你负责修复确定性问题并结合原始评分信息审核评分语义覆盖、原文保真、近义重复和专业合理性。

审核维度：
- 评分覆盖：直接以技术评分信息.md 为原始依据，逐项检查其中适合技术方案响应的评分大项是否被目录准确覆盖；结构化评分项和目录规划用于核对已确认的映射，但不能掩盖原始评分信息中的遗漏。
- 原文保真：只删除评分外壳，保留“项目实施过程中”等有含义的限定词；每条明确响应内容必须在标题或 description 中承接。
- 重复目录：检查全部子目录中是否存在重复、近义、含义重叠或仅换一种说法的节点；不同专业分支下确有独立含义的同名标题不应机械判重。
- 专业合理性：评估目录层级、颗粒度、逻辑顺序、标题表达、description、节点归属以及内容处理模式是否适合正式技术投标文件。越往下必须越具体，最多七级。${standaloneReviewDimensions}

审核与修复流程：
1. 必须先完整审核并形成问题清单，不得边审核边修改。
2. 如果没有问题，不要修改 ${OUTLINE_OUTPUT_FILE}；写入 ${OUTLINE_REVIEW_FILE}，status=passed、issues=[]、user_feedback=""，summary 说明通过原因。
3. 如果发现问题，先为每个问题记录 category、problem、推荐 repair 和 confirmation_required，不得提前修改目录。
4. 只有以下问题可设 confirmation_required=false：不涉及评分来源、评分项映射节点、目标层级和一级目录的标题、说明或明显空洞 description 优化，以及明显重复或近义子目录合并。${scoreTitleNormalizationRule}评分覆盖缺失、评分标题变义、评分项目标层级调整、一级目录调整、增加或拆分目录、跨分支移动以及明显结构重排均必须设为 true。${leafConfirmationRule}
5. 如果全部问题都不需要确认，可以直接执行文案优化或轻微去重，不得调用 ask-user；完成后设置 status=simple_fix、user_feedback=""。${scorePlanFixRule}${silentFixLeafRule}
6. 只要存在一个 confirmation_required=true 的问题，本轮所有问题都不得提前修改。集中调用一次 ask-user，question 使用多行文本完整列出问题及推荐修复方案；提供 2 至 5 个互斥选项，第一项是推荐修复方案，另提供一个名为“调整修复方案”等明确业务名称的选项并设置 custom=true，让用户说明具体修改要求，其他选项均设置 custom=false。${OUTLINE_REVIEW_CONTEXT_FILE} 的确定性检查全部通过时可以提供“保留当前目录”；任一确定性检查不通过时，不得提供“保留当前目录”。custom=true 的选项最多只能有一个。
7. 根据 ask-user 返回的 answer 执行最终处理：用户要求全部或部分修改时更新 ${OUTLINE_OUTPUT_FILE} 和 ${SCORE_COVERAGE_MAP_FILE} 并设置 status=user_feedback；status=user_refuse 只能用于确定性检查已通过、用户拒绝可选语义性优化的情况，此时不得修改目录。评分覆盖缺失、映射损坏、超过七级、Agent 生成单子节点或非法内容模式不能以 user_refuse 保存。将 answer 原文完整写入 user_feedback，修改完成后不得再次询问用户。
8. ${rootRequirement}
9. 修复必须继续遵守 ${SCORE_DIRECTORY_PLAN_FILE} 中用户确认的评分项映射、目标层级和一级目录调整边界。补回遗漏映射、合并重复目录或优化层级时，不得引入未经用户批准的评分大项规划变更；${scorePlanBoundaryRule}
10. 技术一级目录必须保留 ${SCORE_DIRECTORY_PLAN_FILE} 中对应的 branch_id；调整一级目录顺序或编号时不得修改 branch_id。结构事实以 ${OUTLINE_REVIEW_CONTEXT_FILE} 为准；如果其中确定性检查不通过，直接依据列出的节点和缺失项形成问题并修复，不要重新统计。任何语义修复仍必须保证叶子保留合法 content_mode、父节点不包含 content_mode 或 content_mode_note、目录最多七级，并以结构检查列出的 single_child_nodes 为需要修复的单子节点清单。
11. 修复目录后同步更新 ${SCORE_COVERAGE_MAP_FILE}，不得用映射记录掩盖实际缺失的目录要求。
12. 最终将完整问题清单和处理结果写入 ${OUTLINE_REVIEW_FILE}。无问题时完整格式为 {"status":"passed","issues":[],"user_feedback":"","summary":"审核通过原因"}；有问题时完整格式为 {"status":"user_feedback","issues":[{"category":"score-coverage","problem":"问题说明","repair":"修复方案","confirmation_required":true}],"user_feedback":"用户回答原文","summary":"处理结果"}。category 只能是 leaf-count、score-coverage、duplicate-directory、professional-structure；status 按本流程选择 passed、simple_fix、user_feedback 或 user_refuse。
13. ${validationRule}`;
}

function createOutlineReviewCorrectionPrompt({ standaloneTechnical = false, attempt = 1 } = {}) {
  const scorePlanRule = standaloneTechnical
    ? `${SCORE_DIRECTORY_PLAN_FILE} 是已确认的只读规划；评分项映射节点标题必须逐字保持其 target_title 或 additional_titles，不得规范化或改写。只允许优化评分项以下的评分要点和正文小节。`
    : `${SCORE_DIRECTORY_PLAN_FILE} 保持只读，不得修改评分映射节点标题。`;
  return `这是目录最终审核后的第 ${attempt} 次自动复检修复。用户已经回答过审核问题，本阶段不得调用 ask-user，也不得重新解释或缩小用户已确认的修复范围。

一次性读取 ${OUTLINE_REVIEW_CONTEXT_FILE}、${OUTLINE_OUTPUT_FILE}、${SCORE_DIRECTORY_PLAN_FILE}、${SCORE_COVERAGE_MAP_FILE} 和 ${OUTLINE_REVIEW_FILE}。${OUTLINE_REVIEW_CONTEXT_FILE} 是宿主基于最新目录重新计算的确定性失败清单；必须修复其中每一项，不得只处理示例或任选部分问题。

修复要求：
1. mechanical_connector_groups 中的每一个分组都必须处理到不再触发机械连接词门槛：同组含“与”的子标题少于 3 个，或占该组全部子标题的比例低于 60%。优先把可独立编写的对象拆为同级小节或精简为单一主题；固定术语和确需共同论述的标题可以保留，但必须通过优化同组其他标题使整个分组退出机械重复状态。
2. 逐项修复其余确定性问题，包括叶子数量、评分映射、评分层级展开、单子节点、非法内容模式和标题风格；不得改动已经通过的用户确认边界。
3. ${scorePlanRule}
4. 保留 ${OUTLINE_REVIEW_FILE} 中已有的 user_feedback，并更新 issues 和 summary，准确说明本次补充修复结果；不得把未修复问题描述为已完成。
5. 覆盖写回 ${OUTLINE_OUTPUT_FILE}、${SCORE_COVERAGE_MAP_FILE} 和 ${OUTLINE_REVIEW_FILE}，不得写回 ${SCORE_DIRECTORY_PLAN_FILE}。对实际写入的 JSON 文件分别调用 json-validation 校验，只传 file_path；校验失败后先修改再重新校验。`;
}

// 运行 V2 目录业务任务；开发者模式下一级目录确认后并行调度目录任务和独立模版提取任务。
async function runOutlineGenerationTaskV2({ aiService, agentService, ordinaryAgentService, workspaceStore, knowledgeBaseService, knowledgeSession, openXmlHelperService, updateTask, checkpointTask, taskControl, payload }) {
  const storedPlan = workspaceStore.loadTechnicalPlan() || {};
  const restoringOutlineSelection = payload?.agent_resume?.phase === 'outline-selection';
  const standaloneTechnical = storedPlan.outlineMode === 'standalone-technical';
  const technicalScoreHierarchy = standaloneTechnical
    ? deriveTechnicalScoreHierarchy(storedPlan.techRequirements || '')
    : { items: [], rootTitles: [] };
  const hasOriginalPlan = Boolean(storedPlan.originalPlanFile);
  const originalOnly = hasOriginalPlan && storedPlan.outlineExpansionMode === 'original-only';
  const originalPlan = hasOriginalPlan ? workspaceStore.readOriginalPlanMarkdown() : '';
  const responseFileRequirements = storedPlan.bidAnalysisTasks?.responseFileRequirements?.content || '';
  const wordControlOptions = normalizeWordControlOptions(payload?.word_control_options || storedPlan.outlineWordControlOptions);
  const strictMaximumLeafCount = deriveStrictMaximumLeafCount(wordControlOptions);
  let targetLeafCount = deriveTargetLeafCount(wordControlOptions);
  const referenceDocumentIds = normalizeReferenceDocumentIds(storedPlan);
  const knowledgeFiles = buildKnowledgeFiles(knowledgeBaseService, referenceDocumentIds);
  const jsonValidationSchemas = {
    [OUTLINE_OUTPUT_FILE]: OUTLINE_JSON_SCHEMA,
    [TECHNICAL_SCORE_GROUPS_FILE]: TECHNICAL_SCORE_GROUPS_SCHEMA,
    [SCORE_DIRECTORY_PLAN_FILE]: SCORE_DIRECTORY_PLAN_SCHEMA,
    [SCORE_COVERAGE_MAP_FILE]: SCORE_COVERAGE_MAP_SCHEMA,
    [LEAF_ALLOCATION_FILE]: createLeafAllocationSchema(standaloneTechnical ? 1 : 2),
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
      ? '严格按照技术评分信息.md 组织技术方案独立分册。评分条目原文、顺序和数量是后续评分条目层的权威依据；只有直接上级类型为业务分组且层级依据类型和说明有效时才使用直接上级名称作为一级目录，其余评分项分别作为一级目录，绝不按标题字样、语义或相邻关系推断合并。响应文件要求.md 只提供装订和响应约束，项目概述.md 仅用于理解背景和术语，原方案.md 仅用于参考下级标题表达。'
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
  let technicalBranches = [];
  let scorePlan = null;
  let scoreDirectoryPlan = null;
  let scoreCoverageMap = null;
  let allowRootChanges = false;
  let fixedAiLeafCount = 0;
  let allocatedAiLeafCount = null;
  let finalOutline = null;
  let actualLeafCount = 0;
  let leafWarning = '';
  let acceptedLeafCount = null;
  let wordAdjustmentAttempts = 0;
  let outlineReview = null;
  let outlineReviewCorrectionAttempts = 0;

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

  function continueWithChildrenGeneration(allocations) {
    publish('技术方案目录已确认，开始生成子目录', 55, {
      outline: {
        phase: 'generating',
        current_leaf_count: 0,
        target_leaf_count: targetLeafCount,
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
          path: LEAF_ALLOCATION_FILE,
          content: JSON.stringify({
            mode: targetLeafCount === null ? 'agent-decides' : 'allocated',
            target_ai_leaf_count: targetLeafCount,
            fixed_ai_leaf_count: fixedAiLeafCount,
            allocatable_ai_leaf_count: allocatedAiLeafCount,
            allocations,
          }, null, 2),
        },
        {
          path: 'outline-capacity-reference.json',
          content: JSON.stringify(buildCapacityReference(wordControlOptions), null, 2),
        },
      ],
    };
  }

  function continueWithOutlineReview() {
    const sourceValidation = validateFinalOutline({
      outline: finalOutline,
      scorePlan,
      scoreCoverageMap,
    });
    const reviewContext = {
      ...buildOutlineReviewContext({
        outline: finalOutline,
        scoreDirectoryPlan,
        targetLeafCount,
        standaloneTechnical,
        acceptedLeafCount,
        maximumLeafCount: strictMaximumLeafCount,
      }),
      mandatory_issues: sourceValidation.mandatoryIssues,
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
      prompt: createOutlineReviewPrompt({
        targetLeafCount,
        actualLeafCount,
        allowRootChanges,
        standaloneTechnical,
        acceptedLeafCount,
        maximumLeafCount: strictMaximumLeafCount,
      }),
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
      prompt: createInitialPrompt(taskInstruction, {
        standaloneTechnical,
        expectedRootTitles: technicalScoreHierarchy.rootTitles,
      }),
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
    const items = standaloneTechnical
      ? normalizeOutlineScoreMetadataTitles(generated.outline || [])
      : generated.outline || [];
    if (standaloneTechnical) assertStandaloneTechnicalRoots(items, technicalScoreHierarchy);
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
      if (meta.workflow_stage === 'outline_review' || meta.workflow_stage === 'outline_review_correction') {
        const reviewedOutline = readJson(candidate.output_content, OUTLINE_OUTPUT_FILE);
        const normalizedReviewedOutline = buildFinalOutline(reviewedOutline);
        outlineReview = readJson(await meta.readFile(OUTLINE_REVIEW_FILE), OUTLINE_REVIEW_FILE);
        scoreCoverageMap = normalizeScoreCoverageMap(
          readJson(await meta.readFile(SCORE_COVERAGE_MAP_FILE), SCORE_COVERAGE_MAP_FILE),
          scorePlan,
        );
        finalOutline = normalizedReviewedOutline;
        const reviewedScoreDirectoryPlan = standaloneTechnical
          ? readJson(await meta.readFile(SCORE_DIRECTORY_PLAN_FILE), SCORE_DIRECTORY_PLAN_FILE)
          : scoreDirectoryPlan;
        scoreDirectoryPlan = synchronizeScoreDirectoryPlan(
          mergeReviewedScoreDirectoryPlan(scoreDirectoryPlan, reviewedScoreDirectoryPlan, { standaloneTechnical }),
          finalOutline.outline,
        );
        actualLeafCount = countAiLeaves(finalOutline.outline);
        const verifiedReviewContext = buildOutlineReviewContext({
          outline: finalOutline,
          scoreDirectoryPlan,
          targetLeafCount,
          standaloneTechnical,
          acceptedLeafCount,
          maximumLeafCount: strictMaximumLeafCount,
        });
        const finalValidation = validateFinalOutline({
          outline: finalOutline,
          scorePlan,
          scoreCoverageMap,
        });
        const deterministicReviewPassed = finalValidation.valid
          && verifiedReviewContext.leaf_count.valid
          && verifiedReviewContext.structure.valid
          && verifiedReviewContext.score_mapping.valid
          && verifiedReviewContext.professional_structure.valid;
        if (!deterministicReviewPassed) {
          if (outlineReviewCorrectionAttempts >= MAX_OUTLINE_REVIEW_CORRECTIONS) {
            const details = finalValidation.mandatoryIssues.map((issue) => issue.message).join('；');
            throw new Error(`目录最终审核经过自动复检修复后仍存在叶子数量、评分来源映射、层级展开或标题风格问题${details ? `：${details}` : ''}`);
          }
          outlineReviewCorrectionAttempts += 1;
          publish(`目录最终审核仍有未修复问题，正在进行第 ${outlineReviewCorrectionAttempts} 次自动复检修复`, 90, {
            outline: {
              phase: 'reviewing',
              current_leaf_count: actualLeafCount,
              target_leaf_count: targetLeafCount,
              word_adjustment_attempts: wordAdjustmentAttempts,
            },
          });
          return {
            stage: 'outline_review_correction',
            message: `Agent 正在进行第 ${outlineReviewCorrectionAttempts} 次目录复检修复`,
            prompt: createOutlineReviewCorrectionPrompt({
              standaloneTechnical,
              attempt: outlineReviewCorrectionAttempts,
            }),
            files: [
              { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify(finalOutline, null, 2) },
              { path: TECHNICAL_SCORE_GROUPS_FILE, content: JSON.stringify(scorePlan, null, 2) },
              { path: SCORE_DIRECTORY_PLAN_FILE, content: JSON.stringify(scoreDirectoryPlan, null, 2) },
              { path: SCORE_COVERAGE_MAP_FILE, content: JSON.stringify(scoreCoverageMap, null, 2) },
              { path: OUTLINE_REVIEW_CONTEXT_FILE, content: JSON.stringify(verifiedReviewContext, null, 2) },
              { path: OUTLINE_REVIEW_FILE, content: JSON.stringify(outlineReview, null, 2) },
            ],
          };
        }
        await meta.writeFiles([
          { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify(finalOutline, null, 2) },
          { path: SCORE_DIRECTORY_PLAN_FILE, content: JSON.stringify(scoreDirectoryPlan, null, 2) },
          { path: SCORE_COVERAGE_MAP_FILE, content: JSON.stringify(scoreCoverageMap, null, 2) },
        ]);
        if (targetLeafCount !== null) {
          if (actualLeafCount === targetLeafCount) {
            leafWarning = '';
            acceptedLeafCount = null;
          } else if (leafWarning) {
            leafWarning = `AI 生成小节目标为 ${targetLeafCount}，用户已确认最终保留当前 ${actualLeafCount} 个。`;
          }
        }
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
        scoreDirectoryPlan = normalizeScoreDirectoryPlanTitles(
          readJson(await meta.readFile(SCORE_DIRECTORY_PLAN_FILE), SCORE_DIRECTORY_PLAN_FILE),
        );
        if (standaloneTechnical) {
          const scorePlanningAnswer = [...meta.user_question_answers]
            .reverse()
            .find((item) => item.workflow_stage === 'score-planning');
          const hasUserAdjustmentApproval = scorePlanningAnswer?.selected_option === '按上述调整生成'
            || scorePlanningAnswer?.is_custom === true;
          assertStandaloneScoreDirectoryPlan(scoreDirectoryPlan, technicalScoreHierarchy, lockedRoots, {
            hasUserAdjustmentApproval,
          });
        }
        await meta.writeFiles([{
          path: SCORE_DIRECTORY_PLAN_FILE,
          content: JSON.stringify(scoreDirectoryPlan, null, 2),
        }]);
        lockedRoots = attachBranchIdsToRoots(lockedRoots, scoreDirectoryPlan);
        technicalBranches = scoreDirectoryPlan.branches.map((branch) => ({
          branch_id: branch.branch_id,
          root_id: branch.root_id.split('.')[0],
          root_title: branch.root_title,
        }));
        allowRootChanges = scoreDirectoryPlan.allow_root_changes === true;
        fixedAiLeafCount = lockedRoots
          .filter((root) => !root.branch_id && root.content_mode === AI_CONTENT_MODE).length;
        if (standaloneTechnical) {
          const requestedLeafTarget = targetLeafCount;
          const semanticMinimumLeafCount = deriveSemanticMinimumLeafTarget(scoreDirectoryPlan, fixedAiLeafCount);
          targetLeafCount = enforceMinimumLeafTarget(
            targetLeafCount,
            fixedAiLeafCount,
            technicalBranches.length,
            wordControlOptions,
            semanticMinimumLeafCount,
          );
          if (requestedLeafTarget !== null && targetLeafCount !== requestedLeafTarget) {
            publish(`已按评分条目递进展开要求与严格字数上限将 AI 生成叶子目标从 ${requestedLeafTarget} 调整为 ${targetLeafCount}`, 50);
          }
        }
        allocatedAiLeafCount = targetLeafCount === null ? null : targetLeafCount - fixedAiLeafCount;
        if (allocatedAiLeafCount !== null && technicalBranches.length > 1) {
          publish('技术方案目录已确认，Agent 正在分配 AI 生成小节', 50);
          return {
            stage: 'leaf_allocation',
            message: 'Agent 正在分配 AI 生成小节',
            prompt: createLeafAllocationPrompt({ standaloneTechnical }),
            files: [{
              path: LEAF_ALLOCATION_CONTEXT_FILE,
              content: JSON.stringify({
                mode: 'allocated',
                target_ai_leaf_count: targetLeafCount,
                fixed_ai_leaf_count: fixedAiLeafCount,
                allocatable_ai_leaf_count: allocatedAiLeafCount,
                technical_branches: technicalBranches,
              }, null, 2),
            }],
          };
        }
        const allocations = allocatedAiLeafCount === null
          ? technicalBranches.map((branch) => ({ branch_id: branch.branch_id }))
          : [{ branch_id: technicalBranches[0].branch_id, leaf_count: allocatedAiLeafCount }];
        return continueWithChildrenGeneration(allocations);
      }

      if (meta.workflow_stage === 'leaf_allocation') {
        const allocationPayload = readJson(await meta.readFile(LEAF_ALLOCATION_FILE), LEAF_ALLOCATION_FILE);
        return continueWithChildrenGeneration(allocationPayload.allocations);
      }

      const candidateOutline = readJson(candidate.output_content, OUTLINE_OUTPUT_FILE);
      finalOutline = buildFinalOutline(candidateOutline);
      scoreDirectoryPlan = synchronizeScoreDirectoryPlan(scoreDirectoryPlan, finalOutline.outline);
      actualLeafCount = countAiLeaves(finalOutline.outline);
      scoreCoverageMap = normalizeScoreCoverageMap(
        readJson(await meta.readFile(SCORE_COVERAGE_MAP_FILE), SCORE_COVERAGE_MAP_FILE),
        scorePlan,
      );
      const latestLeafAnswer = meta.workflow_stage === 'leaf_adjustment'
        ? [...meta.user_question_answers].reverse().find((item) => item.workflow_stage === 'leaf_adjustment')
        : null;
      if (latestLeafAnswer && latestLeafAnswer.selected_option !== '接受当前结果') {
        wordAdjustmentAttempts += 1;
      }
      const leafCountReadyForReview = targetLeafCount === null
        || (standaloneTechnical
          ? isLeafCountWithinRange(targetLeafCount, actualLeafCount, { soft: true, maximum: strictMaximumLeafCount })
          : actualLeafCount === targetLeafCount);
      if (leafCountReadyForReview) return continueWithOutlineReview();

      if (latestLeafAnswer?.selected_option === '接受当前结果') {
        acceptedLeafCount = actualLeafCount;
        leafWarning = `AI 生成小节目标为 ${targetLeafCount}，用户已接受当前 ${actualLeafCount} 个。`;
        return continueWithOutlineReview();
      }

      publish('AI 生成小节数量存在差异，等待用户决定', 75, {
        outline: {
          phase: 'word-adjusting',
          current_leaf_count: actualLeafCount,
          target_leaf_count: targetLeafCount,
          word_adjustment_attempts: wordAdjustmentAttempts,
        },
      });
      return {
        stage: 'leaf_adjustment',
        message: 'Agent 正在询问如何处理小节数量差异',
        prompt: createLeafAdjustmentPrompt(targetLeafCount, actualLeafCount, {
          standaloneTechnical,
          maximumLeafCount: strictMaximumLeafCount,
        }),
        files: [
          { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify(finalOutline, null, 2) },
          { path: SCORE_DIRECTORY_PLAN_FILE, content: JSON.stringify(scoreDirectoryPlan, null, 2) },
          { path: SCORE_COVERAGE_MAP_FILE, content: JSON.stringify(scoreCoverageMap, null, 2) },
        ],
      };
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
  const persistedFinalOutline = normalizeOutlineHeadingTitles(stripOutlineInternalFields(finalOutline));
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
        target_leaf_count: targetLeafCount,
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
  OUTLINE_WORKING_JSON_SCHEMA,
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
  createLeafAdjustmentPrompt,
  createOutlineReviewPrompt,
  deriveAcceptableLeafRange,
  deriveSemanticMinimumLeafTarget,
  enforceMinimumLeafTarget,
  buildCapacityReference,
  buildOutlineReviewContext,
  normalizeScoreCoverageMap,
  validateFinalOutline,
  buildRemoteKnowledgeFile,
  mergeReviewedScoreDirectoryPlan,
  deriveTechnicalScoreHierarchy,
  normalizeOutlineScoreMetadataTitles,
  normalizeScoreDirectoryPlanTitles,
  assertStandaloneTechnicalRoots,
  assertStandaloneScoreDirectoryPlan,
};
