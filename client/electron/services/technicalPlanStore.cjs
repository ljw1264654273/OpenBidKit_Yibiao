const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
const {
  getTechnicalPlanBidTemplatePath,
  getTechnicalPlanBidTemplateSourcePath,
  getTechnicalPlanBidTemplateFieldsPath,
  getTechnicalPlanGeneratedIllustrationsDir,
  getTechnicalPlanIllustrationsDir,
  getTechnicalPlanOriginalPlanMarkdownPath,
  getTechnicalPlanTenderMarkdownPath,
  getTechnicalPlanTenderOriginalsDir,
  getGeneratedImagesDir,
  getWorkspaceTrashDir,
  getBidProjectTechnicalPlanDir,
} = require('../utils/paths.cjs');
const { getTechnicalPlanProjectTablePrefix } = require('./sqliteDatabase.cjs');
const { deleteImportedImageBatches } = require('../utils/importedImages.cjs');
const { clearMermaidCache } = require('../utils/mermaidCache.cjs');
const { assertSupportedMermaidSyntax } = require('../utils/mermaidPolicy.cjs');
const { detectBidSections } = require('../utils/bidSectionDetector.cjs');
const { compactLogError, createDeveloperLogger } = require('../utils/developerLog.cjs');
const { forceRemoveSync, isFileLockError } = require('../utils/forceRemove.cjs');
const {
  OUTLINE_AGENT_TASK_KEY,
  TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
} = require('./outlineGenerationAgentV2Config.cjs');
const { GLOBAL_FACTS_AGENT_TASK_KEY } = require('./globalFactsAgentV2Config.cjs');
const { normalizeOutlineHeadingTitles } = require('./mandatoryBidContentRules.cjs');
const { reviewHistoricalAdaptationContent } = require('./historicalAdaptationReviewRules.cjs');
const { getProjectAgentTaskKey } = require('./agentTaskKeys.cjs');
const { buildIllustrationBlock, replaceIllustrationBlock } = require('./contentIllustrationReview.cjs');
const { normalizeHistoricalAdaptationDifferences } = require('./historicalAdaptationDifferenceTask.cjs');
const { normalizeHistoricalAdaptationOutlineChanges } = require('./historicalAdaptationOutlineTask.cjs');
const {
  RULE_ENGINE_VERSION: HISTORICAL_ADAPTATION_RULE_ENGINE_VERSION,
  FACT_SCHEMA_VERSION: HISTORICAL_ADAPTATION_FACT_SCHEMA_VERSION,
  REPAIR_PROTOCOL_VERSION: HISTORICAL_ADAPTATION_REPAIR_PROTOCOL_VERSION,
} = require('./historicalAdaptationContentCheckProtocol.cjs');
const {
  assertContentPrerequisites,
  buildHistoricalContentItems,
  getEffectiveMode,
  normalizeHistoricalAdaptationContentItems,
  scanHistoricalResiduals,
} = require('./historicalAdaptationContentTask.cjs');
const {
  reconcileIllustrationItems,
  removeIllustrationBlock,
  getIllustrationTargetNodeId,
} = require('./technicalPlanIllustrationReconciliation.cjs');

const tenderMarkdownRelativePath = path.join('technical-plan', 'tender.md').replace(/\\/g, '/');
const tenderOriginalMarkdownRelativePath = path.join('technical-plan', 'tender-original.md').replace(/\\/g, '/');
const tenderSourceFilesDirRelativePath = path.join('technical-plan', 'tender-files').replace(/\\/g, '/');
const tenderOriginalsDirRelativePath = path.join('technical-plan', 'tender-originals').replace(/\\/g, '/');
const bidTemplateRelativePath = path.join('technical-plan', 'bid-template.docx').replace(/\\/g, '/');
const bidTemplateSourceRelativePath = path.join('technical-plan', 'bid-template-source.docx').replace(/\\/g, '/');
const bidTemplateFieldsRelativePath = path.join('technical-plan', 'bid-template-fields.json').replace(/\\/g, '/');
const originalPlanMarkdownRelativePath = path.join('technical-plan', 'original-plan.md').replace(/\\/g, '/');
const originalOutlineRuntimeFileName = 'original-outline-runtime.json';
const defaultOutlineWordControlOptions = Object.freeze({
  enabled: false,
  minimumWords: 550000,
  maximumWords: 650000,
  sectionWords: 1800,
  strictSectionWords: false,
});
const variantOutlineWordControlOptions = Object.freeze({
  minimumWords: 40000,
  maximumWords: 60000,
  sectionWords: 1800,
  strictSectionWords: false,
});
const defaultOutlineMinimumDepth = 0;
const variantContentGenerationOptions = Object.freeze({
  imagePreset: 'text-only',
  useAiImages: false,
  maxAiImages: 0,
  useMermaidImages: false,
  useAiRedesignForMermaid: false,
  maxMermaidImages: 0,
  useHtmlImages: false,
  maxHtmlImages: 0,
  tableRequirement: 'light',
  maxTables: 3,
});

const initialState = {
  workflowKind: 'technical-plan',
  step: 'document-analysis',
  tenderFile: null,
  tenderFiles: [],
  originalPlanFile: null,
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key',
  bidAnalysisSelectedTaskIds: [],
  bidAnalysisTasks: {},
  bidAnalysisProgress: 0,
  historicalAdaptationDifferences: [],
  historicalAdaptationDifferenceConfirmedAt: undefined,
  historicalAdaptationOriginalOutline: null,
  historicalAdaptationOutlineChanges: [],
  historicalAdaptationOutlineConfirmedAt: undefined,
  historicalAdaptationContentItems: [],
  historicalAdaptationContentConfirmedAt: undefined,
  historicalAdaptationContentCheck: { status: 'idle', findings: [] },
  historicalAdaptationReviewFindings: [],
  historicalAdaptationReviewConfirmedAt: undefined,
  bidSectionMode: 'single',
  bidSections: [],
  bidSectionExtractionStatus: 'idle',
  bidSectionExtractionError: undefined,
  outlineMode: 'standalone-technical',
  outlineExpansionMode: 'ai-complement',
  outlineWordControlOptions: { ...defaultOutlineWordControlOptions },
  outlineWordControlSnapshot: undefined,
  outlineMinimumDepth: defaultOutlineMinimumDepth,
  outlineMinimumDepthSnapshot: undefined,
  referenceKnowledgeDocumentIds: [],
  remoteKnowledgeScopes: [],
  bidSectionExtractionTask: undefined,
  bidAnalysisTask: undefined,
  historicalAdaptationDifferenceTask: undefined,
  historicalAdaptationOutlineTask: undefined,
  historicalAdaptationContentTask: undefined,
  historicalAdaptationContentCheckTask: undefined,
  outlineGenerationTask: undefined,
  globalFactsMode: 'omit',
  globalFactsTask: undefined,
  globalFacts: [],
  contentGenerationTask: undefined,
  variantDeduplicationTask: undefined,
  contentGenerationOptions: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  contentIllustrationPlan: undefined,
  contentGenerationRuntime: undefined,
  bidTemplateExists: false,
  outlineData: null,
};

const taskFieldTypes = {
  bidSectionExtractionTask: 'bid-section-extraction',
  bidAnalysisTask: 'bid-analysis',
  historicalAdaptationDifferenceTask: 'historical-adaptation-difference',
  historicalAdaptationOutlineTask: 'historical-adaptation-outline',
  historicalAdaptationContentTask: 'historical-adaptation-content',
  historicalAdaptationContentCheckTask: 'historical-adaptation-content-check',
  outlineGenerationTask: 'outline-generation',
  outlineAdjustmentTask: 'outline-adjustment',
  globalFactsTask: 'global-facts-generation',
  globalFactsAdjustmentTask: 'global-facts-adjustment',
  contentGenerationTask: 'content-generation',
  variantDeduplicationTask: 'variant-deduplication',
};

const taskTypeFields = Object.fromEntries(Object.entries(taskFieldTypes).map(([field, type]) => [type, field]));

function readHistoricalAdaptationDifferences(value) {
  return normalizeHistoricalAdaptationDifferences(safeJsonParse(value, []));
}

const originalPlanDownstreamTaskTypes = Object.freeze([
  'historical-adaptation-difference',
  'historical-adaptation-outline',
  'historical-adaptation-content',
  'outline-generation',
  'outline-adjustment',
  'global-facts-generation',
  'global-facts-adjustment',
  'content-generation',
]);

function appendImportFailureParts(messageParts, errors) {
  const failed = Array.isArray(errors)
    ? errors.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!failed.length) return;
  messageParts.push(`失败 ${failed.length} 份`);
  messageParts.push(failed.join('；'));
}

function now() {
  return new Date().toISOString();
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function isEmptyObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function stableHash(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function historicalAdaptationProtocolHash(inputsHash) {
  return stableHash(JSON.stringify({
    inputsHash,
    rule_engine_version: HISTORICAL_ADAPTATION_RULE_ENGINE_VERSION,
    fact_schema_version: HISTORICAL_ADAPTATION_FACT_SCHEMA_VERSION,
    repair_protocol_version: HISTORICAL_ADAPTATION_REPAIR_PROTOCOL_VERSION,
    optimization_version: require('./historicalAdaptationContentCheckOptimization.cjs').OPTIMIZATION_VERSION,
  }));
}

function normalizeHistoricalAdaptationContentCheck(value) {
  const source = value && typeof value === 'object' ? value : {};
  const status = ['idle', 'running', 'success', 'stale', 'error'].includes(source.status) ? source.status : 'idle';
  const stages = ['precheck', 'facts', 'semantic', 'repair', 'recheck'];
  const numberOrZero = (field) => Number.isFinite(Number(source[field])) && Number(source[field]) >= 0 ? Number(source[field]) : 0;
  return {
    status,
    stage: stages.includes(source.stage) ? source.stage : undefined,
    findings: Array.isArray(source.findings) ? source.findings : [],
    checked_content_hash: String(source.checked_content_hash || ''),
    checked_inputs_hash: String(source.checked_inputs_hash || ''),
    checked_facts_hash: String(source.checked_facts_hash || ''),
    checked_protocol_inputs_hash: String(source.checked_protocol_inputs_hash || ''),
    rule_engine_version: Number(source.rule_engine_version) || 0,
    fact_schema_version: Number(source.fact_schema_version) || 0,
    repair_protocol_version: Number(source.repair_protocol_version) || 0,
    auto_repaired_count: numberOrZero('auto_repaired_count'),
    manual_count: numberOrZero('manual_count'),
    repair_round: numberOrZero('repair_round'),
    checked_at: source.checked_at ? String(source.checked_at) : undefined,
    error: source.error ? String(source.error) : undefined,
  };
}

function normalizeHistoricalAdaptationContentFactOverrides(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => ({
      fact_key: String(item?.fact_key || '').trim(),
      canonical_value: String(item?.canonical_value ?? item?.value ?? '').trim(),
      kind: String(item?.kind || '').trim(),
      basis: String(item?.basis || 'manual').trim() || 'manual',
      note: String(item?.note || '').trim(),
      updated_at: item?.updated_at ? String(item.updated_at) : undefined,
    }))
    .filter((item) => item.fact_key && item.canonical_value)
    .filter((item) => {
      if (seen.has(item.fact_key)) return false;
      seen.add(item.fact_key);
      return true;
    })
    .sort((a, b) => a.fact_key.localeCompare(b.fact_key));
}

function canonicalHistoricalAdaptationContentFactOverrides(value) {
  return normalizeHistoricalAdaptationContentFactOverrides(value).map((item) => ({
    fact_key: item.fact_key,
    canonical_value: item.canonical_value,
    kind: item.kind,
    basis: item.basis,
    note: item.note,
  }));
}

const HISTORICAL_ADAPTATION_CONTENT_CHECK_BATCH_STATUSES = Object.freeze([
  'pending', 'running', 'success', 'failed-retryable', 'failed-manual', 'stale',
]);

function normalizeHistoricalAdaptationContentCheckBatchStatus(value, fallback = 'pending') {
  const status = String(value || '').trim();
  return HISTORICAL_ADAPTATION_CONTENT_CHECK_BATCH_STATUSES.includes(status) ? status : fallback;
}

function safeFileNamePart(value) {
  return String(value || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'file';
}

/** 生成符合当前文件系统大小写规则的路径比较键。 */
function filePathKey(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function createTenderSourceId(fileName, markdown, index) {
  const hash = stableHash(`${fileName}\n${markdown}`).slice(0, 12);
  return `tender-${String(index + 1).padStart(2, '0')}-${hash}`;
}

function combineTenderMarkdown(markdowns) {
  return (Array.isArray(markdowns) ? markdowns : [])
    .map((markdown) => String(markdown || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function toDbBool(value) {
  return value ? 1 : 0;
}

function fromDbBool(value) {
  return Number(value) === 1;
}

function normalizeStatus(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeWorkflowKind(value) {
  return value === 'existing-plan-expansion' ? 'existing-plan-expansion' : 'technical-plan';
}

function defaultOutlineModeForWorkflow(workflowKind) {
  return normalizeWorkflowKind(workflowKind) === 'existing-plan-expansion'
    ? 'aligned'
    : 'standalone-technical';
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

// 统一 Step03 当前设置和目录快照的字段语义。
function normalizeOutlineWordControlOptions(value) {
  const sectionWords = normalizeNonNegativeInteger(value?.sectionWords);
  return {
    minimumWords: normalizeNonNegativeInteger(value?.minimumWords),
    maximumWords: normalizeNonNegativeInteger(value?.maximumWords),
    sectionWords,
    strictSectionWords: sectionWords > 0 && Boolean(value?.strictSectionWords),
  };
}

function normalizeOutlineMinimumDepth(value) {
  const number = Number(value);
  return number === 3 || number === 4 || number === 5 ? number : defaultOutlineMinimumDepth;
}

function isValidStep(value) {
  return ['document-analysis', 'bid-analysis', 'outline-generation', 'global-facts', 'content-edit', 'expand'].includes(value);
}

function normalizeGlobalFactId(value, index) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id || `fact_${String(index + 1).padStart(3, '0')}`;
}

function isValidBidMode(value) {
  return value === 'key' || value === 'full' || value === 'custom';
}

function normalizeBidSectionMode(value) {
  return value === 'multiple' ? 'multiple' : 'single';
}

function normalizeBidSectionExtractionStatus(value) {
  return normalizeStatus(value, ['idle', 'running', 'success', 'error'], 'idle');
}

function normalizeBidSectionRanges(value) {
  return (Array.isArray(value) ? value : [])
    .map((range) => ({
      startLine: Math.max(1, Math.floor(Number(range?.startLine || range?.start_line || 0))),
      endLine: Math.max(1, Math.floor(Number(range?.endLine || range?.end_line || 0))),
      reason: range?.reason ? String(range.reason) : undefined,
    }))
    .filter((range) => range.startLine > 0 && range.endLine >= range.startLine);
}

function normalizeBidSections(value) {
  return (Array.isArray(value) ? value : [])
    .map((section, index) => {
      const normalizedIndex = Number(section?.index || index + 1);
      const title = String(section?.title || '').trim();
      return {
        id: String(section?.id || `section-${normalizedIndex || index + 1}`).trim(),
        index: Number.isFinite(normalizedIndex) && normalizedIndex > 0 ? normalizedIndex : index + 1,
        unit: String(section?.unit || '标段').trim() || '标段',
        title,
        headLine: String(section?.headLine || section?.head_line || ''),
        description: String(section?.description || ''),
        includeRanges: normalizeBidSectionRanges(section?.includeRanges || section?.include_ranges),
        evidence: (Array.isArray(section?.evidence) ? section.evidence : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      };
    })
    .filter((section) => section.id && section.title);
}

function expandLineRanges(ranges, totalLines) {
  const lines = new Set();
  for (const range of normalizeBidSectionRanges(ranges)) {
    const start = Math.max(1, Math.min(totalLines, range.startLine));
    const end = Math.max(start, Math.min(totalLines, range.endLine));
    for (let line = start; line <= end; line += 1) {
      lines.add(line);
    }
  }
  return lines;
}

function buildSelectedSectionMarkdown(markdown, sections, selectedSectionId) {
  const sourceLines = String(markdown || '').split(/\r?\n/);
  const totalLines = sourceLines.length;
  const selected = sections.find((section) => section.id === selectedSectionId);
  if (!selected) {
    throw new Error('未找到选择的投标范围');
  }
  if (!normalizeBidSectionRanges(selected.includeRanges).length) {
    throw new Error('当前标段缺少有效范围，请重新识别');
  }

  const selectedLines = expandLineRanges(selected.includeRanges, totalLines);
  const otherLines = new Set();
  for (const section of sections) {
    if (section.id === selected.id) continue;
    for (const line of expandLineRanges(section.includeRanges, totalLines)) {
      otherLines.add(line);
    }
  }

  const filtered = sourceLines.filter((_, index) => {
    const lineNumber = index + 1;
    return !otherLines.has(lineNumber) || selectedLines.has(lineNumber);
  }).join('\n').trim();

  if (!filtered) {
    throw new Error('生成投标范围工作副本失败，请重新提取标段');
  }
  return filtered;
}

function getAllBidAnalysisTasks() {
  return getBidAnalysisTasks('full');
}

function getRequiredBidAnalysisTaskIds() {
  return getBidAnalysisTasks('key').map((task) => task.id);
}

function normalizeBidAnalysisTaskIds(taskIds) {
  const requestedIds = new Set((Array.isArray(taskIds) ? taskIds : [])
    .map((taskId) => String(taskId || '').trim())
    .filter(Boolean));
  return getAllBidAnalysisTasks()
    .filter((task) => requestedIds.has(task.id))
    .map((task) => task.id);
}

function normalizeBidAnalysisConfig(mode, selectedTaskIds) {
  const allTaskIds = getAllBidAnalysisTasks().map((task) => task.id);
  const requiredTaskIds = getRequiredBidAnalysisTaskIds();
  const requiredSet = new Set(requiredTaskIds);
  const selectedSet = new Set([...requiredTaskIds, ...normalizeBidAnalysisTaskIds(selectedTaskIds)]);
  const selectedIds = allTaskIds.filter((taskId) => selectedSet.has(taskId));
  const hasOptional = selectedIds.some((taskId) => !requiredSet.has(taskId));
  const hasAll = selectedIds.length === allTaskIds.length;

  if (mode === 'full' || hasAll) {
    return { mode: 'full', selectedTaskIds: allTaskIds };
  }
  if (mode === 'custom' || hasOptional) {
    return { mode: 'custom', selectedTaskIds: selectedIds };
  }
  return { mode: 'key', selectedTaskIds: requiredTaskIds };
}

function getBidAnalysisTaskIdsForConfig(mode, selectedTaskIds) {
  return normalizeBidAnalysisConfig(mode, selectedTaskIds).selectedTaskIds;
}

function isValidOutlineMode(value) {
  return value === 'aligned' || value === 'response-file' || value === 'standalone-technical';
}

function isValidOutlineExpansionMode(value) {
  return value === 'original-only' || value === 'ai-complement';
}

function isValidGlobalFactsMode(value) {
  return value === 'omit' || value === 'placeholder';
}

function normalizeGlobalFactsMode(value) {
  return isValidGlobalFactsMode(value) ? value : 'omit';
}

function collectLeafItems(items) {
  return (items || []).flatMap((item) => item?.children?.length ? collectLeafItems(item.children) : [item]);
}

function flattenOutlineItems(items, parentNodeId = null, level = 1, rows = []) {
  (items || []).forEach((item, index) => {
    const nodeId = String(item?.id || '').trim();
    if (!nodeId) return;
    rows.push({
      node_id: nodeId,
      parent_node_id: parentNodeId,
      sort_order: index,
      level,
      title: String(item?.title || '未命名章节').trim() || '未命名章节',
      description: String(item?.description || '').trim(),
      content_mode: item?.children?.length ? null : String(item?.content_mode || '').trim() || null,
      content_mode_note: item?.children?.length || item?.content_mode !== 'other' ? null : String(item?.content_mode_note || '').trim() || null,
      source_requirement_id: item?.source_requirement_id ? String(item.source_requirement_id) : null,
      source_requirement_title: item?.source_requirement_title ? String(item.source_requirement_title) : null,
      knowledge_item_ids_json: Array.isArray(item?.knowledge_item_ids) && item.knowledge_item_ids.length ? JSON.stringify(item.knowledge_item_ids) : null,
      knowledge_folder_ids_json: Array.isArray(item?.knowledge_folder_ids) && item.knowledge_folder_ids.length ? JSON.stringify(item.knowledge_folder_ids) : null,
      knowledge_document_ids_json: Array.isArray(item?.knowledge_document_ids) && item.knowledge_document_ids.length ? JSON.stringify(item.knowledge_document_ids) : null,
      content: String(item?.content || ''),
    });
    if (item?.children?.length) {
      flattenOutlineItems(item.children, nodeId, level + 1, rows);
    }
  });
  return rows;
}

function clearOutlineItemContent(items) {
  return (items || []).map((item) => ({
    ...item,
    content: '',
    children: item?.children?.length ? clearOutlineItemContent(item.children) : item.children,
  }));
}

function clearOutlineDataContent(outlineData) {
  if (!outlineData?.outline?.length) return outlineData;
  return { ...outlineData, outline: clearOutlineItemContent(outlineData.outline) };
}

const outlineSaveReasons = new Set(['sort', 'edit', 'delete', 'add-root', 'add-child', 'add-parent', 'replace']);

function normalizeOutlineSaveReason(value) {
  return outlineSaveReasons.has(value) ? value : 'replace';
}

function normalizeStringMap(value) {
  const entries = value && typeof value === 'object' ? Object.entries(value) : [];
  const map = new Map();
  for (const [from, to] of entries) {
    const fromId = String(from || '').trim();
    const toId = String(to || '').trim();
    if (fromId && toId) map.set(fromId, toId);
  }
  return map;
}

function normalizeStringSet(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean));
}

function normalizeStringList(value) {
  return [...normalizeStringSet(value)];
}

function reverseIdMap(idMap) {
  const reversed = new Map();
  for (const [oldId, newId] of idMap.entries()) {
    reversed.set(newId, oldId);
  }
  return reversed;
}

function mapOutlineItems(items, mapper) {
  return (items || []).map((item) => {
    const nextItem = mapper(item);
    if (item?.children?.length) {
      nextItem.children = mapOutlineItems(item.children, mapper);
    }
    return nextItem;
  });
}

function remapStringId(value, idMap) {
  const id = String(value || '').trim();
  return idMap.get(id) || id;
}

function remapContentRuntimeIds(runtime, idMap) {
  if (!runtime || typeof runtime !== 'object') return runtime;
  const remapIds = (value) => Array.isArray(value) ? value.map((id) => remapStringId(id, idMap)) : value;
  const itemRounds = runtime.word_adjustment_item_rounds && typeof runtime.word_adjustment_item_rounds === 'object'
    ? Object.fromEntries(Object.entries(runtime.word_adjustment_item_rounds).map(([id, rounds]) => [remapStringId(id, idMap), rounds]))
    : runtime.word_adjustment_item_rounds;
  return {
    ...runtime,
    touched_item_ids: remapIds(runtime.touched_item_ids),
    word_adjustment_item_id: remapStringId(runtime.word_adjustment_item_id, idMap),
    word_adjustment_item_rounds: itemRounds,
    word_adjustment_completed_item_ids: remapIds(runtime.word_adjustment_completed_item_ids),
    target_item_id: remapStringId(runtime.target_item_id, idMap),
  };
}

function remapContentTaskStats(stats, idMap) {
  if (!stats?.content) return stats;
  return {
    ...stats,
    content: {
      ...stats.content,
      section_adjustment_item_id: remapStringId(stats.content.section_adjustment_item_id, idMap),
      total_adjustment_item_id: remapStringId(stats.content.total_adjustment_item_id, idMap),
    },
  };
}

function collectOutlineNodeMap(items, result = new Map()) {
  for (const item of items || []) {
    const nodeId = String(item?.id || '').trim();
    if (nodeId) result.set(nodeId, item);
    if (Array.isArray(item?.children)) collectOutlineNodeMap(item.children, result);
  }
  return result;
}

function nextUserSupplementId(records) {
  const maximum = (records || []).reduce((value, record) => {
    const match = /^U([1-9]\d*)$/.exec(String(record?.source_id || ''));
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `U${maximum + 1}`;
}

function updateScoreCoverageForOutlineSave({ coverageMap, suppliedCoverageMap, reason, idMap, affectedIds, previousOutline, nextOutline }) {
  if (suppliedCoverageMap !== undefined) return suppliedCoverageMap;
  if (reason === 'replace') return undefined;
  if (!coverageMap || !Array.isArray(coverageMap.records)) return coverageMap;

  const previousNodes = collectOutlineNodeMap(previousOutline?.outline || []);
  const nextNodes = collectOutlineNodeMap(nextOutline?.outline || []);
  const records = coverageMap.records.map((record) => {
    const oldNodeIds = Array.isArray(record?.node_ids) ? record.node_ids.map(String) : [];
    const touched = oldNodeIds.some((nodeId) => affectedIds.has(nodeId));
    const survivingOldIds = reason === 'delete'
      ? oldNodeIds.filter((nodeId) => !affectedIds.has(nodeId))
      : oldNodeIds;
    const nodeIds = survivingOldIds
      .map((nodeId) => idMap.get(nodeId) || nodeId)
      .filter((nodeId, index, values) => nextNodes.has(nodeId) && values.indexOf(nodeId) === index);

    if (reason === 'delete' && touched) {
      return nodeIds.length
        ? { ...record, node_ids: nodeIds, user_override: 'partially-removed' }
        : { ...record, node_ids: [], coverage_location: 'none', user_override: 'removed' };
    }
    if (reason === 'edit' && touched) {
      return { ...record, node_ids: nodeIds, user_override: 'renamed' };
    }
    return { ...record, node_ids: nodeIds };
  });

  if (reason === 'add-root' || reason === 'add-child' || reason === 'add-parent') {
    const mappedPreviousIds = new Set(
      [...previousNodes.keys()].map((nodeId) => idMap.get(nodeId) || nodeId),
    );
    for (const [nodeId, node] of nextNodes) {
      if (mappedPreviousIds.has(nodeId)) continue;
      const sourceId = nextUserSupplementId(records);
      records.push({
        source_id: sourceId,
        source_kind: 'user-supplement',
        source_text: String(node?.title || '').trim() || '用户补充目录',
        node_ids: [nodeId],
        coverage_location: 'title',
        user_override: 'added',
        supplement_kind: 'user-added',
      });
    }
  }

  return { ...coverageMap, records };
}

function createTechnicalPlanStore({ app, db: rawDb, fileService, agentService, taskLogStore: rawTaskLogStore, configStore, projectId, onContentChanged }) {
  const projectScoped = Boolean(projectId);
  const projectTablePrefix = projectScoped ? getTechnicalPlanProjectTablePrefix(projectId) : '';
  const tableName = (name) => `${projectTablePrefix || 'technical_plan_'}${name}`;
  const technicalPlanDir = projectScoped
    ? getBidProjectTechnicalPlanDir(app, projectId)
    : require('../utils/paths.cjs').getTechnicalPlanDir(app);
  const projectTable = (name) => tableName(name);
  const originalTechnicalPlanTables = {
    meta: 'technical_plan_meta',
    tasks: 'technical_plan_tasks',
    bidItems: 'technical_plan_bid_items',
    referenceDocs: 'technical_plan_reference_docs',
    remoteScopes: 'technical_plan_remote_knowledge_scopes',
    remoteDocuments: 'technical_plan_remote_knowledge_documents',
    outlineNodes: 'technical_plan_outline_nodes',
    contentSections: 'technical_plan_content_sections',
    contentPlans: 'technical_plan_content_plans',
    globalFacts: 'technical_plan_global_fact_groups',
    illustrationPlans: 'technical_plan_illustration_plans',
    illustrationItems: 'technical_plan_illustration_items',
  };
  const projectTechnicalPlanTables = projectScoped
    ? {
        meta: projectTable('meta'),
        tasks: projectTable('tasks'),
        bidItems: projectTable('bid_items'),
        referenceDocs: projectTable('reference_docs'),
        remoteScopes: projectTable('remote_knowledge_scopes'),
        remoteDocuments: projectTable('remote_knowledge_documents'),
        outlineNodes: projectTable('outline_nodes'),
        contentSections: projectTable('content_sections'),
        contentPlans: projectTable('content_plans'),
        globalFacts: projectTable('global_fact_groups'),
        illustrationPlans: projectTable('illustration_plans'),
        illustrationItems: projectTable('illustration_items'),
      }
    : originalTechnicalPlanTables;
  const technicalPlanTable = (name) => projectTechnicalPlanTables[name];
  const rewriteSql = (sql) => {
    if (!projectScoped || typeof sql !== 'string') return sql;
    let rewritten = sql;
    for (const [key, table] of Object.entries(originalTechnicalPlanTables)) {
      rewritten = rewritten.replace(new RegExp(`\\b${table}\\b`, 'g'), projectTechnicalPlanTables[key]);
    }
    return rewritten;
  };
  const db = projectScoped
    ? new Proxy(rawDb, {
        get(target, property) {
          if (property === 'prepare') return (sql) => target.prepare(rewriteSql(sql));
          if (property === 'exec') return (sql) => target.exec(rewriteSql(sql));
          if (property === 'transaction') {
            return (handler) => target.transaction((...args) => handler(...args));
          }
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      })
    : rawDb;
  const taskLogStore = projectScoped
    ? {
        list: (domain, ...args) => rawTaskLogStore.list(`${domain}:${projectId}`, ...args),
        sync: (domain, ...args) => rawTaskLogStore.sync(`${domain}:${projectId}`, ...args),
        normalizeLogs: rawTaskLogStore.normalizeLogs,
      }
    : rawTaskLogStore;
  const scopedAgentTaskKey = (baseKey) => getProjectAgentTaskKey(baseKey, projectId);
  function deleteOutlineAgentTask() {
    agentService.deletePersistentTask(scopedAgentTaskKey(OUTLINE_AGENT_TASK_KEY));
    agentService.deletePersistentTask(scopedAgentTaskKey(TEMPLATE_EXTRACTION_AGENT_TASK_KEY));
  }
  function deleteGlobalFactsAgentTask() {
    agentService.deletePersistentTask(scopedAgentTaskKey(GLOBAL_FACTS_AGENT_TASK_KEY));
  }
  const tenderMarkdownPath = path.join(technicalPlanDir, 'tender.md');
  const tenderOriginalMarkdownPath = path.join(technicalPlanDir, 'tender-original.md');
  const tenderSourceFilesDir = path.join(technicalPlanDir, 'tender-files');
  const tenderOriginalsDir = path.join(technicalPlanDir, 'tender-originals');
  const bidTemplatePath = path.join(technicalPlanDir, 'bid-template.docx');
  const bidTemplateSourcePath = path.join(technicalPlanDir, 'bid-template-source.docx');
  const bidTemplateFieldsPath = path.join(technicalPlanDir, 'bid-template-fields.json');
  const originalPlanMarkdownPath = path.join(technicalPlanDir, 'original-plan.md');
  const originalOutlineRuntimePath = path.join(path.dirname(originalPlanMarkdownPath), originalOutlineRuntimeFileName);
  const illustrationsDir = projectScoped
    ? path.join(technicalPlanDir, 'illustrations')
    : getTechnicalPlanIllustrationsDir(app);
  const generatedIllustrationsDir = projectScoped
    ? path.join(technicalPlanDir, 'generated-illustrations')
    : getTechnicalPlanGeneratedIllustrationsDir(app);
  const workspaceDir = path.dirname(path.dirname(tenderMarkdownPath));
  const tenderOriginalLogger = createDeveloperLogger({
    app,
    config: configStore?.load?.() || {},
    moduleName: 'technical-plan',
    name: 'tender-original-files',
  });

  const workspaceTrashDir = getWorkspaceTrashDir(app);
  let generatedContentChangedNodeIds = null;

  /**
   * 工作区内的强制删除统一带回收目录兜底:强杀外部占用进程;占用者属于本应用进程(如 Agent 在
   * Main 内的句柄)无法自杀时,登记延迟删除并放行,重启后补删,保证重置/导入不被阻断。
   * 投标模版等以“文件存在”判定状态的路径必须传 deferOnFailure: false,残留会被误认为有效数据。
   */
  function removeWorkspacePathSync(targetPath, onEvent, { deferOnFailure = true } = {}) {
    forceRemoveSync(targetPath, { trashDir: workspaceTrashDir, onEvent, deferOnFailure });
  }

  /** 已在受管原件目录中的文件直接复用，不再复制或重命名。 */
  function getManagedTenderOriginalRelativePath(filePath) {
    const resolvedPath = path.resolve(String(filePath || ''));
    if (filePathKey(path.dirname(resolvedPath)) !== filePathKey(tenderOriginalsDir)) return '';
    return path.relative(workspaceDir, resolvedPath).replace(/\\/g, '/');
  }

  function normalizeIllustrationFilePart(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'illustration';
  }

  function writeIllustrationFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    if (typeof content === 'string') {
      fs.writeFileSync(tempPath, content, 'utf-8');
    } else {
      fs.writeFileSync(tempPath, content);
    }
    fs.renameSync(tempPath, filePath);
  }

  // 根据计划版本和图片项 ID 计算 HTML 源文件的确定性路径。
  function getIllustrationHtmlFile({ revision, itemId }) {
    const safeRevision = normalizeIllustrationFilePart(revision);
    const safeItemId = normalizeIllustrationFilePart(itemId);
    const relativePath = path.join('illustrations', safeRevision, 'html', `${safeItemId}.html`).replace(/\\/g, '/');
    return {
      relativePath,
      filePath: path.join(path.dirname(originalPlanMarkdownPath), relativePath),
    };
  }

  // 独立保存 HTML 图片源文件，供转图失败或任务恢复时复用。
  function saveIllustrationHtml({ revision, itemId, content }) {
    const { relativePath, filePath } = getIllustrationHtmlFile({ revision, itemId });
    writeIllustrationFile(filePath, String(content || ''));
    return { relativePath, filePath };
  }

  // 读取此前已生成的 HTML 图片源文件。
  function readIllustrationHtml(relativePath) {
    const resolvedPath = path.resolve(path.dirname(originalPlanMarkdownPath), String(relativePath || ''));
    const root = `${path.resolve(illustrationsDir)}${path.sep}`;
    if (!resolvedPath.startsWith(root) || !fs.existsSync(resolvedPath)) return '';
    return fs.readFileSync(resolvedPath, 'utf-8');
  }

  // 在计划尚未记录 source_path 时按确定性路径探测已落盘的 HTML。
  function findIllustrationHtml({ revision, itemId }) {
    const entry = getIllustrationHtmlFile({ revision, itemId });
    if (!fs.existsSync(entry.filePath)) return null;
    return { ...entry, content: fs.readFileSync(entry.filePath, 'utf-8') };
  }

  // 保存 HTML 截图 PNG，并返回 Renderer/导出层均可读取的资产 URL。
  function saveIllustrationPng({ revision, itemId, buffer }) {
    const safeRevision = normalizeIllustrationFilePart(revision);
    const safeItemId = normalizeIllustrationFilePart(itemId);
    const filePath = path.join(generatedIllustrationsDir, safeRevision, `${safeItemId}.png`);
    writeIllustrationFile(filePath, buffer);
    return {
      filePath,
      assetUrl: `yibiao-asset://generated-images/technical-plan/illustrations/${encodeURIComponent(safeRevision)}/${encodeURIComponent(`${safeItemId}.png`)}`,
    };
  }

  // 清理技术方案专属的图片源文件和生成图片。
  function clearIllustrationFiles() {
    removeWorkspacePathSync(illustrationsDir);
    removeWorkspacePathSync(generatedIllustrationsDir);
  }
  function resolvePendingTenderMarkdownPath(filePath) {
    return path.resolve(resolveMarkdownPath(filePath));
  }

  function clearTechnicalPlanMermaidCache() {
    try {
      clearMermaidCache(app);
    } catch (error) {
      console.warn('[technical-plan] clear mermaid cache failed', error);
    }
  }

  function shouldClearMermaidCacheForPartial(partial) {
    if (!partial || typeof partial !== 'object') return false;
    if (hasOwn(partial, 'outlineData') && (!partial.outlineData || !partial.outlineData?.outline?.length)) {
      return true;
    }
    return hasOwn(partial, 'contentGenerationSections')
      && hasOwn(partial, 'contentGenerationPlans')
      && isEmptyObject(partial.contentGenerationSections)
      && isEmptyObject(partial.contentGenerationPlans);
  }

  function isPendingTenderMarkdownPath(filePath) {
    const resolvedPath = resolvePendingTenderMarkdownPath(filePath);
    const expectedDir = path.resolve(path.dirname(tenderMarkdownPath));
    return path.dirname(resolvedPath).toLowerCase() === expectedDir.toLowerCase()
      && /^tender-pending-\d+\.tmp\.md$/.test(path.basename(resolvedPath));
  }

  function clearPendingTenderMeta() {
    updateMeta({
      pending_tender_markdown_path: null,
      pending_tender_file_name: null,
      pending_tender_parser_label: null,
      pending_tender_sections_json: null,
      pending_tender_total_declared: null,
      pending_tender_created_at: null,
    });
  }

  function cleanupOrphanPendingTenderFiles(activeMarkdownPath = '') {
    const targetDir = path.dirname(tenderMarkdownPath);
    if (!fs.existsSync(targetDir)) {
      return;
    }
    const activePath = activeMarkdownPath ? path.resolve(activeMarkdownPath).toLowerCase() : '';
    for (const fileName of fs.readdirSync(targetDir)) {
      if (!/^tender-pending-\d+\.tmp\.md$/.test(fileName)) {
        continue;
      }
      const filePath = path.join(targetDir, fileName);
      if (activePath && path.resolve(filePath).toLowerCase() === activePath) {
        continue;
      }
      try {
        const stats = fs.lstatSync(filePath);
        if (stats.isFile()) fs.rmSync(filePath, { force: true });
      } catch {
        // 清理孤儿临时文件失败不影响主流程
      }
    }
  }

  function removePendingTenderMarkdown(markdownPath) {
    const resolvedPath = markdownPath ? resolvePendingTenderMarkdownPath(markdownPath) : '';
    if (!resolvedPath || !isPendingTenderMarkdownPath(resolvedPath) || !fs.existsSync(resolvedPath)) {
      return;
    }
    try {
      const stats = fs.lstatSync(resolvedPath);
      if (stats.isFile()) fs.rmSync(resolvedPath, { force: true });
    } catch {
      // 清理临时文件失败不影响主流程
    }
  }

  function cleanupPendingTenderSelection() {
    const meta = ensureMetaRow();
    const pendingPath = meta.pending_tender_markdown_path || '';
    const markdownPath = pendingPath ? resolvePendingTenderMarkdownPath(pendingPath) : '';
    clearPendingTenderMeta();
    if (!markdownPath || !isPendingTenderMarkdownPath(markdownPath) || !fs.existsSync(markdownPath)) {
      cleanupOrphanPendingTenderFiles();
      return;
    }
    removePendingTenderMarkdown(markdownPath);
    cleanupOrphanPendingTenderFiles();
  }

  function cleanupLegacyPendingTenderState(meta = ensureMetaRow()) {
    const hasPendingMeta = Boolean(
      meta.pending_tender_markdown_path
      || meta.pending_tender_file_name
      || meta.pending_tender_sections_json
      || meta.pending_tender_created_at,
    );
    if (hasPendingMeta) {
      cleanupPendingTenderSelection();
      return true;
    }
    cleanupOrphanPendingTenderFiles();
    return false;
  }

  function ensureMetaRow() {
    const existing = db.prepare('SELECT * FROM technical_plan_meta WHERE id = 1').get();
    if (existing) return existing;
    const timestamp = now();
    db.prepare(`
      INSERT INTO technical_plan_meta (id, workflow_kind, step, bid_analysis_mode, outline_mode, outline_expansion_mode, global_facts_mode, created_at, updated_at)
      VALUES (1, 'technical-plan', 'document-analysis', 'key', 'standalone-technical', 'ai-complement', 'omit', @timestamp, @timestamp)
    `).run({ timestamp });
    return db.prepare('SELECT * FROM technical_plan_meta WHERE id = 1').get();
  }

  function readMetaRow() {
    const meta = db.prepare('SELECT * FROM technical_plan_meta WHERE id = 1').get();
    if (!meta) throw new Error('技术方案数据库尚未初始化');
    return meta;
  }

  function updateMeta(fields) {
    ensureMetaRow();
    if (hasOwn(fields, 'historical_adaptation_content_items_json')) {
      replaceHistoricalContentItems(safeJsonParse(fields.historical_adaptation_content_items_json, []));
    }
    const entries = Object.entries(fields || {}).filter(([key, value]) => value !== undefined && key !== 'historical_adaptation_content_items_json');
    if (!entries.length) return;
    const assignments = entries.map(([key]) => `${key} = @${key}`).join(', ');
    db.prepare(`UPDATE technical_plan_meta SET ${assignments}, updated_at = @updated_at WHERE id = 1`).run({
      ...Object.fromEntries(entries),
      updated_at: now(),
    });
  }

  function readHistoricalContentItems() {
    return normalizeHistoricalAdaptationContentItems(db.prepare(`SELECT item_json FROM technical_plan_historical_content_items
      WHERE project_id = ? ORDER BY sort_order`).all(projectId || '').map((row) => JSON.parse(row.item_json)));
  }

  function readHistoricalContentItem(nodeId) {
    const row = db.prepare('SELECT item_json FROM technical_plan_historical_content_items WHERE project_id = ? AND node_id = ?').get(projectId || '', nodeId);
    return row ? normalizeHistoricalAdaptationContentItems([JSON.parse(row.item_json)])[0] : undefined;
  }

  function writeHistoricalContentItem(item, sortOrder) {
    const existing = db.prepare('SELECT sort_order FROM technical_plan_historical_content_items WHERE project_id = ? AND node_id = ?').get(projectId || '', item.node_id);
    const { source_content: _content, ...stored } = item;
    if (stored.source_version_hash) delete stored.source_excerpt;
    db.prepare(`INSERT INTO technical_plan_historical_content_items
      (project_id, node_id, sort_order, status, source_version_hash, plan_inputs_hash, item_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, node_id) DO UPDATE SET sort_order = excluded.sort_order, status = excluded.status,
        source_version_hash = excluded.source_version_hash, plan_inputs_hash = excluded.plan_inputs_hash,
        item_json = excluded.item_json, updated_at = excluded.updated_at`).run(projectId || '', item.node_id,
      sortOrder ?? existing?.sort_order ?? 0, item.status, item.source_version_hash || null,
      item.input_fingerprint || null, JSON.stringify(stored), item.updated_at || now());
  }

  function replaceHistoricalContentItems(items) {
    const normalized = normalizeHistoricalAdaptationContentItems(items);
    const previous = new Map(db.prepare('SELECT node_id, item_json FROM technical_plan_historical_content_items WHERE project_id = ?').all(projectId || '').map((row) => [row.node_id, row.item_json]));
    for (const [index, item] of normalized.entries()) {
      const stored = { ...item };
      if (stored.source_version_hash) delete stored.source_excerpt;
      if (previous.get(item.node_id) !== JSON.stringify(stored)) writeHistoricalContentItem(item, index);
      previous.delete(item.node_id);
    }
    const remove = db.prepare('DELETE FROM technical_plan_historical_content_items WHERE project_id = ? AND node_id = ?');
    for (const nodeId of previous.keys()) remove.run(projectId || '', nodeId);
  }

  let historicalSourceArchiveCache;
  function getHistoricalAdaptationSourceSection({ nodeId, sourceItem } = {}) {
    const item = sourceItem || readHistoricalContentItem(nodeId);
    if (!item) throw new Error('当前章节尚未建立正文迁移方案');
    if (!item.source_version_hash) return { content: item.source_excerpt || '', available: Boolean(item.source_excerpt) };
    const version = db.prepare('SELECT relative_path, index_json FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(item.source_version_hash);
    if (!version) return { content: '', available: false, error: '来源快照不可用，请重新建立方案' };
    try {
      const { readHistoricalSourceVersion, sourceHash } = require('./historicalSourceArchive.cjs');
      const archivePath = path.join(require('../utils/paths.cjs').getWorkspaceDir(app), version.relative_path);
      const stat = fs.statSync(archivePath);
      const signature = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
      if (historicalSourceArchiveCache?.hash !== item.source_version_hash
        || historicalSourceArchiveCache.signature !== signature || historicalSourceArchiveCache.metadata !== version.index_json) {
        const markdown = readHistoricalSourceVersion(app, { hash: item.source_version_hash, relativePath: version.relative_path });
        const metadata = JSON.parse(version.index_json);
        const sections = Array.isArray(metadata) ? metadata : metadata.sections;
        const byId = new Map();
        const byLocator = new Map();
        for (const section of sections) {
          byId.set(section.id, [section]);
          const locator = section.path.join(' / ');
          if (!byLocator.has(locator)) byLocator.set(locator, []);
          byLocator.get(locator).push(section);
        }
        historicalSourceArchiveCache = { hash: item.source_version_hash, signature, metadata: version.index_json, markdown, byId, byLocator };
      }
      const { markdown, byId, byLocator } = historicalSourceArchiveCache;
      const matches = (item.source_section_id ? byId.get(item.source_section_id) : byLocator.get(item.source_locator)) || [];
      const section = matches.length === 1 ? matches[0] : null;
      if (!section) throw new Error('章节历史来源定位不存在或不唯一，请重新建立方案');
      const content = section ? markdown.slice(section.startOffset, section.endOffset) : '';
      if (!content) throw new Error('章节历史原文为空，请选择定向改写或人工补写');
      if (sourceHash(content) !== item.source_content_hash) throw new Error('章节来源哈希不匹配');
      return { content, available: true, sourceVersionHash: item.source_version_hash };
    } catch (error) {
      return { content: '', available: false, error: error.message };
    }
  }

  let historicalSourceIndexCache;
  function getHistoricalAdaptationSourceIndex(originalPlan, { persist = true } = {}) {
    const { sourceHash, writeHistoricalSourceVersion } = require('./historicalSourceArchive.cjs');
    const hash = sourceHash(originalPlan);
    const row = db.prepare('SELECT index_json FROM technical_plan_historical_source_versions WHERE source_hash = ?').get(hash);
    if (row && historicalSourceIndexCache?.sourceVersionHash === hash) return historicalSourceIndexCache;
    const { buildHistoricalSourceIndex, normalizePath } = require('./historicalSourceIndex.cjs');
    const reference = persist ? writeHistoricalSourceVersion(app, originalPlan) : undefined;
    const metadata = safeJsonParse(row?.index_json, null);
    let index;
    if (metadata?.version === 2 && Array.isArray(metadata.sections)
      && metadata.sections.every((section) => section && Array.isArray(section.path)
        && Number.isInteger(section.startOffset) && Number.isInteger(section.endOffset))) {
      const sections = metadata.sections.map((section) => ({ ...section, content: originalPlan.slice(section.startOffset, section.endOffset) }));
      const byPath = new Map();
      for (const section of sections) {
        const key = normalizePath(section.path).join('/');
        if (!byPath.has(key)) byPath.set(key, []);
        byPath.get(key).push(section);
      }
      index = { sourceVersionHash: hash, sections, byPath };
    } else {
      index = historicalSourceIndexCache?.sourceVersionHash === hash ? historicalSourceIndexCache : buildHistoricalSourceIndex(originalPlan);
      if (persist) {
        db.prepare(`INSERT INTO technical_plan_historical_source_versions (source_hash, relative_path, index_json, created_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(source_hash) DO UPDATE SET index_json = excluded.index_json`)
          .run(hash, reference.relativePath, JSON.stringify({ version: 2, sections: index.sections.map(({ content: _content, ...section }) => section) }), now());
      }
    }
    historicalSourceIndexCache = index;
    return index;
  }

  function resolveMarkdownPath(relativeOrAbsolutePath) {
    const value = String(relativeOrAbsolutePath || '').trim();
    if (!value) return tenderMarkdownPath;
    return path.isAbsolute(value) ? value : path.join(path.dirname(path.dirname(tenderMarkdownPath)), value);
  }

  function readTenderMarkdown() {
    const meta = readMetaRow();
    const filePath = resolveMarkdownPath(meta.tender_markdown_path || tenderMarkdownRelativePath);
    if (!meta.tender_markdown_path || !fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  function loadTenderSourceFiles(meta = readMetaRow()) {
    const sourceFiles = safeJsonParse(meta.tender_files_json, []);
    if (Array.isArray(sourceFiles) && sourceFiles.length) {
      return sourceFiles.map((file) => ({
        id: String(file.id || ''),
        fileName: String(file.fileName || '招标文件'),
        markdownPath: String(file.markdownPath || ''),
        markdownChars: Number(file.markdownChars || 0),
        contentHash: String(file.contentHash || ''),
        parserLabel: file.parserLabel ? String(file.parserLabel) : undefined,
        sourceDocxPath: file.sourceDocxPath ? String(file.sourceDocxPath) : undefined,
        importedAt: file.importedAt ? String(file.importedAt) : undefined,
        updatedAt: file.updatedAt ? String(file.updatedAt) : meta.updated_at,
      })).filter((file) => file.id && file.markdownPath);
    }
    if (meta.tender_markdown_path) {
      return [{
        id: 'tender-legacy-01',
        fileName: meta.tender_file_name || '技术方案招标文件',
        markdownPath: meta.tender_markdown_path,
        markdownChars: Number(meta.tender_markdown_chars || 0),
        contentHash: meta.tender_markdown_hash || '',
        parserLabel: meta.tender_parser_label || undefined,
        importedAt: meta.tender_imported_at || undefined,
        updatedAt: meta.updated_at,
      }];
    }
    return [];
  }

  function readTenderSourceMarkdown(sourceId) {
    const target = loadTenderSourceFiles().find((file) => file.id === String(sourceId || ''));
    if (!target) return '';
    const filePath = resolveMarkdownPath(target.markdownPath);
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  }

  function readOriginalTenderMarkdown() {
    const meta = readMetaRow();
    if (!meta.tender_markdown_path) {
      return '';
    }
    const originalPath = meta.tender_original_markdown_path
      ? resolveMarkdownPath(meta.tender_original_markdown_path)
      : null;
    if (originalPath && fs.existsSync(originalPath)) {
      return fs.readFileSync(originalPath, 'utf-8');
    }
    throw new Error('原始招标文件缺失，请重新上传招标文件');
  }

  function writeMarkdownFile(targetPath, markdown, prefix) {
    const targetDir = path.dirname(targetPath);
    const tempPath = path.join(targetDir, `${prefix}-${Date.now()}.tmp.md`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tempPath, `${String(markdown || '').trim()}\n`, 'utf-8');
    try {
      fs.renameSync(tempPath, targetPath);
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  function checkBidSections() {
    const markdown = readOriginalTenderMarkdown();
    return detectBidSections(markdown);
  }

  function readOriginalPlanMarkdown() {
    const meta = readMetaRow();
    const filePath = resolveMarkdownPath(meta.original_plan_markdown_path || originalPlanMarkdownRelativePath);
    if (!meta.original_plan_markdown_path || !fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  function writeTenderSourceMarkdown(source, index) {
    const markdown = String(source?.file_content || '').trim();
    const fileName = source?.file_name || '招标文件';
    const id = createTenderSourceId(fileName, markdown, index);
    const relativePath = path.join(tenderSourceFilesDirRelativePath, `${id}-${safeFileNamePart(fileName)}.md`).replace(/\\/g, '/');
    const targetPath = resolveMarkdownPath(relativePath);
    writeMarkdownFile(targetPath, markdown, id);
    const sourceDocxPath = persistExistingTenderOriginal(source, id);
    return {
      id,
      fileName,
      markdownPath: relativePath,
      markdownChars: markdown.length,
      contentHash: stableHash(markdown),
      parserLabel: source?.parser_label || undefined,
      sourceDocxPath: sourceDocxPath || undefined,
      importedAt: now(),
      updatedAt: now(),
    };
  }

  /** 把已有或刚落下的招标 Word 原件归到当前源文件编号下。 */
  function persistExistingTenderOriginal(source, id) {
    const destRelative = path.join(tenderOriginalsDirRelativePath, `${id}.docx`).replace(/\\/g, '/');
    const destPath = resolveMarkdownPath(destRelative);
    const incoming = String(source?.source_docx_path || source?.sourceDocxPath || '').trim();
    if (!incoming) return '';
    const sourcePath = path.isAbsolute(incoming) ? incoming : resolveMarkdownPath(incoming);
    if (!fs.existsSync(sourcePath)) return '';
    const managedRelativePath = getManagedTenderOriginalRelativePath(sourcePath);
    if (managedRelativePath) return managedRelativePath;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (filePathKey(sourcePath) !== filePathKey(destPath)) {
      tenderOriginalLogger.write('tender-original.copy.started', { phase: 'state-rebuild', source_path: sourcePath, dest_path: destPath });
      try {
        fs.copyFileSync(sourcePath, destPath);
        tenderOriginalLogger.write('tender-original.copy.completed', { phase: 'state-rebuild', source_path: sourcePath, dest_path: destPath });
      } catch (error) {
        tenderOriginalLogger.write('tender-original.copy.failed', {
          phase: 'state-rebuild',
          source_path: sourcePath,
          dest_path: destPath,
          code: error?.code,
          syscall: error?.syscall,
          error: compactLogError(error),
        });
        throw error;
      }
    }
    return destRelative;
  }

  function pruneTenderOriginals(keptRelativePaths, phase = 'state-rebuild') {
    const keep = new Set((Array.isArray(keptRelativePaths) ? keptRelativePaths : []).map((item) => filePathKey(resolveMarkdownPath(item))));
    if (!fs.existsSync(tenderOriginalsDir)) return;
    for (const name of fs.readdirSync(tenderOriginalsDir)) {
      const filePath = path.join(tenderOriginalsDir, name);
      if (!keep.has(filePathKey(filePath))) {
        tenderOriginalLogger.write('tender-original.delete.started', { phase, file_path: filePath });
        try {
          removeWorkspacePathSync(filePath, (event, payload) => tenderOriginalLogger.write(event, { phase, ...payload }));
          tenderOriginalLogger.write('tender-original.delete.completed', { phase, file_path: filePath });
        } catch (error) {
          tenderOriginalLogger.write('tender-original.delete.failed', {
            phase,
            file_path: filePath,
            code: error?.code,
            syscall: error?.syscall,
            error: compactLogError(error),
          });
          const fileName = path.basename(filePath);
          const message = isFileLockError(error)
            ? `无法删除旧招标 Word 原件“${fileName}”，请关闭可能占用该文件的 Word/WPS，并确认文件可写后重试`
            : `无法清理旧招标 Word 原件“${fileName}”：${error?.message || error}`;
          const cleanupError = new Error(message);
          cleanupError.code = 'TENDER_ORIGINAL_CLEANUP_FAILED';
          cleanupError.cause = error;
          throw cleanupError;
        }
      }
    }
  }

  function clearBidTemplate() {
    const templateFiles = [bidTemplatePath, bidTemplateSourcePath, bidTemplateFieldsPath];
    const templateDir = path.dirname(bidTemplatePath);
    if (fs.existsSync(templateDir)) {
      const tempPrefixes = [
        `${path.basename(bidTemplatePath)}.`,
        `${path.basename(bidTemplateFieldsPath)}.`,
      ];
      for (const name of fs.readdirSync(templateDir)) {
        if (tempPrefixes.some((prefix) => name.startsWith(prefix) && name.includes('.tmp'))) {
          templateFiles.push(path.join(templateDir, name));
        }
      }
    }
    for (const filePath of templateFiles) {
      if (!fs.existsSync(filePath)) continue;
      try {
        removeWorkspacePathSync(
          filePath,
          (event, payload) => tenderOriginalLogger.write(event, { phase: 'bid-template-cleanup', ...payload }),
          { deferOnFailure: false },
        );
      } catch (error) {
        if (isFileLockError(error)) {
          const lockError = new Error('投标模版正在被 Word 使用，请关闭后重试');
          lockError.code = 'BID_TEMPLATE_IN_USE';
          lockError.cause = error;
          throw lockError;
        }
        throw error;
      }
    }
  }

  function clearTenderSourceFiles(phase = 'technical-plan-reset') {
    clearBidTemplate();
    if (fs.existsSync(tenderOriginalsDir)) {
      tenderOriginalLogger.write('tender-original.delete-directory.started', { phase, directory_path: tenderOriginalsDir });
      try {
        removeWorkspacePathSync(tenderOriginalsDir, (event, payload) => tenderOriginalLogger.write(event, { phase, ...payload }));
        tenderOriginalLogger.write('tender-original.delete-directory.completed', { phase, directory_path: tenderOriginalsDir });
      } catch (error) {
        tenderOriginalLogger.write('tender-original.delete-directory.failed', {
          phase,
          directory_path: tenderOriginalsDir,
          code: error?.code,
          syscall: error?.syscall,
          path: error?.path,
          error: compactLogError(error),
        });
        const resetError = new Error('无法清理招标 Word 原件，请关闭可能占用原件的 Word/WPS，并确认文件可写后重试');
        resetError.code = 'TENDER_ORIGINAL_CLEANUP_FAILED';
        resetError.cause = error;
        throw resetError;
      }
    }
    if (fs.existsSync(tenderSourceFilesDir)) {
      removeWorkspacePathSync(tenderSourceFilesDir);
    }
  }

  function clearOriginalOutlineRuntime() {
    if (!fs.existsSync(originalOutlineRuntimePath)) {
      return;
    }
    fs.rmSync(originalOutlineRuntimePath, { force: true });
  }

  function readOriginalOutlineRuntime() {
    if (!fs.existsSync(originalOutlineRuntimePath)) {
      return null;
    }
    try {
      const runtime = safeJsonParse(fs.readFileSync(originalOutlineRuntimePath, 'utf-8'), null);
      if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
        clearOriginalOutlineRuntime();
        return null;
      }
      return runtime;
    } catch {
      clearOriginalOutlineRuntime();
      return null;
    }
  }

  function saveOriginalOutlineRuntime(runtime) {
    const targetDir = path.dirname(originalOutlineRuntimePath);
    const tempPath = path.join(targetDir, `original-outline-runtime-${Date.now()}.tmp.json`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(runtime || {}, null, 2)}\n`, 'utf-8');
    try {
      fs.renameSync(tempPath, originalOutlineRuntimePath);
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  function loadReferenceDocumentIds() {
    return db.prepare('SELECT document_id FROM technical_plan_reference_docs ORDER BY sort_order ASC').all()
      .map((row) => row.document_id);
  }

  function replaceReferenceDocumentIds(documentIds) {
    db.prepare('DELETE FROM technical_plan_reference_docs').run();
    const insert = db.prepare('INSERT INTO technical_plan_reference_docs (document_id, sort_order) VALUES (@document_id, @sort_order)');
    [...new Set((Array.isArray(documentIds) ? documentIds : []).map((id) => String(id || '').trim()).filter(Boolean))]
      .forEach((documentId, index) => insert.run({ document_id: documentId, sort_order: index }));
  }

  function normalizeRemoteKnowledgeDocuments(documents) {
    const seen = new Set();
    return (Array.isArray(documents) ? documents : []).reduce((result, document) => {
      const knowledgeId = String(document?.knowledgeId || '').trim();
      if (!knowledgeId || seen.has(knowledgeId)) return result;
      seen.add(knowledgeId);
      result.push({
        knowledgeId,
        title: String(document?.title || '').trim(),
      });
      return result;
    }, []);
  }

  function normalizeRemoteKnowledgeScopes(scopes) {
    const seen = new Set();
    return (Array.isArray(scopes) ? scopes : []).reduce((result, scope) => {
      const knowledgeBaseId = String(scope?.knowledgeBaseId || '').trim();
      if (!knowledgeBaseId || seen.has(knowledgeBaseId)) return result;
      seen.add(knowledgeBaseId);
      const mode = scope?.mode === 'all' ? 'all' : 'documents';
      result.push({
        knowledgeBaseId,
        knowledgeBaseName: String(scope?.knowledgeBaseName || '').trim(),
        mode,
        endpointFingerprint: String(scope?.endpointFingerprint || '').trim(),
        documents: mode === 'documents' ? normalizeRemoteKnowledgeDocuments(scope?.documents) : [],
      });
      return result;
    }, []);
  }

  function loadRemoteKnowledgeScopes() {
    const documentsByKnowledgeBaseId = db.prepare(`
      SELECT knowledge_base_id, knowledge_id, knowledge_title
      FROM technical_plan_remote_knowledge_documents
      ORDER BY knowledge_base_id ASC, sort_order ASC
    `).all().reduce((result, row) => {
      const documents = result.get(row.knowledge_base_id) || [];
      documents.push({ knowledgeId: row.knowledge_id, title: row.knowledge_title });
      result.set(row.knowledge_base_id, documents);
      return result;
    }, new Map());
    return db.prepare(`
      SELECT knowledge_base_id, knowledge_base_name, scope_mode, endpoint_fingerprint
      FROM technical_plan_remote_knowledge_scopes
      ORDER BY sort_order ASC
    `).all().map((row) => ({
      knowledgeBaseId: row.knowledge_base_id,
      knowledgeBaseName: row.knowledge_base_name,
      mode: row.scope_mode,
      endpointFingerprint: row.endpoint_fingerprint,
      documents: row.scope_mode === 'documents' ? (documentsByKnowledgeBaseId.get(row.knowledge_base_id) || []) : [],
    }));
  }

  function replaceRemoteKnowledgeScopes(scopes) {
    const normalizedScopes = normalizeRemoteKnowledgeScopes(scopes);
    db.prepare('DELETE FROM technical_plan_remote_knowledge_documents').run();
    db.prepare('DELETE FROM technical_plan_remote_knowledge_scopes').run();
    const insertScope = db.prepare(`
      INSERT INTO technical_plan_remote_knowledge_scopes
      (knowledge_base_id, knowledge_base_name, scope_mode, endpoint_fingerprint, sort_order)
      VALUES (@knowledge_base_id, @knowledge_base_name, @scope_mode, @endpoint_fingerprint, @sort_order)
    `);
    const insertDocument = db.prepare(`
      INSERT INTO technical_plan_remote_knowledge_documents
      (knowledge_base_id, knowledge_id, knowledge_title, sort_order)
      VALUES (@knowledge_base_id, @knowledge_id, @knowledge_title, @sort_order)
    `);
    normalizedScopes.forEach((scope, scopeIndex) => {
      insertScope.run({
        knowledge_base_id: scope.knowledgeBaseId,
        knowledge_base_name: scope.knowledgeBaseName,
        scope_mode: scope.mode,
        endpoint_fingerprint: scope.endpointFingerprint,
        sort_order: scopeIndex,
      });
      if (scope.mode !== 'documents') return;
      scope.documents.forEach((document, documentIndex) => {
        insertDocument.run({
          knowledge_base_id: scope.knowledgeBaseId,
          knowledge_id: document.knowledgeId,
          knowledge_title: document.title,
          sort_order: documentIndex,
        });
      });
    });
  }

  function taskFromRow(row) {
    if (!row) return undefined;
    return {
      task_id: row.task_id,
      type: row.type,
      status: normalizeStatus(row.status, ['queued', 'running', 'pausing', 'paused', 'success', 'error'], 'running'),
      progress: Number(row.progress || 0),
      logs: taskLogStore.list('technical-plan', row.type, row.task_id),
      started_at: row.started_at,
      updated_at: row.updated_at,
      error: row.error || undefined,
      stats: safeJsonParse(row.stats_json, undefined),
      pause_requested: fromDbBool(row.pause_requested),
    };
  }

  function saveTask(type, task) {
    if (!task) {
      db.prepare('DELETE FROM technical_plan_tasks WHERE type = ?').run(type);
      if (type === 'bid-section-extraction') {
        updateMeta({ bid_section_extraction_status: 'idle', bid_section_extraction_error: null });
      }
      return;
    }
    const timestamp = now();
    db.prepare(`
      INSERT INTO technical_plan_tasks (type, task_id, status, progress, stats_json, error, pause_requested, started_at, updated_at)
      VALUES (@type, @task_id, @status, @progress, @stats_json, @error, @pause_requested, @started_at, @updated_at)
      ON CONFLICT(type) DO UPDATE SET
        task_id = excluded.task_id,
        status = excluded.status,
        progress = excluded.progress,
        stats_json = excluded.stats_json,
        error = excluded.error,
        pause_requested = excluded.pause_requested,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `).run({
      type,
      task_id: String(task.task_id || ''),
      status: String(task.status || 'running'),
      progress: Math.max(0, Math.min(100, Math.round(Number(task.progress || 0)))),
      stats_json: jsonOrNull(task.stats),
      error: task.error ? String(task.error) : null,
      pause_requested: toDbBool(task.pause_requested),
      started_at: task.started_at || timestamp,
      updated_at: task.updated_at || timestamp,
    });
    taskLogStore.sync('technical-plan', type, String(task.task_id || ''), task.logs, task.updated_at || timestamp);
    if (type === 'bid-section-extraction') {
      updateMeta({
        bid_section_extraction_status: normalizeBidSectionExtractionStatus(task.status),
        bid_section_extraction_error: task.error ? String(task.error) : null,
      });
    }
  }

  function loadTasks() {
    const rows = db.prepare('SELECT * FROM technical_plan_tasks').all();
    const tasks = {};
    for (const row of rows) {
      const field = taskTypeFields[row.type];
      if (field) tasks[field] = taskFromRow(row);
    }
    return tasks;
  }

  function loadTask(type) {
    return taskFromRow(db.prepare('SELECT * FROM technical_plan_tasks WHERE type = ?').get(type));
  }

  function loadBidItems() {
    const rows = db.prepare('SELECT * FROM technical_plan_bid_items ORDER BY sort_order ASC, item_id ASC').all();
    return rows.reduce((acc, row) => {
      acc[row.item_id] = {
        id: row.item_id,
        label: row.label,
        status: normalizeStatus(row.status, ['idle', 'running', 'success', 'error'], 'idle'),
        content: row.content || '',
        error: row.error || undefined,
      };
      return acc;
    }, {});
  }

  function getBidItemSortOrder(itemId) {
    const fullTasks = getAllBidAnalysisTasks();
    const index = fullTasks.findIndex((task) => task.id === itemId);
    return index >= 0 ? index : 9999;
  }

  function getBidItemLabel(itemId, fallbackLabel) {
    const task = getBidAnalysisTasks('full').find((item) => item.id === itemId) || getBidAnalysisTasks('key').find((item) => item.id === itemId);
    return fallbackLabel || task?.label || itemId;
  }

  function saveBidItems(tasks, mode) {
    const entries = Object.entries(tasks || {});
    if (!entries.length) {
      db.prepare('DELETE FROM technical_plan_bid_items').run();
      return;
    }

    const upsert = db.prepare(`
      INSERT INTO technical_plan_bid_items (item_id, label, status, content, error, sort_order, updated_at)
      VALUES (@item_id, @label, @status, @content, @error, @sort_order, @updated_at)
      ON CONFLICT(item_id) DO UPDATE SET
        label = excluded.label,
        status = excluded.status,
        content = excluded.content,
        error = excluded.error,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const [itemId, task] of entries) {
      upsert.run({
        item_id: itemId,
        label: getBidItemLabel(itemId, task?.label),
        status: normalizeStatus(task?.status, ['idle', 'running', 'success', 'error'], 'idle'),
        content: String(task?.content || ''),
        error: task?.error ? String(task.error) : null,
        sort_order: getBidItemSortOrder(itemId, mode),
        updated_at: task?.updated_at || timestamp,
      });
    }
  }

  function saveBidItem(item, mode) {
    const itemId = String(item?.id || '').trim();
    if (!itemId) return;
    saveBidItems({ [itemId]: item }, mode);
  }

  function upsertDerivedBidItem(itemId, content, mode) {
    const label = getBidItemLabel(itemId);
    const value = String(content || '');
    db.prepare(`
      INSERT INTO technical_plan_bid_items (item_id, label, status, content, error, sort_order, updated_at)
      VALUES (@item_id, @label, @status, @content, NULL, @sort_order, @updated_at)
      ON CONFLICT(item_id) DO UPDATE SET
        label = excluded.label,
        status = excluded.status,
        content = excluded.content,
        error = NULL,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run({
      item_id: itemId,
      label,
      status: value.trim() ? 'success' : 'idle',
      content: value,
      sort_order: getBidItemSortOrder(itemId, mode),
      updated_at: now(),
    });
  }

  function calculateBidProgress(mode, bidTasks, selectedTaskIds) {
    const selectedIds = getBidAnalysisTaskIdsForConfig(mode, selectedTaskIds);
    if (!selectedIds.length) return 0;
    const done = selectedIds.filter((taskId) => ['success', 'error'].includes(bidTasks[taskId]?.status)).length;
    return Math.round((done / selectedIds.length) * 100);
  }

  function loadOutlineData(meta) {
    const rows = db.prepare('SELECT * FROM technical_plan_outline_nodes ORDER BY level ASC, parent_node_id ASC, sort_order ASC').all();
    if (!rows.length) return null;

    const map = new Map();
    for (const row of rows) {
      map.set(row.node_id, {
        id: row.node_id,
        title: row.title,
        description: row.description || '',
        content_mode: row.content_mode || undefined,
        content_mode_note: row.content_mode_note || undefined,
        source_requirement_id: row.source_requirement_id || undefined,
        source_requirement_title: row.source_requirement_title || undefined,
        knowledge_item_ids: safeJsonParse(row.knowledge_item_ids_json, undefined),
        knowledge_folder_ids: safeJsonParse(row.knowledge_folder_ids_json, undefined),
        knowledge_document_ids: safeJsonParse(row.knowledge_document_ids_json, undefined),
        content: row.content || '',
        children: [],
      });
    }

    const roots = [];
    for (const row of rows) {
      const item = map.get(row.node_id);
      if (!item) continue;
      if (row.parent_node_id && map.has(row.parent_node_id)) {
        map.get(row.parent_node_id).children.push(item);
      } else {
        roots.push(item);
      }
    }

    function cleanup(item) {
      if (!item.children.length) {
        delete item.children;
      } else {
        item.children.forEach(cleanup);
      }
      if (!item.knowledge_item_ids?.length) delete item.knowledge_item_ids;
      if (!item.knowledge_folder_ids?.length) delete item.knowledge_folder_ids;
      if (!item.knowledge_document_ids?.length) delete item.knowledge_document_ids;
      if (!item.content) delete item.content;
      return item;
    }

    return {
      outline: roots.map(cleanup),
      project_name: meta.outline_project_name || undefined,
      project_overview: meta.outline_project_overview || undefined,
    };
  }

  function saveOutlineData(outlineData) {
    const normalizedOutlineData = normalizeOutlineHeadingTitles(outlineData);
    if (!normalizedOutlineData?.outline?.length) {
      db.prepare('DELETE FROM technical_plan_outline_nodes').run();
      updateMeta({ outline_project_name: null, outline_project_overview: null });
      return;
    }

    const rows = flattenOutlineItems(normalizedOutlineData.outline);
    const nextIds = new Set(rows.map((row) => row.node_id));
    const upsert = db.prepare(`
      INSERT INTO technical_plan_outline_nodes (
        node_id, parent_node_id, sort_order, level, title, description, content_mode, content_mode_note, source_requirement_id,
        source_requirement_title, knowledge_item_ids_json, knowledge_folder_ids_json, knowledge_document_ids_json, content, created_at, updated_at
      ) VALUES (
        @node_id, @parent_node_id, @sort_order, @level, @title, @description, @content_mode, @content_mode_note, @source_requirement_id,
        @source_requirement_title, @knowledge_item_ids_json, @knowledge_folder_ids_json, @knowledge_document_ids_json, @content, @created_at, @updated_at
      ) ON CONFLICT(node_id) DO UPDATE SET
        parent_node_id = excluded.parent_node_id,
        sort_order = excluded.sort_order,
        level = excluded.level,
        title = excluded.title,
        description = excluded.description,
        content_mode = excluded.content_mode,
        content_mode_note = excluded.content_mode_note,
        source_requirement_id = excluded.source_requirement_id,
        source_requirement_title = excluded.source_requirement_title,
        knowledge_item_ids_json = excluded.knowledge_item_ids_json,
        knowledge_folder_ids_json = excluded.knowledge_folder_ids_json,
        knowledge_document_ids_json = excluded.knowledge_document_ids_json,
        content = excluded.content,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const row of rows) {
      upsert.run({ ...row, created_at: timestamp, updated_at: timestamp });
    }

    const existingIds = db.prepare('SELECT node_id FROM technical_plan_outline_nodes').all().map((row) => row.node_id);
    const deleteNode = db.prepare('DELETE FROM technical_plan_outline_nodes WHERE node_id = ?');
    for (const nodeId of existingIds) {
      if (!nextIds.has(nodeId)) deleteNode.run(nodeId);
    }

    updateMeta({
      outline_project_name: normalizedOutlineData.project_name || null,
      outline_project_overview: normalizedOutlineData.project_overview || null,
    });
  }

  function loadContentSections(outlineData) {
    const rows = db.prepare(`
      SELECT s.node_id, s.status, s.error, s.updated_at, n.title, n.content
      FROM technical_plan_content_sections s
      JOIN technical_plan_outline_nodes n ON n.node_id = s.node_id
    `).all();
    const sections = rows.reduce((acc, row) => {
      acc[row.node_id] = {
        id: row.node_id,
        title: row.title || '未命名章节',
        status: normalizeStatus(row.status, ['idle', 'running', 'success', 'error', 'ignored'], 'idle'),
        content: row.content || '',
        error: row.error || undefined,
        updated_at: row.updated_at || undefined,
      };
      return acc;
    }, {});

    for (const item of collectLeafItems(outlineData?.outline || [])) {
      if (!sections[item.id] && item.content?.trim()) {
        sections[item.id] = {
          id: item.id,
          title: item.title || '未命名章节',
          status: 'success',
          content: item.content,
        };
      }
    }

    return sections;
  }

  function saveContentSections(sections) {
    const entries = Object.entries(sections || {});
    if (!entries.length) {
      db.prepare('DELETE FROM technical_plan_content_sections').run();
      return;
    }

    const nextIds = new Set(entries.map(([nodeId]) => nodeId));
    const upsert = db.prepare(`
      INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
      VALUES (@node_id, @status, @error, @updated_at)
      ON CONFLICT(node_id) DO UPDATE SET
        status = excluded.status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `);
    const updateContent = db.prepare('UPDATE technical_plan_outline_nodes SET content = @content, updated_at = @updated_at WHERE node_id = @node_id');
    const timestamp = now();
    for (const [nodeId, section] of entries) {
      upsert.run({
        node_id: nodeId,
        status: normalizeStatus(section?.status, ['idle', 'running', 'success', 'error', 'ignored'], 'idle'),
        error: section?.error ? String(section.error) : null,
        updated_at: section?.updated_at || timestamp,
      });
      if (hasOwn(section, 'content')) {
        updateContent.run({ node_id: nodeId, content: String(section.content || ''), updated_at: timestamp });
      }
    }

    const deleteSection = db.prepare('DELETE FROM technical_plan_content_sections WHERE node_id = ?');
    for (const row of db.prepare('SELECT node_id FROM technical_plan_content_sections').all()) {
      if (!nextIds.has(row.node_id)) deleteSection.run(row.node_id);
    }
  }

  function loadContentPlans() {
    return db.prepare('SELECT * FROM technical_plan_content_plans').all().reduce((acc, row) => {
      const storedPlan = safeJsonParse(row.plan_json, null);
      if (storedPlan?.plan && Number(storedPlan.plan_version) > 0) {
        acc[row.node_id] = {
          plan_version: Number(storedPlan.plan_version),
          plan: storedPlan.plan,
          ...(storedPlan.table_requirement ? { table_requirement: storedPlan.table_requirement } : {}),
          updated_at: row.updated_at || undefined,
        };
      }
      return acc;
    }, {});
  }

  function loadGeneratedIllustrationAssetUrls() {
    return db.prepare(`
      SELECT generation_asset_url AS asset_url
      FROM technical_plan_illustration_items
      WHERE generation_asset_url IS NOT NULL AND generation_asset_url <> ''
      UNION ALL
      SELECT generation_original_asset_url AS asset_url
      FROM technical_plan_illustration_items
      WHERE generation_original_asset_url IS NOT NULL AND generation_original_asset_url <> ''
      UNION ALL
      SELECT generation_redraw_asset_url AS asset_url
      FROM technical_plan_illustration_items
      WHERE generation_redraw_asset_url IS NOT NULL AND generation_redraw_asset_url <> ''
    `).all().map((row) => row.asset_url);
  }

  function deleteGeneratedIllustrationAssets(assetUrls) {
    const generatedImagesDir = path.resolve(getGeneratedImagesDir(app));
    const prefix = 'yibiao-asset://generated-images/';
    const projectIllustrationPrefix = 'technical-plan/illustrations/';
    for (const assetUrl of new Set(assetUrls || [])) {
      const originalSource = String(assetUrl || '');
      const retainedByPlan = db.prepare(`
        SELECT 1
        FROM technical_plan_illustration_items
        WHERE generation_asset_url = ?
          OR generation_original_asset_url = ?
          OR generation_redraw_asset_url = ?
        LIMIT 1
      `).get(originalSource, originalSource, originalSource);
      const stillReferenced = db.prepare('SELECT 1 FROM technical_plan_outline_nodes WHERE instr(content, ?) > 0 LIMIT 1').get(originalSource);
      if (retainedByPlan || stillReferenced) continue;
      const source = originalSource.split('?')[0];
      if (!source.startsWith(prefix)) continue;
      let relativePath;
      try {
        relativePath = decodeURIComponent(source.slice(prefix.length));
      } catch {
        continue;
      }
      const rootDir = projectScoped && relativePath.startsWith(projectIllustrationPrefix)
        ? path.resolve(generatedIllustrationsDir)
        : generatedImagesDir;
      const rootRelativePath = projectScoped && relativePath.startsWith(projectIllustrationPrefix)
        ? relativePath.slice(projectIllustrationPrefix.length)
        : relativePath;
      const filePath = path.resolve(rootDir, rootRelativePath);
      if (filePath === rootDir || !filePath.startsWith(`${rootDir}${path.sep}`)) continue;
      fs.rmSync(filePath, { force: true });
    }
  }

  const pendingGeneratedAssetCleanup = new Set();
  let generatedAssetCleanupScheduled = false;
  function scheduleGeneratedAssetCleanup(assetUrls) {
    (assetUrls || []).filter(Boolean).forEach((assetUrl) => pendingGeneratedAssetCleanup.add(assetUrl));
    if (!pendingGeneratedAssetCleanup.size || generatedAssetCleanupScheduled) return;
    generatedAssetCleanupScheduled = true;
    setImmediate(() => {
      generatedAssetCleanupScheduled = false;
      const queuedAssetUrls = [...pendingGeneratedAssetCleanup];
      pendingGeneratedAssetCleanup.clear();
      try {
        deleteGeneratedIllustrationAssets(queuedAssetUrls);
      } catch (error) {
        console.warn('[technical-plan] 清理旧生图失败', error?.message || String(error));
      }
    });
  }

  function clearUnreferencedRootGeneratedImages() {
    const generatedImagesDir = getGeneratedImagesDir(app);
    if (!fs.existsSync(generatedImagesDir)) return;
    const assetUrls = fs.readdirSync(generatedImagesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `yibiao-asset://generated-images/${encodeURIComponent(entry.name)}`);
    scheduleGeneratedAssetCleanup(assetUrls);
  }

  function deleteContentIllustrationPlanRows() {
    db.prepare('DELETE FROM technical_plan_illustration_items').run();
    db.prepare('DELETE FROM technical_plan_illustration_plans').run();
  }

  function clearContentIllustrationPlan() {
    const assetUrls = loadGeneratedIllustrationAssetUrls();
    deleteContentIllustrationPlanRows();
    scheduleGeneratedAssetCleanup(assetUrls);
  }

  function illustrationItemValues(item, sortOrder, timestamp, existing = {}) {
    const sourceGeneration = item?.generation || {};
    const isMermaid = item?.kind === 'mermaid';
    const generation = {
      ...sourceGeneration,
      ...(existing.generation_original_code || sourceGeneration.original_code || (isMermaid ? sourceGeneration.code : '')
        ? { original_code: existing.generation_original_code || sourceGeneration.original_code || (isMermaid ? sourceGeneration.code : '') }
        : {}),
      ...(existing.generation_original_asset_url || sourceGeneration.original_asset_url || (!isMermaid ? sourceGeneration.asset_url : '')
        ? { original_asset_url: existing.generation_original_asset_url || sourceGeneration.original_asset_url || (!isMermaid ? sourceGeneration.asset_url : '') }
        : {}),
      ...(existing.generation_original_source_path || sourceGeneration.original_source_path || (!isMermaid ? sourceGeneration.source_path : '')
        ? { original_source_path: existing.generation_original_source_path || sourceGeneration.original_source_path || (!isMermaid ? sourceGeneration.source_path : '') }
        : {}),
    };
    return {
      item_id: String(item.item_id),
      kind: String(item.kind || ''),
      image_type: String(item.image_type || ''),
      title: String(item.title || ''),
      section_ids_json: JSON.stringify(Array.isArray(item.section_ids) ? item.section_ids : []),
      placement: String(item.placement || 'after'),
      priority: Number(item.priority || 0),
      generation_status: generation?.status ? String(generation.status) : null,
      generation_mode: generation?.mode ? String(generation.mode) : null,
      generation_code: generation?.code ? String(generation.code) : null,
      generation_draft_code: generation?.draft_code ? String(generation.draft_code) : null,
      generation_review_status: generation?.review_status ? String(generation.review_status) : null,
      generation_review_error: generation?.review_error ? String(generation.review_error) : null,
      generation_reviewed_at: generation?.reviewed_at ? String(generation.reviewed_at) : null,
      generation_source_path: generation?.source_path ? String(generation.source_path) : null,
      generation_asset_url: generation?.asset_url ? String(generation.asset_url) : null,
      generation_original_code: generation?.original_code ? String(generation.original_code) : null,
      generation_original_asset_url: generation?.original_asset_url ? String(generation.original_asset_url) : null,
      generation_original_source_path: generation?.original_source_path ? String(generation.original_source_path) : null,
      generation_redraw_status: generation?.redraw_status ? String(generation.redraw_status) : null,
      generation_redraw_asset_url: generation?.redraw_asset_url ? String(generation.redraw_asset_url) : null,
      generation_redraw_source_path: generation?.redraw_source_path ? String(generation.redraw_source_path) : null,
      generation_redraw_error: generation?.redraw_error ? String(generation.redraw_error) : null,
      generation_redraw_attempts: generation?.redraw_attempts === undefined ? null : Number(generation.redraw_attempts || 0),
      generation_redraw_updated_at: generation?.redraw_updated_at || null,
      generation_attempts: generation?.attempts === undefined ? null : Number(generation.attempts || 0),
      generation_error: generation?.error ? String(generation.error) : null,
      generation_updated_at: generation?.updated_at || null,
      sort_order: Number(sortOrder || 0),
      updated_at: item.updated_at || timestamp,
    };
  }

  const upsertIllustrationItem = db.prepare(`
    INSERT INTO technical_plan_illustration_items (
      item_id, kind, image_type, title, section_ids_json, placement, priority,
      generation_status, generation_mode, generation_code, generation_draft_code,
      generation_review_status, generation_review_error, generation_reviewed_at, generation_source_path,
      generation_asset_url, generation_original_code, generation_original_asset_url, generation_original_source_path,
      generation_redraw_status, generation_redraw_asset_url, generation_redraw_source_path,
      generation_redraw_error, generation_redraw_attempts, generation_redraw_updated_at,
      generation_attempts, generation_error, generation_updated_at,
      sort_order, updated_at
    ) VALUES (
      @item_id, @kind, @image_type, @title, @section_ids_json, @placement, @priority,
      @generation_status, @generation_mode, @generation_code, @generation_draft_code,
      @generation_review_status, @generation_review_error, @generation_reviewed_at, @generation_source_path,
      @generation_asset_url, @generation_original_code, @generation_original_asset_url, @generation_original_source_path,
      @generation_redraw_status, @generation_redraw_asset_url, @generation_redraw_source_path,
      @generation_redraw_error, @generation_redraw_attempts, @generation_redraw_updated_at,
      @generation_attempts, @generation_error, @generation_updated_at,
      @sort_order, @updated_at
    ) ON CONFLICT(item_id) DO UPDATE SET
      kind = excluded.kind,
      image_type = excluded.image_type,
      title = excluded.title,
      section_ids_json = excluded.section_ids_json,
      placement = excluded.placement,
      priority = excluded.priority,
      generation_status = excluded.generation_status,
      generation_mode = excluded.generation_mode,
      generation_code = excluded.generation_code,
      generation_draft_code = excluded.generation_draft_code,
      generation_review_status = excluded.generation_review_status,
      generation_review_error = excluded.generation_review_error,
      generation_reviewed_at = excluded.generation_reviewed_at,
      generation_source_path = excluded.generation_source_path,
      generation_asset_url = excluded.generation_asset_url,
      generation_original_code = excluded.generation_original_code,
      generation_original_asset_url = excluded.generation_original_asset_url,
      generation_original_source_path = excluded.generation_original_source_path,
      generation_redraw_status = excluded.generation_redraw_status,
      generation_redraw_asset_url = excluded.generation_redraw_asset_url,
      generation_redraw_source_path = excluded.generation_redraw_source_path,
      generation_redraw_error = excluded.generation_redraw_error,
      generation_redraw_attempts = excluded.generation_redraw_attempts,
      generation_redraw_updated_at = excluded.generation_redraw_updated_at,
      generation_attempts = excluded.generation_attempts,
      generation_error = excluded.generation_error,
      generation_updated_at = excluded.generation_updated_at,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);

  function replaceContentIllustrationPlan(plan) {
    const previousAssetUrls = loadGeneratedIllustrationAssetUrls();
    deleteContentIllustrationPlanRows();
    if (!plan || !Array.isArray(plan.items)) {
      scheduleGeneratedAssetCleanup(previousAssetUrls);
      return;
    }
    const timestamp = plan.updated_at || now();
    db.prepare(`
      INSERT INTO technical_plan_illustration_plans (id, plan_version, revision, updated_at)
      VALUES (1, ?, ?, ?)
    `).run(Number(plan.plan_version || 0), String(plan.revision || ''), timestamp);
    plan.items.forEach((item, index) => {
      if (item?.item_id) upsertIllustrationItem.run(illustrationItemValues(item, index, timestamp));
    });
    const retainedAssetUrls = new Set(loadGeneratedIllustrationAssetUrls());
    scheduleGeneratedAssetCleanup(previousAssetUrls.filter((assetUrl) => !retainedAssetUrls.has(assetUrl)));
  }

  function saveContentIllustrationItem(item) {
    if (!item?.item_id) return;
    const existing = db.prepare(`
      SELECT
        sort_order,
        generation_asset_url,
        generation_original_code,
        generation_original_asset_url,
        generation_original_source_path,
        generation_redraw_asset_url
      FROM technical_plan_illustration_items
      WHERE item_id = ?
    `).get(item.item_id);
    upsertIllustrationItem.run(illustrationItemValues(item, existing?.sort_order || 0, now(), existing));
    const nextAssetUrl = item?.generation?.asset_url ? String(item.generation.asset_url) : '';
    const nextRedrawAssetUrl = item?.generation?.redraw_asset_url ? String(item.generation.redraw_asset_url) : '';
    const staleAssetUrls = [];
    if (existing?.generation_asset_url && existing.generation_asset_url !== nextAssetUrl) {
      staleAssetUrls.push(existing.generation_asset_url);
    }
    if (existing?.generation_redraw_asset_url && existing.generation_redraw_asset_url !== nextRedrawAssetUrl) {
      staleAssetUrls.push(existing.generation_redraw_asset_url);
    }
    scheduleGeneratedAssetCleanup(staleAssetUrls);
  }

  function loadContentIllustrationPlan() {
    const plan = db.prepare('SELECT * FROM technical_plan_illustration_plans WHERE id = 1').get();
    if (!plan) return undefined;
    const items = db.prepare('SELECT * FROM technical_plan_illustration_items ORDER BY sort_order ASC, item_id ASC').all().map((row) => {
      const generation = row.generation_status ? {
        status: row.generation_status,
        ...(row.generation_mode ? { mode: row.generation_mode } : {}),
        ...(row.generation_code ? { code: row.generation_code } : {}),
        ...(row.generation_draft_code ? { draft_code: row.generation_draft_code } : {}),
        ...(row.generation_review_status ? { review_status: row.generation_review_status } : {}),
        ...(row.generation_review_error ? { review_error: row.generation_review_error } : {}),
        ...(row.generation_reviewed_at ? { reviewed_at: row.generation_reviewed_at } : {}),
        ...(row.generation_source_path ? { source_path: row.generation_source_path } : {}),
        ...(row.generation_asset_url ? { asset_url: row.generation_asset_url } : {}),
        ...(row.generation_original_code ? { original_code: row.generation_original_code } : {}),
        ...(row.generation_original_asset_url ? { original_asset_url: row.generation_original_asset_url } : {}),
        ...(row.generation_original_source_path ? { original_source_path: row.generation_original_source_path } : {}),
        ...(row.generation_redraw_status ? { redraw_status: row.generation_redraw_status } : {}),
        ...(row.generation_redraw_asset_url ? { redraw_asset_url: row.generation_redraw_asset_url } : {}),
        ...(row.generation_redraw_source_path ? { redraw_source_path: row.generation_redraw_source_path } : {}),
        ...(row.generation_redraw_error ? { redraw_error: row.generation_redraw_error } : {}),
        ...(row.generation_redraw_attempts === null ? {} : { redraw_attempts: Number(row.generation_redraw_attempts || 0) }),
        ...(row.generation_redraw_updated_at ? { redraw_updated_at: row.generation_redraw_updated_at } : {}),
        ...(row.generation_attempts === null ? {} : { attempts: Number(row.generation_attempts || 0) }),
        ...(row.generation_error ? { error: row.generation_error } : {}),
        ...(row.generation_updated_at ? { updated_at: row.generation_updated_at } : {}),
      } : undefined;
      return {
        item_id: row.item_id,
        kind: row.kind,
        image_type: row.image_type,
        title: row.title,
        section_ids: safeJsonParse(row.section_ids_json, []),
        placement: row.placement,
        priority: Number(row.priority || 0),
        ...(generation ? { generation } : {}),
      };
    });
    return {
      plan_version: Number(plan.plan_version || 0),
      revision: plan.revision,
      items,
      updated_at: plan.updated_at || undefined,
    };
  }

  function normalizeMermaidReviewCode(value) {
    const code = String(value || '').replace(/^```mermaid\s*/i, '').replace(/```$/i, '').trim();
    if (!code) throw new Error('Mermaid 代码不能为空');
    assertSupportedMermaidSyntax(code);
    if (/[;；]/.test(code)) throw new Error('Mermaid 代码不能使用分号');
    if (/\s&\s/.test(code) && /-->|---|==>/.test(code)) throw new Error('Mermaid 代码不能使用多节点 & 连接简写');
    if (/\[[^\]\n"']*[\u3400-\u9fff][^\]\n"']*\]/u.test(code)) throw new Error('Mermaid 中文节点标签必须使用双引号');
    if (/^\s*[\u3400-\u9fff][\w\u3400-\u9fff-]*\s*(?:-->|---|==>)/mu.test(code)) throw new Error('Mermaid 节点 ID 不能直接使用中文');
    return code;
  }

  function findMermaidReviewPlanItem(itemId) {
    const plan = loadContentIllustrationPlan();
    const id = String(itemId || '').trim();
    const item = plan?.items?.find((entry) => entry.item_id === id);
    if (!item) throw new Error('未找到 Mermaid 审核项');
    if (item.kind !== 'mermaid') throw new Error('当前图片项不是 Mermaid 图');
    return { plan, item };
  }

  function findIllustrationReviewPlanItem(itemId) {
    const plan = loadContentIllustrationPlan();
    const id = String(itemId || '').trim();
    const item = plan?.items?.find((entry) => entry.item_id === id);
    if (!item) throw new Error('未找到图片审核项');
    return { plan, item };
  }

  function getIllustrationTargetNodeId(item) {
    return item.kind === 'html' && item.placement === 'before'
      ? item.section_ids?.[0]
      : item.section_ids?.[item.section_ids.length - 1];
  }

  function buildMermaidIllustrationBlock(item, code) {
    const itemId = String(item?.item_id || '').trim();
    const caption = String(item?.title || '').replace(/\s+/g, ' ').trim();
    if (!itemId || !caption || !code) {
      throw new Error('流程图缺少有效的 Mermaid 代码或标题');
    }
    return `<!-- yibiao-illustration:start id="${itemId}" -->\n\`\`\`mermaid\n${code}\n\`\`\`\n\n*<!-- yibiao-figure-caption -->${caption}*\n<!-- yibiao-illustration:end -->`;
  }

  function cleanIllustrationGeneration(generation) {
    const nextGeneration = { ...(generation || {}) };
    Object.keys(nextGeneration).forEach((key) => {
      if (nextGeneration[key] === undefined) delete nextGeneration[key];
    });
    return nextGeneration;
  }

  function resolveIllustrationAssetPath(assetUrl) {
    const source = String(assetUrl || '').split('?')[0];
    const prefix = 'yibiao-asset://generated-images/';
    if (!source.startsWith(prefix)) return '';
    let relativePath;
    try {
      relativePath = decodeURIComponent(source.slice(prefix.length));
    } catch {
      return '';
    }
    const projectIllustrationPrefix = 'technical-plan/illustrations/';
    const rootDir = projectScoped && relativePath.startsWith(projectIllustrationPrefix)
      ? generatedIllustrationsDir
      : getGeneratedImagesDir(app);
    const rootRelativePath = projectScoped && relativePath.startsWith(projectIllustrationPrefix)
      ? relativePath.slice(projectIllustrationPrefix.length)
      : relativePath;
    const resolved = path.resolve(rootDir, rootRelativePath);
    if (resolved === rootDir || !resolved.startsWith(`${path.resolve(rootDir)}${path.sep}`)) return '';
    return resolved;
  }

  function assertIllustrationOriginalResource(item, assetUrl, sourcePath) {
    const assetPath = resolveIllustrationAssetPath(assetUrl);
    if (assetPath && !fs.existsSync(assetPath)) {
      throw new Error(`原始图片文件不存在：${assetUrl}`);
    }
    if (sourcePath) {
      const resolvedSourcePath = resolveMarkdownPath(sourcePath);
      if (!fs.existsSync(resolvedSourcePath)) {
        throw new Error(`原始图片源文件不存在：${sourcePath}`);
      }
    }
  }

  function saveIllustrationSelection(item, { assetUrl, sourcePath, code }) {
    const targetNodeId = getIllustrationTargetNodeId(item);
    if (!targetNodeId) throw new Error('图片没有关联正文小节');

    const timestamp = now();
    const transaction = db.transaction(() => {
      const node = db.prepare('SELECT node_id, content FROM technical_plan_outline_nodes WHERE node_id = ?').get(targetNodeId);
      if (!node) throw new Error('当前目录中未找到图片所属章节');
      const replacement = assetUrl
        ? buildIllustrationBlock(item, assetUrl)
        : buildMermaidIllustrationBlock(item, code);
      let nextContent;
      try {
        nextContent = replaceIllustrationBlock(node.content || '', item.item_id, replacement);
      } catch (error) {
        const failedOriginalWithRedraw = item.generation?.status === 'error'
          && !item.generation?.asset_url
          && item.generation?.redraw_status === 'success'
          && assetUrl === item.generation?.redraw_asset_url;
        if (!failedOriginalWithRedraw || error.message !== `未找到正文图片块：${item.item_id}`) throw error;
        const current = String(node.content || '').trim();
        nextContent = item.placement === 'before'
          ? `${replacement}\n\n${current}`.trim()
          : `${current}\n\n${replacement}`.trim();
      }

      db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?')
        .run(nextContent, timestamp, targetNodeId);
      db.prepare(`
        INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
        VALUES (?, 'success', NULL, ?)
        ON CONFLICT(node_id) DO UPDATE SET status = 'success', error = NULL, updated_at = excluded.updated_at
      `).run(targetNodeId, timestamp);

      const nextGeneration = {
        ...(item.generation || {}),
        status: assetUrl ? 'success' : item.kind === 'mermaid' ? 'pending' : (item.generation?.status || 'success'),
        ...(code ? { code } : {}),
        review_status: 'confirmed',
        review_error: undefined,
        reviewed_at: timestamp,
        ...(assetUrl ? { asset_url: assetUrl, source_path: sourcePath || item.generation?.source_path } : {}),
        ...(assetUrl ? {} : item.kind === 'mermaid' ? { asset_url: undefined, source_path: undefined } : {}),
        redraw_status: undefined,
        redraw_asset_url: undefined,
        redraw_source_path: undefined,
        redraw_error: undefined,
        redraw_attempts: undefined,
        redraw_updated_at: undefined,
        error: undefined,
        attempts: undefined,
        updated_at: timestamp,
      };
      saveContentIllustrationItem({
        ...item,
        generation: cleanIllustrationGeneration(nextGeneration),
        updated_at: timestamp,
      });
    });
    transaction();

    const state = loadTechnicalPlan();
    return {
      outlineData: state.outlineData,
      contentGenerationSections: state.contentGenerationSections,
      contentIllustrationPlan: state.contentIllustrationPlan,
    };
  }

  function confirmMermaidIllustrationItem(item, normalizedCode) {
    const candidateAssetUrl = item.generation?.redraw_status === 'success'
      ? String(item.generation?.redraw_asset_url || '').trim()
      : '';
    return saveIllustrationSelection(item, {
      assetUrl: candidateAssetUrl,
      sourcePath: candidateAssetUrl ? item.generation?.redraw_source_path : undefined,
      code: normalizedCode,
    });
  }

  function saveMermaidReviewItemGeneration(item, generationPatch) {
    const nextGeneration = {
      ...(item.generation || {}),
      ...generationPatch,
      updated_at: now(),
    };
    Object.keys(nextGeneration).forEach((key) => {
      if (nextGeneration[key] === undefined) delete nextGeneration[key];
    });
    const nextItem = {
      ...item,
      generation: nextGeneration,
      updated_at: now(),
    };
    saveContentIllustrationItem(nextItem);
    return { contentIllustrationPlan: loadContentIllustrationPlan() };
  }

  function saveMermaidReviewCode({ itemId, code }) {
    const { item } = findMermaidReviewPlanItem(itemId);
    const normalizedCode = normalizeMermaidReviewCode(code);
    return saveMermaidReviewItemGeneration(item, {
      status: 'reviewing',
      code: normalizedCode,
      review_status: 'pending',
      review_error: undefined,
      asset_url: undefined,
      source_path: undefined,
      redraw_status: undefined,
      redraw_asset_url: undefined,
      redraw_source_path: undefined,
      redraw_error: undefined,
      redraw_attempts: undefined,
      redraw_updated_at: undefined,
      error: undefined,
    });
  }

  function previewMermaidReviewItem({ code }) {
    return { success: true, code: normalizeMermaidReviewCode(code) };
  }

  function getIllustrationReviewItem({ itemId }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    return { item };
  }

  function previewIllustrationReviewItem({ itemId, code }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    if (item.kind === 'mermaid') {
      return { success: true, code: normalizeMermaidReviewCode(code) };
    }
    return { success: true };
  }

  function saveIllustrationReviewItem({ itemId, code }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    if (item.kind === 'mermaid') {
      const normalizedCode = normalizeMermaidReviewCode(code);
      return saveMermaidReviewItemGeneration(item, {
        status: 'reviewing',
        code: normalizedCode,
        review_status: 'pending',
        review_error: undefined,
        asset_url: undefined,
        source_path: undefined,
        redraw_status: undefined,
        redraw_asset_url: undefined,
        redraw_source_path: undefined,
        redraw_error: undefined,
        redraw_attempts: undefined,
        redraw_updated_at: undefined,
        error: undefined,
      });
    }
    return saveMermaidReviewItemGeneration(item, {
      review_status: 'pending',
      review_error: undefined,
      redraw_status: undefined,
      redraw_asset_url: undefined,
      redraw_source_path: undefined,
      redraw_error: undefined,
      redraw_attempts: undefined,
      redraw_updated_at: undefined,
    });
  }

  function saveIllustrationRedrawCandidate({ itemId, generation }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    return saveMermaidReviewItemGeneration(item, {
      ...(generation || {}),
      redraw_updated_at: now(),
    });
  }

  function confirmMermaidReviewItem({ itemId, code }) {
    const { item } = findMermaidReviewPlanItem(itemId);
    const normalizedCode = normalizeMermaidReviewCode(code);
    return confirmMermaidIllustrationItem(item, normalizedCode);
  }

  function confirmIllustrationReviewItem({ itemId, code }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    if (item.kind === 'mermaid') {
      const normalizedCode = normalizeMermaidReviewCode(code);
      return confirmMermaidIllustrationItem(item, normalizedCode);
    }
    const candidateAssetUrl = item.generation?.redraw_status === 'success'
      ? String(item.generation?.redraw_asset_url || '').trim()
      : '';
    const currentAssetUrl = candidateAssetUrl || String(item.generation?.asset_url || '').trim();
    if (!currentAssetUrl) throw new Error('当前图片没有可确认的图片资源');
    return saveIllustrationSelection(item, {
      assetUrl: currentAssetUrl,
      sourcePath: candidateAssetUrl ? item.generation?.redraw_source_path : item.generation?.source_path,
    });
  }

  function resetIllustrationReviewItem({ itemId }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    const originalCode = String(item.generation?.original_code || '').trim();
    const originalAssetUrl = String(item.generation?.original_asset_url || '').trim();
    const originalSourcePath = String(item.generation?.original_source_path || '').trim();
    if (item.kind === 'mermaid') {
      if (!originalCode) throw new Error('未找到原始 Mermaid 流程图，无法重置');
    } else {
      if (!originalAssetUrl) throw new Error('未找到原始图片，无法重置');
      assertIllustrationOriginalResource(item, originalAssetUrl, originalSourcePath);
    }

    const targetNodeId = getIllustrationTargetNodeId(item);
    if (!targetNodeId) throw new Error('图片没有关联正文小节');
    const timestamp = now();
    const transaction = db.transaction(() => {
      const node = db.prepare('SELECT node_id, content FROM technical_plan_outline_nodes WHERE node_id = ?').get(targetNodeId);
      if (!node) throw new Error('当前目录中未找到图片所属章节');
      const replacement = item.kind === 'mermaid'
        ? buildMermaidIllustrationBlock(item, originalCode)
        : buildIllustrationBlock(item, originalAssetUrl);
      const nextContent = replaceIllustrationBlock(node.content || '', item.item_id, replacement);
      db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?')
        .run(nextContent, timestamp, targetNodeId);
      db.prepare(`
        INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
        VALUES (?, 'success', NULL, ?)
        ON CONFLICT(node_id) DO UPDATE SET status = 'success', error = NULL, updated_at = excluded.updated_at
      `).run(targetNodeId, timestamp);

      const nextGeneration = cleanIllustrationGeneration({
        ...(item.generation || {}),
        status: item.kind === 'mermaid' ? 'pending' : 'success',
        ...(item.kind === 'mermaid'
          ? { code: originalCode, asset_url: undefined, source_path: undefined }
          : { asset_url: originalAssetUrl, source_path: originalSourcePath || undefined }),
        review_status: 'pending',
        review_error: undefined,
        reviewed_at: undefined,
        redraw_status: undefined,
        redraw_asset_url: undefined,
        redraw_source_path: undefined,
        redraw_error: undefined,
        redraw_attempts: undefined,
        redraw_updated_at: undefined,
        error: undefined,
        attempts: undefined,
        updated_at: timestamp,
      });
      saveContentIllustrationItem({
        ...item,
        generation: nextGeneration,
        updated_at: timestamp,
      });
    });
    transaction();

    const state = loadTechnicalPlan();
    return {
      outlineData: state.outlineData,
      contentGenerationSections: state.contentGenerationSections,
      contentIllustrationPlan: state.contentIllustrationPlan,
    };
  }

  function skipMermaidReviewItem({ itemId }) {
    const { item } = findMermaidReviewPlanItem(itemId);
    return saveMermaidReviewItemGeneration(item, {
      status: 'skipped',
      review_status: 'skipped',
      review_error: undefined,
      reviewed_at: now(),
      asset_url: undefined,
      source_path: undefined,
      redraw_status: undefined,
      redraw_asset_url: undefined,
      redraw_source_path: undefined,
      redraw_error: undefined,
      redraw_attempts: undefined,
      redraw_updated_at: undefined,
      error: undefined,
      attempts: undefined,
    });
  }

  function skipIllustrationReviewItem({ itemId }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    return saveMermaidReviewItemGeneration(item, {
      status: item.generation?.status || 'success',
      review_status: 'skipped',
      review_error: undefined,
      reviewed_at: now(),
      redraw_status: undefined,
      redraw_asset_url: undefined,
      redraw_source_path: undefined,
      redraw_error: undefined,
      redraw_attempts: undefined,
      redraw_updated_at: undefined,
    });
  }

  function adoptIllustrationReviewItem({ itemId }) {
    const { item } = findIllustrationReviewPlanItem(itemId);
    const candidateAssetUrl = String(item.generation?.redraw_asset_url || '').trim();
    if (!candidateAssetUrl || item.generation?.redraw_status !== 'success') {
      throw new Error('当前图片没有可采用的 AI 重绘候选');
    }
    return saveIllustrationSelection(item, {
      assetUrl: candidateAssetUrl,
      sourcePath: item.generation?.redraw_source_path,
    });
  }

  function normalizeGlobalFactGroups(groups) {
    const seen = new Set();
    return (Array.isArray(groups) ? groups : []).map((group, index) => {
      const title = String(group?.title || '').trim();
      const content = String(group?.content || '').trim();
      if (!title || !content) return null;
      let id = normalizeGlobalFactId(group?.id || group?.group_id || title, index);
      let suffix = 2;
      while (seen.has(id)) {
        id = `${id}_${suffix}`;
        suffix += 1;
      }
      seen.add(id);
      return {
        id,
        title,
        content,
        updated_at: group?.updated_at || group?.updatedAt || now(),
      };
    }).filter(Boolean);
  }

  function loadGlobalFacts() {
    return db.prepare('SELECT * FROM technical_plan_global_fact_groups ORDER BY sort_order ASC, group_id ASC').all().map((row) => ({
      id: row.group_id,
      title: row.title,
      content: row.content || '',
      updated_at: row.updated_at || undefined,
    }));
  }

  function replaceGlobalFacts(groups) {
    const normalized = normalizeGlobalFactGroups(groups);
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    if (!normalized.length) return;

    const insert = db.prepare(`
      INSERT INTO technical_plan_global_fact_groups (group_id, title, content, sort_order, created_at, updated_at)
      VALUES (@group_id, @title, @content, @sort_order, @created_at, @updated_at)
    `);
    const timestamp = now();
    normalized.forEach((group, index) => insert.run({
      group_id: group.id,
      title: group.title,
      content: group.content,
      sort_order: index,
      created_at: timestamp,
      updated_at: group.updated_at || timestamp,
    }));
  }

  function saveContentPlans(plans) {
    const entries = Object.entries(plans || {}).filter(([, value]) => value?.plan && Number(value.plan_version) > 0);
    if (!entries.length) {
      db.prepare('DELETE FROM technical_plan_content_plans').run();
      return;
    }

    const nextIds = new Set(entries.map(([nodeId]) => nodeId));
    const upsert = db.prepare(`
      INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at)
      VALUES (@node_id, @plan_json, @updated_at)
      ON CONFLICT(node_id) DO UPDATE SET
        plan_json = excluded.plan_json,
        updated_at = excluded.updated_at
    `);
    const timestamp = now();
    for (const [nodeId, value] of entries) {
      if (!value?.plan) continue;
      upsert.run({
        node_id: nodeId,
        plan_json: JSON.stringify({
          plan_version: Number(value.plan_version),
          plan: value.plan,
          ...(value.table_requirement ? { table_requirement: value.table_requirement } : {}),
        }),
        updated_at: value.updated_at || timestamp,
      });
    }

    const deletePlan = db.prepare('DELETE FROM technical_plan_content_plans WHERE node_id = ?');
    for (const row of db.prepare('SELECT node_id FROM technical_plan_content_plans').all()) {
      if (!nextIds.has(row.node_id)) deletePlan.run(row.node_id);
    }
  }

  const updateGeneratedContent = db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?');
  const upsertGeneratedSection = db.prepare(`
    INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
    VALUES (@node_id, @status, @error, @updated_at)
    ON CONFLICT(node_id) DO UPDATE SET
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);
  const upsertGeneratedPlan = db.prepare(`
    INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at)
    VALUES (@node_id, @plan_json, @updated_at)
    ON CONFLICT(node_id) DO UPDATE SET
      plan_json = excluded.plan_json,
      updated_at = excluded.updated_at
  `);
  function saveContentGenerationItemFields({ nodeId, section, storedPlan, runtime }) {
    const timestamp = now();
    if (section) {
      const previousContent = db.prepare('SELECT content FROM technical_plan_outline_nodes WHERE node_id = ?').get(nodeId)?.content || '';
      const nextContent = String(section.content || '');
      updateGeneratedContent.run(String(section.content || ''), timestamp, nodeId);
      if (generatedContentChangedNodeIds && previousContent !== nextContent) {
        generatedContentChangedNodeIds.add(String(nodeId));
      }
      upsertGeneratedSection.run({
        node_id: nodeId,
        status: normalizeStatus(section.status, ['idle', 'running', 'success', 'error', 'ignored'], 'idle'),
        error: section.error ? String(section.error) : null,
        updated_at: section.updated_at || timestamp,
      });
    }
    if (storedPlan) {
      upsertGeneratedPlan.run({
        node_id: nodeId,
        plan_json: JSON.stringify({
          plan_version: Number(storedPlan.plan_version),
          plan: storedPlan.plan,
          ...(storedPlan.table_requirement ? { table_requirement: storedPlan.table_requirement } : {}),
        }),
        updated_at: storedPlan.updated_at || timestamp,
      });
    }
    if (runtime !== undefined) {
      updateMeta({ content_generation_runtime_json: jsonOrNull(runtime) });
    }
  }

  function clearDownstreamFromTender() {
    clearHistoricalAdaptationContentCheckCache();
    deleteOutlineAgentTask();
    deleteGlobalFactsAgentTask();
    db.prepare('DELETE FROM technical_plan_tasks').run();
    db.prepare('DELETE FROM technical_plan_bid_items').run();
    db.prepare('DELETE FROM technical_plan_reference_docs').run();
    db.prepare('DELETE FROM technical_plan_remote_knowledge_documents').run();
    db.prepare('DELETE FROM technical_plan_remote_knowledge_scopes').run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    clearContentIllustrationPlan();
    clearOriginalOutlineRuntime();
    clearTechnicalPlanMermaidCache();
    updateMeta({
      step: 'document-analysis',
      bid_analysis_mode: 'key',
      bid_analysis_selected_task_ids_json: null,
      outline_mode: defaultOutlineModeForWorkflow(ensureMetaRow().workflow_kind),
      outline_expansion_mode: 'ai-complement',
      outline_word_control_snapshot_json: null,
      outline_minimum_depth_snapshot: null,
      outline_project_name: null,
      outline_project_overview: null,
      global_facts_mode: 'omit',
      content_generation_options_json: null,
      content_generation_runtime_json: null,
      pending_tender_markdown_path: null,
      pending_tender_file_name: null,
      pending_tender_parser_label: null,
      pending_tender_sections_json: null,
      pending_tender_total_declared: null,
      pending_tender_created_at: null,
      bid_section_mode: 'single',
      bid_sections_json: null,
      bid_section_extraction_status: 'idle',
      bid_section_extraction_error: null,
      selected_section_id: null,
      selected_section_title: null,
      historical_adaptation_differences_json: null,
      historical_adaptation_difference_confirmed_at: null,
      historical_adaptation_original_outline_json: null,
      historical_adaptation_outline_changes_json: null,
      historical_adaptation_outline_confirmed_at: null,
      historical_adaptation_content_items_json: null,
      historical_adaptation_content_confirmed_at: null,
      historical_adaptation_content_check_json: null,
      historical_adaptation_review_findings_json: null,
      historical_adaptation_review_confirmed_at: null,
    });
  }

  function clearDownstreamFromBidSectionChange() {
    clearHistoricalAdaptationContentCheckCache();
    clearBidTemplate();
    deleteOutlineAgentTask();
    deleteGlobalFactsAgentTask();
    db.prepare('DELETE FROM technical_plan_tasks').run();
    db.prepare('DELETE FROM technical_plan_bid_items').run();
    db.prepare('DELETE FROM technical_plan_reference_docs').run();
    db.prepare('DELETE FROM technical_plan_remote_knowledge_documents').run();
    db.prepare('DELETE FROM technical_plan_remote_knowledge_scopes').run();
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    clearContentIllustrationPlan();
    clearOriginalOutlineRuntime();
    clearTechnicalPlanMermaidCache();
    updateMeta({
      content_generation_options_json: null,
      content_generation_runtime_json: null,
      outline_word_control_snapshot_json: null,
      outline_minimum_depth_snapshot: null,
      outline_project_name: null,
      outline_project_overview: null,
      historical_adaptation_differences_json: null,
      historical_adaptation_difference_confirmed_at: null,
      historical_adaptation_original_outline_json: null,
      historical_adaptation_outline_changes_json: null,
      historical_adaptation_outline_confirmed_at: null,
      historical_adaptation_content_items_json: null,
      historical_adaptation_content_confirmed_at: null,
      historical_adaptation_content_check_json: null,
      historical_adaptation_review_findings_json: null,
      historical_adaptation_review_confirmed_at: null,
    });
  }

  function clearContentGenerationState() {
    db.prepare("UPDATE technical_plan_outline_nodes SET content = '', updated_at = ?").run(now());
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();
    db.prepare("DELETE FROM technical_plan_tasks WHERE type = 'content-generation'").run();
    clearContentIllustrationPlan();
    clearTechnicalPlanMermaidCache();
    updateMeta({ content_generation_runtime_json: null });
  }

  function clearHistoricalAdaptationReviewState() {
    updateMeta({
      historical_adaptation_review_findings_json: null,
      historical_adaptation_review_confirmed_at: null,
    });
  }

  function collectOutlineNodeAndDescendantIds(nodeId) {
    const targetNodeId = String(nodeId || '').trim();
    if (!targetNodeId) return [];
    return db.prepare(`
      WITH RECURSIVE affected(node_id) AS (
        SELECT node_id FROM technical_plan_outline_nodes WHERE node_id = ?
        UNION ALL
        SELECT child.node_id
        FROM technical_plan_outline_nodes child
        JOIN affected parent ON child.parent_node_id = parent.node_id
      )
      SELECT node_id FROM affected
    `).all(targetNodeId).map((row) => row.node_id);
  }

  function clearContentGenerationStateForNodes(nodeIds) {
    const affectedIds = normalizeStringList(nodeIds);
    if (!affectedIds.length) return;
    const placeholders = affectedIds.map(() => '?').join(', ');
    const timestamp = now();
    db.prepare(`UPDATE technical_plan_outline_nodes SET content = '', updated_at = ? WHERE node_id IN (${placeholders})`).run(timestamp, ...affectedIds);
    db.prepare(`DELETE FROM technical_plan_content_sections WHERE node_id IN (${placeholders})`).run(...affectedIds);
    db.prepare(`DELETE FROM technical_plan_content_plans WHERE node_id IN (${placeholders})`).run(...affectedIds);
    db.prepare("DELETE FROM technical_plan_tasks WHERE type = 'content-generation'").run();
    clearContentIllustrationPlan();
    clearTechnicalPlanMermaidCache();
    updateMeta({ content_generation_runtime_json: null });
  }

  function clearDownstreamFromOriginalPlan() {
    clearHistoricalAdaptationContentCheckCache();
    deleteOutlineAgentTask();
    deleteGlobalFactsAgentTask();
    db.prepare(`DELETE FROM technical_plan_tasks WHERE type IN (${originalPlanDownstreamTaskTypes.map(() => '?').join(', ')})`).run(...originalPlanDownstreamTaskTypes);
    db.prepare('DELETE FROM technical_plan_outline_nodes').run();
    db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();
    clearContentIllustrationPlan();
    clearOriginalOutlineRuntime();
    clearTechnicalPlanMermaidCache();
    updateMeta({
      step: 'document-analysis',
      outline_project_name: null,
      outline_project_overview: null,
      content_generation_runtime_json: null,
      outline_word_control_snapshot_json: null,
      outline_minimum_depth_snapshot: null,
      historical_adaptation_differences_json: null,
      historical_adaptation_difference_confirmed_at: null,
      historical_adaptation_original_outline_json: null,
      historical_adaptation_outline_changes_json: null,
      historical_adaptation_outline_confirmed_at: null,
      historical_adaptation_content_items_json: null,
      historical_adaptation_content_confirmed_at: null,
      historical_adaptation_content_check_json: null,
      historical_adaptation_review_findings_json: null,
      historical_adaptation_review_confirmed_at: null,
    });
  }

  // 正文任务活动或暂停期间禁止手工保存，避免清空待恢复的图片计划。
  function assertContentEditingAllowed() {
    const row = db.prepare("SELECT status FROM technical_plan_tasks WHERE type IN ('content-generation', 'historical-adaptation-content', 'historical-adaptation-content-check') AND status IN ('queued', 'running', 'pausing', 'paused') LIMIT 1").get();
    if (row) {
      throw new Error('当前正文任务正在运行、排队或已暂停，请先完成任务再编辑正文');
    }
  }

  function loadOutlinePersistenceSnapshot() {
    return {
      nodes: db.prepare('SELECT node_id, content FROM technical_plan_outline_nodes').all().reduce((acc, row) => {
        acc[row.node_id] = { content: row.content || '' };
        return acc;
      }, {}),
      sections: db.prepare('SELECT node_id, status, error, updated_at FROM technical_plan_content_sections').all(),
      plans: db.prepare('SELECT node_id, plan_json, updated_at FROM technical_plan_content_plans').all(),
    };
  }

  function assertOutlineMutationAllowed() {
    const adaptationTask = db.prepare("SELECT status FROM technical_plan_tasks WHERE type = 'historical-adaptation-outline'").get();
    if (['queued', 'running', 'pausing', 'paused'].includes(adaptationTask?.status)) {
      throw new Error('目录适配任务正在运行或暂停中，请结束后再调整目录');
    }
    const task = db.prepare("SELECT status FROM technical_plan_tasks WHERE type = 'content-generation'").get();
    if (['running', 'pausing', 'paused'].includes(task?.status)) {
      throw new Error('正文生成任务正在运行或暂停中，请结束后再调整目录');
    }
    const adaptationContentTask = db.prepare("SELECT status FROM technical_plan_tasks WHERE type = 'historical-adaptation-content'").get();
    if (['queued', 'running', 'pausing', 'paused'].includes(adaptationContentTask?.status)) {
      throw new Error('正文迁移任务正在运行、排队或暂停中，请结束后再调整目录');
    }
  }

  function assertOutlineNodeKnowledgeMutationAllowed() {
    const outlineTask = db.prepare("SELECT status FROM technical_plan_tasks WHERE type = 'outline-generation'").get();
    if (['running', 'pausing'].includes(outlineTask?.status)) {
      throw new Error('目录生成任务正在运行中，请结束后再关联知识库');
    }
    assertOutlineMutationAllowed();
  }

  function shouldClearSavedNode({ clearAll, oldId, newId, affectedIds }) {
    return clearAll || affectedIds.has(oldId) || (!oldId && affectedIds.has(newId));
  }

  function buildOutlineWithPersistedContent(outlineData, { snapshot, reverseMap, affectedIds, clearAll }) {
    if (!outlineData?.outline?.length) return outlineData;
    return {
      ...outlineData,
      outline: mapOutlineItems(outlineData.outline, (item) => {
        const newId = String(item?.id || '').trim();
        const oldId = reverseMap.get(newId) || newId;
        const clearContent = shouldClearSavedNode({ clearAll, oldId, newId, affectedIds });
        const oldContent = snapshot.nodes[oldId]?.content;
        return {
          ...item,
          content: clearContent ? '' : String(oldContent ?? item?.content ?? ''),
        };
      }),
    };
  }

  function restoreMappedContentRows({ snapshot, idMap, affectedIds, nextIds, clearAll }) {
    db.prepare('DELETE FROM technical_plan_content_sections').run();
    db.prepare('DELETE FROM technical_plan_content_plans').run();

    if (clearAll || !nextIds.size) return;

    const insertSection = db.prepare(`
      INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
      VALUES (@node_id, @status, @error, @updated_at)
    `);
    const seenSections = new Set();
    for (const row of snapshot.sections) {
      const oldId = String(row.node_id || '').trim();
      const newId = idMap.get(oldId) || oldId;
      if (!newId || !nextIds.has(newId) || seenSections.has(newId)) continue;
      if (shouldClearSavedNode({ clearAll, oldId, newId, affectedIds })) continue;
      seenSections.add(newId);
      insertSection.run({
        node_id: newId,
        status: normalizeStatus(row.status, ['idle', 'running', 'success', 'error', 'ignored'], 'idle'),
        error: row.error || null,
        updated_at: row.updated_at || now(),
      });
    }

    const insertPlan = db.prepare(`
      INSERT INTO technical_plan_content_plans (node_id, plan_json, updated_at)
      VALUES (@node_id, @plan_json, @updated_at)
    `);
    const seenPlans = new Set();
    for (const row of snapshot.plans) {
      const oldId = String(row.node_id || '').trim();
      const newId = idMap.get(oldId) || oldId;
      if (!newId || !nextIds.has(newId) || seenPlans.has(newId)) continue;
      if (shouldClearSavedNode({ clearAll, oldId, newId, affectedIds })) continue;
      if (!row.plan_json) continue;
      seenPlans.add(newId);
      insertPlan.run({
        node_id: newId,
        plan_json: row.plan_json,
        updated_at: row.updated_at || now(),
      });
    }
  }

  // 目录排序时使用临时编号同步主键和外键，避免删除重建正文状态与计划。
  function saveSortedOutline(outlineData, idMap) {
    const rows = flattenOutlineItems(outlineData?.outline || []);
    const changedIds = [...idMap.entries()].filter(([oldId, newId]) => oldId !== newId);
    const temporaryIds = new Map(changedIds.map(([oldId], index) => [oldId, `__outline_sort_${crypto.randomUUID()}_${index}`]));
    db.pragma('defer_foreign_keys = ON');

    for (const [oldId] of changedIds) {
      const temporaryId = temporaryIds.get(oldId);
      db.prepare('UPDATE technical_plan_outline_nodes SET node_id = ? WHERE node_id = ?').run(temporaryId, oldId);
      db.prepare('UPDATE technical_plan_content_sections SET node_id = ? WHERE node_id = ?').run(temporaryId, oldId);
      db.prepare('UPDATE technical_plan_content_plans SET node_id = ? WHERE node_id = ?').run(temporaryId, oldId);
    }
    for (const [oldId] of changedIds) {
      db.prepare('UPDATE technical_plan_outline_nodes SET parent_node_id = ? WHERE parent_node_id = ?').run(temporaryIds.get(oldId), oldId);
    }
    for (const [oldId, newId] of changedIds) {
      const temporaryId = temporaryIds.get(oldId);
      db.prepare('UPDATE technical_plan_outline_nodes SET node_id = ? WHERE node_id = ?').run(newId, temporaryId);
      db.prepare('UPDATE technical_plan_content_sections SET node_id = ? WHERE node_id = ?').run(newId, temporaryId);
      db.prepare('UPDATE technical_plan_content_plans SET node_id = ? WHERE node_id = ?').run(newId, temporaryId);
      db.prepare('UPDATE technical_plan_outline_nodes SET parent_node_id = ? WHERE parent_node_id = ?').run(newId, temporaryId);
    }

    const updateNode = db.prepare(`
      UPDATE technical_plan_outline_nodes
      SET parent_node_id = @parent_node_id,
        sort_order = @sort_order,
        level = @level,
        title = @title,
        updated_at = @updated_at
      WHERE node_id = @node_id
    `);
    const timestamp = now();
    rows.forEach((row) => updateNode.run({ ...row, updated_at: timestamp }));
    updateMeta({
      outline_project_name: outlineData?.project_name || null,
      outline_project_overview: outlineData?.project_overview || null,
    });

    const meta = readMetaRow();
    if (meta.content_generation_runtime_json) {
      const runtime = remapContentRuntimeIds(safeJsonParse(meta.content_generation_runtime_json, {}), idMap);
      db.prepare('UPDATE technical_plan_meta SET content_generation_runtime_json = ?, updated_at = ? WHERE id = 1')
        .run(JSON.stringify(runtime), timestamp);
    }
    const contentTask = db.prepare("SELECT stats_json FROM technical_plan_tasks WHERE type = 'content-generation'").get();
    if (contentTask?.stats_json) {
      const stats = remapContentTaskStats(safeJsonParse(contentTask.stats_json, {}), idMap);
      db.prepare("UPDATE technical_plan_tasks SET stats_json = ? WHERE type = 'content-generation'").run(JSON.stringify(stats));
    }
  }

  function applyPartial(partial) {
    const meta = ensureMetaRow();
    const metaUpdates = {};
    const invalidatesContentGeneration = partial.invalidateContentGeneration === true;

    if (hasOwn(partial, 'workflowKind')) metaUpdates.workflow_kind = normalizeWorkflowKind(partial.workflowKind);
    if (hasOwn(partial, 'step') && isValidStep(partial.step)) metaUpdates.step = partial.step;
    if (hasOwn(partial, 'bidAnalysisMode') && isValidBidMode(partial.bidAnalysisMode)) metaUpdates.bid_analysis_mode = partial.bidAnalysisMode;
    if (hasOwn(partial, 'bidAnalysisSelectedTaskIds')) metaUpdates.bid_analysis_selected_task_ids_json = jsonOrNull(normalizeBidAnalysisTaskIds(partial.bidAnalysisSelectedTaskIds));
    if (hasOwn(partial, 'bidSectionMode')) metaUpdates.bid_section_mode = normalizeBidSectionMode(partial.bidSectionMode);
    if (hasOwn(partial, 'bidSections')) metaUpdates.bid_sections_json = jsonOrNull(normalizeBidSections(partial.bidSections));
    if (hasOwn(partial, 'bidSectionExtractionStatus')) metaUpdates.bid_section_extraction_status = normalizeBidSectionExtractionStatus(partial.bidSectionExtractionStatus);
    if (hasOwn(partial, 'bidSectionExtractionError')) metaUpdates.bid_section_extraction_error = partial.bidSectionExtractionError ? String(partial.bidSectionExtractionError) : null;
    if (hasOwn(partial, 'outlineMode') && isValidOutlineMode(partial.outlineMode)) metaUpdates.outline_mode = partial.outlineMode;
    if (hasOwn(partial, 'outlineExpansionMode') && isValidOutlineExpansionMode(partial.outlineExpansionMode)) metaUpdates.outline_expansion_mode = partial.outlineExpansionMode;
    if (hasOwn(partial, 'globalFactsMode')) metaUpdates.global_facts_mode = normalizeGlobalFactsMode(partial.globalFactsMode);
    if (hasOwn(partial, 'outlineWordControlOptions')) metaUpdates.outline_word_control_options_json = jsonOrNull(normalizeOutlineWordControlOptions(partial.outlineWordControlOptions));
    if (hasOwn(partial, 'outlineWordControlSnapshot')) {
      metaUpdates.outline_word_control_snapshot_json = partial.outlineWordControlSnapshot === undefined || partial.outlineWordControlSnapshot === null
        ? null
        : JSON.stringify(normalizeOutlineWordControlOptions(partial.outlineWordControlSnapshot));
    }
    if (hasOwn(partial, 'outlineMinimumDepth')) {
      metaUpdates.outline_minimum_depth = normalizeOutlineMinimumDepth(partial.outlineMinimumDepth);
    }
    if (hasOwn(partial, 'outlineMinimumDepthSnapshot')) {
      metaUpdates.outline_minimum_depth_snapshot = partial.outlineMinimumDepthSnapshot === undefined || partial.outlineMinimumDepthSnapshot === null
        ? null
        : normalizeOutlineMinimumDepth(partial.outlineMinimumDepthSnapshot);
    }
    if (hasOwn(partial, 'contentGenerationOptions')) metaUpdates.content_generation_options_json = jsonOrNull(partial.contentGenerationOptions);
    if (!invalidatesContentGeneration && hasOwn(partial, 'contentGenerationRuntime')) metaUpdates.content_generation_runtime_json = jsonOrNull(partial.contentGenerationRuntime);
    if (hasOwn(partial, 'historicalAdaptationDifferences')) {
      metaUpdates.historical_adaptation_differences_json = jsonOrNull(normalizeHistoricalAdaptationDifferences(partial.historicalAdaptationDifferences));
    }
    if (hasOwn(partial, 'historicalAdaptationDifferenceConfirmedAt')) {
      metaUpdates.historical_adaptation_difference_confirmed_at = partial.historicalAdaptationDifferenceConfirmedAt
        ? String(partial.historicalAdaptationDifferenceConfirmedAt)
        : null;
    }
    if (hasOwn(partial, 'historicalAdaptationOriginalOutline')) {
      metaUpdates.historical_adaptation_original_outline_json = jsonOrNull(partial.historicalAdaptationOriginalOutline);
    }
    if (hasOwn(partial, 'historicalAdaptationOutlineChanges')) {
      metaUpdates.historical_adaptation_outline_changes_json = jsonOrNull(
        normalizeHistoricalAdaptationOutlineChanges(partial.historicalAdaptationOutlineChanges),
      );
    }
    if (hasOwn(partial, 'historicalAdaptationOutlineConfirmedAt')) {
      metaUpdates.historical_adaptation_outline_confirmed_at = partial.historicalAdaptationOutlineConfirmedAt
        ? String(partial.historicalAdaptationOutlineConfirmedAt)
        : null;
    }
    if (hasOwn(partial, 'historicalAdaptationContentItems')) {
      metaUpdates.historical_adaptation_content_items_json = jsonOrNull(
        normalizeHistoricalAdaptationContentItems(partial.historicalAdaptationContentItems),
      );
    }
    if (partial.historicalAdaptationContentItem) writeHistoricalContentItem(normalizeHistoricalAdaptationContentItems([partial.historicalAdaptationContentItem])[0]);
    if (hasOwn(partial, 'historicalAdaptationContentConfirmedAt')) {
      metaUpdates.historical_adaptation_content_confirmed_at = partial.historicalAdaptationContentConfirmedAt
        ? String(partial.historicalAdaptationContentConfirmedAt)
        : null;
    }
    if (hasOwn(partial, 'historicalAdaptationContentCheck')) {
      metaUpdates.historical_adaptation_content_check_json = jsonOrNull(
        normalizeHistoricalAdaptationContentCheck(partial.historicalAdaptationContentCheck),
      );
    }
    if (hasOwn(partial, 'historicalAdaptationContentFactOverrides')) {
      metaUpdates.historical_adaptation_content_fact_overrides_json = jsonOrNull(
        normalizeHistoricalAdaptationContentFactOverrides(partial.historicalAdaptationContentFactOverrides),
      );
    }
    if (hasOwn(partial, 'historicalAdaptationReviewFindings')) {
      metaUpdates.historical_adaptation_review_findings_json = jsonOrNull(partial.historicalAdaptationReviewFindings);
    }
    if (hasOwn(partial, 'historicalAdaptationReviewConfirmedAt')) {
      metaUpdates.historical_adaptation_review_confirmed_at = partial.historicalAdaptationReviewConfirmedAt
        ? String(partial.historicalAdaptationReviewConfirmedAt)
        : null;
    }

    if (Object.keys(metaUpdates).length) updateMeta(metaUpdates);

    const nextBidMode = isValidBidMode(partial.bidAnalysisMode) ? partial.bidAnalysisMode : meta.bid_analysis_mode;
    if (hasOwn(partial, 'referenceKnowledgeDocumentIds')) replaceReferenceDocumentIds(partial.referenceKnowledgeDocumentIds);
    if (hasOwn(partial, 'remoteKnowledgeScopes')) replaceRemoteKnowledgeScopes(partial.remoteKnowledgeScopes);
    if (!invalidatesContentGeneration && hasOwn(partial, 'contentIllustrationPlan')) replaceContentIllustrationPlan(partial.contentIllustrationPlan);
    if (hasOwn(partial, 'contentIllustrationItem')) saveContentIllustrationItem(partial.contentIllustrationItem);
    if (hasOwn(partial, 'bidAnalysisTasks')) saveBidItems(partial.bidAnalysisTasks, nextBidMode);
    if (hasOwn(partial, 'bidAnalysisItem')) saveBidItem(partial.bidAnalysisItem, nextBidMode);
    if (hasOwn(partial, 'projectOverview')) upsertDerivedBidItem('projectOverview', partial.projectOverview, nextBidMode);
    if (hasOwn(partial, 'techRequirements')) upsertDerivedBidItem('techRequirements', partial.techRequirements, nextBidMode);
    if (hasOwn(partial, 'globalFacts')) {
      replaceGlobalFacts(partial.globalFacts);
      db.prepare(`UPDATE historical_adaptation_content_check_batches
        SET status = 'stale', error_code = 'stale-input', error_message = '全局事实已变化', updated_at = ?
        WHERE project_id = ? AND status <> 'stale'`).run(now(), contentCheckBatchProjectId);
      updateMeta({ historical_adaptation_content_check_json: jsonOrNull({ status: 'stale', findings: [] }) });
    }

    if (invalidatesContentGeneration) clearContentGenerationState();

    for (const [field, type] of Object.entries(taskFieldTypes)) {
      if (invalidatesContentGeneration && field === 'contentGenerationTask') continue;
      if (hasOwn(partial, field)) saveTask(type, partial[field]);
    }

    if (hasOwn(partial, 'outlineData')) {
      if (partial.outlineData === null) {
        db.prepare('DELETE FROM technical_plan_outline_nodes').run();
        updateMeta({
          outline_project_name: null,
          outline_project_overview: null,
          outline_word_control_snapshot_json: null,
          outline_minimum_depth_snapshot: null,
        });
      } else {
        saveOutlineData(partial.outlineData);
        if (!partial.outlineData?.outline?.length) {
          updateMeta({ outline_word_control_snapshot_json: null, outline_minimum_depth_snapshot: null });
        }
      }
    }

    if (!invalidatesContentGeneration && hasOwn(partial, 'contentGenerationSections')) saveContentSections(partial.contentGenerationSections);
    if (!invalidatesContentGeneration && hasOwn(partial, 'contentGenerationPlans')) saveContentPlans(partial.contentGenerationPlans);
    if (hasOwn(partial, 'contentGenerationItem')) saveContentGenerationItemFields(partial.contentGenerationItem);
  }

  function loadTechnicalPlan() {
    const meta = readMetaRow();
    const bidAnalysisMode = isValidBidMode(meta.bid_analysis_mode) ? meta.bid_analysis_mode : 'key';
    const bidAnalysisSelectedTaskIds = getBidAnalysisTaskIdsForConfig(
      bidAnalysisMode,
      safeJsonParse(meta.bid_analysis_selected_task_ids_json, []),
    );
    const bidAnalysisTasks = loadBidItems();
    const outlineData = loadOutlineData(meta);
    const tasks = loadTasks();
    const bidSections = normalizeBidSections(safeJsonParse(meta.bid_sections_json, []));
    const bidSectionExtractionTask = tasks.bidSectionExtractionTask;
    const tenderFiles = loadTenderSourceFiles(meta);
    const tenderFile = meta.tender_markdown_path ? {
      fileName: meta.tender_file_name || '技术方案招标文件',
      markdownPath: meta.tender_markdown_path,
      markdownChars: Number(meta.tender_markdown_chars || 0),
      contentHash: meta.tender_markdown_hash || '',
      originalMarkdownPath: meta.tender_original_markdown_path || meta.tender_markdown_path,
      originalMarkdownChars: Number(meta.tender_original_markdown_chars || meta.tender_markdown_chars || 0),
      originalContentHash: meta.tender_original_markdown_hash || meta.tender_markdown_hash || '',
      parserLabel: meta.tender_parser_label || undefined,
      importedAt: meta.tender_imported_at || undefined,
      selectedSectionId: meta.selected_section_id || undefined,
      selectedSectionTitle: meta.selected_section_title || undefined,
      updatedAt: meta.updated_at,
    } : null;
    const originalPlanFile = meta.original_plan_markdown_path ? {
      fileName: meta.original_plan_file_name || '原方案',
      markdownPath: meta.original_plan_markdown_path,
      markdownChars: Number(meta.original_plan_markdown_chars || 0),
      contentHash: meta.original_plan_markdown_hash || '',
      parserLabel: meta.original_plan_parser_label || undefined,
      importedAt: meta.original_plan_imported_at || undefined,
      updatedAt: meta.updated_at,
    } : null;

    return {
      ...initialState,
      workflowKind: normalizeWorkflowKind(meta.workflow_kind),
      step: isValidStep(meta.step) ? meta.step : 'document-analysis',
      tenderFile,
      tenderFiles,
      originalPlanFile,
      projectOverview: bidAnalysisTasks.projectOverview?.status === 'success' ? bidAnalysisTasks.projectOverview.content : '',
      techRequirements: bidAnalysisTasks.techRequirements?.status === 'success' ? bidAnalysisTasks.techRequirements.content : '',
      bidAnalysisMode,
      bidAnalysisSelectedTaskIds,
      bidAnalysisTasks,
      bidAnalysisProgress: calculateBidProgress(bidAnalysisMode, bidAnalysisTasks, bidAnalysisSelectedTaskIds),
      historicalAdaptationDifferences: readHistoricalAdaptationDifferences(meta.historical_adaptation_differences_json),
      historicalAdaptationDifferenceConfirmedAt: meta.historical_adaptation_difference_confirmed_at || undefined,
      historicalAdaptationOriginalOutline: safeJsonParse(meta.historical_adaptation_original_outline_json, null),
      historicalAdaptationOutlineChanges: normalizeHistoricalAdaptationOutlineChanges(
        safeJsonParse(meta.historical_adaptation_outline_changes_json, []),
      ),
      historicalAdaptationOutlineConfirmedAt: meta.historical_adaptation_outline_confirmed_at || undefined,
      historicalAdaptationContentItems: normalizeHistoricalAdaptationContentItems(
        readHistoricalContentItems(),
      ),
      historicalAdaptationContentConfirmedAt: meta.historical_adaptation_content_confirmed_at || undefined,
      historicalAdaptationContentCheck: normalizeHistoricalAdaptationContentCheck(
        safeJsonParse(meta.historical_adaptation_content_check_json, null),
      ),
      historicalAdaptationContentFactOverrides: normalizeHistoricalAdaptationContentFactOverrides(
        safeJsonParse(meta.historical_adaptation_content_fact_overrides_json, []),
      ),
      historicalAdaptationReviewFindings: safeJsonParse(meta.historical_adaptation_review_findings_json, []),
      historicalAdaptationReviewConfirmedAt: meta.historical_adaptation_review_confirmed_at || undefined,
      bidSectionMode: normalizeBidSectionMode(meta.bid_section_mode),
      bidSections,
      bidSectionExtractionStatus: bidSectionExtractionTask?.status
        ? normalizeBidSectionExtractionStatus(bidSectionExtractionTask.status)
        : normalizeBidSectionExtractionStatus(meta.bid_section_extraction_status),
      bidSectionExtractionError: bidSectionExtractionTask?.error || meta.bid_section_extraction_error || undefined,
      outlineMode: isValidOutlineMode(meta.outline_mode) ? meta.outline_mode : defaultOutlineModeForWorkflow(meta.workflow_kind),
      outlineExpansionMode: isValidOutlineExpansionMode(meta.outline_expansion_mode) ? meta.outline_expansion_mode : 'ai-complement',
      globalFactsMode: normalizeGlobalFactsMode(meta.global_facts_mode),
      outlineWordControlOptions: normalizeOutlineWordControlOptions(safeJsonParse(meta.outline_word_control_options_json, defaultOutlineWordControlOptions)),
      outlineWordControlSnapshot: meta.outline_word_control_snapshot_json
        ? normalizeOutlineWordControlOptions(safeJsonParse(meta.outline_word_control_snapshot_json, defaultOutlineWordControlOptions))
        : undefined,
      outlineMinimumDepth: normalizeOutlineMinimumDepth(meta.outline_minimum_depth),
      outlineMinimumDepthSnapshot: meta.outline_minimum_depth_snapshot === null || meta.outline_minimum_depth_snapshot === undefined
        ? (outlineData?.outline?.length ? defaultOutlineMinimumDepth : undefined)
        : normalizeOutlineMinimumDepth(meta.outline_minimum_depth_snapshot),
      referenceKnowledgeDocumentIds: loadReferenceDocumentIds(),
      remoteKnowledgeScopes: loadRemoteKnowledgeScopes(),
      ...tasks,
      globalFacts: loadGlobalFacts(),
      contentGenerationOptions: safeJsonParse(meta.content_generation_options_json, undefined),
      contentGenerationRuntime: safeJsonParse(meta.content_generation_runtime_json, undefined),
      contentIllustrationPlan: loadContentIllustrationPlan(),
      bidTemplateExists: fs.existsSync(bidTemplatePath) && fs.existsSync(bidTemplateFieldsPath),
      contentGenerationSections: loadContentSections(outlineData),
      contentGenerationPlans: loadContentPlans(),
      outlineData,
    };
  }

  const updateTechnicalPlanTransaction = db.transaction((partial) => {
    applyPartial(partial || {});
  });

  // 应用技术方案局部更新，但不重新加载完整工作区状态。
  function updateTechnicalPlanWithoutReload(partial) {
    const shouldClearMermaidCache = shouldClearMermaidCacheForPartial(partial);
    generatedContentChangedNodeIds = new Set();
    try {
      updateTechnicalPlanTransaction(partial || {});
    } catch (error) {
      generatedContentChangedNodeIds = null;
      throw error;
    }
    const changedNodeIds = [...generatedContentChangedNodeIds];
    generatedContentChangedNodeIds = null;
    if ((changedNodeIds.length || partial?.invalidateContentGeneration === true || partial?.outlineData === null)
      && typeof onContentChanged === 'function') {
      onContentChanged({ origin: 'generation', nodeIds: changedNodeIds });
    }
    const deletedAgentSessions = hasOwn(partial, 'outlineData') && partial.outlineData === null;
    if (deletedAgentSessions) {
      deleteOutlineAgentTask();
      deleteGlobalFactsAgentTask();
    }
    if (shouldClearMermaidCache) {
      clearTechnicalPlanMermaidCache();
    }
    if (deletedAgentSessions || hasOwn(partial, 'step') || hasOwn(partial, 'outlineData') || hasOwn(partial, 'globalFacts')) {
    }
  }

  function updateTechnicalPlan(partial) {
    updateTechnicalPlanWithoutReload(partial);
  }

  function updateStep(step) {
    return updateTechnicalPlan({ step });
  }

  function setWorkflowKind(workflowKind) {
    return updateTechnicalPlan({ workflowKind: normalizeWorkflowKind(workflowKind) });
  }

  function syncWorkflowKind(workflowKind) {
    updateMeta({ workflow_kind: normalizeWorkflowKind(workflowKind) });
  }

  function switchWorkflowKind(workflowKind) {
    void workflowKind;
    throw new Error('项目类型固定，请返回项目列表创建新项目');
  }

  function saveOutlineConfig({ referenceKnowledgeDocumentIds, remoteKnowledgeScopes, outlineMode, outlineExpansionMode, wordControlOptions, minimumDepth } = {}) {
    const transaction = db.transaction(() => {
      replaceReferenceDocumentIds(referenceKnowledgeDocumentIds);
      replaceRemoteKnowledgeScopes(remoteKnowledgeScopes);
      updateTechnicalPlan({
        outlineMode: isValidOutlineMode(outlineMode) ? outlineMode : defaultOutlineModeForWorkflow(ensureMetaRow().workflow_kind),
        outlineExpansionMode: isValidOutlineExpansionMode(outlineExpansionMode) ? outlineExpansionMode : 'ai-complement',
        outlineWordControlOptions: normalizeOutlineWordControlOptions(wordControlOptions),
        outlineMinimumDepth: normalizeOutlineMinimumDepth(minimumDepth),
      });
    });
    transaction();
  }

  // 保存用户确认后的一级目录待扩展选择，不写入正式目录树。
  function saveOutlineSelection({ taskId, items, selectedIds } = {}) {
    const task = loadTask('outline-generation');
    if (!task || task.task_id !== taskId || task.status !== 'success') {
      throw new Error('一级目录生成结果已变化，请重新打开后再选择');
    }

    updateTechnicalPlan({
      outlineGenerationTask: {
        ...task,
        updated_at: now(),
        stats: {
          ...(task.stats || {}),
          outline_selection: {
            items,
            selected_ids: selectedIds,
            confirmed: true,
          },
        },
      },
    });
  }

  function resetTenderWorkingCopyToOriginal() {
    const originalMarkdown = readOriginalTenderMarkdown().trim();
    if (!originalMarkdown) {
      return;
    }
    writeMarkdownFile(tenderMarkdownPath, originalMarkdown, 'tender');
    updateMeta({
      tender_markdown_path: tenderMarkdownRelativePath,
      tender_markdown_hash: stableHash(originalMarkdown),
      tender_markdown_chars: originalMarkdown.length,
    });
  }

  function saveBidAnalysisConfig({ mode, selectedTaskIds, bidSectionMode } = {}) {
    const config = normalizeBidAnalysisConfig(mode, selectedTaskIds);
    const nextSectionMode = bidSectionMode === undefined ? null : normalizeBidSectionMode(bidSectionMode);
    const meta = ensureMetaRow();
    const shouldChangeSectionMode = nextSectionMode && nextSectionMode !== normalizeBidSectionMode(meta.bid_section_mode);
    if (!shouldChangeSectionMode) {
      updateTechnicalPlan({
        bidAnalysisMode: config.mode,
        bidAnalysisSelectedTaskIds: config.selectedTaskIds,
      });
      return;
    }

    const transaction = db.transaction(() => {
      clearDownstreamFromBidSectionChange();
      if (nextSectionMode === 'single' || nextSectionMode === 'multiple') {
        resetTenderWorkingCopyToOriginal();
      }
      updateMeta({
        bid_analysis_mode: config.mode,
        bid_analysis_selected_task_ids_json: jsonOrNull(config.selectedTaskIds),
        bid_section_mode: nextSectionMode,
        bid_sections_json: null,
        bid_section_extraction_status: 'idle',
        bid_section_extraction_error: null,
        selected_section_id: null,
        selected_section_title: null,
      });
    });
    transaction();
  }

  function saveHistoricalAdaptationDifferences({ differences } = {}) {
    const normalized = normalizeHistoricalAdaptationDifferences(differences);
    const complete = normalized.every((item) => item.decision === 'confirmed' || item.decision === 'ignored');
    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM technical_plan_tasks WHERE type IN ('historical-adaptation-outline', 'historical-adaptation-content', 'content-generation', 'global-facts-generation')").run();
      const meta = readMetaRow();
      const previousDifferences = readHistoricalAdaptationDifferences(meta.historical_adaptation_differences_json);
      const previousById = new Map(previousDifferences.map((item) => [item.id, item]));
      const nextById = new Map(normalized.map((item) => [item.id, item]));
      const signature = (item) => JSON.stringify({
        category: item.category,
        title: item.title,
        historical_excerpt: item.historical_excerpt,
        tender_requirement: item.tender_requirement,
        action: item.action,
        content_change_scope: item.content_change_scope,
        replacements: item.replacements,
        target_action: item.target_action,
        evidence_kind: item.evidence_kind,
        confidence: item.confidence,
        old_content_evidence: item.old_content_evidence,
        decision: item.decision,
      });
      const changedDifferenceIds = new Set([...previousById.keys(), ...nextById.keys()].filter((id) => {
        const previous = previousById.get(id);
        const next = nextById.get(id);
        return !previous || !next || signature(previous) !== signature(next);
      }));
      const contentItems = normalizeHistoricalAdaptationContentItems(readHistoricalContentItems())
        .map((item) => {
          if (!item.difference_ids.some((id) => changedDifferenceIds.has(id)) || item.content_origin === 'manual') return item;
          return { ...item, status: 'stale', confirmed_at: undefined, updated_at: now() };
        });
      if (changedDifferenceIds.size) {
        updateMeta({
          historical_adaptation_content_items_json: jsonOrNull(contentItems),
          historical_adaptation_content_confirmed_at: null,
          historical_adaptation_content_check_json: jsonOrNull({ status: 'stale', findings: [] }),
          historical_adaptation_review_findings_json: null,
          historical_adaptation_review_confirmed_at: null,
        });
      }
      updateMeta({
        historical_adaptation_differences_json: jsonOrNull(normalized),
        historical_adaptation_difference_confirmed_at: complete ? now() : null,
      });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function resetBidSectionDownstream() {
    const transaction = db.transaction(() => {
      clearDownstreamFromBidSectionChange();
      resetTenderWorkingCopyToOriginal();
      updateMeta({
        bid_section_mode: 'single',
        bid_sections_json: null,
        bid_section_extraction_status: 'idle',
        bid_section_extraction_error: null,
        selected_section_id: null,
        selected_section_title: null,
      });
    });
    transaction();
  }

  function saveOutline(payload) {
    const request = payload?.outlineData ? payload : { outlineData: payload, reason: 'replace' };
    const outlineData = normalizeOutlineHeadingTitles(request?.outlineData);
    const reason = normalizeOutlineSaveReason(request?.reason);
    const idMap = normalizeStringMap(request?.idMap);
    const reverseMap = reverseIdMap(idMap);
    const affectedIds = normalizeStringSet(request?.affectedNodeIds);
    const clearAll = reason === 'replace';
    const invalidatesContentTask = reason !== 'sort';

    let savedOutlineData = outlineData;
    const changedNodeIds = new Set();
    const sourcePathsToClean = new Set();
    const transaction = db.transaction(() => {
      assertOutlineMutationAllowed();
      const previousOutline = loadOutlineData(readMetaRow());
      const previousIllustrationPlan = loadContentIllustrationPlan();
      if (!clearAll && reason !== 'sort') {
        const visit = (items, inherited = false) => {
          for (const item of items || []) {
            const nodeId = String(item.id);
            const affected = inherited || affectedIds.has(nodeId);
            if (affected) affectedIds.add(nodeId);
            visit(item.children, affected);
          }
        };
        visit(previousOutline?.outline);
      }
      const outlineTaskRow = db.prepare("SELECT stats_json FROM technical_plan_tasks WHERE type = 'outline-generation'").get();
      const outlineTaskStats = safeJsonParse(outlineTaskRow?.stats_json, {});
      const nextScoreCoverageMap = updateScoreCoverageForOutlineSave({
        coverageMap: outlineTaskStats?.score_coverage_map,
        suppliedCoverageMap: request?.scoreCoverageMap,
        reason,
        idMap,
        affectedIds,
        previousOutline,
        nextOutline: outlineData,
      });
      const saveScoreCoverageMap = () => {
        if (!outlineTaskRow) return;
        const stats = { ...outlineTaskStats };
        if (nextScoreCoverageMap === undefined) delete stats.score_coverage_map;
        else stats.score_coverage_map = nextScoreCoverageMap;
        db.prepare("UPDATE technical_plan_tasks SET stats_json = ?, updated_at = ? WHERE type = 'outline-generation'")
          .run(JSON.stringify(stats), now());
      };
      if (reason === 'sort') {
        saveSortedOutline(outlineData, idMap);
      } else {
        const snapshot = loadOutlinePersistenceSnapshot();
        const outlineToSave = buildOutlineWithPersistedContent(outlineData, { snapshot, reverseMap, affectedIds, clearAll });
        saveOutlineData(outlineToSave);
        if (!outlineToSave?.outline?.length) {
          updateMeta({ outline_word_control_snapshot_json: null, outline_minimum_depth_snapshot: null });
        }
        const rows = flattenOutlineItems(outlineToSave?.outline || []);
        const nextIds = new Set(rows.map((row) => row.node_id));
        restoreMappedContentRows({ snapshot, idMap, affectedIds, nextIds, clearAll });
        db.prepare("DELETE FROM technical_plan_tasks WHERE type = 'content-generation'").run();
        clearTechnicalPlanMermaidCache();
        updateMeta({ content_generation_runtime_json: null });
      }
      if (clearAll) {
        clearContentIllustrationPlan();
      } else if (previousIllustrationPlan?.items?.length) {
        const { keptItems, droppedItems } = reconcileIllustrationItems({
          items: previousIllustrationPlan.items, previousOutline, nextOutline: outlineData,
          idMap, affectedIds,
        });
        replaceContentIllustrationPlan(keptItems.length
          ? { ...previousIllustrationPlan, items: keptItems } : undefined);
        const updateContent = db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?');
        for (const item of droppedItems) {
          const oldTarget = getIllustrationTargetNodeId(item);
          const newTarget = idMap.get(oldTarget) || oldTarget;
          const row = db.prepare('SELECT content FROM technical_plan_outline_nodes WHERE node_id = ?').get(newTarget);
          if (row?.content) {
            const cleaned = removeIllustrationBlock(row.content, item.item_id);
            if (cleaned !== row.content) {
              updateContent.run(cleaned, now(), newTarget);
              changedNodeIds.add(newTarget);
            }
          }
          for (const source of ['source_path', 'original_source_path', 'redraw_source_path']) {
            if (item.generation?.[source]) sourcePathsToClean.add(item.generation[source]);
          }
        }
      }
      if (clearAll) {
        for (const item of previousIllustrationPlan?.items || []) {
          for (const source of ['source_path', 'original_source_path', 'redraw_source_path']) {
            if (item.generation?.[source]) sourcePathsToClean.add(item.generation[source]);
          }
        }
      }
      saveScoreCoverageMap();
      if (request?.historicalAdaptation === true) {
        db.prepare("DELETE FROM technical_plan_tasks WHERE type = 'historical-adaptation-content'").run();
        const nextNodeTitles = new Map(
          flattenOutlineItems(loadOutlineData(readMetaRow())?.outline || [])
            .map((row) => [String(row.node_id), String(row.title || '')]),
        );
        const remappedChanges = normalizeHistoricalAdaptationOutlineChanges(request?.changes).map((item) => {
          if (item.change_type === 'deleted') return item;
          const targetNodeId = idMap.get(item.target_node_id) || item.target_node_id;
          return {
            ...item,
            target_node_id: targetNodeId,
            target_title: nextNodeTitles.get(targetNodeId) || item.target_title,
          };
        }).filter((item) => item.change_type === 'deleted' || nextNodeTitles.has(item.target_node_id));
        updateMeta({
          historical_adaptation_outline_changes_json: jsonOrNull(remappedChanges),
          historical_adaptation_outline_confirmed_at: null,
          historical_adaptation_content_items_json: null,
          historical_adaptation_content_confirmed_at: null,
          historical_adaptation_content_check_json: null,
          historical_adaptation_review_findings_json: null,
          historical_adaptation_review_confirmed_at: null,
        });
      } else if (reason !== 'sort') {
        clearHistoricalAdaptationReviewState();
      }
      savedOutlineData = loadOutlineData(readMetaRow());
    });
    transaction();
    for (const source of sourcePathsToClean) {
      const filePath = path.resolve(technicalPlanDir, source);
      const root = path.resolve(illustrationsDir);
      if (!filePath.startsWith(`${root}${path.sep}`)) continue;
      const retained = db.prepare(`SELECT 1 FROM technical_plan_illustration_items
        WHERE generation_source_path = ? OR generation_original_source_path = ? OR generation_redraw_source_path = ? LIMIT 1`)
        .get(source, source, source);
      if (!retained) removeWorkspacePathSync(filePath);
    }
    if ((invalidatesContentTask || changedNodeIds.size) && typeof onContentChanged === 'function') {
      onContentChanged({ origin: 'manual', nodeIds: [...changedNodeIds] });
    }
    const outlineGenerationTask = loadTask('outline-generation');
    return {
      outlineData: savedOutlineData,
      historicalAdaptationOutlineChanges: normalizeHistoricalAdaptationOutlineChanges(
        safeJsonParse(readMetaRow().historical_adaptation_outline_changes_json, []),
      ),
      historicalAdaptationOutlineConfirmedAt: readMetaRow().historical_adaptation_outline_confirmed_at || undefined,
      outlineGenerationTask,
      contentGenerationSections: loadContentSections(savedOutlineData),
      contentGenerationPlans: loadContentPlans(),
      contentIllustrationPlan: loadContentIllustrationPlan(),
      contentGenerationTask: loadTask('content-generation'),
      contentGenerationRuntime: safeJsonParse(readMetaRow().content_generation_runtime_json, undefined),
    };
  }

  function saveHistoricalAdaptationOutline(payload = {}) {
    saveOutline({ ...payload, historicalAdaptation: true });
    return loadTechnicalPlan();
  }

  function confirmHistoricalAdaptationOutline() {
    const transaction = db.transaction(() => {
      assertOutlineMutationAllowed();
      const outlineData = loadOutlineData(readMetaRow());
      if (!outlineData?.outline?.length) throw new Error('当前没有可确认的适配目录');
      updateMeta({ historical_adaptation_outline_confirmed_at: now() });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function staleHistoricalAdaptationContentCheck({ preserveFindings = true } = {}) {
    // 输入变化后，旧结果不能用于放行，但要保留给用户逐项定位处理；新一轮检查才替换它。
    db.prepare(`UPDATE historical_adaptation_content_check_batches
      SET status = 'stale', error_code = 'stale-input', error_message = '一致性检查输入已变化', updated_at = ?
      WHERE project_id = ? AND status <> 'stale'`).run(now(), contentCheckBatchProjectId);
    const previousCheck = normalizeHistoricalAdaptationContentCheck(safeJsonParse(readMetaRow().historical_adaptation_content_check_json, null));
    updateMeta({
      historical_adaptation_content_confirmed_at: null,
      historical_adaptation_content_check_json: jsonOrNull({
        ...previousCheck,
        status: 'stale',
        findings: preserveFindings ? previousCheck.findings : [],
      }),
      historical_adaptation_review_findings_json: null,
      historical_adaptation_review_confirmed_at: null,
    });
  }

  const contentCheckBatchProjectId = String(projectId || '');

  function getHistoricalAdaptationContentCheckCache({ phase, cacheKey }) {
    const row = db.prepare(`SELECT result_json FROM historical_adaptation_content_check_cache
      WHERE project_id = ? AND phase = ? AND cache_key = ?`).get(contentCheckBatchProjectId, phase, cacheKey);
    return row ? safeJsonParse(row.result_json, undefined) : undefined;
  }

  function saveHistoricalAdaptationContentCheckCache({ phase, cacheKey, nodeIds, result }) {
    const timestamp = now();
    db.prepare(`INSERT INTO historical_adaptation_content_check_cache
      (project_id, phase, cache_key, node_ids_json, result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, phase, cache_key) DO UPDATE SET
        node_ids_json = excluded.node_ids_json, result_json = excluded.result_json, updated_at = excluded.updated_at`)
      .run(contentCheckBatchProjectId, phase, cacheKey, JSON.stringify(nodeIds), JSON.stringify(result), timestamp, timestamp);
  }

  function clearHistoricalAdaptationContentCheckCache() {
    db.prepare('DELETE FROM historical_adaptation_content_check_cache WHERE project_id = ?').run(contentCheckBatchProjectId);
  }

  function normalizeContentCheckBatchRow(row) {
    if (!row) return undefined;
    const parseJson = (value, fallback) => safeJsonParse(value, fallback);
    const nodeIds = parseJson(row.node_ids_json, []);
    const requestSummary = parseJson(row.request_summary_json, undefined);
    const result = parseJson(row.result_json, undefined);
    return {
      ...row,
      project_id: String(row.project_id || ''),
      check_run_id: String(row.check_run_id || ''),
      batch_id: String(row.batch_id || ''),
      batch_index: Number(row.batch_index || 0),
      node_ids: Array.isArray(nodeIds) ? nodeIds.map((item) => String(item || '')).filter(Boolean) : [],
      content_hash: row.content_hash ? String(row.content_hash) : undefined,
      input_hash: row.input_hash ? String(row.input_hash) : undefined,
      facts_hash: row.facts_hash ? String(row.facts_hash) : undefined,
      protocol_hash: row.protocol_hash ? String(row.protocol_hash) : undefined,
      status: normalizeHistoricalAdaptationContentCheckBatchStatus(row.status),
      error_code: row.error_code ? String(row.error_code) : undefined,
      error_message: row.error_message ? String(row.error_message) : undefined,
      attempt_count: Math.max(0, Number(row.attempt_count || 0)),
      request_summary: requestSummary,
      result,
      // camelCase aliases make Main task call sites less error-prone while the
      // snake_case fields remain the SQLite-facing contract.
      checkRunId: String(row.check_run_id || ''),
      batchId: String(row.batch_id || ''),
      batchIndex: Number(row.batch_index || 0),
      nodeIds: Array.isArray(nodeIds) ? nodeIds.map((item) => String(item || '')).filter(Boolean) : [],
      contentHash: row.content_hash ? String(row.content_hash) : undefined,
      inputHash: row.input_hash ? String(row.input_hash) : undefined,
      factsHash: row.facts_hash ? String(row.facts_hash) : undefined,
      protocolHash: row.protocol_hash ? String(row.protocol_hash) : undefined,
      errorCode: row.error_code ? String(row.error_code) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      attemptCount: Math.max(0, Number(row.attempt_count || 0)),
      requestSummary,
    };
  }

  function normalizeContentCheckBatchInput(raw, index, defaults = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const batchId = String(source.batchId || source.batch_id || `batch-${index + 1}`).trim();
    if (!batchId) throw new Error('一致性检查批次缺少 batch_id');
    const nodeIds = [...new Set((source.nodeIds || source.node_ids || []).map((item) => String(item || '').trim()).filter(Boolean))];
    return {
      project_id: contentCheckBatchProjectId,
      check_run_id: String(source.checkRunId || source.check_run_id || defaults.checkRunId || '').trim(),
      batch_id: batchId,
      batch_index: Number.isFinite(Number(source.batchIndex ?? source.batch_index)) ? Math.max(0, Math.floor(Number(source.batchIndex ?? source.batch_index))) : index,
      node_ids_json: JSON.stringify(nodeIds),
      content_hash: String(source.contentHash || source.content_hash || defaults.contentHash || '').trim() || null,
      input_hash: String(source.inputHash || source.input_hash || defaults.inputHash || '').trim() || null,
      facts_hash: String(source.factsHash || source.facts_hash || defaults.factsHash || '').trim() || null,
      protocol_hash: String(source.protocolHash || source.protocol_hash || defaults.protocolHash || '').trim() || null,
      status: normalizeHistoricalAdaptationContentCheckBatchStatus(source.status, 'pending'),
      error_code: String(source.errorCode || source.error_code || '').trim() || null,
      error_message: String(source.errorMessage || source.error_message || '').trim() || null,
      attempt_count: Math.max(0, Math.floor(Number(source.attemptCount ?? source.attempt_count ?? 0) || 0)),
      request_summary_json: source.requestSummary !== undefined || source.request_summary !== undefined
        ? jsonOrNull(source.requestSummary ?? source.request_summary) : null,
      result_json: source.result !== undefined || source.result_json !== undefined
        ? jsonOrNull(source.result !== undefined ? source.result : safeJsonParse(source.result_json, undefined)) : null,
    };
  }

  function createHistoricalAdaptationContentCheckBatches({ checkRunId, batches, contentHash, inputHash, factsHash, protocolHash, replace = false } = {}) {
    const normalizedRunId = String(checkRunId || '').trim();
    if (!normalizedRunId) throw new Error('一致性检查批次缺少 check_run_id');
    const entries = (Array.isArray(batches) ? batches : []).map((item, index) => normalizeContentCheckBatchInput(item, index, { checkRunId: normalizedRunId, contentHash, inputHash, factsHash, protocolHash }));
    if (!entries.length) return [];
    const timestamp = now();
    const transaction = db.transaction(() => {
      if (replace) db.prepare('DELETE FROM historical_adaptation_content_check_batches WHERE project_id = ? AND check_run_id = ?').run(contentCheckBatchProjectId, normalizedRunId);
      const upsert = db.prepare(`
        INSERT INTO historical_adaptation_content_check_batches
          (project_id, check_run_id, batch_id, batch_index, node_ids_json, content_hash, input_hash, facts_hash, protocol_hash,
           status, error_code, error_message, attempt_count, request_summary_json, result_json, created_at, updated_at)
        VALUES (@project_id, @check_run_id, @batch_id, @batch_index, @node_ids_json, @content_hash, @input_hash, @facts_hash, @protocol_hash,
           @status, @error_code, @error_message, @attempt_count, @request_summary_json, @result_json, @created_at, @updated_at)
        ON CONFLICT(project_id, check_run_id, batch_id) DO UPDATE SET
          batch_index = excluded.batch_index, node_ids_json = excluded.node_ids_json,
          content_hash = excluded.content_hash,
          input_hash = excluded.input_hash, facts_hash = excluded.facts_hash, protocol_hash = excluded.protocol_hash,
          status = excluded.status, error_code = excluded.error_code, error_message = excluded.error_message,
          attempt_count = excluded.attempt_count, request_summary_json = excluded.request_summary_json,
          result_json = excluded.result_json, updated_at = excluded.updated_at
      `);
      for (const entry of entries) {
        const existing = db.prepare(`SELECT status FROM historical_adaptation_content_check_batches
          WHERE project_id = ? AND check_run_id = ? AND batch_id = ?`)
          .get(contentCheckBatchProjectId, normalizedRunId, entry.batch_id);
        // Re-planning a run must preserve a successful cache entry. Callers that
        // intentionally restart a run use replace=true, which deletes rows first.
        if (!replace && existing?.status === 'success') continue;
        upsert.run({ ...entry, created_at: existing?.created_at || timestamp, updated_at: timestamp });
      }
    });
    transaction();
    return entries.map((entry) => normalizeContentCheckBatchRow(db.prepare(`SELECT * FROM historical_adaptation_content_check_batches WHERE project_id = ? AND check_run_id = ? AND batch_id = ?`).get(contentCheckBatchProjectId, normalizedRunId, entry.batch_id)));
  }

  function upsertHistoricalAdaptationContentCheckRun({ checkRunId, contentHash, inputHash, factsHash, protocolHash, expectedBatchCount, expectedNodeIds, status = 'running' } = {}) {
    const normalizedRunId = String(checkRunId || '').trim();
    if (!normalizedRunId) throw new Error('一致性检查运行缺少 check_run_id');
    const timestamp = now();
    db.prepare(`
      INSERT INTO historical_adaptation_content_check_runs
        (project_id, check_run_id, content_hash, input_hash, facts_hash, protocol_hash, expected_batch_count, expected_node_ids_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, check_run_id) DO UPDATE SET
        content_hash = excluded.content_hash, input_hash = excluded.input_hash, facts_hash = excluded.facts_hash,
        protocol_hash = excluded.protocol_hash, expected_batch_count = excluded.expected_batch_count,
        expected_node_ids_json = excluded.expected_node_ids_json, status = excluded.status, updated_at = excluded.updated_at
    `).run(contentCheckBatchProjectId, normalizedRunId, String(contentHash || '').trim() || null, String(inputHash || '').trim() || null,
      String(factsHash || '').trim() || null, String(protocolHash || '').trim() || null,
      Math.max(0, Math.floor(Number(expectedBatchCount) || 0)), JSON.stringify([...new Set((expectedNodeIds || []).map((item) => String(item || '').trim()).filter(Boolean))]),
      String(status || 'running'), timestamp, timestamp);
    return getHistoricalAdaptationContentCheckRun({ checkRunId: normalizedRunId });
  }

  function getHistoricalAdaptationContentCheckRun({ checkRunId } = {}) {
    const row = db.prepare('SELECT * FROM historical_adaptation_content_check_runs WHERE project_id = ? AND check_run_id = ?')
      .get(contentCheckBatchProjectId, String(checkRunId || '').trim());
    if (!row) return undefined;
    return { ...row, expected_node_ids: safeJsonParse(row.expected_node_ids_json, []) };
  }

  function listHistoricalAdaptationContentCheckBatches({ checkRunId, statuses } = {}) {
    const params = [contentCheckBatchProjectId];
    let sql = 'SELECT * FROM historical_adaptation_content_check_batches WHERE project_id = ?';
    if (String(checkRunId || '').trim()) { sql += ' AND check_run_id = ?'; params.push(String(checkRunId).trim()); }
    const normalizedStatuses = (Array.isArray(statuses) ? statuses : statuses ? [statuses] : [])
      .map((status) => normalizeHistoricalAdaptationContentCheckBatchStatus(status, '')).filter(Boolean);
    if (normalizedStatuses.length) {
      sql += ` AND status IN (${normalizedStatuses.map(() => '?').join(',')})`;
      params.push(...normalizedStatuses);
    }
    sql += ' ORDER BY check_run_id ASC, batch_index ASC, batch_id ASC';
    return db.prepare(sql).all(...params).map(normalizeContentCheckBatchRow);
  }

  function getHistoricalAdaptationContentCheckBatch({ checkRunId, batchId } = {}) {
    const row = db.prepare(`SELECT * FROM historical_adaptation_content_check_batches WHERE project_id = ? AND check_run_id = ? AND batch_id = ?`)
      .get(contentCheckBatchProjectId, String(checkRunId || '').trim(), String(batchId || '').trim());
    return normalizeContentCheckBatchRow(row);
  }

  function updateHistoricalAdaptationContentCheckBatch({ checkRunId, batchId, ...patch } = {}) {
    const current = getHistoricalAdaptationContentCheckBatch({ checkRunId, batchId });
    if (!current) throw new Error('未找到一致性检查批次');
    const merged = normalizeContentCheckBatchInput({ ...current, ...patch, checkRunId, batchId }, current.batch_index);
    const timestamp = now();
    db.prepare(`UPDATE historical_adaptation_content_check_batches SET batch_index = ?, node_ids_json = ?, content_hash = ?, input_hash = ?, facts_hash = ?, protocol_hash = ?, status = ?, error_code = ?, error_message = ?, attempt_count = ?, request_summary_json = ?, result_json = ?, updated_at = ? WHERE project_id = ? AND check_run_id = ? AND batch_id = ?`)
      .run(merged.batch_index, merged.node_ids_json, merged.content_hash, merged.input_hash, merged.facts_hash, merged.protocol_hash, merged.status, merged.error_code, merged.error_message, merged.attempt_count, merged.request_summary_json, merged.result_json, timestamp, contentCheckBatchProjectId, String(checkRunId || '').trim(), String(batchId || '').trim());
    return getHistoricalAdaptationContentCheckBatch({ checkRunId, batchId });
  }

  function saveHistoricalAdaptationContentCheckBatchResult({ checkRunId, batchId, status = 'success', result, errorCode, errorMessage, requestSummary, attemptCount, contentHash, inputHash, factsHash, protocolHash, snapshot } = {}) {
    const normalizedRunId = String(checkRunId || '').trim();
    const normalizedBatchId = String(batchId || '').trim();
    const nextStatus = normalizeHistoricalAdaptationContentCheckBatchStatus(status, 'success');
    const transaction = db.transaction(() => {
      const current = db.prepare('SELECT * FROM historical_adaptation_content_check_batches WHERE project_id = ? AND check_run_id = ? AND batch_id = ?')
        .get(contentCheckBatchProjectId, normalizedRunId, normalizedBatchId);
      if (!current) throw new Error('未找到一致性检查批次');
      db.prepare(`UPDATE historical_adaptation_content_check_batches SET content_hash = COALESCE(?, content_hash), input_hash = COALESCE(?, input_hash), facts_hash = COALESCE(?, facts_hash), protocol_hash = COALESCE(?, protocol_hash), status = ?, error_code = ?, error_message = ?, attempt_count = ?, request_summary_json = ?, result_json = ?, updated_at = ? WHERE project_id = ? AND check_run_id = ? AND batch_id = ?`)
        .run(String(contentHash || '').trim() || null, String(inputHash || '').trim() || null, String(factsHash || '').trim() || null, String(protocolHash || '').trim() || null,
          nextStatus, String(errorCode || '').trim() || null, String(errorMessage || '').trim() || null,
          attemptCount === undefined ? Number(current.attempt_count || 0) + 1 : Math.max(0, Math.floor(Number(attemptCount) || 0)),
          requestSummary === undefined ? current.request_summary_json : jsonOrNull(requestSummary), result === undefined ? current.result_json : jsonOrNull(result), now(),
          contentCheckBatchProjectId, normalizedRunId, normalizedBatchId);
      if (snapshot !== undefined) {
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.historicalAdaptationContentCheck) throw new Error('snapshot payload invalid');
        if (snapshot.historicalAdaptationContentCheck.status === 'success') {
          const unfinished = db.prepare(`SELECT COUNT(*) AS count FROM historical_adaptation_content_check_batches
            WHERE project_id = ? AND check_run_id = ? AND status <> 'success'`).get(contentCheckBatchProjectId, normalizedRunId);
          if (Number(unfinished?.count || 0) > 0) throw new Error('batch snapshot incomplete');
        }
        updateMeta({ historical_adaptation_content_check_json: jsonOrNull(snapshot.historicalAdaptationContentCheck) });
      }
    });
    transaction();
    return getHistoricalAdaptationContentCheckBatch({ checkRunId: normalizedRunId, batchId: normalizedBatchId });
  }

  function getReusableHistoricalAdaptationContentCheckBatches({ checkRunId, contentHash, inputHash, factsHash, protocolHash } = {}) {
    if (!String(checkRunId || '').trim() || !String(inputHash || '').trim()
      || !String(contentHash || '').trim() || !String(factsHash || '').trim() || !String(protocolHash || '').trim()) return [];
    const rows = listHistoricalAdaptationContentCheckBatches({ checkRunId, statuses: ['success'] });
    return rows.filter((row) => (!inputHash || row.input_hash === String(inputHash))
      && (!contentHash || row.content_hash === String(contentHash))
      && (!factsHash || row.facts_hash === String(factsHash))
      && (!protocolHash || row.protocol_hash === String(protocolHash)));
  }

  function invalidateHistoricalAdaptationContentCheckBatches({ checkRunId, inputHash, factsHash, protocolHash, reason } = {}) {
    const normalizedRunId = String(checkRunId || '').trim();
    const rows = listHistoricalAdaptationContentCheckBatches({ checkRunId: normalizedRunId || undefined });
    const stale = rows.filter((row) => {
      if (normalizedRunId && row.check_run_id !== normalizedRunId) return false;
      const hasMismatch = (inputHash !== undefined && inputHash !== null && row.input_hash !== String(inputHash))
        || (factsHash !== undefined && factsHash !== null && row.facts_hash !== String(factsHash))
        || (protocolHash !== undefined && protocolHash !== null && row.protocol_hash !== String(protocolHash));
      return inputHash === undefined && factsHash === undefined && protocolHash === undefined ? true : hasMismatch;
    });
    if (!stale.length) return [];
    const timestamp = now();
    const update = db.prepare(`UPDATE historical_adaptation_content_check_batches SET status = 'stale', error_code = 'stale-input', error_message = ?, updated_at = ? WHERE project_id = ? AND check_run_id = ? AND batch_id = ?`);
    const transaction = db.transaction(() => stale.forEach((row) => update.run(String(reason || '一致性检查输入已变化'), timestamp, contentCheckBatchProjectId, row.check_run_id, row.batch_id)));
    transaction();
    return stale.map((row) => getHistoricalAdaptationContentCheckBatch({ checkRunId: row.check_run_id, batchId: row.batch_id }));
  }

  function recoverHistoricalAdaptationContentCheckBatches({ checkRunId } = {}) {
    const rows = listHistoricalAdaptationContentCheckBatches({ checkRunId, statuses: ['pending', 'running'] });
    const timestamp = now();
    const transaction = db.transaction(() => db.prepare(`UPDATE historical_adaptation_content_check_batches SET status = 'failed-retryable', error_code = 'interrupted', error_message = '一致性检查任务中断，可重试当前批次', updated_at = ? WHERE project_id = ? AND status IN ('pending', 'running')${String(checkRunId || '').trim() ? ' AND check_run_id = ?' : ''}`)
      .run(...([timestamp, contentCheckBatchProjectId, ...(String(checkRunId || '').trim() ? [String(checkRunId).trim()] : [])])));
    if (rows.length) transaction();
    return listHistoricalAdaptationContentCheckBatches({ checkRunId });
  }

  function prepareHistoricalAdaptationContentPlan() {
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const state = loadTechnicalPlan();
      const originalPlan = readOriginalPlanMarkdown();
      assertContentPrerequisites(state, originalPlan);
      const index = getHistoricalAdaptationSourceIndex(originalPlan);
      const planId = require('node:crypto').randomUUID();
      const beforeContext = getHistoricalAdaptationContentCheckContext();
      const items = buildHistoricalContentItems({ state, originalPlan, sourceIndex: index }).map(({ source_content: _sourceContent, ...item }) => ({ ...item, plan_id: item.plan_id || planId }));
      const distribution = require('./historicalAdaptationRuleEngine.cjs').summarizeRuleDistribution(
        require('./historicalAdaptationRuleEngine.cjs').buildHistoricalAdaptationRules(state.historicalAdaptationDifferences), items);
      if (distribution.blocked) throw new Error('低置信规则覆盖范围异常，请返回差异确认修正规则后重新建立方案');
      updateMeta({ historical_adaptation_content_items_json: jsonOrNull(items) });
      if (getHistoricalAdaptationContentCheckContext().inputsHash !== beforeContext.inputsHash) staleHistoricalAdaptationContentCheck();
    });
    transaction();
    return loadTechnicalPlan();
  }

  function getHistoricalAdaptationContentCheckContext() {
    const meta = readMetaRow();
    const outlineData = loadOutlineData(meta);
    const leaves = collectLeafItems(outlineData?.outline || []);
    const items = normalizeHistoricalAdaptationContentItems(readHistoricalContentItems());
    const byId = new Map(items.map((item) => [item.node_id, item]));
    const contentSnapshot = leaves.map((item) => ({ node_id: String(item.id || ''), content: String(item.content || '') }));
    // 全局事实由 Main 侧 SQLite 保存，是一致性检查的确认输入；不得只依赖 Renderer 快照。
    const globalFacts = loadGlobalFacts();
    const factOverrides = normalizeHistoricalAdaptationContentFactOverrides(
      safeJsonParse(meta.historical_adaptation_content_fact_overrides_json, []),
    );
    const inputSnapshot = {
      outline: leaves.map((item) => ({ node_id: String(item.id || ''), title: String(item.title || '') })),
      differences: readHistoricalAdaptationDifferences(meta.historical_adaptation_differences_json),
      strategies: leaves.map((item) => {
        const plan = byId.get(String(item.id || ''));
        return { node_id: String(item.id || ''), reuse_original: plan?.reuse_original, recommended_mode: plan?.recommended_mode, manual_mode: plan?.manual_mode, manual_instruction: plan?.manual_instruction };
      }),
      baseline: loadBidItems(),
      global_facts: globalFacts,
      manual_fact_overrides: canonicalHistoricalAdaptationContentFactOverrides(factOverrides),
      // 正文一致性检查协议参与输入指纹。自动修复协议升级后，旧缓存必须失效。
      rule_engine_version: HISTORICAL_ADAPTATION_RULE_ENGINE_VERSION,
      semantic_check_version: 2,
      fact_schema_version: HISTORICAL_ADAPTATION_FACT_SCHEMA_VERSION,
      repair_protocol_version: HISTORICAL_ADAPTATION_REPAIR_PROTOCOL_VERSION,
      plans: items.map((item) => ({ node_id: item.node_id, input_fingerprint: item.input_fingerprint,
        source_version_hash: item.source_version_hash, source_content_hash: item.source_content_hash,
        rule_engine_version: item.rule_engine_version, content_plan_version: item.content_plan_version })),
    };
    const originalPlan = readOriginalPlanMarkdown();
    const sourceAvailability = items.map((item) => {
      const { available, error, content } = getHistoricalAdaptationSourceSection({ nodeId: item.node_id });
      return { node_id: item.node_id, available, error, content };
    });
    const expectedItems = originalPlan ? buildHistoricalContentItems({
      state: { outlineData, historicalAdaptationContentItems: items, historicalAdaptationDifferences: inputSnapshot.differences,
        historicalAdaptationOutlineChanges: normalizeHistoricalAdaptationOutlineChanges(safeJsonParse(meta.historical_adaptation_outline_changes_json, [])),
        bidAnalysisTasks: inputSnapshot.baseline },
      originalPlan, sourceIndex: getHistoricalAdaptationSourceIndex(originalPlan, { persist: false }),
    }) : [];
    const contentHash = stableHash(JSON.stringify(contentSnapshot));
    const inputsHash = stableHash(JSON.stringify(inputSnapshot));
    const protocolHash = historicalAdaptationProtocolHash(inputsHash);
    return {
      contentHash,
      inputsHash,
      protocolHash,
      factsHash: normalizeHistoricalAdaptationContentCheck(safeJsonParse(meta.historical_adaptation_content_check_json, null)).checked_facts_hash,
      outlineData,
      items,
      expectedItems,
      sourceAvailability,
      baseline: inputSnapshot.baseline,
      globalFacts,
      factOverrides,
      globalFactsHash: stableHash(JSON.stringify(globalFacts)),
      differences: inputSnapshot.differences,
      check: normalizeHistoricalAdaptationContentCheck(safeJsonParse(meta.historical_adaptation_content_check_json, null)),
    };
  }

  function getHistoricalAdaptationContentFacts() {
    const context = getHistoricalAdaptationContentCheckContext();
    const base = {
      contentHash: context.contentHash,
      inputsHash: context.inputsHash,
      protocolHash: context.protocolHash,
      factsHash: context.factsHash || undefined,
      checkStatus: context.check.status,
      checkError: context.check.error,
      facts: [],
      overrides: context.factOverrides,
    };
    const runs = db.prepare('SELECT * FROM historical_adaptation_content_check_runs WHERE project_id = ? ORDER BY created_at DESC').all(contentCheckBatchProjectId);
    const expectedNodes = new Set(context.items.map((item) => String(item.node_id || '')).filter(Boolean));
    const run = runs.find((candidate) => candidate.status === 'success'
      && candidate.content_hash === context.contentHash
      && candidate.input_hash === context.inputsHash
      && candidate.facts_hash === context.factsHash
      && candidate.protocol_hash === context.protocolHash
      && Number(candidate.expected_batch_count || 0) > 0
      && (() => {
        const candidateNodes = new Set(safeJsonParse(candidate.expected_node_ids_json, []).map((nodeId) => String(nodeId || '').trim()).filter(Boolean));
        return candidateNodes.size === expectedNodes.size && [...candidateNodes].every((nodeId) => expectedNodes.has(nodeId));
      })());
    if (!run) return { ...base, ok: false, code: 'unavailable', message: context.check.stage === 'precheck'
      ? '一致性检查停在预检阶段，尚未提取全文事实。请处理阻断项后重新运行检查。'
      : '当前正文还没有可匹配的全文事实快照。请重新运行一致性检查。' };
    const batches = listHistoricalAdaptationContentCheckBatches({ checkRunId: run.check_run_id });
    const expectedCount = Number(run.expected_batch_count || 0);
    const batchNodeIds = new Set(batches.flatMap((batch) => batch.node_ids.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)));
    const batchFactsHash = batches[0]?.facts_hash;
    const complete = batches.length === expectedCount
      && batches.every((batch, index) => batch.status === 'success'
        && batch.batch_index === index
        && batch.content_hash === context.contentHash
        && batch.input_hash === context.inputsHash
        && batchFactsHash && batch.facts_hash === batchFactsHash
        && batch.protocol_hash === context.protocolHash)
      && batchNodeIds.size === expectedNodes.size
      && [...batchNodeIds].every((nodeId) => expectedNodes.has(nodeId));
    if (!complete) return { ...base, ok: false, code: 'stale', message: '全文事实快照不完整或已过期，请重新运行一致性检查。', checkRunId: run.check_run_id };
    const factsByKey = new Map();
    for (const batch of batches) {
      const facts = Array.isArray(batch.result?.facts) ? batch.result.facts : [];
      for (const raw of facts) {
        const key = String(raw?.fact_key || raw?.fact_id || `${raw?.kind || ''}:${raw?.canonical_value || raw?.value || ''}`).trim();
        if (!key) continue;
        const current = factsByKey.get(key) || {
          fact_key: String(raw.fact_key || raw.fact_id || key),
          fact_id: raw.fact_id,
          kind: String(raw.kind || '').trim(),
          canonical_value: String(raw.canonical_value || raw.value || '').trim(),
          normalized_value: raw.normalized_value,
          normalized_values: [],
          conflict: raw.conflict === true,
          chapter_node_ids: [],
          evidence: [],
          values: [],
        };
        const rawChapterNodeIds = Array.isArray(raw.chapter_node_ids) && raw.chapter_node_ids.length
          ? raw.chapter_node_ids : batch.node_ids;
        const rawNormalizedValues = (Array.isArray(raw.normalized_values) ? raw.normalized_values : [raw.normalized_value])
          .map((value) => String(value || '').trim()).filter(Boolean);
        const canonicalValue = String(raw.canonical_value || raw.value || '').trim();
        const canonicalConflict = Boolean(canonicalValue && current.canonical_value && canonicalValue !== current.canonical_value);
        current.chapter_node_ids = [...new Set([...current.chapter_node_ids, ...rawChapterNodeIds]
          .map((nodeId) => String(nodeId || '').trim()).filter(Boolean))];
        current.evidence = [...new Set([...current.evidence, ...(Array.isArray(raw.evidence) ? raw.evidence : raw.evidence ? [String(raw.evidence)] : [])])];
        current.normalized_values = [...new Set([...current.normalized_values, ...rawNormalizedValues])];
        current.values = [...new Set([
          ...current.values,
          canonicalValue,
          ...(Array.isArray(raw.values) ? raw.values : []),
          ...(rawNormalizedValues.length > 1 ? rawNormalizedValues : []),
        ].map((value) => String(value || '').trim()).filter(Boolean))];
        current.conflict = current.conflict || raw.conflict === true || canonicalConflict || current.normalized_values.length > 1;
        factsByKey.set(key, current);
      }
    }
    const facts = [...factsByKey.values()].map((fact) => {
      const override = context.factOverrides.find((item) => item.fact_key === fact.fact_key);
      return override ? { ...fact, canonical_value: override.canonical_value, manually_overridden: true, conflict: false } : fact;
    });
    for (const override of context.factOverrides) {
      if (factsByKey.has(override.fact_key)) continue;
      facts.push({ fact_key: override.fact_key, kind: override.kind, canonical_value: override.canonical_value,
        manually_overridden: true, conflict: false, chapter_node_ids: [], evidence: [override.note || '人工补录事实'] });
    }
    return { ...base, ok: true, checkRunId: run.check_run_id, facts };
  }

  function saveHistoricalAdaptationContentFactOverrides({ expectedContentHash, expectedInputsHash, expectedProtocolHash, overrides, deleteFactKeys } = {}) {
    const transaction = db.transaction(() => {
      const current = getHistoricalAdaptationContentCheckContext();
      if (current.contentHash !== String(expectedContentHash || '')
        || current.inputsHash !== String(expectedInputsHash || '')
        || current.protocolHash !== String(expectedProtocolHash || '')) {
        const error = new Error('一致性检查输入已变化，请重新读取全文事实后再保存');
        error.code = 'conflict';
        throw error;
      }
      const currentByKey = new Map(current.factOverrides.map((item) => [item.fact_key, item]));
      const explicitDeletes = new Set((Array.isArray(deleteFactKeys) ? deleteFactKeys : [])
        .map((item) => String(item || '').trim()).filter(Boolean));
      for (const item of Array.isArray(overrides) ? overrides : []) {
        const factKey = String(item?.fact_key || '').trim();
        if (!factKey) continue;
        const value = String(item?.canonical_value ?? item?.value ?? '').trim();
        if (!value) explicitDeletes.add(factKey);
        else currentByKey.set(factKey, item);
      }
      for (const factKey of explicitDeletes) currentByKey.delete(factKey);
      const normalized = normalizeHistoricalAdaptationContentFactOverrides([...currentByKey.values()]);
      updateMeta({ historical_adaptation_content_fact_overrides_json: JSON.stringify(normalized) });
      staleHistoricalAdaptationContentCheck();
      return getHistoricalAdaptationContentCheckContext();
    });
    const next = transaction();
    return {
      ok: true,
      contentHash: next.contentHash,
      inputsHash: next.inputsHash,
      protocolHash: next.protocolHash,
      overrides: next.factOverrides,
      technicalPlanPatch: { historicalAdaptationContentCheck: next.check },
    };
  }

  function saveHistoricalAdaptationContentStrategy({ nodeId, mode, instruction } = {}) {
    const targetNodeId = String(nodeId || '').trim();
    const targetMode = String(mode || '').trim();
    if (!['direct', 'local-rewrite', 'rewrite'].includes(targetMode)) throw new Error('请选择有效的正文迁移方式');
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const current = readHistoricalContentItem(targetNodeId);
      if (!current) throw new Error('当前章节尚未建立正文迁移方案');
      if (['direct', 'local-rewrite'].includes(targetMode) && (!current.source_path || !(current.source_content_hash || current.source_excerpt))) throw new Error('当前章节没有可靠历史正文，请选择定向改写并填写补充要求');
      const manualInstruction = targetMode === 'rewrite' ? String(instruction || '').trim() : '';
      if (targetMode === 'rewrite' && !manualInstruction) throw new Error('请填写定向改写要求');
      const timestamp = now();
      writeHistoricalContentItem({
        ...current,
        manual_mode: targetMode,
        manual_instruction: manualInstruction,
        status: current.status === 'idle' ? 'idle' : 'stale',
        error: undefined,
        error_code: undefined,
        updated_at: timestamp,
      });
      staleHistoricalAdaptationContentCheck();
    });
    transaction();
    return loadTechnicalPlan();
  }

  function resetHistoricalAdaptationContentStrategies() {
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const state = loadTechnicalPlan();
      const originalPlan = readOriginalPlanMarkdown();
      assertContentPrerequisites(state, originalPlan);
      const previousById = new Map(state.historicalAdaptationContentItems.map((item) => [item.node_id, item]));
      const timestamp = now();
      const nextItems = buildHistoricalContentItems({ state, originalPlan, sourceIndex: getHistoricalAdaptationSourceIndex(originalPlan) }).map(({ source_content: _sourceContent, ...item }) => {
        const previous = previousById.get(item.node_id);
        return {
          ...item,
          manual_mode: undefined,
          manual_instruction: '',
          status: previous?.content_origin === 'manual' ? previous.status
            : !item.recommended_mode || item.recommended_mode === 'rewrite' ? 'review'
              : previous && previous.status !== 'idle' ? 'stale' : 'idle',
          content_origin: previous?.content_origin,
          residuals: previous?.residuals || [],
          error: previous?.content_origin === 'manual' ? previous.error : undefined,
          updated_at: timestamp,
        };
      });
      updateMeta({ historical_adaptation_content_items_json: jsonOrNull(nextItems) });
      staleHistoricalAdaptationContentCheck();
    });
    transaction();
    return loadTechnicalPlan();
  }

  function saveHistoricalAdaptationChapterContent({ nodeId, content } = {}) {
    const targetNodeId = String(nodeId || '').trim();
    const nextContent = String(content || '');
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const node = db.prepare('SELECT node_id FROM technical_plan_outline_nodes WHERE node_id = ?').get(targetNodeId);
      if (!node) throw new Error('当前目录中未找到该章节');
      const item = readHistoricalContentItem(targetNodeId);
      if (!item) throw new Error('当前章节尚未建立正文迁移记录');
      const timestamp = now();
      const residuals = scanHistoricalResiduals(nextContent, item);
      const nextItem = {
        ...item,
        status: nextContent.trim() && !residuals.length ? 'success' : 'review',
        content_origin: 'manual',
        residuals,
        confirmed_at: undefined,
        updated_at: timestamp,
        error: undefined,
      };
      db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?').run(nextContent, timestamp, targetNodeId);
      db.prepare(`
        INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
        VALUES (?, ?, NULL, ?)
        ON CONFLICT(node_id) DO UPDATE SET status = excluded.status, error = NULL, updated_at = excluded.updated_at
      `).run(targetNodeId, nextContent.trim() ? 'success' : 'idle', timestamp);
      writeHistoricalContentItem(nextItem);
      staleHistoricalAdaptationContentCheck();
      clearContentIllustrationPlan();
    });
    transaction();
    if (typeof onContentChanged === 'function') onContentChanged({ origin: 'historical-adaptation', nodeIds: [targetNodeId] });
    return loadTechnicalPlan();
  }

  function applyHistoricalAdaptationConsistencyRepairs({
    expectedContentHash,
    expectedInputsHash,
    expectedFactsHash,
    repairs,
    repairMode,
  } = {}) {
    const requestedContentHash = String(expectedContentHash || '');
    const requestedInputsHash = String(expectedInputsHash || '');
    const requestedFactsHash = String(expectedFactsHash || '');
    if (!requestedContentHash || !requestedInputsHash || !requestedFactsHash || !Array.isArray(repairs) || !repairs.length) {
      throw new Error('repair request schema invalid');
    }

    const changedNodeIds = [];
    const transaction = db.transaction(() => {
      const meta = readMetaRow();
      const outlineData = loadOutlineData(meta);
      const leaves = collectLeafItems(outlineData?.outline || []);
      const contentSnapshot = leaves.map((item) => ({
        node_id: String(item.id || ''),
        content: String(item.content || ''),
      }));
      const currentContentHash = stableHash(JSON.stringify(contentSnapshot));
      if (currentContentHash !== requestedContentHash) throw new Error('content hash mismatch');

      const context = getHistoricalAdaptationContentCheckContext();
      if (context.inputsHash !== requestedInputsHash) throw new Error('input hash mismatch');
      const currentCheck = normalizeHistoricalAdaptationContentCheck(
        safeJsonParse(meta.historical_adaptation_content_check_json, null),
      );
      const expectedProtocolInputsHash = historicalAdaptationProtocolHash(requestedInputsHash);
      if (currentCheck.checked_content_hash !== requestedContentHash) throw new Error('check content hash mismatch');
      if (currentCheck.checked_inputs_hash !== requestedInputsHash) throw new Error('check input hash mismatch');
      if (currentCheck.checked_protocol_inputs_hash !== expectedProtocolInputsHash) throw new Error('check protocol inputs hash mismatch');
      if (currentCheck.rule_engine_version !== HISTORICAL_ADAPTATION_RULE_ENGINE_VERSION) throw new Error('check rule engine version mismatch');
      if (currentCheck.fact_schema_version !== HISTORICAL_ADAPTATION_FACT_SCHEMA_VERSION) throw new Error('check fact schema version mismatch');
      if (currentCheck.repair_protocol_version !== HISTORICAL_ADAPTATION_REPAIR_PROTOCOL_VERSION) throw new Error('check repair protocol version mismatch');
      // 事实表只在一致性检查任务的持久快照中存在。将该快照哈希作为事务 CAS，
      // 防止模型提取事实后正文或检查状态被其他写入替换。
      if (currentCheck.checked_facts_hash !== requestedFactsHash) throw new Error('facts hash mismatch');

      const leafById = new Map(leaves.map((item) => [String(item.id || ''), item]));
      const itemById = new Map(normalizeHistoricalAdaptationContentItems(readHistoricalContentItems())
        .map((item) => [String(item.node_id), item]));
      const editsByNode = new Map();
      const nextContents = new Map();
      const nextItems = new Map();

      for (const group of repairs) {
        if (!group || typeof group !== 'object' || !String(group.group_id || '').trim()
          || !String(group.fact_id || '').trim() || group.confidence !== 'high'
          || !String(group.rationale || '').trim() || !Array.isArray(group.chapters) || !group.chapters.length) {
          throw new Error('repair group schema invalid');
        }
        if (group.expected_content_hash !== requestedContentHash) throw new Error('content hash mismatch');
        if (group.expected_inputs_hash !== requestedInputsHash) throw new Error('input hash mismatch');
        if (group.expected_facts_hash !== requestedFactsHash) throw new Error('facts hash mismatch');
        const newValues = new Set();
        for (const edit of group.chapters) {
          const nodeId = String(edit?.node_id || '').trim();
          if (!nodeId) throw new Error('invalid node');
          const leaf = leafById.get(nodeId);
          if (!leaf) throw new Error('invalid node');
          const item = itemById.get(nodeId);
          if (!item) throw new Error('historical content item not found');
          if (item.content_origin === 'manual') throw new Error('manual source cannot be auto repaired');
          const currentContent = String(leaf.content || '');
          const expectedItemFingerprint = item.item_fingerprint || item.input_fingerprint
            || stableHash(JSON.stringify({ node_id: nodeId, content: currentContent }));
          if (String(edit.expected_item_fingerprint || '') !== expectedItemFingerprint) throw new Error('item fingerprint mismatch');
          if (String(edit.expected_node_content_hash || '') !== stableHash(currentContent)) throw new Error('node content hash mismatch');
          const oldText = String(edit.old_text || '');
          const newText = String(edit.new_text || '');
          if (!oldText || !newText) throw new Error('empty edit');
          if (oldText === newText) throw new Error('no-op edit');
          if (oldText === currentContent) throw new Error('whole-chapter replacement');
          const first = currentContent.indexOf(oldText);
          if (first < 0) throw new Error('old text not found');
          if (currentContent.indexOf(oldText, first + oldText.length) >= 0) throw new Error('old text ambiguous');
          const fenceCountBefore = (currentContent.slice(0, first).match(/```/g) || []).length;
          const fenceCountThrough = (currentContent.slice(0, first + oldText.length).match(/```/g) || []).length;
          if (fenceCountBefore % 2 === 1 || fenceCountThrough % 2 === 1
            || /```/.test(oldText) || /```/.test(newText)) throw new Error('markdown protected range');
          const nodeEdits = editsByNode.get(nodeId) || [];
          if (nodeEdits.some((candidate) => first < candidate.end && first + oldText.length > candidate.start)) {
            throw new Error('overlapping edit range');
          }
          if (repairMode !== 'semantic' && newValues.size && !newValues.has(newText)) throw new Error('fact coverage value mismatch');
          newValues.add(newText);
          nodeEdits.push({ start: first, end: first + oldText.length, oldText, newText, item, originalContent: currentContent });
          editsByNode.set(nodeId, nodeEdits);
        }
      }
      for (const [nodeId, edits] of editsByNode) {
        let content = edits[0].originalContent;
        for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
          content = `${content.slice(0, edit.start)}${edit.newText}${content.slice(edit.end)}`;
        }
        nextContents.set(nodeId, content);
        nextItems.set(nodeId, { item: edits[0].item, content });
      }
      if (!nextContents.size) throw new Error('no repair chapters');

      const timestamp = now();
      const updateNode = db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?');
      const updateSection = db.prepare('UPDATE technical_plan_content_sections SET status = ?, error = NULL, updated_at = ? WHERE node_id = ?');
      for (const [nodeId, content] of nextContents) {
        updateNode.run(content, timestamp, nodeId);
        updateSection.run('success', timestamp, nodeId);
        const { item } = nextItems.get(nodeId);
        const effectiveMode = getEffectiveMode(item);
        writeHistoricalContentItem({
          ...item,
          status: 'success',
          content_origin: 'ai-repair',
          migration_output_hash: stableHash(JSON.stringify([
            item.source_hash, item.input_fingerprint, effectiveMode, item.manual_instruction, content,
          ])),
          residuals: [],
          confirmed_at: undefined,
          error: undefined,
          error_code: undefined,
          updated_at: timestamp,
        });
        changedNodeIds.push(nodeId);
      }
      updateMeta({
        historical_adaptation_content_confirmed_at: null,
        historical_adaptation_review_findings_json: null,
        historical_adaptation_review_confirmed_at: null,
        historical_adaptation_content_check_json: null,
      });
      clearContentIllustrationPlan();
    });
    transaction();
    if (typeof onContentChanged === 'function') onContentChanged({ origin: 'ai-repair', nodeIds: changedNodeIds });
    return { appliedCount: changedNodeIds.length, nodeIds: changedNodeIds };
  }

  function confirmHistoricalAdaptationContentItem({ nodeId } = {}) {
    const targetNodeId = String(nodeId || '').trim();
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const node = db.prepare('SELECT content FROM technical_plan_outline_nodes WHERE node_id = ?').get(targetNodeId);
      if (!node) throw new Error('当前目录中未找到该章节');
      const item = readHistoricalContentItem(targetNodeId);
      if (!item) throw new Error('当前章节尚未建立正文迁移记录');
      // 人工确认只记录“接受当前结果”的决定，不改写正文，也不阻断空正文、历史残留或占位符。
      // 保留已有 residuals，并把当前正文扫描到的证据合并进去，便于导出后人工追溯处理。
      const residuals = [...new Set([...(item.residuals || []), ...scanHistoricalResiduals(node.content, item)])];
      const timestamp = now();
      writeHistoricalContentItem({
        ...item,
        status: 'success',
        residuals,
        confirmed_at: timestamp,
        updated_at: timestamp,
        error: undefined,
      });
      updateMeta({ historical_adaptation_content_confirmed_at: null });
      staleHistoricalAdaptationContentCheck({ preserveFindings: true });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function confirmHistoricalAdaptationContent() {
    const transaction = db.transaction(() => {
      const activeMigration = db.prepare("SELECT 1 FROM technical_plan_tasks WHERE type = 'historical-adaptation-content' AND status IN ('queued', 'running', 'pausing', 'paused') LIMIT 1").get();
      if (activeMigration) throw new Error('正文迁移任务正在运行、排队或已暂停，请先完成任务再确认正文迁移');
      const readiness = getHistoricalAdaptationContentReadiness();
      if (!readiness.ready) throw new Error(`仍有 ${readiness.blockingCount} 个正文问题需要处理`);
      updateMeta({ historical_adaptation_content_confirmed_at: now() });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function getHistoricalAdaptationContentReadiness() {
    const context = getHistoricalAdaptationContentCheckContext();
    const leaves = collectLeafItems(context.outlineData?.outline || []);
    const manuallyConfirmedNodeIds = new Set(context.items.filter((item) => item?.confirmed_at).map((item) => item.node_id));
    const findings = [];
    findings.push(...require('./historicalAdaptationContentCheckTask.cjs').collectDeterministicFindings(context).map((finding) => {
      // Legacy records created before migration plans had stable identifiers. They
      // can be accepted as-is in stage five; stage six remains the place to review
      // any consistency risk introduced by that legacy state.
      if (finding.code === 'plan-stale') {
        const item = context.items.find((candidate) => candidate?.node_id && finding.node_ids?.includes(candidate.node_id));
        if (item?.content_origin === 'migrated' && !item.plan_id) return { ...finding, blocking: false };
      }
      return finding;
    }));
    // 结构状态复用任务预检；历史字面候选由下方最新语义快照裁决，不重复阻断。
    const activeTask = db.prepare("SELECT type FROM technical_plan_tasks WHERE type IN ('historical-adaptation-content', 'historical-adaptation-content-check') AND status IN ('queued', 'running', 'pausing', 'paused') LIMIT 1").get();
    if (activeTask) findings.push({ id: 'active-task', code: 'active-task', category: 'task', severity: 'P0', blocking: activeTask.type === 'historical-adaptation-content', node_ids: [], message: activeTask.type === 'historical-adaptation-content' ? '正文迁移任务仍在运行' : '一致性检查任务仍在运行', evidence: activeTask.type });
    const check = normalizeHistoricalAdaptationContentCheck(safeJsonParse(readMetaRow().historical_adaptation_content_check_json, null));
    const checkCurrent = check.status === 'success'
      && check.checked_content_hash === context.contentHash
      && check.checked_inputs_hash === context.inputsHash
      && check.checked_facts_hash
      && check.checked_protocol_inputs_hash === historicalAdaptationProtocolHash(context.inputsHash)
      && check.rule_engine_version === HISTORICAL_ADAPTATION_RULE_ENGINE_VERSION
      && check.fact_schema_version === HISTORICAL_ADAPTATION_FACT_SCHEMA_VERSION
      && check.repair_protocol_version === HISTORICAL_ADAPTATION_REPAIR_PROTOCOL_VERSION;
    if (!checkCurrent) findings.push({ id: 'check-stale', code: 'check-stale', category: 'task', severity: 'P0', blocking: false, node_ids: [], message: '一致性检查尚未完成或结果已过期', evidence: check.error || check.status });
    if (checkCurrent) findings.push(...check.findings.filter((finding) => {
      if (!finding?.blocking) return false;
      const nodeIds = Array.isArray(finding.node_ids) ? finding.node_ids.filter(Boolean) : [];
      // 旧检查快照可能是在章节确认前生成的；只要 finding 关联的所有章节都已人工确认，
      // 就不再阻断阶段确认。没有章节归属的全局问题仍然保留。
      return !(nodeIds.length && nodeIds.every((nodeId) => manuallyConfirmedNodeIds.has(nodeId)));
    }).map((finding) => ({ ...finding, blocking: false })));
    const blocking = findings.filter((finding) => finding.blocking);
    const checkFindings = checkCurrent ? check.findings : [];
    const checkBlockingCount = checkFindings.filter((finding) => finding.blocking).length;
    const leafOrder = new Map(leaves.map((leaf, index) => [String(leaf.id || ''), index]));
    const firstNodeId = blocking.flatMap((finding) => finding.node_ids || [])
      .filter((nodeId) => leafOrder.has(nodeId))
      .sort((left, right) => leafOrder.get(left) - leafOrder.get(right))[0];
    return { ready: blocking.length === 0, blockingCount: blocking.length, firstNodeId, findings,
      planInputsHash: context.inputsHash, contentHash: context.contentHash, checkSnapshotValid: checkCurrent,
      checkBlockingCount, checkRisk: activeTask?.type === 'historical-adaptation-content-check'
        || !checkCurrent || checkBlockingCount > 0 || checkFindings.some((finding) => !finding.blocking) };
  }

  function assertHistoricalAdaptationContentAccepted() {
    const meta = readMetaRow();
    if (!meta.historical_adaptation_content_confirmed_at) throw new Error('请先完成并确认环节五正文迁移');
  }

  function runHistoricalAdaptationReview() {
    const transaction = db.transaction(() => {
      assertHistoricalAdaptationContentAccepted();
      const meta = readMetaRow();
      const findings = reviewHistoricalAdaptationContent({
        outline: loadOutlineData(meta)?.outline || [],
        contentItems: readHistoricalContentItems(),
        differences: readHistoricalAdaptationDifferences(meta.historical_adaptation_differences_json),
        // 一致性检查是环节六的可选诊断，不参与终审硬门禁；终审只保留
        // 正文结构、迁移记录和已确认删除内容等确定性规则。
        semanticCheckPassed: true,
      }, safeJsonParse(meta.historical_adaptation_review_findings_json, []));
      updateMeta({
        historical_adaptation_review_findings_json: JSON.stringify(findings),
        historical_adaptation_review_confirmed_at: null,
      });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function setHistoricalAdaptationReviewFinding({ findingId, resolution, resolutionNote } = {}) {
    if (!['resolved', 'ignored'].includes(resolution)) throw new Error('请选择有效的问题处置状态');
    const note = String(resolutionNote || '').trim();
    if (!note) throw new Error('请填写问题处置说明');
    const transaction = db.transaction(() => {
      const meta = readMetaRow();
      if (!meta.historical_adaptation_review_findings_json) throw new Error('请先运行终审');
      const findings = safeJsonParse(meta.historical_adaptation_review_findings_json, []);
      if (!findings.some((finding) => finding.id === findingId)) throw new Error('该问题已变化，请重新运行终审');
      if (findings.find((finding) => finding.id === findingId).severity === 'P0') throw new Error('P0 阻断问题必须整改正文或修改差异规则，不能通过备注豁免');
      const timestamp = now();
      updateMeta({
        historical_adaptation_review_findings_json: JSON.stringify(findings.map((finding) => finding.id === findingId ? {
          ...finding,
          resolution,
          resolution_note: note,
          resolved_at: timestamp,
        } : finding)),
        historical_adaptation_review_confirmed_at: null,
      });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function assertHistoricalAdaptationReviewHasNoOpenP0(meta = readMetaRow()) {
    if (!meta.historical_adaptation_review_findings_json) throw new Error('请先运行终审');
    const findings = safeJsonParse(meta.historical_adaptation_review_findings_json, []);
    const blockingCount = findings.filter((finding) => finding.severity === 'P0').length;
    if (blockingCount) throw new Error(`仍有 ${blockingCount} 个 P0 阻断问题未处置`);
    return findings;
  }

  function confirmHistoricalAdaptationReview() {
    const transaction = db.transaction(() => {
      assertHistoricalAdaptationContentAccepted();
      const meta = readMetaRow();
      assertHistoricalAdaptationReviewHasNoOpenP0(meta);
      updateMeta({ historical_adaptation_review_confirmed_at: now() });
    });
    transaction();
    return loadTechnicalPlan();
  }

  function assertHistoricalAdaptationExportAllowed() {
    assertHistoricalAdaptationContentAccepted();
    const meta = readMetaRow();
    if (meta.historical_adaptation_review_findings_json) assertHistoricalAdaptationReviewHasNoOpenP0(meta);
    return true;
  }

  function saveOutlineNodeKnowledge({ nodeId, knowledgeFolderIds, knowledgeDocumentIds } = {}) {
    const targetNodeId = String(nodeId || '').trim();
    const normalizedFolderIds = normalizeStringList(knowledgeFolderIds);
    const normalizedDocumentIds = normalizeStringList(knowledgeDocumentIds);
    let result;
    const transaction = db.transaction(() => {
      assertOutlineNodeKnowledgeMutationAllowed();
      const affectedNodeIds = collectOutlineNodeAndDescendantIds(targetNodeId);
      if (!affectedNodeIds.length) {
        throw new Error('未找到要关联知识库的目录项');
      }
      db.prepare('UPDATE technical_plan_outline_nodes SET knowledge_folder_ids_json = ?, knowledge_document_ids_json = ?, updated_at = ? WHERE node_id = ?')
        .run(
          normalizedFolderIds.length ? JSON.stringify(normalizedFolderIds) : null,
          normalizedDocumentIds.length ? JSON.stringify(normalizedDocumentIds) : null,
          now(),
          targetNodeId,
        );
      clearContentGenerationStateForNodes(affectedNodeIds);
      const outlineData = loadOutlineData(readMetaRow());
      result = {
        outlineData,
        contentGenerationSections: loadContentSections(outlineData),
        contentGenerationPlans: loadContentPlans(),
        contentGenerationTask: undefined,
        contentGenerationRuntime: undefined,
        contentIllustrationPlan: undefined,
      };
    });
    transaction();
    if (typeof onContentChanged === 'function') onContentChanged({ origin: 'manual' });
    return result;
  }

  function saveGlobalFactsConfig({ globalFactsMode } = {}) {
    const normalized = normalizeGlobalFactsMode(globalFactsMode);
    updateTechnicalPlan({ globalFactsMode: normalized });
    return { globalFactsMode: normalized };
  }

  function saveGlobalFacts(globalFacts) {
    const normalizedGlobalFacts = normalizeGlobalFactGroups(globalFacts);
    let savedTask;
    const transaction = db.transaction(() => {
      replaceGlobalFacts(normalizedGlobalFacts);
      db.prepare(`UPDATE historical_adaptation_content_check_batches
        SET status = 'stale', error_code = 'stale-input', error_message = '全局事实已变化', updated_at = ?
        WHERE project_id = ? AND status <> 'stale'`).run(now(), contentCheckBatchProjectId);
      clearContentGenerationState();
      const timestamp = now();
      savedTask = {
        task_id: `manual-global-facts-${Date.now()}`,
        type: 'global-facts-generation',
        status: 'success',
        progress: 100,
        logs: ['全局事实已保存。'],
        started_at: timestamp,
        updated_at: timestamp,
      };
      saveTask('global-facts-generation', savedTask);
    });
    transaction();
    if (typeof onContentChanged === 'function') onContentChanged({ origin: 'manual' });
    return {
      globalFacts: normalizedGlobalFacts,
      globalFactsTask: savedTask,
      contentGenerationTask: undefined,
      contentGenerationSections: {},
      contentGenerationPlans: {},
      contentIllustrationPlan: undefined,
      contentGenerationRuntime: undefined,
    };
  }

  function saveContentGenerationOptions(contentGenerationOptions) {
    updateTechnicalPlan({ contentGenerationOptions, contentIllustrationPlan: undefined });
    return { contentGenerationOptions, contentIllustrationPlan: undefined };
  }

  function saveChapterContent({ nodeId, content, reason = 'manual' }) {
    let changed = false;
    const transaction = db.transaction(() => {
      assertContentEditingAllowed();
      const timestamp = now();
      const node = db.prepare('SELECT node_id, title, content FROM technical_plan_outline_nodes WHERE node_id = ?').get(nodeId);
      if (!node) throw new Error('当前目录中未找到该章节');
      const nextContent = String(content || '');
      changed = String(node.content || '') !== nextContent;
      db.prepare('UPDATE technical_plan_outline_nodes SET content = ?, updated_at = ? WHERE node_id = ?').run(nextContent, timestamp, nodeId);
      db.prepare(`
        INSERT INTO technical_plan_content_sections (node_id, status, error, updated_at)
        VALUES (?, ?, NULL, ?)
        ON CONFLICT(node_id) DO UPDATE SET status = excluded.status, error = NULL, updated_at = excluded.updated_at
      `).run(nodeId, nextContent.trim() ? 'success' : 'idle', timestamp);
      if (reason !== 'variant-deduplication') {
        clearContentIllustrationPlan();
      }
      if (changed) clearHistoricalAdaptationReviewState();
    });
    transaction();
    if (changed && typeof onContentChanged === 'function') onContentChanged({ origin: reason, nodeIds: [String(nodeId)] });
    return { contentIllustrationPlan: undefined };
  }

  function exportVariantSeed() {
    const meta = readMetaRow();
    const state = loadTechnicalPlan();
    if (!state.tenderFile) throw new Error('第一份标书缺少有效招标文件');
    const tenderFiles = loadTenderSourceFiles(meta).map((file) => {
      const sourceDocxPath = String(file.sourceDocxPath || '').trim();
      const resolvedDocxPath = sourceDocxPath ? resolveMarkdownPath(sourceDocxPath) : '';
      return {
        ...file,
        markdown: readTenderSourceMarkdown(file.id),
        sourceDocxPath: resolvedDocxPath && fs.existsSync(resolvedDocxPath) ? resolvedDocxPath : undefined,
      };
    });
    return {
      tenderFile: { ...state.tenderFile },
      tenderFiles,
      workingMarkdown: readTenderMarkdown(),
      originalMarkdown: readOriginalTenderMarkdown(),
      bidAnalysisMode: state.bidAnalysisMode,
      bidAnalysisSelectedTaskIds: [...state.bidAnalysisSelectedTaskIds],
      bidAnalysisTasks: Object.fromEntries(Object.entries(state.bidAnalysisTasks || {})
        .filter(([, task]) => task?.status === 'success')
        .map(([id, task]) => [id, { ...task }])),
      bidSectionMode: state.bidSectionMode,
      bidSections: state.bidSections,
      bidSectionExtractionStatus: state.bidSectionExtractionStatus,
      selectedSectionId: state.tenderFile.selectedSectionId,
      selectedSectionTitle: state.tenderFile.selectedSectionTitle,
      selectedSectionHeadLine: meta.selected_section_head_line || undefined,
      outlineMinimumDepth: state.outlineMinimumDepth,
    };
  }

  function importVariantSeed(seed) {
    const workingMarkdown = String(seed?.workingMarkdown || '').trim();
    const originalMarkdown = String(seed?.originalMarkdown || '').trim();
    if (!workingMarkdown || !originalMarkdown) throw new Error('第一份标书的招标文件种子不完整');
    const timestamp = now();
    fs.mkdirSync(technicalPlanDir, { recursive: true });
    removeWorkspacePathSync(tenderSourceFilesDir);
    removeWorkspacePathSync(tenderOriginalsDir);
    writeMarkdownFile(tenderMarkdownPath, workingMarkdown, 'variant-tender');
    writeMarkdownFile(tenderOriginalMarkdownPath, originalMarkdown, 'variant-tender-original');

    const tenderFiles = (Array.isArray(seed?.tenderFiles) ? seed.tenderFiles : []).map((file, index) => {
      const id = String(file?.id || createTenderSourceId(file?.fileName, file?.markdown, index));
      const fileName = String(file?.fileName || '招标文件');
      const markdown = String(file?.markdown || '').trim();
      const markdownPath = path.join(tenderSourceFilesDirRelativePath, `${id}-${safeFileNamePart(fileName)}.md`).replace(/\\/g, '/');
      writeMarkdownFile(resolveMarkdownPath(markdownPath), markdown, id);
      let sourceDocxPath;
      const sourceDocx = String(file?.sourceDocxPath || '').trim();
      if (sourceDocx && fs.existsSync(sourceDocx)) {
        sourceDocxPath = path.join(tenderOriginalsDirRelativePath, `${id}.docx`).replace(/\\/g, '/');
        const targetPath = resolveMarkdownPath(sourceDocxPath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourceDocx, targetPath);
      }
      return {
        id,
        fileName,
        markdownPath,
        markdownChars: markdown.length,
        contentHash: file?.contentHash || stableHash(markdown),
        parserLabel: file?.parserLabel,
        sourceDocxPath,
        importedAt: file?.importedAt || timestamp,
        updatedAt: timestamp,
      };
    });

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM technical_plan_tasks').run();
      db.prepare('DELETE FROM technical_plan_bid_items').run();
      db.prepare('DELETE FROM technical_plan_reference_docs').run();
      db.prepare('DELETE FROM technical_plan_remote_knowledge_documents').run();
      db.prepare('DELETE FROM technical_plan_remote_knowledge_scopes').run();
      db.prepare('DELETE FROM technical_plan_outline_nodes').run();
      db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
      db.prepare('DELETE FROM technical_plan_content_sections').run();
      db.prepare('DELETE FROM technical_plan_content_plans').run();
      clearContentIllustrationPlan();
      updateMeta({
        workflow_kind: 'technical-plan',
        step: 'outline-generation',
        tender_file_name: seed?.tenderFile?.fileName || tenderFiles[0]?.fileName || '招标文件',
        tender_markdown_path: tenderMarkdownRelativePath,
        tender_markdown_hash: stableHash(workingMarkdown),
        tender_markdown_chars: workingMarkdown.length,
        tender_parser_label: seed?.tenderFile?.parserLabel || null,
        tender_imported_at: seed?.tenderFile?.importedAt || timestamp,
        tender_files_json: JSON.stringify(tenderFiles),
        tender_original_markdown_path: tenderOriginalMarkdownRelativePath,
        tender_original_markdown_hash: stableHash(originalMarkdown),
        tender_original_markdown_chars: originalMarkdown.length,
        bid_analysis_mode: isValidBidMode(seed?.bidAnalysisMode) ? seed.bidAnalysisMode : 'key',
        bid_analysis_selected_task_ids_json: jsonOrNull(normalizeBidAnalysisTaskIds(seed?.bidAnalysisSelectedTaskIds)),
        bid_section_mode: normalizeBidSectionMode(seed?.bidSectionMode),
        bid_sections_json: jsonOrNull(normalizeBidSections(seed?.bidSections)),
        bid_section_extraction_status: seed?.bidSectionExtractionStatus === 'success' ? 'success' : 'idle',
        bid_section_extraction_error: null,
        selected_section_id: seed?.selectedSectionId || null,
        selected_section_title: seed?.selectedSectionTitle || null,
        selected_section_head_line: seed?.selectedSectionHeadLine || null,
        outline_word_control_options_json: JSON.stringify(variantOutlineWordControlOptions),
        outline_word_control_snapshot_json: null,
        outline_minimum_depth: normalizeOutlineMinimumDepth(seed?.outlineMinimumDepth),
        outline_minimum_depth_snapshot: null,
        outline_project_name: null,
        outline_project_overview: null,
        content_generation_options_json: JSON.stringify(variantContentGenerationOptions),
        content_generation_runtime_json: null,
      });
      saveBidItems(seed?.bidAnalysisTasks || {}, seed?.bidAnalysisMode);
    });
    transaction();
    return loadTechnicalPlan();
  }

  async function runBeforeCommit(beforeCommit) {
    if (typeof beforeCommit === 'function') {
      await beforeCommit();
    }
  }

  async function importTenderDocument(filePaths, options = {}) {
    if (!fileService?.importDocument) {
      throw new Error('文件导入服务尚未初始化');
    }

    const result = await fileService.importDocument({ multiple: true, filePaths });
    if (!result?.success || !result.file_content) {
      return {
        success: false,
        message: result?.message || '未导入文件',
        markdown: '',
      };
    }

    const importedDocuments = Array.isArray(result.documents) && result.documents.length ? result.documents : [result];
    const existingSourceDocuments = loadTenderSourceFiles().map((file) => {
      const markdown = String(readTenderSourceMarkdown(file.id) || '').trim();
      return markdown ? {
        file_content: markdown,
        file_name: file.fileName,
        parser_label: file.parserLabel,
        content_hash: file.contentHash || stableHash(markdown),
        source_docx_path: file.sourceDocxPath,
      } : null;
    }).filter(Boolean);
    const existingKeys = new Set(existingSourceDocuments.map((item) => `${item.file_name}\u0000${item.content_hash}`));
    const existingOriginalPaths = new Set(existingSourceDocuments
      .map((item) => String(item.source_docx_path || '').trim())
      .filter(Boolean)
      .map((item) => filePathKey(resolveMarkdownPath(item))));
    const addedDocuments = [];
    let skippedCount = 0;
    importedDocuments.forEach((item) => {
      const markdown = String(item.file_content || '').trim();
      if (!markdown) return;
      const fileName = item.file_name || '未命名文件';
      const key = `${fileName}\u0000${stableHash(markdown)}`;
      const sourcePath = String(item.source_path || '').trim();
      if (existingKeys.has(key) || (sourcePath && existingOriginalPaths.has(filePathKey(sourcePath)))) {
        skippedCount += 1;
        return;
      }
      existingKeys.add(key);
      addedDocuments.push(item);
    });

    if (!addedDocuments.length) {
      const messageParts = [];
      if (skippedCount > 0) messageParts.push(`已跳过 ${skippedCount} 份重复文件`);
      appendImportFailureParts(messageParts, result.errors);
      return {
        success: false,
        message: messageParts.join('，') || result.message || '未导入文件',
        markdown: '',
      };
    }

    await runBeforeCommit(options.beforeCommit);
    clearBidTemplate();
    cleanupPendingTenderSelection();

    const mergedDocuments = [...existingSourceDocuments, ...addedDocuments];
    pruneTenderOriginals([
      ...existingSourceDocuments.map((item) => item.source_docx_path),
      ...addedDocuments.map((item) => item.source_path),
    ].filter(Boolean), 'import-preflight');
    for (let index = 0; index < mergedDocuments.length; index += 1) {
      const item = mergedDocuments[index];
      const sourcePath = String(item.source_path || '').trim();
      if (!sourcePath || item.source_docx_path || !fileService?.persistTenderSourceDocx) continue;
      const sourceId = createTenderSourceId(item.file_name || '未命名文件', String(item.file_content || '').trim(), index);
      const relativePath = path.join(tenderOriginalsDirRelativePath, `${sourceId}.docx`).replace(/\\/g, '/');
      const destPath = resolveMarkdownPath(relativePath);
      const managedRelativePath = getManagedTenderOriginalRelativePath(sourcePath);
      if (managedRelativePath) {
        item.source_docx_path = managedRelativePath;
        tenderOriginalLogger.write('tender-original.persist.reused', { phase: 'import', source_path: sourcePath });
        continue;
      }
      tenderOriginalLogger.write('tender-original.persist.started', { phase: 'import', source_path: sourcePath, dest_path: destPath });
      try {
        const persisted = filePathKey(sourcePath) === filePathKey(destPath)
          ? true
          : await fileService.persistTenderSourceDocx(sourcePath, destPath);
        if (persisted) item.source_docx_path = relativePath;
        tenderOriginalLogger.write('tender-original.persist.completed', { phase: 'import', source_path: sourcePath, dest_path: destPath, persisted: Boolean(persisted) });
      } catch (error) {
        tenderOriginalLogger.write('tender-original.persist.failed', {
          phase: 'import',
          source_path: sourcePath,
          dest_path: destPath,
          code: error?.code,
          syscall: error?.syscall,
          error: compactLogError(error),
        });
        throw new Error(`${item.file_name || '招标文件'}：无法保存 Word 原件，${error.message || error}`);
      }
    }
    const markdown = combineTenderMarkdown(mergedDocuments.map((item) => item.file_content));
    const fileName = mergedDocuments.length > 1 ? `${mergedDocuments.length} 份招标文件` : mergedDocuments[0].file_name || '未命名文件';
    const parserLabel = mergedDocuments.length > 1 ? null : mergedDocuments[0].parser_label || null;
    const messageParts = [`已解析 ${addedDocuments.length} 份招标文件`];
    if (result.fallbackToLocal === true || mergedDocuments.some((item) => item.fallback_to_local)) {
      messageParts.push('当前格式已自动使用本地解析');
    }
    if (skippedCount > 0) messageParts.push(`跳过 ${skippedCount} 份重复文件`);
    appendImportFailureParts(messageParts, result.errors);

    return saveTenderMarkdownAndState(markdown, {
      fileName,
      parserLabel,
      message: messageParts.join('，'),
      fallbackToLocal: result.fallbackToLocal === true,
      resetOriginal: true,
      sourceFiles: mergedDocuments,
    });
  }

  async function removeTenderDocument(sourceId, options = {}) {
    const targetId = String(sourceId || '');
    const existingFiles = loadTenderSourceFiles();
    const remainingFiles = existingFiles.filter((file) => file.id !== targetId);
    if (!targetId || remainingFiles.length === existingFiles.length) {
      return { success: false, message: '未找到要删除的招标文件', markdown: '' };
    }

    await runBeforeCommit(options.beforeCommit);
    clearBidTemplate();
    if (!remainingFiles.length) {
      clearTenderSourceFiles('remove-last-tender');
      removeWorkspacePathSync(tenderMarkdownPath);
      removeWorkspacePathSync(tenderOriginalMarkdownPath);
      const transaction = db.transaction(() => {
        clearDownstreamFromTender();
        updateMeta({
          tender_file_name: null,
          tender_markdown_path: null,
          tender_markdown_hash: null,
          tender_markdown_chars: 0,
          tender_original_markdown_path: null,
          tender_original_markdown_hash: null,
          tender_original_markdown_chars: 0,
          tender_parser_label: null,
          tender_imported_at: null,
          tender_files_json: null,
          selected_section_id: null,
          selected_section_title: null,
        });
      });
      transaction();
      return { success: true, message: '已移除招标文件', markdown: '' };
    }

    const sourceFiles = remainingFiles.map((file) => ({
      file_content: String(readTenderSourceMarkdown(file.id) || '').trim(),
      file_name: file.fileName,
      parser_label: file.parserLabel,
      source_docx_path: file.sourceDocxPath,
    })).filter((item) => item.file_content);
    const markdown = combineTenderMarkdown(sourceFiles.map((item) => item.file_content));
    const fileName = sourceFiles.length > 1 ? `${sourceFiles.length} 份招标文件` : sourceFiles[0]?.file_name || '未命名文件';
    const parserLabel = sourceFiles.length > 1 ? null : sourceFiles[0]?.parser_label || null;
    return saveTenderMarkdownAndState(markdown, {
      fileName,
      parserLabel,
      message: '已移除招标文件',
      resetOriginal: true,
      sourceFiles,
    });
  }

  async function importOriginalPlanDocument(filePaths, options = {}) {
    const importer = fileService?.importTechnicalPlanDocument || fileService?.importDocument;
    if (!importer) {
      throw new Error('文件导入服务尚未初始化');
    }

    const result = fileService.importTechnicalPlanDocument
      ? await fileService.importTechnicalPlanDocument('原方案', { filePaths })
      : await importer({ filePaths });
    if (!result?.success || !result.file_content) {
      return {
        success: false,
        message: result?.message || '未导入文件',
        markdown: '',
      };
    }

    const markdown = String(result.file_content || '').trim();
    const fileName = result.file_name || '未命名文件';
    const parserLabel = result.parser_label || null;
    await runBeforeCommit(options.beforeCommit);
    const targetDir = path.dirname(originalPlanMarkdownPath);
    const tempPath = path.join(targetDir, `original-plan-${Date.now()}.tmp.md`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(tempPath, `${markdown}\n`, 'utf-8');

    try {
      fs.renameSync(tempPath, originalPlanMarkdownPath);
      const timestamp = now();
      const transaction = db.transaction(() => {
        updateMeta({
          workflow_kind: 'existing-plan-expansion',
          original_plan_file_name: fileName,
          original_plan_markdown_path: originalPlanMarkdownRelativePath,
          original_plan_markdown_hash: stableHash(markdown),
          original_plan_markdown_chars: markdown.length,
          original_plan_parser_label: parserLabel || null,
          original_plan_imported_at: timestamp,
        });
        clearDownstreamFromOriginalPlan();
      });
      transaction();
      return {
        success: true,
        message: result.message || '原方案已导入',
        markdown,
      };
    } catch (error) {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  function saveTenderMarkdownAndState(markdown, { fileName, parserLabel, message, selectedSection, fallbackToLocal, resetOriginal, sourceFiles }) {
    const nextMarkdown = String(markdown || '').trim();
    if (Array.isArray(sourceFiles)) {
      clearBidTemplate();
      if (fs.existsSync(tenderSourceFilesDir)) {
        removeWorkspacePathSync(tenderSourceFilesDir);
      }
    }
    const tenderSourceFiles = Array.isArray(sourceFiles)
      ? sourceFiles.map(writeTenderSourceMarkdown)
      : undefined;
    if (tenderSourceFiles) {
      pruneTenderOriginals(tenderSourceFiles.map((file) => file.sourceDocxPath).filter(Boolean));
    }
    writeMarkdownFile(tenderMarkdownPath, nextMarkdown, 'tender');
    if (resetOriginal) {
      writeMarkdownFile(tenderOriginalMarkdownPath, nextMarkdown, 'tender-original');
    }

    const timestamp = now();
    const transaction = db.transaction(() => {
      clearDownstreamFromTender();
      updateMeta({
        tender_file_name: fileName || '未命名文件',
        tender_markdown_path: tenderMarkdownRelativePath,
        tender_markdown_hash: stableHash(nextMarkdown),
        tender_markdown_chars: nextMarkdown.length,
        tender_original_markdown_path: resetOriginal ? tenderOriginalMarkdownRelativePath : undefined,
        tender_original_markdown_hash: resetOriginal ? stableHash(nextMarkdown) : undefined,
        tender_original_markdown_chars: resetOriginal ? nextMarkdown.length : undefined,
        tender_parser_label: parserLabel || null,
        tender_imported_at: timestamp,
        tender_files_json: tenderSourceFiles ? JSON.stringify(tenderSourceFiles) : undefined,
        selected_section_id: selectedSection?.id || null,
        selected_section_title: selectedSection?.title || null,
      });
    });
    transaction();
    return {
      success: true,
      message: message || (fallbackToLocal ? '文件解析完成，当前格式已自动使用本地解析' : '招标文件已导入'),
      markdown: nextMarkdown,
      // 本地正则标段检测结论（零 Token），供 STEP 01 导入后立即提示疑似多标段
      bidSectionDetection: detectBidSections(nextMarkdown),
    };
  }

  function selectBidSection(selectedSection) {
    const selected = selectedSection || {};
    const meta = ensureMetaRow();
    const aiSections = normalizeBidSections(safeJsonParse(meta.bid_sections_json, []));

    if (aiSections.length >= 2) {
      const matched = aiSections.find((section) => section.id === selected.id) || selected;
      const originalMarkdown = readOriginalTenderMarkdown().trim();
      if (!originalMarkdown) {
        throw new Error('原始招标文件内容为空，请重新上传');
      }
      const workingMarkdown = buildSelectedSectionMarkdown(originalMarkdown, aiSections, matched.id);
      clearBidTemplate();
      writeMarkdownFile(tenderMarkdownPath, workingMarkdown, 'tender');
      const transaction = db.transaction(() => {
        clearDownstreamFromBidSectionChange();
        updateMeta({
          tender_markdown_path: tenderMarkdownRelativePath,
          tender_markdown_hash: stableHash(workingMarkdown),
          tender_markdown_chars: workingMarkdown.length,
          bid_section_mode: 'multiple',
          selected_section_id: matched.id || null,
          selected_section_title: matched.title || null,
        });
      });
      transaction();
      return {
        success: true,
        message: `已选择【${matched.title || '投标范围'}】，招标文件解析将仅使用当前投标范围`,
        markdown: workingMarkdown,
      };
    }

    throw new Error('请先完成多标段识别，再选择投标范围');
  }

  function clearTechnicalPlan() {
    const workflowKind = normalizeWorkflowKind(ensureMetaRow().workflow_kind);
    clearTenderSourceFiles();
    cleanupPendingTenderSelection();
    removeWorkspacePathSync(tenderMarkdownPath);
    removeWorkspacePathSync(tenderOriginalMarkdownPath);
    removeWorkspacePathSync(originalPlanMarkdownPath);
    clearOriginalOutlineRuntime();
    clearTechnicalPlanMermaidCache();
    clearIllustrationFiles();
    deleteImportedImageBatches(app, 'technical-plan');
    deleteOutlineAgentTask();
    deleteGlobalFactsAgentTask();
    const transaction = db.transaction(() => {
      clearHistoricalAdaptationContentCheckCache();
      db.prepare('DELETE FROM technical_plan_tasks').run();
      db.prepare('DELETE FROM technical_plan_bid_items').run();
      db.prepare('DELETE FROM technical_plan_reference_docs').run();
      db.prepare('DELETE FROM technical_plan_remote_knowledge_documents').run();
      db.prepare('DELETE FROM technical_plan_remote_knowledge_scopes').run();
      db.prepare('DELETE FROM technical_plan_outline_nodes').run();
      db.prepare('DELETE FROM technical_plan_global_fact_groups').run();
      clearContentIllustrationPlan();
      db.prepare('DELETE FROM technical_plan_meta').run();
      ensureMetaRow();
      updateMeta({ workflow_kind: workflowKind });
    });
    transaction();
    return { success: true, message: '技术方案缓存已清空' };
  }

  cleanupLegacyPendingTenderState(ensureMetaRow());

  return {
    loadTechnicalPlan,
    updateTechnicalPlan,
    updateTechnicalPlanWithoutReload,
    clearMermaidCache: clearTechnicalPlanMermaidCache,
    clearIllustrationFiles,
    clearUnreferencedGeneratedImages: clearUnreferencedRootGeneratedImages,
    clearTechnicalPlan,
    importTenderDocument,
    removeTenderDocument,
    importOriginalPlanDocument,
    checkBidSections,
    resetBidSectionDownstream,
    selectBidSection,
    readTenderMarkdown,
    readTenderSourceMarkdown,
    readOriginalTenderMarkdown,
    readOriginalPlanMarkdown,
    readIllustrationHtml,
    findIllustrationHtml,
    readOriginalOutlineRuntime,
    saveOriginalOutlineRuntime,
    clearOriginalOutlineRuntime,
    updateStep,
    syncWorkflowKind,
    setWorkflowKind,
    switchWorkflowKind,
    saveBidAnalysisConfig,
    saveHistoricalAdaptationDifferences,
    saveHistoricalAdaptationOutline,
    confirmHistoricalAdaptationOutline,
    saveHistoricalAdaptationChapterContent,
    applyHistoricalAdaptationConsistencyRepairs,
    prepareHistoricalAdaptationContentPlan,
    getHistoricalAdaptationSourceSection,
    getHistoricalAdaptationSourceIndex,
    saveHistoricalAdaptationContentStrategy,
    resetHistoricalAdaptationContentStrategies,
    getHistoricalAdaptationContentCheckContext,
    upsertHistoricalAdaptationContentCheckRun,
    getHistoricalAdaptationContentCheckRun,
    getHistoricalAdaptationContentFacts,
    saveHistoricalAdaptationContentFactOverrides,
    getHistoricalAdaptationContentCheckCache,
    saveHistoricalAdaptationContentCheckCache,
    createHistoricalAdaptationContentCheckBatches,
    createHistoricalAdaptationContentCheckBatch({ checkRunId, batch, ...defaults } = {}) {
      return createHistoricalAdaptationContentCheckBatches({ checkRunId, batches: [batch || defaults], ...defaults })[0];
    },
    listHistoricalAdaptationContentCheckBatches,
    readHistoricalAdaptationContentCheckBatches: listHistoricalAdaptationContentCheckBatches,
    getHistoricalAdaptationContentCheckBatch,
    updateHistoricalAdaptationContentCheckBatch,
    saveHistoricalAdaptationContentCheckBatchResult,
    writeHistoricalAdaptationContentCheckBatchResult: saveHistoricalAdaptationContentCheckBatchResult,
    getReusableHistoricalAdaptationContentCheckBatches,
    readReusableHistoricalAdaptationContentCheckBatches: getReusableHistoricalAdaptationContentCheckBatches,
    invalidateHistoricalAdaptationContentCheckBatches,
    markHistoricalAdaptationContentCheckBatchesStale: invalidateHistoricalAdaptationContentCheckBatches,
    recoverHistoricalAdaptationContentCheckBatches,
    getHistoricalAdaptationContentReadiness,
    confirmHistoricalAdaptationContentItem,
    confirmHistoricalAdaptationContent,
    runHistoricalAdaptationReview,
    setHistoricalAdaptationReviewFinding,
    confirmHistoricalAdaptationReview,
    assertHistoricalAdaptationExportAllowed,
    saveOutlineConfig,
    saveOutlineSelection,
    saveOutline,
    saveOutlineNodeKnowledge,
    saveGlobalFactsConfig,
    saveGlobalFacts,
    saveIllustrationHtml,
    saveIllustrationPng,
    saveContentGenerationOptions,
    saveChapterContent,
    exportVariantSeed,
    importVariantSeed,
    getIllustrationReviewItem,
    previewIllustrationReviewItem,
    saveIllustrationReviewItem,
    saveIllustrationRedrawCandidate,
    confirmIllustrationReviewItem,
    resetIllustrationReviewItem,
    skipIllustrationReviewItem,
    adoptIllustrationReviewItem,
    previewMermaidReviewItem,
    saveMermaidReviewCode,
    confirmMermaidReviewItem,
    skipMermaidReviewItem,
    clearBidTemplate,
    listTenderSourceDocxRelativePaths() {
      return loadTenderSourceFiles()
        .map((file) => String(file.sourceDocxPath || '').trim())
        .filter((item) => item && fs.existsSync(resolveMarkdownPath(item)));
    },
    getBidTemplateRelativePath() {
      return bidTemplateRelativePath;
    },
    getBidTemplateSourceRelativePath() {
      return bidTemplateSourceRelativePath;
    },
    getBidTemplateFieldsRelativePath() {
      return bidTemplateFieldsRelativePath;
    },
    hasBidTemplate() {
      return fs.existsSync(bidTemplatePath) && fs.existsSync(bidTemplateFieldsPath);
    },
    getBidTemplatePath() {
      return bidTemplatePath;
    },
    getBidTemplateSourcePath() {
      return bidTemplateSourcePath;
    },
    getBidTemplateFieldsPath() {
      return bidTemplateFieldsPath;
    },
    copyTenderOriginalsToDirectory(destDir) {
      const targetDir = String(destDir || '').trim();
      if (!targetDir) return [];
      fs.mkdirSync(targetDir, { recursive: true });
      return loadTenderSourceFiles()
        .map((file) => String(file.sourceDocxPath || '').trim())
        .filter((item) => item && fs.existsSync(resolveMarkdownPath(item)))
        .map((relativePath) => {
          const fileName = path.basename(relativePath);
          fs.copyFileSync(resolveMarkdownPath(relativePath), path.join(targetDir, fileName));
          return fileName;
        });
    },
    resolveTenderSourceDocxPath(sourceHint) {
      const hint = String(sourceHint || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
      const sources = loadTenderSourceFiles()
        .map((file) => String(file.sourceDocxPath || '').trim())
        .filter((item) => item && fs.existsSync(resolveMarkdownPath(item)));
      if (!hint || hint === '招标原件') return sources;
      const fileName = path.posix.basename(hint);
      if (!fileName || fileName === '招标原件') return sources;
      const matched = sources.find((item) => path.posix.basename(item) === fileName || item === hint);
      return matched ? [matched] : [];
    },
  };
}

module.exports = {
  createTechnicalPlanStore,
  originalPlanDownstreamTaskTypes,
};
