const crypto = require('node:crypto');
const { runBidSectionExtractionTask } = require('./bidSectionExtractionTask.cjs');
const { runBidAnalysisTask } = require('./bidAnalysisTask.cjs');
const { runContentGenerationTask } = require('./contentGenerationTask.cjs');
const { runGlobalFactsTaskV2 } = require('./globalFactsTaskV2.cjs');
const { runOutlineGenerationTaskV2 } = require('./outlineGenerationTaskV2.cjs');
const { runOutlineAdjustmentTask } = require('./outlineAdjustmentTask.cjs');
const { runGlobalFactsAdjustmentTask } = require('./globalFactsAdjustmentTask.cjs');
const {
  OUTLINE_AGENT_TASK_KEY,
  TEMPLATE_EXTRACTION_AGENT_TASK_KEY,
} = require('./outlineGenerationAgentV2Config.cjs');
const { GLOBAL_FACTS_AGENT_TASK_KEY } = require('./globalFactsAgentV2Config.cjs');
const { FEASIBILITY_OUTLINE_AGENT_TASK_KEY } = require('./feasibilityOutlineAgentConfig.cjs');
const { runRejectionCheckTask, runRejectionItemsExtractionTask } = require('./rejectionCheckTask.cjs');
const { originalPlanDownstreamTaskTypes } = require('./technicalPlanStore.cjs');
const {
  clearContent,
  runFeasibilityAnalysisTask,
  runFeasibilityParametersTask,
  runFeasibilityContentTask,
  runFeasibilityHumanWritingTask,
} = require('./feasibilityReportTasks.cjs');
const { runFeasibilityOutlineTask } = require('./feasibilityOutlineTask.cjs');
const { runFeasibilityOutlineAdjustmentTask } = require('./feasibilityOutlineAdjustmentTask.cjs');
const { normalizeLogs } = require('./taskLogStore.cjs');

const taskDefinitions = {
  'bid-section-extraction': {
    label: '多标段识别',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 2,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'bidSectionExtractionTask',
  },
  'bid-analysis': {
    label: '招标文件解析',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 2,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'bidAnalysisTask',
  },
  'outline-generation': {
    label: '目录生成',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 3,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'outlineGenerationTask',
  },
  'outline-adjustment': {
    label: '目录AI调整',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 3,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'outlineAdjustmentTask',
  },
  'global-facts-generation': {
    label: '全局事实设定',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 4,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'globalFactsTask',
  },
  'global-facts-adjustment': {
    label: '全局事实AI调整',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 4,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'globalFactsAdjustmentTask',
  },
  'content-generation': {
    label: '正文生成',
    group: 'technical-plan',
    groupLabel: '技术方案',
    step: 5,
    lockPolicy: 'scope-exclusive',
    stateKey: 'technicalPlan',
    field: 'contentGenerationTask',
  },
  'rejection-items-extraction': {
    label: '无效与废标项解析',
    group: 'rejection-check',
    groupLabel: '废标项检查',
    step: 1,
    lockPolicy: 'group-exclusive',
    stateKey: 'rejectionCheck',
    field: 'extractionTask',
  },
  'rejection-check-run': {
    label: '废标项检查',
    group: 'rejection-check',
    groupLabel: '废标项检查',
    step: 2,
    lockPolicy: 'group-exclusive',
    stateKey: 'rejectionCheck',
    field: 'checkTask',
  },
  'duplicate-analysis': {
    label: '标书查重分析',
    group: 'duplicate-check',
    groupLabel: '标书查重',
    step: 2,
    lockPolicy: 'group-exclusive',
    stateKey: 'duplicateCheck',
    field: 'analysisTask',
  },
  'feasibility-analysis': {
    label: '可研项目资料分析',
    group: 'feasibility-report',
    groupLabel: '可行性研究报告',
    step: 2,
    lockPolicy: 'group-exclusive',
    stateKey: 'feasibilityReport',
    field: 'analysisTask',
  },
  'feasibility-outline': {
    label: '可研报告目录生成',
    group: 'feasibility-report',
    groupLabel: '可行性研究报告',
    step: 3,
    lockPolicy: 'group-exclusive',
    stateKey: 'feasibilityReport',
    field: 'outlineTask',
  },
  'feasibility-outline-adjustment': {
    label: '可研报告目录AI调整',
    group: 'feasibility-report',
    groupLabel: '可行性研究报告',
    step: 3,
    lockPolicy: 'group-exclusive',
    stateKey: 'feasibilityReport',
    field: 'outlineAdjustmentTask',
  },
  'feasibility-parameters': {
    label: '可研关键参数生成',
    group: 'feasibility-report',
    groupLabel: '可行性研究报告',
    step: 4,
    lockPolicy: 'group-exclusive',
    stateKey: 'feasibilityReport',
    field: 'parametersTask',
  },
  'feasibility-content': {
    label: '可研报告正文生成',
    group: 'feasibility-report',
    groupLabel: '可行性研究报告',
    step: 5,
    lockPolicy: 'group-exclusive',
    stateKey: 'feasibilityReport',
    field: 'contentTask',
  },
  'feasibility-human-writing': {
    label: '可研自然化审校',
    group: 'feasibility-report',
    groupLabel: '可行性研究报告',
    step: 5,
    lockPolicy: 'group-exclusive',
    stateKey: 'feasibilityReport',
    field: 'humanWritingTask',
  },
};

function now() {
  return new Date().toISOString();
}

function getTaskDefinition(type) {
  return taskDefinitions[type] || { label: type, stateKey: 'technicalPlan', field: undefined, lockPolicy: 'none' };
}

function getScopeId(payload) {
  const scopeId = payload?.projectId ?? payload?.project_id ?? payload?.scopeId ?? payload?.scope_id;
  return scopeId === undefined || scopeId === null ? '' : String(scopeId);
}

function createDuplicateCheckPayloadSignature(payload = {}) {
  const tenderFiles = Array.isArray(payload.tenderFiles) ? payload.tenderFiles : [payload.tenderFile].filter(Boolean);
  const files = [...tenderFiles, ...(Array.isArray(payload.bidFiles) ? payload.bidFiles : [])]
    .filter(Boolean)
    .map((file) => `${file.file_path}|${file.size}|${file.modified_at}`);
  return crypto.createHash('sha1').update(files.join('\n')).digest('hex');
}

function getPayloadSignature(type, payload) {
  if (type === 'duplicate-analysis') {
    return createDuplicateCheckPayloadSignature(payload);
  }
  return undefined;
}

function isActiveTaskStatus(status) {
  return status === 'running' || status === 'pausing' || status === 'queued';
}

const technicalPlanStepByTaskType = Object.freeze({
  'bid-section-extraction': 'bid-analysis',
  'bid-analysis': 'bid-analysis',
  'outline-generation': 'outline-generation',
  'outline-adjustment': 'outline-generation',
  'global-facts-generation': 'global-facts',
  'global-facts-adjustment': 'global-facts',
  'content-generation': 'content-edit',
});

function getBidProjectStatusForTask(task, statusOverride) {
  if (statusOverride) return statusOverride;
  if (['queued', 'running', 'pausing', 'paused'].includes(task?.status)) return 'generating';
  if (task?.status === 'error' || task?.status === 'interrupted') return 'failed';
  if (task?.status === 'success' && task?.type === 'content-generation') return 'completed';
  return 'incomplete';
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function copyPatchFields(target, source, fields) {
  for (const field of fields) {
    if (hasOwn(source, field)) {
      target[field] = source[field];
    }
  }
}

// 提取技术方案流程中由用户选择或填写的任务参数，不包含生成结果和正文缓存。
function createTechnicalPlanUserSettings(state = {}) {
  const settings = {};
  copyPatchFields(settings, state, [
    'workflowKind',
    'step',
    'tenderFile',
    'tenderFiles',
    'originalPlanFile',
    'bidAnalysisMode',
    'bidAnalysisSelectedTaskIds',
    'bidSectionMode',
    'outlineMode',
    'outlineExpansionMode',
    'outlineWordControlOptions',
    'outlineWordControlSnapshot',
    'referenceKnowledgeDocumentIds',
    'contentGenerationOptions',
  ]);
  return settings;
}

const INTERRUPTED_SECTION_ERROR = '上次生成被中断，请继续生成。';

function clearOutlineContentByIds(items, interruptedIds) {
  if (!(interruptedIds instanceof Set) || !interruptedIds.size) {
    return items;
  }

  return (items || []).map((item) => {
    const nextItem = interruptedIds.has(item.id) ? { ...item, content: '' } : { ...item };
    if (item?.children?.length) {
      nextItem.children = clearOutlineContentByIds(item.children, interruptedIds);
    }
    return nextItem;
  });
}

function normalizeInterruptedContentSections(technicalPlan) {
  const sections = technicalPlan?.contentGenerationSections || {};
  const interruptedIds = new Set();
  const nextSections = { ...sections };

  for (const [itemId, section] of Object.entries(sections)) {
    if (section?.status !== 'running') {
      continue;
    }
    interruptedIds.add(itemId);
    // 单小节重新生成时异常退出可能丢失旧正文；场景极窄，恢复优先保证可继续重跑，不额外保存旧正文。
    nextSections[itemId] = {
      ...section,
      status: 'error',
      content: '',
      error: INTERRUPTED_SECTION_ERROR,
      updated_at: now(),
    };
  }

  if (!interruptedIds.size) {
    return { sections, outlineData: technicalPlan?.outlineData, interruptedIds };
  }

  const outlineData = technicalPlan?.outlineData?.outline
    ? {
      ...technicalPlan.outlineData,
      outline: clearOutlineContentByIds(technicalPlan.outlineData.outline, interruptedIds),
    }
    : technicalPlan?.outlineData;

  return { sections: nextSections, outlineData, interruptedIds };
}

function inferContentGenerationPhase(technicalPlan) {
  return technicalPlan?.contentGenerationTask?.stats?.content?.phase
    || technicalPlan?.contentGenerationRuntime?.phase
    || 'planning';
}

function createTask(type, payload) {
  const definition = getTaskDefinition(type);
  const scopeId = getScopeId(payload);
  const payloadSignature = getPayloadSignature(type, payload);
  return {
    task_id: crypto.randomUUID(),
    type,
    group: definition.group,
    step: definition.step,
    lock_policy: definition.lockPolicy,
    scope_id: scopeId || undefined,
    project_id: scopeId || undefined,
    projectId: scopeId || undefined,
    payload_signature: payloadSignature,
    status: 'running',
    progress: 0,
    logs: [],
    started_at: now(),
    updated_at: now(),
  };
}

function cloneRemoteScopes(scopes) {
  return (Array.isArray(scopes) ? scopes : []).map((scope) => ({
    ...scope,
    documents: (Array.isArray(scope?.documents) ? scope.documents : []).map((document) => ({ ...document })),
  }));
}

function createTaskService({ aiService, agentService, autoConfirmationService, technicalPlanStore, bidProjectManager, rejectionCheckStore, duplicateCheckStore, feasibilityReportStore, knowledgeBaseService, knowledgeReferenceService, remoteKnowledgeDecisionService, duplicateCheckService, openXmlHelperService, taskRunners = {} }) {
  const subscribers = new Set();
  const callbackSubscribers = new Set();
  const activeTasks = new Map();
  const activeTaskControls = new Map();
  const technicalPlanConcurrency = 2;
  let technicalPlanRunning = 0;
  const technicalPlanQueue = [];

  function getTechnicalPlanStore(projectId) {
    return bidProjectManager?.getTechnicalPlanStore(projectId || bidProjectManager?.getCurrentProjectId?.()) || technicalPlanStore;
  }

  function requireProjectId(projectId, operation) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
      throw new Error(`${operation}必须提供 projectId`);
    }
    return normalizedProjectId;
  }

  function getProjectScopedTechnicalPlanStore(projectId, operation) {
    const normalizedProjectId = requireProjectId(projectId, operation);
    const store = bidProjectManager
      ? bidProjectManager.getTechnicalPlanStore(normalizedProjectId)
      : technicalPlanStore;
    if (!store) {
      throw new Error(`${operation}未找到项目 ${normalizedProjectId} 的技术方案 Store`);
    }
    return { projectId: normalizedProjectId, store };
  }

  function getProjectId(payloadOrTask) {
    return getScopeId(payloadOrTask) || String(bidProjectManager?.getCurrentProjectId?.() || '').trim();
  }

  function getTaskKey(type, payloadOrTask) {
    const projectId = getProjectId(payloadOrTask);
    return projectId ? `${type}:${projectId}` : type;
  }

  function getAgentTaskKey(baseKey, payloadOrTask) {
    const projectId = getProjectId(payloadOrTask);
    return projectId ? `${baseKey}:${projectId}` : baseKey;
  }

  function hasActiveTask(type, projectId) {
    return activeTasks.has(getTaskKey(type, { projectId, project_id: projectId, scopeId: projectId }));
  }

  function snapshotTask(task) {
    const control = activeTaskControls.get(getTaskKey(task?.type, task));
    const decision = control?.remoteKnowledgeDecision;
    return {
      ...task,
      remote_knowledge_action_required: Boolean(decision),
      ...(decision?.decisionId ? { remote_knowledge_decision_id: decision.decisionId } : {}),
    };
  }

  function emit(task, snapshot) {
    const event = { task: snapshotTask(task), ...snapshot };
    for (const webContents of subscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send('tasks:event', event);
      }
    }
    for (const callback of callbackSubscribers) {
      callback(event);
    }
  }

  remoteKnowledgeDecisionService?.onDecision?.((decision) => {
    for (const [taskKey, control] of activeTaskControls.entries()) {
      if (control.knowledgeSession?.taskId !== decision?.taskId) continue;
      control.remoteKnowledgeDecision = decision;
      const task = activeTasks.get(taskKey);
      if (task) emit(task, getSnapshotForTask(task));
      break;
    }
  });

  function buildTechnicalPlanSnapshot(task, state = {}, eventPatch = {}) {
    const patch = { ...(eventPatch.technicalPlanPatch || {}) };
    const taskField = getTaskField(task.type);
    if (taskField) {
      patch[taskField] = snapshotTask(task) || state?.[taskField];
    }

    if (task.type === 'bid-analysis') {
      copyPatchFields(patch, state, ['bidAnalysisMode', 'bidAnalysisProgress', 'projectOverview', 'techRequirements', 'bidAnalysisTasks']);
      if (state.outlineData === null) {
        copyPatchFields(patch, state, [
          'outlineData',
          'outlineWordControlSnapshot',
          'outlineGenerationTask',
          'globalFactsTask',
          'globalFactsAdjustmentTask',
          'globalFacts',
          'contentGenerationTask',
          'contentGenerationOptions',
          'contentGenerationSections',
          'contentGenerationPlans',
          'contentIllustrationPlan',
          'contentGenerationRuntime',
        ]);
      }
    }

    if (task.type === 'bid-section-extraction') {
      copyPatchFields(patch, state, [
        'bidSectionMode',
        'bidSections',
        'bidSectionExtractionStatus',
        'bidSectionExtractionError',
        'tenderFile',
        'bidAnalysisTask',
        'bidAnalysisTasks',
        'bidAnalysisProgress',
        'projectOverview',
        'techRequirements',
        'outlineData',
        'outlineWordControlSnapshot',
        'outlineGenerationTask',
        'referenceKnowledgeDocumentIds',
        'globalFactsTask',
        'globalFactsAdjustmentTask',
        'globalFacts',
        'contentGenerationTask',
        'contentGenerationOptions',
        'contentGenerationSections',
        'contentGenerationPlans',
        'contentIllustrationPlan',
        'contentGenerationRuntime',
      ]);
    }

    if (task.type === 'outline-generation') {
      copyPatchFields(patch, state, [
        'outlineMode',
        'outlineExpansionMode',
        'outlineWordControlOptions',
        'outlineWordControlSnapshot',
        'referenceKnowledgeDocumentIds',
        'globalFactsTask',
        'globalFactsAdjustmentTask',
        'globalFacts',
        'bidTemplateExists',
      ]);
      if (task.status === 'success' || state.outlineData === null || hasOwn(eventPatch, 'outlineData')) {
        copyPatchFields(patch, state, [
          'outlineData',
          'globalFactsTask',
          'globalFactsAdjustmentTask',
          'globalFacts',
          'contentGenerationTask',
          'contentGenerationSections',
          'contentGenerationPlans',
          'contentIllustrationPlan',
          'contentGenerationRuntime',
        ]);
      }
    }

    if (task.type === 'global-facts-generation') {
      copyPatchFields(patch, state, ['globalFacts', 'globalFactsAdjustmentTask']);
      copyPatchFields(patch, state, [
        'contentGenerationTask',
        'contentGenerationSections',
        'contentGenerationPlans',
        'contentIllustrationPlan',
        'contentGenerationRuntime',
      ]);
    }

    if (task.type === 'global-facts-adjustment') {
      copyPatchFields(patch, state, ['globalFacts']);
      copyPatchFields(patch, state, [
        'contentGenerationTask',
        'contentGenerationSections',
        'contentGenerationPlans',
        'contentIllustrationPlan',
        'contentGenerationRuntime',
      ]);
    }

    if (task.type === 'content-generation') {
      copyPatchFields(patch, state, ['outlineWordControlSnapshot', 'contentIllustrationPlan', 'contentGenerationRuntime']);
      if (!isActiveTaskStatus(task.status)) {
        copyPatchFields(patch, state, [
          'outlineData',
          'contentGenerationSections',
          'contentGenerationPlans',
          'contentIllustrationPlan',
          'contentGenerationRuntime',
        ]);
      }
    }

    if (hasOwn(eventPatch, 'outlineData')) {
      patch.outlineData = eventPatch.outlineData;
    }
    if (hasOwn(eventPatch, 'contentRuntime')) {
      patch.contentGenerationRuntime = eventPatch.contentRuntime;
    }

    const event = { technicalPlanPatch: patch };
    if (hasOwn(eventPatch, 'bidItem')) event.bidItem = eventPatch.bidItem;
    if (hasOwn(eventPatch, 'outlineData')) event.outlineData = eventPatch.outlineData;
    if (hasOwn(eventPatch, 'contentSection')) event.contentSection = eventPatch.contentSection;
    if (hasOwn(eventPatch, 'contentPlan')) event.contentPlan = eventPatch.contentPlan;
    if (hasOwn(eventPatch, 'contentRuntime')) event.contentRuntime = eventPatch.contentRuntime;
    return event;
  }

  function buildFeasibilityReportSnapshot(task, state = {}) {
    const patch = {};
    const taskField = getTaskField(task.type);
    if (taskField) {
      patch[taskField] = state?.[taskField] || task;
    }
    copyPatchFields(patch, state, [
      'step',
      'projectInfo',
      'sourceFiles',
      'analysisMarkdown',
      'outlineTemplate',
      'targetWords',
      'referenceDocumentIds',
      'keyParametersMarkdown',
      'outlineData',
      'analysisTask',
      'outlineTask',
      'outlineAdjustmentTask',
      'parametersTask',
      'contentTask',
      'humanWritingTask',
    ]);
    return { feasibilityReportPatch: patch };
  }

  function buildSnapshot(definition, state, task, eventPatch) {
    if (definition.stateKey === 'technicalPlan') {
      return buildTechnicalPlanSnapshot(task, state, eventPatch);
    }
    if (definition.stateKey === 'rejectionCheck') {
      return { rejectionCheckPatch: state };
    }
    if (definition.stateKey === 'duplicateCheck') {
      return { duplicateCheckPatch: state };
    }
    if (definition.stateKey === 'feasibilityReport') {
      return buildFeasibilityReportSnapshot(task, state, eventPatch);
    }
    return {};
  }

  function getSnapshotForTask(task) {
    const definition = getTaskDefinition(task.type);
    if (definition.stateKey === 'technicalPlan') {
      return buildSnapshot(definition, getTechnicalPlanStore(getProjectId(task)).loadTechnicalPlan(), task);
    }
    if (definition.stateKey === 'rejectionCheck') {
      return { rejectionCheck: rejectionCheckStore.loadRejectionCheck() };
    }
    if (definition.stateKey === 'duplicateCheck') {
      return { duplicateCheck: duplicateCheckStore.loadDuplicateCheck() };
    }
    if (definition.stateKey === 'feasibilityReport') {
      return buildSnapshot(definition, feasibilityReportStore.loadFeasibilityReport(), task);
    }
    return {};
  }

  function subscribe(webContents) {
    subscribers.add(webContents);
    for (const task of activeTasks.values()) {
      if (!webContents.isDestroyed()) {
        webContents.send('tasks:event', { task, ...getSnapshotForTask(task) });
      }
    }
    webContents.once('destroyed', () => subscribers.delete(webContents));
  }

  /**
   * 订阅 Main 进程中的任务事件，并返回取消订阅函数
   */
  function subscribeCallback(callback) {
    callbackSubscribers.add(callback);
    for (const task of activeTasks.values()) {
      callback({ task, ...getSnapshotForTask(task) });
    }
    return () => callbackSubscribers.delete(callback);
  }

  function getTaskField(type) {
    return getTaskDefinition(type).field;
  }

  function getActiveTaskConflict(type, payload) {
    const definition = getTaskDefinition(type);
    if (definition.lockPolicy === 'none' || !definition.group) {
      return null;
    }

    const nextScopeId = getProjectId(payload);
    for (const task of activeTasks.values()) {
      if (!isActiveTaskStatus(task.status) || task.type === type) {
        continue;
      }

      const activeDefinition = getTaskDefinition(task.type);
      if (activeDefinition.group !== definition.group) {
        continue;
      }

      if (definition.lockPolicy === 'group-exclusive' || activeDefinition.lockPolicy === 'group-exclusive') {
        if (definition.group === 'technical-plan' && activeDefinition.group === 'technical-plan' && nextScopeId && task.scope_id !== nextScopeId) {
          continue;
        }
        return { task, definition: activeDefinition };
      }

      if (definition.lockPolicy === 'scope-exclusive' && nextScopeId && task.scope_id === nextScopeId) {
        return { task, definition: activeDefinition };
      }
    }

    return null;
  }

  function assertTaskCanStart(type, payload) {
    const conflict = getActiveTaskConflict(type, payload);
    if (!conflict) {
      const definition = getTaskDefinition(type);
      if (definition.group === 'technical-plan') {
        const technicalPlan = getTechnicalPlanStore(getProjectId(payload)).loadTechnicalPlan() || {};
        const pausedContentTask = technicalPlan.contentGenerationTask;
        if (pausedContentTask?.status === 'paused') {
          if (type === 'content-generation' && payload?.resume) {
            return;
          }
          throw new Error('正文生成已暂停，请先继续当前正文生成任务或重置技术方案后再启动新的任务。');
        }
      }
      if (definition.group === 'feasibility-report' && feasibilityReportStore) {
        const report = feasibilityReportStore.loadFeasibilityReport() || {};
        if (report.contentTask?.status === 'paused') {
          if (type === 'feasibility-content' && (payload?.resume || payload?.onlyMissing)) {
            return;
          }
          throw new Error('可研正文生成已暂停，请先继续当前正文生成或重置可研后再启动新的任务。');
        }
      }
      return;
    }

    const definition = getTaskDefinition(type);
    throw new Error(`当前${definition.groupLabel || '任务组'}正在执行“${conflict.definition.label || conflict.task.type}”，请完成后再启动“${definition.label || type}”。`);
  }

  function updateWorkspaceStateWithoutReload(definition, partial, workspaceStore) {
    if (definition.stateKey === 'technicalPlan') {
      (workspaceStore || technicalPlanStore).updateTechnicalPlanWithoutReload(partial);
      return;
    }
    if (definition.stateKey === 'rejectionCheck') {
      rejectionCheckStore.updateRejectionCheckWithoutReload(partial);
      return;
    }
    if (definition.stateKey === 'duplicateCheck') {
      duplicateCheckStore.updateDuplicateCheckWithoutReload(partial);
      return;
    }
    if (definition.stateKey === 'feasibilityReport') {
      feasibilityReportStore.updateFeasibilityReportWithoutReload(partial);
      return;
    }
    technicalPlanStore.updateTechnicalPlanWithoutReload(partial);
  }

  function loadWorkspaceState(definition, projectId) {
    if (definition.stateKey === 'technicalPlan') {
      return getTechnicalPlanStore(projectId).loadTechnicalPlan();
    }
    if (definition.stateKey === 'rejectionCheck') {
      return rejectionCheckStore.loadRejectionCheck();
    }
    if (definition.stateKey === 'duplicateCheck') {
      return duplicateCheckStore.loadDuplicateCheck();
    }
    if (definition.stateKey === 'feasibilityReport') {
      return feasibilityReportStore.loadFeasibilityReport();
    }
    return technicalPlanStore.loadTechnicalPlan();
  }

  // 在 Agent 失败时采集父任务及其前置步骤的用户参数快照。
  function createAgentUserTaskContext(type, definition, payload, currentTask) {
    const workspaceState = loadWorkspaceState(definition, getProjectId(payload)) || {};
    return {
      managed_task: {
        type,
        label: definition.label || type,
        group: definition.group || '',
        group_label: definition.groupLabel || '',
        step: definition.step,
        state_key: definition.stateKey || '',
        payload,
        state: currentTask,
      },
      workflow_settings: definition.stateKey === 'technicalPlan'
        ? createTechnicalPlanUserSettings(workspaceState)
        : {},
    };
  }

  function updateBidProjectTaskStatus(task, statusOverride) {
    const projectId = getProjectId(task);
    if (!projectId || !bidProjectManager?.updateProject) return;
    const nextStatus = getBidProjectStatusForTask(task, statusOverride);
    try {
      bidProjectManager.updateProject(projectId, {
        status: nextStatus,
        lastTaskType: task.type,
        lastTaskStatus: task.status,
        lastError: task.error || null,
        currentStep: technicalPlanStepByTaskType[task.type],
      });
    } catch (error) {
      console.warn('[task-service] 更新标书项目状态失败', error);
    }
  }

  function drainTechnicalPlanQueue() {
    while (technicalPlanRunning < technicalPlanConcurrency && technicalPlanQueue.length) {
      const entry = technicalPlanQueue.shift();
      const task = activeTasks.get(entry.taskKey);
      const control = activeTaskControls.get(entry.taskKey);
      if (!task || !control || control.cancelled) continue;
      technicalPlanRunning += 1;
      entry.resolve();
    }
  }

  function startManagedTask(type, payload, runner, initialPartial = {}, startOptions = {}) {
    const projectId = getProjectId(payload);
    const scopedPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, ...(projectId ? { projectId, project_id: projectId, scopeId: projectId, scope_id: projectId } : {}) }
      : payload;
    const taskKey = getTaskKey(type, scopedPayload);
    const workspaceStore = getTechnicalPlanStore(projectId);
    const existingTask = activeTasks.get(taskKey);
    if (existingTask && isActiveTaskStatus(existingTask.status)) {
      const nextPayloadSignature = getPayloadSignature(type, payload);
      if (existingTask.payload_signature && nextPayloadSignature && existingTask.payload_signature !== nextPayloadSignature) {
        const definition = getTaskDefinition(type);
        throw new Error(`当前${definition.groupLabel || '任务组'}正在执行“${definition.label || type}”，请等待当前任务完成后再重新分析新的文件集合。`);
      }
      emit(existingTask, getSnapshotForTask(existingTask));
      return existingTask;
    }

    assertTaskCanStart(type, payload);
    startOptions.beforeStart?.();

    const definition = getTaskDefinition(type);
    const task = startOptions.existingTask || createTask(type, scopedPayload);
    if (projectId) {
      task.scope_id = projectId;
      task.project_id = projectId;
      task.projectId = projectId;
    }
    const shouldQueue = definition.group === 'technical-plan'
      && technicalPlanRunning >= technicalPlanConcurrency
      && !startOptions.existingTask;
    if (shouldQueue) {
      task.status = 'queued';
      task.queue_position = technicalPlanQueue.length + 1;
    }
    if (definition.group === 'technical-plan' && !shouldQueue) {
      technicalPlanRunning += 1;
    }
    const queueScopeId = `${type}:${task.task_id}`;
    activeTasks.set(taskKey, task);
    updateBidProjectTaskStatus(task, 'generating');
    const taskField = getTaskField(type);
    let currentTask = task;
    const abortController = new AbortController();
    let resolveSettled;
    const settledPromise = new Promise((resolve) => {
      resolveSettled = resolve;
    });
    const taskControl = {
      queueScopeId,
      signal: abortController.signal,
      knowledgeSession: null,
      remoteKnowledgeDecision: null,
      remoteKnowledgeDecisionWaiters: 0,
      pauseRequested: false,
      queued: shouldQueue,
      cancelled: false,
      outlineSelectionWaiter: null,
      outlineSelectionResult: null,
      outlineSelectionAutoConfirmationId: null,
      isPauseRequested() {
        return this.pauseRequested;
      },
      beginRemoteKnowledgeDecisionWait() {
        this.remoteKnowledgeDecisionWaiters += 1;
      },
      endRemoteKnowledgeDecisionWait() {
        this.remoteKnowledgeDecisionWaiters = Math.max(0, this.remoteKnowledgeDecisionWaiters - 1);
        if (this.remoteKnowledgeDecisionWaiters || !this.remoteKnowledgeDecision) return;
        this.remoteKnowledgeDecision = null;
        const activeTask = activeTasks.get(taskKey);
        if (activeTask) emit(activeTask, getSnapshotForTask(activeTask));
      },
      requestPause() {
        this.pauseRequested = true;
        const pausedLogs = currentTask.logs?.length
          ? currentTask.logs
          : ['已请求暂停，正在等待当前 AI 请求完成。'];
        return checkpointTask({ status: 'pausing', pause_requested: true, logs: pausedLogs }).task;
      },
      waitForOutlineSelection() {
        if (abortController.signal.aborted) {
          throw abortController.signal.reason || new Error('目录生成任务已取消');
        }
        if (this.outlineSelectionResult) return Promise.resolve(this.outlineSelectionResult);
        if (this.outlineSelectionWaiter) {
          this.registerOutlineSelectionAutoConfirmation?.();
          return this.outlineSelectionWaiter.promise;
        }
        let resolve;
        let reject;
        const promise = new Promise((resolvePromise, rejectPromise) => {
          resolve = resolvePromise;
          reject = rejectPromise;
        });
        promise.catch(() => undefined);
        this.outlineSelectionWaiter = { promise, resolve, reject };
        this.registerOutlineSelectionAutoConfirmation?.();
        return promise;
      },
      cancel(reason = '后台任务已取消') {
        const error = new Error(reason);
        error.code = 'TASK_CANCELLED';
        this.outlineSelectionWaiter?.reject?.(error);
        this.outlineSelectionWaiter = null;
        autoConfirmationService.unregister(this.outlineSelectionAutoConfirmationId);
        this.outlineSelectionAutoConfirmationId = null;
        this.cancelled = true;
        if (!abortController.signal.aborted) abortController.abort(error);
        if (this.queued) {
          const queueIndex = technicalPlanQueue.findIndex((entry) => entry.taskKey === taskKey);
          if (queueIndex >= 0) technicalPlanQueue.splice(queueIndex, 1);
          this.dispose();
          activeTasks.delete(taskKey);
          activeTaskControls.delete(taskKey);
          resolveSettled();
          drainTechnicalPlanQueue();
        }
      },
      waitForSettlement() {
        return settledPromise;
      },
      dispose() {
        this.knowledgeSession?.dispose?.();
        this.knowledgeSession = null;
        this.outlineSelectionWaiter?.reject?.(new Error('目录生成任务已结束'));
        this.outlineSelectionWaiter = null;
        autoConfirmationService.unregister(this.outlineSelectionAutoConfirmationId);
        this.outlineSelectionAutoConfirmationId = null;
      },
    };
    activeTaskControls.set(taskKey, taskControl);

    const applyTaskPatch = (partial) => {
      const nextStatus = currentTask.status === 'pausing' && partial.status === 'running'
        ? 'pausing'
        : partial.status || currentTask.status;
      currentTask = {
        ...currentTask,
        ...partial,
        status: nextStatus,
        pause_requested: partial.pause_requested === false ? false : taskControl.pauseRequested || partial.pause_requested,
        logs: partial.logs ? normalizeLogs(partial.logs) : currentTask.logs,
        updated_at: now(),
      };
      activeTasks.set(taskKey, currentTask);
      return currentTask;
    };

    // 仅更新内存并推送 Renderer，用于无恢复价值的高频展示状态。
    const updateTask = (partial, workspaceState = {}, eventPatch) => {
      const nextTask = applyTaskPatch(partial);
      emit(nextTask, buildSnapshot(definition, { ...(workspaceState || {}), [taskField]: nextTask }, nextTask, eventPatch));
      return nextTask;
    };

    // 将业务状态和任务状态作为同一个 checkpoint 落库，并在提交后统一推送事件。
    const checkpointTask = (taskPartial, workspacePartial = {}, eventPatch) => {
      if (taskControl.signal.aborted) {
        throw taskControl.signal.reason || new Error('后台任务已取消');
      }
      const nextTask = applyTaskPatch(taskPartial);
      const persistedTask = { ...nextTask };
      delete persistedTask.remote_knowledge_action_required;
      delete persistedTask.remote_knowledge_decision_id;
      const persistedPatch = {
        ...(workspacePartial || {}),
        [taskField]: persistedTask,
      };
      updateWorkspaceStateWithoutReload(definition, persistedPatch, workspaceStore);
      emit(nextTask, buildSnapshot(definition, persistedPatch, nextTask, eventPatch));
      return { task: nextTask };
    };

    // 为一级目录默认选择注册自动确认，并把截止时间同步到任务状态。
    taskControl.registerOutlineSelectionAutoConfirmation = () => {
      if (type !== 'outline-generation' || taskControl.outlineSelectionAutoConfirmationId) return;
      const selection = currentTask.stats?.outline_selection;
      if (!selection?.items?.length || !selection.selected_ids?.length || selection.confirmed) return;
      const confirmationId = `outline-selection:${currentTask.task_id}`;
      const defaultItems = selection.items;
      const defaultSelectedIds = selection.selected_ids;
      taskControl.outlineSelectionAutoConfirmationId = confirmationId;
      autoConfirmationService.register({
        id: confirmationId,
        submit: () => taskControl.confirmOutlineSelection({
          taskId: currentTask.task_id,
          items: defaultItems,
          selectedIds: defaultSelectedIds,
        }),
        onStateChange: ({ auto_answer_at: autoAnswerAt }) => {
          const currentSelection = currentTask.stats?.outline_selection;
          if (!currentSelection || currentSelection.confirmed) return;
          const nextSelection = { ...currentSelection };
          if (autoAnswerAt) nextSelection.auto_answer_at = autoAnswerAt;
          else delete nextSelection.auto_answer_at;
          currentTask = checkpointTask({
            stats: {
              ...(currentTask.stats || {}),
              outline_selection: nextSelection,
            },
          }).task;
        },
      });
    };

    taskControl.confirmOutlineSelection = (request = {}) => {
      if (type !== 'outline-generation' || request.taskId !== currentTask.task_id) {
        throw new Error('一级目录生成结果已变化，请重新打开后再选择');
      }
      const waiter = taskControl.outlineSelectionWaiter;
      if (!waiter) throw new Error('当前目录任务不在一级目录确认阶段');
      const items = Array.isArray(request.items) ? request.items : [];
      const selectedIds = Array.isArray(request.selectedIds) ? request.selectedIds : [];
      autoConfirmationService.unregister(taskControl.outlineSelectionAutoConfirmationId);
      taskControl.outlineSelectionAutoConfirmationId = null;
      const checkpoint = checkpointTask({
        stats: {
          ...(currentTask.stats || {}),
          outline_selection: {
            items,
            selected_ids: selectedIds,
            confirmed: true,
          },
        },
      });
      currentTask = checkpoint.task;
      taskControl.outlineSelectionWaiter = null;
      taskControl.outlineSelectionResult = { items, selectedIds };
      waiter.resolve(taskControl.outlineSelectionResult);
      return { success: true };
    };

    // 用户修改一级目录草稿后停止当前确认项的自动提交。
    taskControl.suppressOutlineSelectionAutoConfirmation = (request = {}) => {
      if (type !== 'outline-generation' || request.taskId !== currentTask.task_id) {
        return { success: true };
      }
      autoConfirmationService.suppress(taskControl.outlineSelectionAutoConfirmationId);
      return { success: true };
    };

    const previousState = loadWorkspaceState(definition, projectId) || {};
    if (!shouldQueue && knowledgeReferenceService && ['outline-generation', 'global-facts-generation', 'content-generation'].includes(type)) {
      const session = knowledgeReferenceService.createTaskSession({
        taskId: currentTask.task_id,
        workflow: previousState.workflowKind || 'technical-plan',
        localDocumentIds: Array.isArray(previousState.referenceKnowledgeDocumentIds) ? [...previousState.referenceKnowledgeDocumentIds] : [],
        remoteScopes: cloneRemoteScopes(previousState.remoteKnowledgeScopes),
        taskControl,
      });
      taskControl.knowledgeSession = session;
    }
    const initialState = startOptions.skipInitialStateUpdate
      ? previousState
      : { ...initialPartial, [taskField]: currentTask };
    if (!startOptions.skipInitialStateUpdate) {
      updateWorkspaceStateWithoutReload(definition, initialState, workspaceStore);
    }
    emit(currentTask, buildSnapshot(definition, initialState, currentTask));
    if (!shouldQueue && startOptions.restoreOutlineSelectionWaiter) {
      taskControl.waitForOutlineSelection();
    }

    const runnerWorkspaceStore = definition.stateKey === 'technicalPlan'
      ? workspaceStore
      : definition.stateKey === 'rejectionCheck'
        ? rejectionCheckStore
        : definition.stateKey === 'feasibilityReport'
          ? feasibilityReportStore
          : duplicateCheckStore;
    const runGate = shouldQueue
      ? new Promise((resolve) => technicalPlanQueue.push({ taskKey, resolve }))
      : Promise.resolve();
    runGate.then(() => {
      if (taskControl.cancelled) return;
      taskControl.queued = false;
      currentTask = applyTaskPatch({ status: 'running', queue_position: undefined });
      updateWorkspaceStateWithoutReload(definition, { [taskField]: currentTask }, workspaceStore);
      emit(currentTask, buildSnapshot(definition, { [taskField]: currentTask }, currentTask));
      if (knowledgeReferenceService && ['outline-generation', 'global-facts-generation', 'content-generation'].includes(type) && !taskControl.knowledgeSession) {
        const session = knowledgeReferenceService.createTaskSession({
          taskId: currentTask.task_id,
          workflow: previousState.workflowKind || 'technical-plan',
          localDocumentIds: Array.isArray(previousState.referenceKnowledgeDocumentIds) ? [...previousState.referenceKnowledgeDocumentIds] : [],
          remoteScopes: cloneRemoteScopes(previousState.remoteKnowledgeScopes),
          taskControl,
        });
        taskControl.knowledgeSession = session;
      }
      if (startOptions.restoreOutlineSelectionWaiter && !taskControl.outlineSelectionWaiter) {
        taskControl.waitForOutlineSelection();
      }
      const runnerAiService = aiService?.withQueueScope ? aiService.withQueueScope(queueScopeId, taskControl.signal) : aiService;
      const agentTaskContextProvider = () => createAgentUserTaskContext(type, definition, scopedPayload, currentTask);
      const runnerAgentService = agentService.bindTaskContext(
        agentTaskContextProvider,
        {
          queueScopeId,
          signal: taskControl.signal,
          primary_session: startOptions.primarySession === true,
        },
      );
      const runnerOrdinaryAgentService = agentService.bindTaskContext(
        agentTaskContextProvider,
        {
          queueScopeId,
          signal: taskControl.signal,
        },
      );
      return runner({ aiService: runnerAiService, agentService: runnerAgentService, ordinaryAgentService: runnerOrdinaryAgentService, workspaceStore: runnerWorkspaceStore, knowledgeBaseService, knowledgeReferenceService, knowledgeSession: taskControl.knowledgeSession, openXmlHelperService, updateTask, checkpointTask, payload: scopedPayload, taskControl, previousState });
    }).catch((error) => {
      if (!taskControl.signal.aborted) {
        checkpointTask({ status: 'error', error: error.message || '任务执行失败' });
      }
    }).finally(() => {
      if (definition.group === 'technical-plan' && !taskControl.queued) {
        technicalPlanRunning = Math.max(0, technicalPlanRunning - 1);
      }
      taskControl.dispose();
      if (aiService?.resumeQueueScope) {
        aiService.resumeQueueScope(queueScopeId);
      }
      updateBidProjectTaskStatus(currentTask);
      activeTasks.delete(taskKey);
      activeTaskControls.delete(taskKey);
      resolveSettled();
      drainTechnicalPlanQueue();
    });

    return snapshotTask(currentTask);
  }

  // 取消技术方案任务并等待退出，避免清空下游后旧任务继续提交 checkpoint。
  async function cancelTechnicalPlanTasks(reason, taskTypes, projectId) {
    const targetProjectId = requireProjectId(projectId, '取消技术方案任务');
    const typeFilter = Array.isArray(taskTypes) && taskTypes.length ? new Set(taskTypes) : null;
    const controls = [];
    for (const [taskKey, task] of activeTasks.entries()) {
      const definition = getTaskDefinition(task.type);
      const control = activeTaskControls.get(taskKey);
      if (definition.group !== 'technical-plan' || !isActiveTaskStatus(task.status) || !control?.cancel) continue;
      if (typeFilter && !typeFilter.has(task.type)) continue;
      if (String(getScopeId(task) || '').trim() !== targetProjectId) continue;
      controls.push(control);
      control.cancel(reason);
    }
    await Promise.all(controls.map((control) => control.waitForSettlement()));
  }

  // 取消废标检查任务并等待退出，避免清空下游后旧任务继续提交 checkpoint。
  async function cancelRejectionCheckTasks(reason, taskTypes) {
    const typeFilter = Array.isArray(taskTypes) && taskTypes.length ? new Set(taskTypes) : null;
    const controls = [];
    for (const [taskKey, task] of activeTasks.entries()) {
      const definition = getTaskDefinition(task.type);
      const control = activeTaskControls.get(taskKey);
      if (definition.group !== 'rejection-check' || !isActiveTaskStatus(task.status) || !control?.cancel) continue;
      if (typeFilter && !typeFilter.has(task.type)) continue;
      controls.push(control);
      control.cancel(reason);
    }
    await Promise.all(controls.map((control) => control.waitForSettlement()));
  }

  async function cancelFeasibilityReportTasks(reason, taskTypes) {
    const typeFilter = Array.isArray(taskTypes) && taskTypes.length ? new Set(taskTypes) : null;
    const controls = [];
    for (const [taskKey, task] of activeTasks.entries()) {
      const definition = getTaskDefinition(task.type);
      const control = activeTaskControls.get(taskKey);
      if (definition.group !== 'feasibility-report' || !isActiveTaskStatus(task.status) || !control?.cancel) continue;
      if (typeFilter && !typeFilter.has(task.type)) continue;
      controls.push(control);
      control.cancel(reason);
    }
    await Promise.all(controls.map((control) => control.waitForSettlement()));
  }

  function recoverInterruptedContentGenerationTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('content-generation', projectId)) {
      return;
    }

    const contentTask = technicalPlan.contentGenerationTask;
    if (!isActiveTaskStatus(contentTask?.status)) {
      return;
    }

    const { sections, outlineData, interruptedIds } = normalizeInterruptedContentSections(technicalPlan);
    const normalizedPlan = interruptedIds.size
      ? { ...technicalPlan, contentGenerationSections: sections, outlineData }
      : technicalPlan;
    const phase = inferContentGenerationPhase(normalizedPlan);
    const nextLogs = [
      ...(Array.isArray(contentTask.logs) ? contentTask.logs : []),
      '上次正文生成因应用关闭而暂停，可点击继续恢复。',
    ];
    const nextStats = {
      ...(contentTask.stats || {}),
      content: {
        ...(contentTask.stats?.content || {}),
        phase,
      },
    };
    const pausedTask = {
      ...contentTask,
      status: 'paused',
      pause_requested: false,
      logs: nextLogs,
      stats: nextStats,
      updated_at: now(),
    };
    const partial = {
      outlineData,
      contentGenerationSections: sections,
      contentGenerationTask: pausedTask,
      contentGenerationRuntime: {
        ...(normalizedPlan.contentGenerationRuntime || {}),
        phase,
        updated_at: now(),
      },
    };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(pausedTask, buildSnapshot(getTaskDefinition('content-generation'), partial, pausedTask));
  }

  function recoverInterruptedOutlineGenerationTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('outline-generation', projectId)) {
      return;
    }

    const outlineTask = technicalPlan.outlineGenerationTask;
    if (!isActiveTaskStatus(outlineTask?.status)) {
      return;
    }

    const agentState = outlineTask.stats?.agent || {};
    let persistentTask = null;
    let templatePersistentTask = null;
    try {
      persistentTask = agentService.loadPersistentTask(getAgentTaskKey(OUTLINE_AGENT_TASK_KEY, { projectId }));
    } catch {}
    try {
      templatePersistentTask = agentService.loadPersistentTask(getAgentTaskKey(TEMPLATE_EXTRACTION_AGENT_TASK_KEY, { projectId }));
    } catch {}
    const recoverableWaiting = persistentTask?.state?.run_id === outlineTask.task_id
      && persistentTask.state.status === 'waiting-outline-selection'
      && persistentTask.state.phase === 'outline-selection'
      && persistentTask.state.agent_connection === 'idle'
      && Boolean(persistentTask.state.session_file)
      && agentService.hasPersistentTaskSession(getAgentTaskKey(OUTLINE_AGENT_TASK_KEY, { projectId }))
      && Boolean(outlineTask.stats?.outline_selection?.items?.length)
      && outlineTask.stats.outline_selection.confirmed !== true;
    if (recoverableWaiting) {
      startManagedTask('outline-generation', {
        projectId,
        ...(agentState.resume_payload || {}),
        agent_resume: {
          phase: 'outline-selection',
        },
      }, runOutlineGenerationTaskV2, {}, {
        existingTask: outlineTask,
        skipInitialStateUpdate: true,
        restoreOutlineSelectionWaiter: true,
        primarySession: agentService.isPrimarySession({ task_key: getAgentTaskKey(OUTLINE_AGENT_TASK_KEY, { projectId }) }),
      });
      return;
    }

    const message = '上次目录生成未完成，请重新生成目录。';
    if (persistentTask) {
      try {
        agentService.updatePersistentTask(getAgentTaskKey(OUTLINE_AGENT_TASK_KEY, { projectId }), {
          status: 'interrupted',
          agent_connection: 'idle',
          error: message,
        });
      } catch {}
    }
    if (templatePersistentTask) {
      try {
        agentService.updatePersistentTask(getAgentTaskKey(TEMPLATE_EXTRACTION_AGENT_TASK_KEY, { projectId }), {
          status: 'interrupted',
          agent_connection: 'idle',
          error: message,
        });
      } catch {}
    }
    try { workspaceStore.clearBidTemplate(); } catch {}
    const recoveredStats = { ...(outlineTask.stats || {}) };
    delete recoveredStats.outline_selection;
    if (recoveredStats.agent) {
      recoveredStats.agent = {
        ...recoveredStats.agent,
        status: 'interrupted',
        agent_connection: 'idle',
      };
    }
    if (recoveredStats.template_agent) {
      recoveredStats.template_agent = {
        ...recoveredStats.template_agent,
        status: 'interrupted',
        agent_connection: 'idle',
      };
    }
    const recoveredTask = {
      ...outlineTask,
      status: 'error',
      progress: Math.max(0, Math.min(99, Number(outlineTask.progress || 0) || 0)),
      pause_requested: false,
      error: message,
      logs: [...(Array.isArray(outlineTask.logs) ? outlineTask.logs : []), message],
      stats: recoveredStats,
      updated_at: now(),
    };
    const partial = { outlineGenerationTask: recoveredTask };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(recoveredTask, buildSnapshot(getTaskDefinition('outline-generation'), partial, recoveredTask));
  }

  function recoverInterruptedOutlineAdjustmentTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('outline-adjustment', projectId)) {
      return;
    }

    const adjustmentTask = technicalPlan.outlineAdjustmentTask;
    if (!isActiveTaskStatus(adjustmentTask?.status)) {
      return;
    }

    const message = '上次目录 AI 调整未完成，请重新发送调整要求。';
    const recoveredTask = {
      ...adjustmentTask,
      status: 'error',
      progress: Math.max(0, Math.min(99, Number(adjustmentTask.progress || 0) || 0)),
      pause_requested: false,
      error: message,
      logs: [...(Array.isArray(adjustmentTask.logs) ? adjustmentTask.logs : []), message],
      updated_at: now(),
    };
    const partial = { outlineAdjustmentTask: recoveredTask };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(recoveredTask, buildSnapshot(getTaskDefinition('outline-adjustment'), partial, recoveredTask));
  }

  function recoverInterruptedGlobalFactsAdjustmentTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('global-facts-adjustment', projectId)) {
      return;
    }

    const adjustmentTask = technicalPlan.globalFactsAdjustmentTask;
    if (!isActiveTaskStatus(adjustmentTask?.status)) {
      return;
    }

    const message = '上次全局事实 AI 调整未完成，请重新发送调整要求。';
    const recoveredTask = {
      ...adjustmentTask,
      status: 'error',
      progress: Math.max(0, Math.min(99, Number(adjustmentTask.progress || 0) || 0)),
      pause_requested: false,
      error: message,
      logs: [...(Array.isArray(adjustmentTask.logs) ? adjustmentTask.logs : []), message],
      updated_at: now(),
    };
    const partial = { globalFactsAdjustmentTask: recoveredTask };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(recoveredTask, buildSnapshot(getTaskDefinition('global-facts-adjustment'), partial, recoveredTask));
  }

  function recoverInterruptedBidAnalysisTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('bid-analysis', projectId)) {
      return;
    }

    const bidAnalysisTask = technicalPlan.bidAnalysisTask;
    if (!isActiveTaskStatus(bidAnalysisTask?.status)) {
      return;
    }

    const message = '上次招标文件解析未完成，请重新解析';
    const interruptedBidAnalysisTasks = {};
    for (const [itemId, item] of Object.entries(technicalPlan.bidAnalysisTasks || {})) {
      if (item?.status === 'running') {
        interruptedBidAnalysisTasks[itemId] = {
          ...item,
          status: 'error',
          error: message,
        };
      }
    }

    const logs = Array.isArray(bidAnalysisTask.logs) ? bidAnalysisTask.logs : [];
    const recoveredTask = {
      ...bidAnalysisTask,
      status: 'error',
      progress: 100,
      pause_requested: false,
      error: message,
      logs: logs.includes(message) ? logs : [...logs, message],
      updated_at: now(),
    };
    const partial = Object.keys(interruptedBidAnalysisTasks).length
      ? { bidAnalysisTask: recoveredTask, bidAnalysisTasks: interruptedBidAnalysisTasks }
      : { bidAnalysisTask: recoveredTask };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(recoveredTask, buildSnapshot(getTaskDefinition('bid-analysis'), partial, recoveredTask));
  }

  function recoverInterruptedBidSectionExtractionTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('bid-section-extraction', projectId)) {
      return;
    }

    const extractionTask = technicalPlan.bidSectionExtractionTask;
    if (!isActiveTaskStatus(extractionTask?.status)) {
      return;
    }

    const message = '上次多标段识别未完成，请重新识别';
    const recoveredTask = {
      ...extractionTask,
      status: 'error',
      progress: 100,
      pause_requested: false,
      error: message,
      logs: [...(Array.isArray(extractionTask.logs) ? extractionTask.logs : []), message],
      updated_at: now(),
    };
    const partial = {
      bidSectionExtractionTask: recoveredTask,
      bidSectionExtractionStatus: 'error',
      bidSectionExtractionError: message,
    };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(recoveredTask, buildSnapshot(getTaskDefinition('bid-section-extraction'), partial, recoveredTask));
  }

  function recoverInterruptedGlobalFactsTask(technicalPlan, projectId, workspaceStore = technicalPlanStore) {
    if (hasActiveTask('global-facts-generation', projectId)) {
      return;
    }

    const globalFactsTask = technicalPlan.globalFactsTask;
    if (!isActiveTaskStatus(globalFactsTask?.status)) {
      return;
    }

    const message = '上次全局事实设定未完成，请重新解析';
    const recoveredTask = {
      ...globalFactsTask,
      status: 'error',
      progress: 100,
      error: message,
      logs: [...(Array.isArray(globalFactsTask.logs) ? globalFactsTask.logs : []), message],
      updated_at: now(),
    };
    const partial = { globalFactsTask: recoveredTask };
    workspaceStore.updateTechnicalPlanWithoutReload(partial);
    emit(recoveredTask, buildSnapshot(getTaskDefinition('global-facts-generation'), partial, recoveredTask));
  }

  function recoverInterruptedRejectionCheckTasks(state) {
    const staleExtractionMessage = '上次解析未完成，请重新解析';
    const staleCheckMessage = '上次检查未完成，请重新检查';
    const partial = {};

    if (!activeTasks.has('rejection-items-extraction') && state.extractionTask?.status === 'running') {
      partial.invalidBidAndRejectionItems = state.invalidBidAndRejectionItems?.status === 'running'
        ? { ...state.invalidBidAndRejectionItems, status: 'error', error: staleExtractionMessage, updatedAt: now() }
        : state.invalidBidAndRejectionItems;
      partial.extractionTask = {
        ...state.extractionTask,
        status: 'error',
        progress: 100,
        error: staleExtractionMessage,
        logs: [staleExtractionMessage],
        updated_at: now(),
      };
    }

    if (!activeTasks.has('rejection-check-run') && state.checkTask?.status === 'running') {
      const markResult = (result) => result?.status === 'running'
        ? { ...result, status: 'error', error: staleCheckMessage, progressMessage: staleCheckMessage, updatedAt: now() }
        : result;
      partial.rejectionCheckResult = markResult(state.rejectionCheckResult);
      partial.typoCheckResult = markResult(state.typoCheckResult);
      partial.logicCheckResult = markResult(state.logicCheckResult);
      partial.checkTask = {
        ...state.checkTask,
        status: 'error',
        progress: 100,
        error: staleCheckMessage,
        logs: [staleCheckMessage],
        updated_at: now(),
      };
    }

    if (Object.keys(partial).length) {
      rejectionCheckStore.updateRejectionCheckWithoutReload(partial);
    }
  }

  function recoverInterruptedDuplicateCheckTask(state) {
    if (activeTasks.has('duplicate-analysis')) {
      return;
    }
    if (state.analysisTask?.status !== 'running') {
      return;
    }
    const message = '上次标书查重分析未完成，请重新分析';
    const markAnalysis = (analysis) => analysis?.status === 'running'
      ? { ...analysis, status: 'error', progress: 100, message, updated_at: now() }
      : analysis;
    const recoveredTask = {
      ...state.analysisTask,
      status: 'error',
      progress: 100,
      logs: [message],
      error: message,
      updated_at: now(),
    };
    const partial = {
      analysisTask: recoveredTask,
      metadataAnalysis: markAnalysis(state.metadataAnalysis),
      outlineAnalysis: markAnalysis(state.outlineAnalysis),
      contentAnalysis: markAnalysis(state.contentAnalysis),
      imageAnalysis: markAnalysis(state.imageAnalysis),
    };
    duplicateCheckStore.updateDuplicateCheckWithoutReload(partial);
    emit(recoveredTask, { duplicateCheckPatch: partial });
  }

  function recoverInterruptedFeasibilityTasks(state) {
    if (!feasibilityReportStore) return;
    const markError = (task, message) => {
      if (!isActiveTaskStatus(task?.status)) return undefined;
      return {
        ...task,
        status: 'error',
        progress: 100,
        error: message,
        logs: [...(Array.isArray(task.logs) ? task.logs : []), message],
        updated_at: now(),
      };
    };
    const interruptMessage = '上次任务因应用关闭而中断，请重新开始。';
    const pausedMessage = '上次正文生成因应用关闭而暂停，可点击继续恢复。';
    const partial = {};
    const analysisTask = markError(state.analysisTask, interruptMessage);
    const outlineTask = markError(state.outlineTask, interruptMessage);
    const parametersTask = markError(state.parametersTask, interruptMessage);
    const humanWritingTask = markError(state.humanWritingTask, interruptMessage);
    if (analysisTask) partial.analysisTask = analysisTask;
    if (outlineTask) partial.outlineTask = outlineTask;
    if (parametersTask) partial.parametersTask = parametersTask;
    if (humanWritingTask) partial.humanWritingTask = humanWritingTask;
    if (isActiveTaskStatus(state.outlineAdjustmentTask?.status)) {
      const message = '上次目录 AI 调整未完成，请重新发送调整要求。';
      partial.outlineAdjustmentTask = {
        ...state.outlineAdjustmentTask,
        status: 'error',
        progress: Math.max(0, Math.min(99, Number(state.outlineAdjustmentTask.progress || 0) || 0)),
        pause_requested: false,
        error: message,
        logs: [...(Array.isArray(state.outlineAdjustmentTask.logs) ? state.outlineAdjustmentTask.logs : []), message],
        updated_at: now(),
      };
    }
    if (isActiveTaskStatus(state.contentTask?.status)) {
      partial.contentTask = {
        ...state.contentTask,
        status: 'paused',
        pause_requested: false,
        logs: [...(Array.isArray(state.contentTask.logs) ? state.contentTask.logs : []), pausedMessage],
        updated_at: now(),
      };
    }
    if (!Object.keys(partial).length) return;
    feasibilityReportStore.updateFeasibilityReportWithoutReload(partial);
    const recovered = partial.contentTask || analysisTask || outlineTask || partial.outlineAdjustmentTask || parametersTask || humanWritingTask;
    if (recovered) emit(recovered, { feasibilityReportPatch: partial });
  }

  const rejectionCheckRecoveryState = rejectionCheckStore.loadRejectionCheck() || {};
  const duplicateCheckRecoveryState = duplicateCheckStore.loadDuplicateCheck() || {};
  const feasibilityReportRecoveryState = feasibilityReportStore?.loadFeasibilityReport?.() || {};
  const projectRecoveryEntries = bidProjectManager?.listProjects?.() || [];
  const technicalPlanRecoveryEntries = projectRecoveryEntries.length
    ? projectRecoveryEntries.map((project) => ({
      projectId: project.projectId,
      store: getTechnicalPlanStore(project.projectId),
      state: getTechnicalPlanStore(project.projectId).loadTechnicalPlan() || {},
    }))
    : [{ projectId: '', store: technicalPlanStore, state: technicalPlanStore.loadTechnicalPlan() || {} }];
  technicalPlanRecoveryEntries.forEach(({ projectId, store, state }) => {
    recoverInterruptedBidSectionExtractionTask(state, projectId, store);
    recoverInterruptedBidAnalysisTask(state, projectId, store);
    recoverInterruptedOutlineGenerationTask(state, projectId, store);
    recoverInterruptedOutlineAdjustmentTask(state, projectId, store);
    recoverInterruptedContentGenerationTask(state, projectId, store);
    recoverInterruptedGlobalFactsTask(state, projectId, store);
    recoverInterruptedGlobalFactsAdjustmentTask(state, projectId, store);
  });
  recoverInterruptedRejectionCheckTasks(rejectionCheckRecoveryState);
  recoverInterruptedDuplicateCheckTask(duplicateCheckRecoveryState);
  recoverInterruptedFeasibilityTasks(feasibilityReportRecoveryState);

  return {
    subscribe,
    subscribeCallback,
    startBidSectionExtraction(payload) {
      return startManagedTask('bid-section-extraction', payload, runBidSectionExtractionTask, {
        bidSectionMode: 'multiple',
        bidSections: [],
        bidSectionExtractionStatus: 'running',
        bidSectionExtractionError: undefined,
        bidAnalysisTask: undefined,
        bidAnalysisTasks: {},
        bidAnalysisProgress: 0,
        projectOverview: '',
        techRequirements: '',
        outlineData: null,
        outlineWordControlSnapshot: undefined,
        outlineGenerationTask: undefined,
        outlineAdjustmentTask: undefined,
        referenceKnowledgeDocumentIds: [],
        globalFactsTask: undefined,
        globalFactsAdjustmentTask: undefined,
        globalFacts: [],
        contentGenerationTask: undefined,
        contentGenerationOptions: undefined,
        contentGenerationSections: {},
        contentGenerationPlans: {},
        contentIllustrationPlan: undefined,
        contentGenerationRuntime: undefined,
      });
    },
    startBidAnalysis(payload) {
      return startManagedTask('bid-analysis', payload, runBidAnalysisTask);
    },
    startOutlineGeneration(payload) {
      const outlineMode = payload?.outline_mode === 'standalone-technical'
        ? 'standalone-technical'
        : payload?.outline_mode === 'response-file'
          ? 'response-file'
          : 'aligned';
      const taskPayload = { ...payload, outline_mode: outlineMode };
      return startManagedTask('outline-generation', taskPayload, taskRunners.outlineGeneration || runOutlineGenerationTaskV2, {
        outlineMode,
        outlineExpansionMode: payload?.outline_expansion_mode === 'original-only' ? 'original-only' : 'ai-complement',
        outlineWordControlOptions: payload?.word_control_options,
        referenceKnowledgeDocumentIds: Array.isArray(payload?.reference_knowledge_document_ids) ? payload.reference_knowledge_document_ids : [],
        bidTemplateExists: false,
        outlineData: null,
        outlineWordControlSnapshot: undefined,
        outlineAdjustmentTask: undefined,
        globalFactsTask: undefined,
        globalFactsAdjustmentTask: undefined,
        globalFacts: [],
        contentGenerationTask: undefined,
        contentGenerationSections: {},
        contentGenerationPlans: {},
        contentIllustrationPlan: undefined,
        contentGenerationRuntime: undefined,
      }, {
        primarySession: true,
        beforeStart: () => {
          agentService.deletePersistentTask(getAgentTaskKey(OUTLINE_AGENT_TASK_KEY, taskPayload));
          agentService.deletePersistentTask(getAgentTaskKey(TEMPLATE_EXTRACTION_AGENT_TASK_KEY, taskPayload));
          getTechnicalPlanStore(getProjectId(taskPayload)).clearBidTemplate();
        },
      });
    },
    startOutlineAdjustment(payload) {
      return startManagedTask('outline-adjustment', payload, runOutlineAdjustmentTask, {}, {
        primarySession: agentService.isPrimarySession({ task_key: getAgentTaskKey(OUTLINE_AGENT_TASK_KEY, payload) }),
      });
    },
    startGlobalFactsGeneration(payload) {
      return startManagedTask('global-facts-generation', payload, runGlobalFactsTaskV2, {
        invalidateContentGeneration: true,
        globalFacts: [],
        globalFactsAdjustmentTask: undefined,
        contentGenerationTask: undefined,
        contentGenerationSections: {},
        contentGenerationPlans: {},
        contentIllustrationPlan: undefined,
        contentGenerationRuntime: undefined,
      }, {
        primarySession: true,
        beforeStart: () => agentService.deletePersistentTask(getAgentTaskKey(GLOBAL_FACTS_AGENT_TASK_KEY, payload)),
      });
    },
    startGlobalFactsAdjustment(payload) {
      return startManagedTask('global-facts-adjustment', payload, runGlobalFactsAdjustmentTask, {}, {
        primarySession: agentService.isPrimarySession({ task_key: getAgentTaskKey(GLOBAL_FACTS_AGENT_TASK_KEY, payload) }),
      });
    },
    startContentGeneration(payload) {
      const technicalPlan = getTechnicalPlanStore(getProjectId(payload)).loadTechnicalPlan();
      if (!technicalPlan.outlineWordControlSnapshot) {
        throw new Error('当前目录没有字数控制生效快照，请重新生成目录');
      }
      return startManagedTask('content-generation', payload, runContentGenerationTask);
    },
    pauseContentGeneration(payload = {}) {
      const taskKey = getTaskKey('content-generation', payload);
      const task = activeTasks.get(taskKey);
      const control = activeTaskControls.get(taskKey);
      if (task && isActiveTaskStatus(task.status) && control?.requestPause) {
        if (control.queueScopeId && aiService?.pauseQueueScope) {
          aiService.pauseQueueScope(control.queueScopeId);
        }
        return control.requestPause();
      }

      const technicalPlan = getTechnicalPlanStore(getProjectId(payload)).loadTechnicalPlan() || {};
      const contentTask = technicalPlan.contentGenerationTask;
      if (contentTask?.status === 'paused' || contentTask?.status === 'pausing') {
        return contentTask;
      }

      throw new Error('当前没有正在生成的正文任务。');
    },
    pauseFeasibilityContent(payload = {}) {
      const taskKey = getTaskKey('feasibility-content', payload);
      const task = activeTasks.get(taskKey);
      const control = activeTaskControls.get(taskKey);
      if (task && isActiveTaskStatus(task.status) && control?.requestPause) {
        if (control.queueScopeId && aiService?.pauseQueueScope) {
          aiService.pauseQueueScope(control.queueScopeId);
        }
        return control.requestPause();
      }

      const report = feasibilityReportStore?.loadFeasibilityReport?.() || {};
      const contentTask = report.contentTask;
      if (contentTask?.status === 'paused' || contentTask?.status === 'pausing') {
        return contentTask;
      }

      throw new Error('当前没有正在生成的可研正文任务。');
    },
    startRejectionItemsExtraction(payload) {
      return startManagedTask('rejection-items-extraction', payload, runRejectionItemsExtractionTask, payload?.workspaceState || {});
    },
    startRejectionCheck(payload) {
      return startManagedTask('rejection-check-run', payload, runRejectionCheckTask, payload?.workspaceState || {});
    },
    startDuplicateAnalysis(payload) {
      if (!duplicateCheckService?.runAnalysisTask) {
        throw new Error('标书查重任务服务尚未初始化');
      }
      return startManagedTask('duplicate-analysis', payload, duplicateCheckService.runAnalysisTask);
    },
    startFeasibilityAnalysis(payload) {
      return startManagedTask('feasibility-analysis', payload, runFeasibilityAnalysisTask, {
        outlineData: null,
        keyParametersMarkdown: '',
        outlineTask: null,
        outlineAdjustmentTask: null,
        parametersTask: null,
        contentTask: null,
        humanWritingTask: null,
      });
    },
    startFeasibilityOutline(payload) {
      return startManagedTask('feasibility-outline', payload, runFeasibilityOutlineTask, {
        outlineTemplate: payload?.outlineTemplate,
        targetWords: payload?.targetWords,
        referenceDocumentIds: payload?.referenceDocumentIds,
        outlineData: null,
        keyParametersMarkdown: '',
        outlineAdjustmentTask: null,
        parametersTask: null,
        contentTask: null,
        humanWritingTask: null,
      }, {
        primarySession: true,
        beforeStart: () => agentService.deletePersistentTask(FEASIBILITY_OUTLINE_AGENT_TASK_KEY),
      });
    },
    startFeasibilityOutlineAdjustment(payload) {
      return startManagedTask('feasibility-outline-adjustment', payload, runFeasibilityOutlineAdjustmentTask, {}, {
        primarySession: agentService.isPrimarySession({ task_key: FEASIBILITY_OUTLINE_AGENT_TASK_KEY }),
      });
    },
    startFeasibilityParameters(payload) {
      return startManagedTask('feasibility-parameters', payload, runFeasibilityParametersTask, {
        contentTask: null,
        humanWritingTask: null,
      });
    },
    startFeasibilityContent(payload) {
      const incremental = Boolean(payload?.onlyMissing || payload?.resume);
      if (incremental) {
        return startManagedTask('feasibility-content', payload, runFeasibilityContentTask, {});
      }
      const report = feasibilityReportStore?.loadFeasibilityReport?.() || {};
      const initialPartial = { humanWritingTask: null };
      if (report.outlineData?.outline?.length) {
        initialPartial.outlineData = {
          ...report.outlineData,
          outline: clearContent(report.outlineData.outline),
        };
      }
      return startManagedTask('feasibility-content', payload, runFeasibilityContentTask, initialPartial);
    },
    startFeasibilityHumanWriting(payload) {
      return startManagedTask('feasibility-human-writing', payload, runFeasibilityHumanWritingTask);
    },
    confirmOutlineSelection(payload) {
      const control = activeTaskControls.get(getTaskKey('outline-generation', payload));
      if (!control?.confirmOutlineSelection) throw new Error('当前没有等待确认的一级目录任务');
      return control.confirmOutlineSelection(payload);
    },
    suppressOutlineSelectionAutoConfirmation(payload) {
      const control = activeTaskControls.get(getTaskKey('outline-generation', payload));
      if (!control?.suppressOutlineSelectionAutoConfirmation) return { success: true };
      return control.suppressOutlineSelectionAutoConfirmation(payload);
    },
    async resetTechnicalPlan(projectId) {
      const target = getProjectScopedTechnicalPlanStore(projectId, '重置技术方案');
      await cancelTechnicalPlanTasks('技术方案已重置，后台任务已取消', undefined, target.projectId);
      // 空闲常驻的 openxml 助手不在任务取消范围内,重置前显式关掉,确保没有进程握着招标原件
      await openXmlHelperService.close?.();
      return target.store.clearTechnicalPlan();
    },
    async cancelProjectTasks(projectId) {
      const targetProjectId = requireProjectId(projectId, '取消标书项目任务');
      return cancelTechnicalPlanTasks('标书项目已删除，后台任务已取消', undefined, targetProjectId);
    },
    async importTenderDocument(filePaths, projectId) {
      const target = getProjectScopedTechnicalPlanStore(projectId, '导入招标文件');
      const store = target.store;
      return store.importTenderDocument(filePaths, {
        beforeCommit: async () => {
          await cancelTechnicalPlanTasks('招标文件已更新，后台任务已取消', undefined, target.projectId);
          await openXmlHelperService.close?.();
        },
      });
    },
    async removeTenderDocument(sourceId, projectId) {
      const target = getProjectScopedTechnicalPlanStore(projectId, '删除招标文件');
      const store = target.store;
      return store.removeTenderDocument(sourceId, {
        beforeCommit: async () => {
          await cancelTechnicalPlanTasks('招标文件已更新，后台任务已取消', undefined, target.projectId);
          await openXmlHelperService.close?.();
        },
      });
    },
    async importOriginalPlanDocument(filePaths, projectId) {
      const target = getProjectScopedTechnicalPlanStore(projectId, '导入原方案');
      return target.store.importOriginalPlanDocument(filePaths, {
        beforeCommit: () => cancelTechnicalPlanTasks(
          '原方案已更新，后台任务已取消',
          originalPlanDownstreamTaskTypes,
          target.projectId,
        ),
      });
    },
    async resetRejectionCheck() {
      await cancelRejectionCheckTasks('废标项检查已重置，后台任务已取消');
      return rejectionCheckStore.clearRejectionCheck();
    },
    importRejectionCheckDocument(role, filePaths) {
      const documentRole = role === 'bid' ? 'bid' : 'tender';
      return rejectionCheckStore.importDocument(role, filePaths, {
        beforeCommit: () => cancelRejectionCheckTasks(
          documentRole === 'bid' ? '投标文件已更新，后台任务已取消' : '招标文件已更新，后台任务已取消',
          documentRole === 'bid' ? ['rejection-check-run'] : undefined,
        ),
      });
    },
    importRejectionCheckTenderFromTechnicalPlan() {
      return rejectionCheckStore.importTenderFromTechnicalPlan({
        beforeCommit: () => cancelRejectionCheckTasks('招标文件已更新，后台任务已取消'),
      });
    },
    removeRejectionCheckDocument(role, documentId) {
      const documentRole = role === 'bid' ? 'bid' : 'tender';
      return rejectionCheckStore.removeDocument(role, documentId, {
        beforeCommit: () => cancelRejectionCheckTasks(
          documentRole === 'bid' ? '投标文件已更新，后台任务已取消' : '招标文件已更新，后台任务已取消',
          documentRole === 'bid' ? ['rejection-check-run'] : undefined,
        ),
      });
    },
    async resetFeasibilityReport() {
      await cancelFeasibilityReportTasks('可研报告已重置，后台任务已取消');
      return feasibilityReportStore.clearFeasibilityReport();
    },
    importFeasibilitySourceDocuments(filePaths) {
      return feasibilityReportStore.importSourceDocuments(filePaths, {
        beforeCommit: () => cancelFeasibilityReportTasks('可研资料已更新，后台任务已取消'),
      });
    },
    removeFeasibilitySourceDocument(sourceId) {
      return feasibilityReportStore.removeSourceDocument(sourceId, {
        beforeCommit: () => cancelFeasibilityReportTasks('可研资料已更新，后台任务已取消'),
      });
    },
    async saveFeasibilityProjectInfo(projectInfo) {
      await cancelFeasibilityReportTasks('项目信息已更新，后台任务已取消');
      return feasibilityReportStore.saveProjectInfo(projectInfo, { clearDownstream: true });
    },
    async saveFeasibilityAnalysis(markdown) {
      await cancelFeasibilityReportTasks('资料分析已更新，后台任务已取消');
      return feasibilityReportStore.saveAnalysis(markdown);
    },
    async saveFeasibilityOutline(payload) {
      await cancelFeasibilityReportTasks('报告目录已更新，后台任务已取消');
      return feasibilityReportStore.saveOutline(payload);
    },
    async saveFeasibilityKeyParameters(markdown) {
      await cancelFeasibilityReportTasks('关键参数已更新，后台任务已取消');
      return feasibilityReportStore.saveKeyParameters(markdown);
    },
    getActiveTasks() {
      return Array.from(activeTasks.values()).map(snapshotTask);
    },
  };
}

module.exports = { createTaskService };
