import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DocumentAnalysisPage from './DocumentAnalysisPage';
import BidAnalysisPage from './BidAnalysisPage';
import OutlineEditPage from './OutlineEditPage';
import GlobalFactsPage from './GlobalFactsPage';
import ContentEditPage from './ContentEditPage';
import WordExportDialog from '../../export-format/components/WordExportDialog';
import { useTechnicalPlanWorkflow } from '../hooks/useTechnicalPlanWorkflow';
import { bidAnalysisTasks, getBidAnalysisTasks, isMissingBidAnalysisResult } from '../services/bidAnalysisWorkflow';
import { trackPageView } from '../../../shared/analytics/analytics';
import { AppDialog, ToolbarArrowLeftIcon, ToolbarArrowRightIcon, ToolbarDocumentIcon, ToolbarHomeIcon, useToast } from '../../../shared/ui';
import type { FloatingToolbarAction } from '../../../shared/ui';
import type { BackgroundTaskState, BidAnalysisTasks, ContentGenerationOptions, GlobalFactGroupState, GlobalFactsMode, RemoteKnowledgeScope, SaveOutlineRequest, SaveOutlineSelectionRequest, TechnicalPlanState, TechnicalPlanStep, TechnicalPlanWorkflowKind } from '../types';
import { DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS } from '../../../shared/types';
import type { OutlineData, OutlineItem, OutlineWordControlOptions } from '../../../shared/types';
import type { SectionId } from '../../../shared/types/navigation';
import { showRemoteKnowledgeDecision } from '../../../shared/navigation/appNavigation';
import { countReadableWords } from '../../../shared/utils/wordCount';
import { hasGeneratedContent } from '../../export-format/services/wordExportUi';
import { getQuickConfigMissingItems, isQuickConfigComplete, isValidCustomPageCount, resolvePageLadderKey } from '../services/quickConfig';
import type { BidProject } from '../../bid-project/types';

interface TechnicalPlanHomeProps {
  workflowKind: TechnicalPlanWorkflowKind;
  projectId?: string;
  registerLeaveGuard?: (guard: ((nextSection?: string) => Promise<boolean>) | null) => void;
  onSectionChange?: (section: SectionId) => void;
}

interface OutlineSortGuard {
  hasUnsavedSort: () => boolean;
  saveSort: () => Promise<void>;
  discardSort: () => void;
}

interface WordControlWarningMetric {
  label: string;
  expected: string;
  actual: string;
}

interface WordControlWarningSection {
  id: string;
  title: string;
  words: number;
}

interface WordControlWarningDialogState {
  taskId: string;
  title: string;
  message: string;
  metrics: WordControlWarningMetric[];
  sections: WordControlWarningSection[];
}

const steps: TechnicalPlanStep[] = [
  'document-analysis',
  'bid-analysis',
  'outline-generation',
  'global-facts',
  'content-edit',
  'expand',
];

const stepLabels: Record<TechnicalPlanStep, string> = {
  'document-analysis': '选择标书',
  'bid-analysis': '招标文件解析',
  'outline-generation': '目录生成',
  'global-facts': '全局事实设定',
  'content-edit': '生成正文',
  expand: '扩写改写',
};

const resetState = {
  workflowKind: 'technical-plan' as TechnicalPlanWorkflowKind,
  step: 'document-analysis' as TechnicalPlanStep,
  tenderFile: null,
  tenderFiles: [],
  originalPlanFile: null,
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key' as const,
  bidAnalysisSelectedTaskIds: [] as string[],
  bidAnalysisTasks: {},
  bidAnalysisProgress: 0,
  bidSectionMode: 'single' as const,
  bidSections: [],
  bidSectionExtractionStatus: 'idle' as const,
  bidSectionExtractionError: undefined,
  outlineMode: 'standalone-technical' as const,
  outlineExpansionMode: 'ai-complement' as const,
  outlineWordControlOptions: { ...DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS },
  outlineWordControlSnapshot: undefined,
  referenceKnowledgeDocumentIds: [] as string[],
  remoteKnowledgeScopes: [],
  bidSectionExtractionTask: undefined,
  bidAnalysisTask: undefined,
  outlineGenerationTask: undefined,
  outlineAdjustmentTask: undefined,
  globalFactsMode: 'fabricate' as GlobalFactsMode,
  globalFactsTask: undefined,
  globalFactsAdjustmentTask: undefined,
  globalFacts: [] as GlobalFactGroupState[],
  contentGenerationTask: undefined,
  contentGenerationOptions: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  contentIllustrationPlan: undefined,
  contentGenerationRuntime: undefined,
  bidTemplateExists: false,
  outlineData: null,
};

function collectLeafItems(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => item.children?.length ? collectLeafItems(item.children) : [item]);
}

function isOutlineLeafCountOutsideRange(outlineData: OutlineData, options: OutlineWordControlOptions) {
  if (options.minimumWords === 0 && options.maximumWords === 0) return false;
  const effectiveSectionWords = options.sectionWords > 0 ? options.sectionWords : 1500;
  const leafCount = collectLeafItems(outlineData.outline || []).filter((item) => item.content_mode === 'ai-generate').length;
  const minimumLeafCount = options.minimumWords > 0 ? Math.ceil(options.minimumWords / effectiveSectionWords) : null;
  const maximumLeafCount = options.maximumWords > 0 ? Math.floor(options.maximumWords / effectiveSectionWords) : null;
  return (minimumLeafCount !== null && leafCount < minimumLeafCount)
    || (maximumLeafCount !== null && leafCount > maximumLeafCount);
}

const MAX_UI_TASK_LOGS = 80;
const requiredBidAnalysisTasks = getBidAnalysisTasks('key');

function hasOwnField<T extends object>(value: T, field: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function trimTaskLogs(task?: BackgroundTaskState): BackgroundTaskState | undefined {
  if (!task?.logs || task.logs.length <= MAX_UI_TASK_LOGS) {
    return task;
  }

  return { ...task, logs: task.logs.slice(-MAX_UI_TASK_LOGS) };
}

function formatCountRange(minimum: number, maximum: number, unit: string) {
  if (minimum > 0 && maximum > 0) return `${minimum.toLocaleString('zh-CN')} 至 ${maximum.toLocaleString('zh-CN')} ${unit}`;
  if (minimum > 0) return `不少于 ${minimum.toLocaleString('zh-CN')} ${unit}`;
  if (maximum > 0) return `不超过 ${maximum.toLocaleString('zh-CN')} ${unit}`;
  return '未限制';
}

// 根据任务最终统计构建需要用户处理的字数警告弹窗。
function buildWordControlWarningDialog(task: BackgroundTaskState, state: TechnicalPlanState): WordControlWarningDialogState | null {
  const outlineStats = task.stats?.outline;
  if (outlineStats?.word_adjustment_warning && outlineStats.word_adjustment_warning_kind === 'quality') {
    return {
      taskId: task.task_id,
      title: '目录已生成，建议人工核对',
      message: outlineStats.word_adjustment_warning,
      metrics: [],
      sections: [],
    };
  }

  const contentStats = task.stats?.content;
  if (!contentStats?.word_control_warning) return null;

  const minimumWords = contentStats.minimum_words || 0;
  const maximumWords = contentStats.maximum_words || 0;
  const sectionWords = contentStats.section_words || 0;
  const sectionMinimumWords = sectionWords > 0 ? Math.ceil(sectionWords * 0.8) : 0;
  const sectionMaximumWords = sectionWords > 0 ? Math.floor(sectionWords * 1.2) : 0;
  const orderedLeaves = state.outlineData?.outline?.length
    ? collectLeafItems(state.outlineData.outline).filter((item) => item.content_mode === 'ai-generate')
    : [];
  const sectionSources = orderedLeaves.length
    ? orderedLeaves.map((item) => ({
        id: item.id,
        title: item.title || state.contentGenerationSections[item.id]?.title || '未命名章节',
        status: state.contentGenerationSections[item.id]?.status,
        content: state.contentGenerationSections[item.id]?.content ?? item.content ?? '',
      }))
    : Object.values(state.contentGenerationSections);
  const sections = contentStats.strict_section_words && sectionWords > 0
    ? sectionSources
        .filter((section) => section.status === 'success')
        .map((section) => ({ ...section, words: countReadableWords(section.content) }))
        .filter((section) => section.words < sectionMinimumWords || section.words > sectionMaximumWords)
        .map(({ id, title, words }) => ({ id, title, words }))
    : [];
  const metrics: WordControlWarningMetric[] = [];
  if (minimumWords > 0 || maximumWords > 0) {
    metrics.push({
      label: '全文字数',
      expected: formatCountRange(minimumWords, maximumWords, '字'),
      actual: `${(contentStats.current_words || 0).toLocaleString('zh-CN')} 字`,
    });
  }
  if (contentStats.strict_section_words && sectionWords > 0) {
    metrics.push({
      label: '单个小节',
      expected: `${sectionMinimumWords.toLocaleString('zh-CN')} 至 ${sectionMaximumWords.toLocaleString('zh-CN')} 字（目标 ${sectionWords.toLocaleString('zh-CN')} 字）`,
      actual: `${sections.length.toLocaleString('zh-CN')} 个小节未达标`,
    });
  }

  return {
    taskId: task.task_id,
    title: '正文字数未达到预期',
    message: contentStats.word_control_warning,
    metrics,
    sections,
  };
}

function areRequiredBidAnalysisTasksReady(tasks: BidAnalysisTasks) {
  return requiredBidAnalysisTasks.every((task) => {
    const state = tasks[task.id];
    return state?.status === 'success' && state.content.trim();
  });
}

function workflowLabel(kind: TechnicalPlanWorkflowKind) {
  return kind === 'existing-plan-expansion' ? '已有方案扩写' : '生成技术方案';
}

function updateOutlineItemContent(items: OutlineItem[], itemId: string, content: string): OutlineItem[] {
  return items.map((item) => {
    if (item.id === itemId) {
      return { ...item, content };
    }

    return item.children?.length
      ? { ...item, children: updateOutlineItemContent(item.children, itemId, content) }
      : item;
  });
}

function hasTechnicalPlanDownstreamData(state: TechnicalPlanState) {
  const hasBidAnalysisData = Object.values(state.bidAnalysisTasks || {}).some((item) => (
    Boolean(item?.content?.trim()) || item?.status === 'success'
  ));
  const hasOutlineData = Boolean(state.outlineData?.outline?.length);
  const hasTasks = [
    state.bidAnalysisTask,
    state.outlineGenerationTask,
    state.outlineAdjustmentTask,
    state.globalFactsTask,
    state.globalFactsAdjustmentTask,
    state.contentGenerationTask,
  ].some(Boolean);

  return hasBidAnalysisData
    || Boolean(state.projectOverview.trim() || state.techRequirements.trim())
    || hasOutlineData
    || state.globalFacts.length > 0
    || Object.keys(state.contentGenerationSections || {}).length > 0
    || Object.keys(state.contentGenerationPlans || {}).length > 0
    || hasTasks;
}

function TechnicalPlanHome({ workflowKind, projectId, registerLeaveGuard, onSectionChange }: TechnicalPlanHomeProps) {
  const { hydrated, state, setState } = useTechnicalPlanWorkflow(projectId);
  const { showToast } = useToast();
  const [tenderMarkdown, setTenderMarkdown] = useState('');
  const [tenderMarkdownLoading, setTenderMarkdownLoading] = useState(false);
  const [tenderMarkdownError, setTenderMarkdownError] = useState('');
  const [customPageState, setCustomPageState] = useState({ selected: false, draft: '0' });
  const tenderMarkdownVersionRef = useRef<string | null>(null);
  const tenderMarkdownRequestRef = useRef(0);
  const tenderFileVersion = state.tenderFile ? state.tenderFile.contentHash || state.tenderFile.updatedAt : null;
  const tenderMarkdownStepActive = state.step === 'document-analysis' || state.step === 'outline-generation';
  const [originalPlanMarkdown, setOriginalPlanMarkdown] = useState('');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [sortLeaveDialogOpen, setSortLeaveDialogOpen] = useState(false);
  const [wordControlWarningDialog, setWordControlWarningDialog] = useState<WordControlWarningDialogState | null>(null);
  const [pendingWordControlWarningTaskId, setPendingWordControlWarningTaskId] = useState<string | null>(null);
  const [savingSortBeforeLeave, setSavingSortBeforeLeave] = useState(false);
  const [bidAnalysisFocusRequest, setBidAnalysisFocusRequest] = useState<{ taskId: string } | null>(null);
  const [globalFactsFocusRequest, setGlobalFactsFocusRequest] = useState<{ groupId: string } | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [bidProject, setBidProject] = useState<BidProject | null>(null);
  const sortGuardRef = useRef<OutlineSortGuard | null>(null);
  const sortLeaveResolverRef = useRef<((allowed: boolean) => void) | null>(null);
  const shownWordControlWarningTaskIdsRef = useRef(new Set<string>());
  const projectPayload = projectId ? { projectId } : undefined;
  const handleCustomPageStateChange = useCallback((next: { selected: boolean; draft: string }) => {
    setCustomPageState((previous) => (
      previous.selected === next.selected && previous.draft === next.draft ? previous : next
    ));
  }, []);
  const activeIndex = steps.indexOf(state.step);
  const requiredBidAnalysisReady = areRequiredBidAnalysisTasksReady(state.bidAnalysisTasks);
  const isBidSectionExtractionRunning = state.bidSectionExtractionTask?.status === 'running' || state.bidSectionExtractionTask?.status === 'pausing';
  const isBidAnalysisTaskRunning = state.bidAnalysisTask?.status === 'running' || state.bidAnalysisTask?.status === 'pausing';
  const selectedBidSectionValid = state.bidSectionMode !== 'multiple'
    || Boolean(state.tenderFile?.selectedSectionId && state.bidSections.some((section) => section.id === state.tenderFile?.selectedSectionId));
  const bidSectionReady = state.bidSectionMode !== 'multiple'
    || (state.bidSectionExtractionStatus === 'success' && !isBidSectionExtractionRunning && selectedBidSectionValid);
  const bidAnalysisReady = requiredBidAnalysisReady && !isBidAnalysisTaskRunning && bidSectionReady;
  const quickConfigMissingItems = getQuickConfigMissingItems({
    pageLadder: resolvePageLadderKey(state.outlineWordControlOptions),
    bidSectionMode: state.bidSectionMode,
    selectedBidSectionValid,
    contentGenerationOptions: state.contentGenerationOptions,
  });
  const quickConfigComplete = isQuickConfigComplete({
    pageLadder: resolvePageLadderKey(state.outlineWordControlOptions),
    bidSectionMode: state.bidSectionMode,
    selectedBidSectionValid,
    contentGenerationOptions: state.contentGenerationOptions,
  });
  const firstMissingBidAnalysisTask = bidAnalysisTasks.find((task) => (
    state.bidAnalysisSelectedTaskIds.includes(task.id)
    && isMissingBidAnalysisResult(task, state.bidAnalysisTasks[task.id]?.content)
  ));
  const globalFactsReady = state.globalFacts.length > 0 && state.globalFactsTask?.status === 'success';
  const firstGlobalFactWithPlaceholder = state.globalFacts.find((group) => `${group.title || ''}${group.content || ''}`.includes('【待填写】'));
  const globalFactsHasPlaceholder = Boolean(firstGlobalFactWithPlaceholder);
  const isGlobalFactsAdjusting = state.globalFactsAdjustmentTask?.status === 'running' || state.globalFactsAdjustmentTask?.status === 'pausing';
  const contentTaskStatus = state.contentGenerationTask?.status;
  const isContentGenerating = contentTaskStatus === 'running' || contentTaskStatus === 'pausing';
  const isContentPaused = contentTaskStatus === 'paused';
  const hasDownstreamData = hasTechnicalPlanDownstreamData(state);
  const requiresOriginalPlan = workflowKind === 'existing-plan-expansion';
  const isNextDisabled = activeIndex >= steps.length - 1
    || (state.step === 'document-analysis' && (!state.tenderFile || (requiresOriginalPlan && !state.originalPlanFile) || !quickConfigComplete))
    || (state.step === 'bid-analysis' && !bidAnalysisReady)
    || (state.step === 'outline-generation' && (!state.outlineData || !state.outlineWordControlSnapshot))
    || (state.step === 'global-facts' && (!globalFactsReady || isGlobalFactsAdjusting));
  const nextTooltip = (() => {
    if (state.step === 'document-analysis' && !state.tenderFile) {
      return '上传完招标文件后才能进入下一步';
    }
    if (state.step === 'document-analysis' && requiresOriginalPlan && !state.originalPlanFile) {
      return '上传完原方案后才能进入下一步';
    }
    if (state.step === 'document-analysis' && !quickConfigComplete) {
      return `请先完成快速配置：${quickConfigMissingItems.join('、')}`;
    }
    if (state.step === 'bid-analysis' && isBidSectionExtractionRunning) {
      return '多标段识别任务仍在运行，请等待当前任务结束';
    }
    if (state.step === 'bid-analysis' && state.bidSectionMode === 'multiple' && state.bidSectionExtractionStatus === 'error') {
      return '请重新识别标段或切回单标段';
    }
    if (state.step === 'bid-analysis' && state.bidSectionMode === 'multiple' && !selectedBidSectionValid) {
      return '请先选择本次投标范围';
    }
    if (state.step === 'bid-analysis' && isBidAnalysisTaskRunning) {
      return '招标文件解析任务仍在运行，请等待当前任务结束';
    }
    if (state.step === 'bid-analysis' && firstMissingBidAnalysisTask) {
      return `${firstMissingBidAnalysisTask.label}未提取到有效内容，点击后定位到该项`;
    }
    if (state.step === 'bid-analysis' && !requiredBidAnalysisReady) {
      return '招标文件解析完成后才能进入目录生成';
    }
    if (state.step === 'outline-generation' && !state.outlineData) {
      return '目录生成完成后才能进入全局事实设定';
    }
    if (state.step === 'outline-generation' && !state.outlineWordControlSnapshot) {
      return '当前目录缺少字数控制生效配置，请重新生成目录';
    }
    if (state.step === 'global-facts' && isGlobalFactsAdjusting) {
      return '全局事实正在 AI 调整，请等待结束后再进入正文生成';
    }
    if (state.step === 'global-facts' && !globalFactsReady) {
      return '全局事实设定完成后才能进入正文生成';
    }
    if (state.step === 'global-facts' && globalFactsHasPlaceholder) {
      return '请先将【待填写】替换为实际内容后再进入正文生成';
    }
    if (activeIndex >= steps.length - 1) {
      return '当前已经是最后一步';
    }
    return `进入${stepLabels[steps[activeIndex + 1]]}`;
  })();

  const resolveSortLeave = (allowed: boolean) => {
    sortLeaveResolverRef.current?.(allowed);
    sortLeaveResolverRef.current = null;
    setSortLeaveDialogOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setBidProject(null);
      return () => { cancelled = true; };
    }
    window.yibiao?.bidProject.get(projectId)
      .then((project) => {
        if (!cancelled) setBidProject(project);
      })
      .catch(() => {
        if (!cancelled) setBidProject(null);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const confirmSortLeaveOnly = useCallback(async () => {
    const guard = sortGuardRef.current;
    if (!guard?.hasUnsavedSort()) {
      return true;
    }

    setSortLeaveDialogOpen(true);
    return new Promise<boolean>((resolve) => {
      sortLeaveResolverRef.current = resolve;
    });
  }, []);

  const continueSorting = () => {
    resolveSortLeave(false);
  };

  const discardSortAndLeave = () => {
    sortGuardRef.current?.discardSort();
    resolveSortLeave(true);
  };

  const saveSortAndLeave = async () => {
    const guard = sortGuardRef.current;
    if (!guard) {
      resolveSortLeave(true);
      return;
    }

    try {
      setSavingSortBeforeLeave(true);
      await guard.saveSort();
      resolveSortLeave(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存排序失败', 'error');
    } finally {
      setSavingSortBeforeLeave(false);
    }
  };

  useEffect(() => {
    if (!hydrated) return;

    trackPageView(`${workflowKind}/${state.step}`);
  }, [hydrated, projectId, state.step, workflowKind]);

  useEffect(() => {
    if (!hydrated || wordControlWarningDialog) return;
    const currentStepTask = state.step === 'outline-generation'
      ? state.outlineGenerationTask
      : state.step === 'content-edit'
        ? state.contentGenerationTask
        : undefined;
    const task = pendingWordControlWarningTaskId
      ? [state.outlineGenerationTask, state.contentGenerationTask]
          .find((candidate) => candidate?.task_id === pendingWordControlWarningTaskId)
      : currentStepTask;
    if (!task || task.status !== 'success' || shownWordControlWarningTaskIdsRef.current.has(task.task_id)) return;
    const dialog = buildWordControlWarningDialog(task, state);
    if (!dialog) return;
    shownWordControlWarningTaskIdsRef.current.add(task.task_id);
    setPendingWordControlWarningTaskId(null);
    setWordControlWarningDialog(dialog);
  }, [hydrated, pendingWordControlWarningTaskId, state, wordControlWarningDialog]);

  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(confirmSortLeaveOnly);
    return () => registerLeaveGuard(null);
  }, [confirmSortLeaveOnly, registerLeaveGuard]);

  const switchStep = async (step: TechnicalPlanStep) => {
    if (step === state.step) {
      return;
    }
    if (
      state.step === 'document-analysis'
      && step === 'bid-analysis'
      && customPageState.selected
      && !isValidCustomPageCount(customPageState.draft)
    ) {
      showToast('请输入大于 0 的整数页数', 'error');
      return;
    }
    if (state.step === 'bid-analysis' && step === 'outline-generation' && firstMissingBidAnalysisTask) {
      setBidAnalysisFocusRequest({ taskId: firstMissingBidAnalysisTask.id });
      showToast(`“${firstMissingBidAnalysisTask.label}”自动重试后仍未提取到有效内容，请重新解析该项后再进入下一步`, 'info');
      return;
    }
    if (state.step === 'global-facts' && step === 'content-edit' && firstGlobalFactWithPlaceholder) {
      setGlobalFactsFocusRequest({ groupId: firstGlobalFactWithPlaceholder.id });
      showToast('存在待填写，请您改为真实数据后再继续', 'info');
      return;
    }
    const allowed = await confirmSortLeaveOnly();
    if (!allowed) {
      return;
    }

    if (state.step === 'outline-generation' && step === 'global-facts') {
      const latestState = await window.yibiao!.technicalPlan.loadState(projectPayload);
      setState((prev) => ({ ...prev, ...latestState }));
      const finalOutlineData = latestState.outlineData;
      const snapshot = latestState.outlineWordControlSnapshot;
      if (finalOutlineData && !snapshot) {
        showToast('当前目录缺少字数控制生效配置，请重新生成目录后再进入下一步', 'info');
        return;
      }
    }

    setState((prev) => ({ ...prev, step }));
    window.yibiao?.technicalPlan.updateStep({ step, ...(projectId ? { projectId } : {}) }).catch((error) => {
      showToast(error instanceof Error ? error.message : '保存技术方案步骤失败', 'error');
    });
  };

  const goToOffset = async (offset: number) => {
    const nextStep = steps[activeIndex + offset];
    if (nextStep) {
      await switchStep(nextStep);
    }
  };

  useEffect(() => {
    if (!window.yibiao?.tasks) {
      return;
    }

    const unsubscribe = window.yibiao.tasks.onTaskEvent<typeof state>((event) => {
      const eventProjectId = event.task.project_id || event.task.projectId || event.task.scope_id;
      if (projectId && eventProjectId !== projectId) return;
      const taskType = (event.task as { type?: string } | undefined)?.type;
      const latestTask = trimTaskLogs(event.task as BackgroundTaskState | undefined);
      const technicalPlan = event.technicalPlanPatch || event.technicalPlan;

      if (!technicalPlan) {
        return;
      }

      if (latestTask?.status === 'success' && !shownWordControlWarningTaskIdsRef.current.has(latestTask.task_id)) {
        const warning = latestTask.stats?.outline?.word_adjustment_warning_kind === 'quality'
          ? latestTask.stats.outline.word_adjustment_warning
          : latestTask.stats?.content?.word_control_warning;
        if (warning) {
          setPendingWordControlWarningTaskId(latestTask.task_id);
        }
      }

      setState((prev) => {
        if (taskType === 'bid-section-extraction') {
          return {
            ...prev,
            bidSectionExtractionTask: trimTaskLogs(technicalPlan.bidSectionExtractionTask) || latestTask,
            bidSectionMode: technicalPlan.bidSectionMode ?? prev.bidSectionMode,
            bidSections: Array.isArray(technicalPlan.bidSections) ? technicalPlan.bidSections : prev.bidSections,
            bidSectionExtractionStatus: technicalPlan.bidSectionExtractionStatus ?? prev.bidSectionExtractionStatus,
            bidSectionExtractionError: technicalPlan.bidSectionExtractionError ?? prev.bidSectionExtractionError,
            tenderFile: technicalPlan.tenderFile ?? prev.tenderFile,
            bidAnalysisTask: hasOwnField(technicalPlan, 'bidAnalysisTask') ? trimTaskLogs(technicalPlan.bidAnalysisTask) : prev.bidAnalysisTask,
            bidAnalysisTasks: hasOwnField(technicalPlan, 'bidAnalysisTasks') ? (technicalPlan.bidAnalysisTasks || {}) : prev.bidAnalysisTasks,
            bidAnalysisProgress: technicalPlan.bidAnalysisProgress ?? prev.bidAnalysisProgress,
            projectOverview: technicalPlan.projectOverview ?? prev.projectOverview,
            techRequirements: technicalPlan.techRequirements ?? prev.techRequirements,
            outlineData: hasOwnField(technicalPlan, 'outlineData') ? (technicalPlan.outlineData || null) : prev.outlineData,
            outlineWordControlSnapshot: hasOwnField(technicalPlan, 'outlineWordControlSnapshot') ? technicalPlan.outlineWordControlSnapshot : prev.outlineWordControlSnapshot,
            outlineGenerationTask: hasOwnField(technicalPlan, 'outlineGenerationTask') ? trimTaskLogs(technicalPlan.outlineGenerationTask) : prev.outlineGenerationTask,
            referenceKnowledgeDocumentIds: Array.isArray(technicalPlan.referenceKnowledgeDocumentIds) ? technicalPlan.referenceKnowledgeDocumentIds : prev.referenceKnowledgeDocumentIds,
            remoteKnowledgeScopes: Array.isArray(technicalPlan.remoteKnowledgeScopes) ? technicalPlan.remoteKnowledgeScopes : prev.remoteKnowledgeScopes,
            globalFactsTask: hasOwnField(technicalPlan, 'globalFactsTask') ? trimTaskLogs(technicalPlan.globalFactsTask) : prev.globalFactsTask,
            globalFactsAdjustmentTask: hasOwnField(technicalPlan, 'globalFactsAdjustmentTask') ? trimTaskLogs(technicalPlan.globalFactsAdjustmentTask) : prev.globalFactsAdjustmentTask,
            globalFacts: hasOwnField(technicalPlan, 'globalFacts') ? (technicalPlan.globalFacts || []) : prev.globalFacts,
            contentGenerationTask: hasOwnField(technicalPlan, 'contentGenerationTask') ? trimTaskLogs(technicalPlan.contentGenerationTask) : prev.contentGenerationTask,
            contentGenerationOptions: hasOwnField(technicalPlan, 'contentGenerationOptions') ? technicalPlan.contentGenerationOptions : prev.contentGenerationOptions,
            contentGenerationSections: hasOwnField(technicalPlan, 'contentGenerationSections') ? (technicalPlan.contentGenerationSections || {}) : prev.contentGenerationSections,
            contentGenerationPlans: hasOwnField(technicalPlan, 'contentGenerationPlans') ? (technicalPlan.contentGenerationPlans || {}) : prev.contentGenerationPlans,
            contentIllustrationPlan: hasOwnField(technicalPlan, 'contentIllustrationPlan') ? technicalPlan.contentIllustrationPlan : prev.contentIllustrationPlan,
            contentGenerationRuntime: hasOwnField(technicalPlan, 'contentGenerationRuntime') ? technicalPlan.contentGenerationRuntime : prev.contentGenerationRuntime,
          };
        }

        if (taskType === 'bid-analysis') {
          const outlineDataReset = hasOwnField(technicalPlan, 'outlineData') && technicalPlan.outlineData === null;
          return {
            ...prev,
            bidAnalysisTask: trimTaskLogs(technicalPlan.bidAnalysisTask) || latestTask,
            bidAnalysisMode: technicalPlan.bidAnalysisMode ?? prev.bidAnalysisMode,
            bidAnalysisSelectedTaskIds: Array.isArray(technicalPlan.bidAnalysisSelectedTaskIds)
              ? technicalPlan.bidAnalysisSelectedTaskIds
              : prev.bidAnalysisSelectedTaskIds,
            bidAnalysisTasks: {
              ...prev.bidAnalysisTasks,
              ...(technicalPlan.bidAnalysisTasks || {}),
              ...(event.bidItem ? { [event.bidItem.id]: event.bidItem } : {}),
            },
            bidAnalysisProgress: technicalPlan.bidAnalysisProgress ?? prev.bidAnalysisProgress,
            projectOverview: technicalPlan.projectOverview ?? prev.projectOverview,
            techRequirements: technicalPlan.techRequirements ?? prev.techRequirements,
            outlineGenerationTask: outlineDataReset ? undefined : prev.outlineGenerationTask,
            globalFactsTask: outlineDataReset ? undefined : prev.globalFactsTask,
            globalFactsAdjustmentTask: outlineDataReset ? undefined : prev.globalFactsAdjustmentTask,
            globalFacts: outlineDataReset ? [] : prev.globalFacts,
            contentGenerationTask: outlineDataReset ? undefined : prev.contentGenerationTask,
            contentGenerationOptions: outlineDataReset ? undefined : prev.contentGenerationOptions,
            contentGenerationSections: outlineDataReset ? {} : prev.contentGenerationSections,
            contentGenerationPlans: outlineDataReset ? {} : prev.contentGenerationPlans,
            contentIllustrationPlan: outlineDataReset ? undefined : prev.contentIllustrationPlan,
            contentGenerationRuntime: outlineDataReset ? undefined : prev.contentGenerationRuntime,
            outlineWordControlSnapshot: outlineDataReset ? undefined : prev.outlineWordControlSnapshot,
            outlineData: hasOwnField(technicalPlan, 'outlineData') ? (technicalPlan.outlineData || null) : prev.outlineData,
          };
        }

        if (taskType === 'outline-generation') {
          const hasOutlineData = hasOwnField(technicalPlan, 'outlineData');
          const nextOutlineData = hasOutlineData ? (technicalPlan.outlineData || null) : prev.outlineData;
          const outlineDataChanged = nextOutlineData !== prev.outlineData;

          return {
            ...prev,
            outlineGenerationTask: trimTaskLogs(technicalPlan.outlineGenerationTask) || latestTask,
            outlineMode: technicalPlan.outlineMode ?? prev.outlineMode,
            outlineExpansionMode: technicalPlan.outlineExpansionMode ?? prev.outlineExpansionMode,
            outlineWordControlOptions: technicalPlan.outlineWordControlOptions ?? prev.outlineWordControlOptions,
            outlineWordControlSnapshot: hasOwnField(technicalPlan, 'outlineWordControlSnapshot') ? technicalPlan.outlineWordControlSnapshot : prev.outlineWordControlSnapshot,
            referenceKnowledgeDocumentIds: Array.isArray(technicalPlan.referenceKnowledgeDocumentIds)
              ? technicalPlan.referenceKnowledgeDocumentIds
              : prev.referenceKnowledgeDocumentIds,
            remoteKnowledgeScopes: Array.isArray(technicalPlan.remoteKnowledgeScopes) ? technicalPlan.remoteKnowledgeScopes : prev.remoteKnowledgeScopes,
            outlineData: nextOutlineData,
            globalFactsTask: hasOwnField(technicalPlan, 'globalFactsTask') ? trimTaskLogs(technicalPlan.globalFactsTask) : prev.globalFactsTask,
            globalFactsAdjustmentTask: hasOwnField(technicalPlan, 'globalFactsAdjustmentTask') ? trimTaskLogs(technicalPlan.globalFactsAdjustmentTask) : prev.globalFactsAdjustmentTask,
            globalFacts: hasOwnField(technicalPlan, 'globalFacts') ? (technicalPlan.globalFacts || []) : prev.globalFacts,
            contentGenerationTask: hasOwnField(technicalPlan, 'contentGenerationTask') ? trimTaskLogs(technicalPlan.contentGenerationTask) : (outlineDataChanged ? undefined : prev.contentGenerationTask),
            contentGenerationSections: hasOwnField(technicalPlan, 'contentGenerationSections') ? (technicalPlan.contentGenerationSections || {}) : (outlineDataChanged ? {} : prev.contentGenerationSections),
            contentGenerationPlans: hasOwnField(technicalPlan, 'contentGenerationPlans') ? (technicalPlan.contentGenerationPlans || {}) : (outlineDataChanged ? {} : prev.contentGenerationPlans),
            contentIllustrationPlan: hasOwnField(technicalPlan, 'contentIllustrationPlan') ? technicalPlan.contentIllustrationPlan : (outlineDataChanged ? undefined : prev.contentIllustrationPlan),
            contentGenerationRuntime: hasOwnField(technicalPlan, 'contentGenerationRuntime') ? technicalPlan.contentGenerationRuntime : (outlineDataChanged ? undefined : prev.contentGenerationRuntime),
            bidTemplateExists: hasOwnField(technicalPlan, 'bidTemplateExists') ? Boolean(technicalPlan.bidTemplateExists) : prev.bidTemplateExists,
          };
        }

        if (taskType === 'outline-adjustment') {
          const hasOutlineData = hasOwnField(technicalPlan, 'outlineData');
          return {
            ...prev,
            outlineAdjustmentTask: trimTaskLogs(technicalPlan.outlineAdjustmentTask) || latestTask,
            outlineGenerationTask: hasOwnField(technicalPlan, 'outlineGenerationTask') ? trimTaskLogs(technicalPlan.outlineGenerationTask) : prev.outlineGenerationTask,
            outlineData: hasOutlineData ? (technicalPlan.outlineData || null) : prev.outlineData,
            contentGenerationTask: hasOwnField(technicalPlan, 'contentGenerationTask') ? trimTaskLogs(technicalPlan.contentGenerationTask) : prev.contentGenerationTask,
            contentGenerationSections: hasOwnField(technicalPlan, 'contentGenerationSections') ? (technicalPlan.contentGenerationSections || {}) : prev.contentGenerationSections,
            contentGenerationPlans: hasOwnField(technicalPlan, 'contentGenerationPlans') ? (technicalPlan.contentGenerationPlans || {}) : prev.contentGenerationPlans,
            contentIllustrationPlan: hasOwnField(technicalPlan, 'contentIllustrationPlan') ? technicalPlan.contentIllustrationPlan : prev.contentIllustrationPlan,
            contentGenerationRuntime: hasOwnField(technicalPlan, 'contentGenerationRuntime') ? technicalPlan.contentGenerationRuntime : prev.contentGenerationRuntime,
          };
        }

        if (taskType === 'global-facts-generation') {
          const hasGlobalFacts = hasOwnField(technicalPlan, 'globalFacts');
          return {
            ...prev,
            globalFactsTask: trimTaskLogs(technicalPlan.globalFactsTask) || latestTask,
            globalFactsAdjustmentTask: hasOwnField(technicalPlan, 'globalFactsAdjustmentTask') ? trimTaskLogs(technicalPlan.globalFactsAdjustmentTask) : prev.globalFactsAdjustmentTask,
            globalFacts: hasGlobalFacts ? (technicalPlan.globalFacts || []) : prev.globalFacts,
            contentGenerationTask: hasOwnField(technicalPlan, 'contentGenerationTask') ? trimTaskLogs(technicalPlan.contentGenerationTask) : prev.contentGenerationTask,
            contentGenerationSections: hasOwnField(technicalPlan, 'contentGenerationSections') ? (technicalPlan.contentGenerationSections || {}) : prev.contentGenerationSections,
            contentGenerationPlans: hasOwnField(technicalPlan, 'contentGenerationPlans') ? (technicalPlan.contentGenerationPlans || {}) : prev.contentGenerationPlans,
            contentIllustrationPlan: hasOwnField(technicalPlan, 'contentIllustrationPlan') ? technicalPlan.contentIllustrationPlan : prev.contentIllustrationPlan,
            contentGenerationRuntime: hasOwnField(technicalPlan, 'contentGenerationRuntime') ? technicalPlan.contentGenerationRuntime : prev.contentGenerationRuntime,
          };
        }

        if (taskType === 'global-facts-adjustment') {
          const hasGlobalFacts = hasOwnField(technicalPlan, 'globalFacts');
          return {
            ...prev,
            globalFactsAdjustmentTask: trimTaskLogs(technicalPlan.globalFactsAdjustmentTask) || latestTask,
            globalFacts: hasGlobalFacts ? (technicalPlan.globalFacts || []) : prev.globalFacts,
            contentGenerationTask: hasOwnField(technicalPlan, 'contentGenerationTask') ? trimTaskLogs(technicalPlan.contentGenerationTask) : prev.contentGenerationTask,
            contentGenerationSections: hasOwnField(technicalPlan, 'contentGenerationSections') ? (technicalPlan.contentGenerationSections || {}) : prev.contentGenerationSections,
            contentGenerationPlans: hasOwnField(technicalPlan, 'contentGenerationPlans') ? (technicalPlan.contentGenerationPlans || {}) : prev.contentGenerationPlans,
            contentIllustrationPlan: hasOwnField(technicalPlan, 'contentIllustrationPlan') ? technicalPlan.contentIllustrationPlan : prev.contentIllustrationPlan,
            contentGenerationRuntime: hasOwnField(technicalPlan, 'contentGenerationRuntime') ? technicalPlan.contentGenerationRuntime : prev.contentGenerationRuntime,
          };
        }

        if (taskType === 'content-generation') {
          const hasPatchOutlineData = hasOwnField(technicalPlan, 'outlineData') || hasOwnField(event, 'outlineData');
          const patchOutlineData = hasOwnField(technicalPlan, 'outlineData') ? technicalPlan.outlineData : event.outlineData;
          const contentSection = event.contentSection;
          const nextSections = hasOwnField(technicalPlan, 'contentGenerationSections')
            ? (technicalPlan.contentGenerationSections || {})
            : contentSection
              ? { ...prev.contentGenerationSections, [contentSection.id]: contentSection }
              : prev.contentGenerationSections;
          const nextOutlineData = hasPatchOutlineData
            ? (patchOutlineData || null)
            : contentSection?.content !== undefined && prev.outlineData
              ? { ...prev.outlineData, outline: updateOutlineItemContent(prev.outlineData.outline, contentSection.id, contentSection.content) }
              : prev.outlineData;
          return {
            ...prev,
            contentGenerationTask: latestTask || trimTaskLogs(technicalPlan.contentGenerationTask),
            outlineWordControlSnapshot: hasOwnField(technicalPlan, 'outlineWordControlSnapshot') ? technicalPlan.outlineWordControlSnapshot : prev.outlineWordControlSnapshot,
            outlineMode: technicalPlan.outlineMode ?? prev.outlineMode,
            referenceKnowledgeDocumentIds: Array.isArray(technicalPlan.referenceKnowledgeDocumentIds)
              ? technicalPlan.referenceKnowledgeDocumentIds
              : prev.referenceKnowledgeDocumentIds,
            remoteKnowledgeScopes: Array.isArray(technicalPlan.remoteKnowledgeScopes) ? technicalPlan.remoteKnowledgeScopes : prev.remoteKnowledgeScopes,
            contentGenerationSections: nextSections,
            contentGenerationPlans: hasOwnField(technicalPlan, 'contentGenerationPlans') ? (technicalPlan.contentGenerationPlans || {}) : prev.contentGenerationPlans,
            contentIllustrationPlan: hasOwnField(technicalPlan, 'contentIllustrationPlan') ? technicalPlan.contentIllustrationPlan : prev.contentIllustrationPlan,
            contentGenerationRuntime: hasOwnField(technicalPlan, 'contentGenerationRuntime') ? technicalPlan.contentGenerationRuntime : prev.contentGenerationRuntime,
            outlineData: nextOutlineData,
          };
        }

        return prev;
      });
    });
    window.yibiao.tasks.getActiveTasks().catch((error) => {
      console.warn('获取后台任务状态失败', error);
    });

    return unsubscribe;
  }, [projectId, setState, showToast]);

  const loadTenderMarkdown = useCallback(async (force = true) => {
    if (tenderFileVersion === null) {
      tenderMarkdownRequestRef.current += 1;
      tenderMarkdownVersionRef.current = null;
      setTenderMarkdown('');
      setTenderMarkdownLoading(false);
      setTenderMarkdownError('');
      return;
    }
    if (!tenderMarkdownStepActive || (!force && tenderMarkdownVersionRef.current === tenderFileVersion)) return;

    const requestId = ++tenderMarkdownRequestRef.current;
    setTenderMarkdownLoading(true);
    setTenderMarkdownError('');
    try {
      const markdown = await window.yibiao?.technicalPlan.readTenderMarkdown(projectPayload);
      if (requestId !== tenderMarkdownRequestRef.current) return;
      tenderMarkdownVersionRef.current = tenderFileVersion;
      setTenderMarkdown(markdown || '');
    } catch (error) {
      if (requestId !== tenderMarkdownRequestRef.current) return;
      const message = `读取招标文件 Markdown 失败${error instanceof Error ? `：${error.message}` : '，请重试'}`;
      setTenderMarkdownError(message);
      showToast(message, 'error');
    } finally {
      if (requestId === tenderMarkdownRequestRef.current) setTenderMarkdownLoading(false);
    }
  }, [showToast, tenderFileVersion, tenderMarkdownStepActive]);

  useEffect(() => {
    if (tenderMarkdownVersionRef.current !== tenderFileVersion || tenderFileVersion === null) {
      tenderMarkdownVersionRef.current = null;
      setTenderMarkdown('');
      setTenderMarkdownError('');
    }
    setTenderMarkdownLoading(false);
    if (state.step !== 'document-analysis' && state.step !== 'outline-generation') {
      return;
    }
    void loadTenderMarkdown(false);
    return () => {
      // 只丢弃过期读取结果，不取消 Main 的后台任务。
      tenderMarkdownRequestRef.current += 1;
    };
  }, [loadTenderMarkdown, tenderFileVersion]);

  useEffect(() => {
    if (state.step !== 'document-analysis' || !requiresOriginalPlan) {
      setOriginalPlanMarkdown('');
      return;
    }
    if (!state.originalPlanFile) {
      setOriginalPlanMarkdown('');
      return;
    }
    let mounted = true;
    window.yibiao?.technicalPlan.readOriginalPlanMarkdown(projectPayload).then((markdown) => {
      if (mounted) setOriginalPlanMarkdown(markdown || '');
    }).catch((error) => {
      if (mounted) showToast(error instanceof Error ? error.message : '读取原方案 Markdown 失败', 'error');
    });
    return () => {
      mounted = false;
    };
  }, [requiresOriginalPlan, showToast, state.originalPlanFile, state.step]);

  const saveChapterContent = async (item: OutlineItem, content: string) => {
    if (!state.outlineData?.outline?.length) {
      throw new Error('当前没有可保存的目录');
    }

    const updatedOutlineData = {
      ...state.outlineData,
      outline: updateOutlineItemContent(state.outlineData.outline, item.id, content),
    };
    const updatedSections = {
      ...state.contentGenerationSections,
      [item.id]: {
        id: item.id,
        title: item.title || '未命名章节',
        status: content.trim() ? 'success' as const : 'idle' as const,
        content,
        updated_at: new Date().toISOString(),
      },
    };

    setState((prev) => ({
      ...prev,
      outlineData: updatedOutlineData,
      contentGenerationSections: updatedSections,
    }));
      const saved = await window.yibiao?.technicalPlan.saveChapterContent({ projectId, nodeId: item.id, content });
    if (saved) setState((prev) => ({ ...prev, ...saved }));
  };

  const confirmResetTechnicalPlan = async () => {
    if (isResetting) return;

    setResetDialogOpen(false);
    setIsResetting(true);
    showToast('正在重置技术方案，将停止后台任务并清理工作区文件，请稍候…', 'info');
    try {
      const result = await window.yibiao?.technicalPlan.clear(projectPayload);
      setState({ ...resetState, workflowKind });
      setTenderMarkdown('');
      setOriginalPlanMarkdown('');
      showToast(result?.message || '技术方案已重置', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重置技术方案失败', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  const resetBidSectionDownstream = async () => {
    const result = await window.yibiao?.tasks.resetBidSectionDownstream({ projectId });
    if (!result?.success) {
      throw new Error(result?.message || '重置当前标书失败');
    }
    const latestState = await window.yibiao?.technicalPlan.loadState(projectPayload);
    if (latestState) {
      setState((prev) => ({ ...prev, ...latestState }));
    }
  };

  const saveContentGenerationOptions = async (contentGenerationOptions: ContentGenerationOptions) => {
    const saved = await window.yibiao?.technicalPlan.saveContentGenerationOptions({ projectId, options: contentGenerationOptions });
    setState((prev) => ({ ...prev, ...(saved || {}), contentGenerationOptions }));
  };

  const saveGlobalFacts = async (globalFacts: GlobalFactGroupState[]) => {
    const saved = await window.yibiao?.technicalPlan.saveGlobalFacts({ projectId, globalFacts });
    setState((prev) => ({ ...prev, ...(saved || {}), globalFacts }));
  };

  const saveGlobalFactsConfig = async (globalFactsMode: GlobalFactsMode) => {
    const saved = await window.yibiao?.technicalPlan.saveGlobalFactsConfig({ projectId, globalFactsMode });
    setState((prev) => ({ ...prev, ...(saved || {}), globalFactsMode }));
  };

  const saveOutline = async (request: SaveOutlineRequest) => {
    const saved = await window.yibiao?.technicalPlan.saveOutline({ ...request, projectId });
    setState((prev) => {
      if (request.reason !== 'sort') {
        return { ...prev, ...(saved || {}), outlineData: saved?.outlineData || request.outlineData };
      }
      const contentGenerationSections = Object.fromEntries(Object.entries(prev.contentGenerationSections).map(([nodeId, section]) => {
        const nextId = request.idMap?.[nodeId] || nodeId;
        return [nextId, { ...section, id: nextId }];
      }));
      const contentGenerationPlans = Object.fromEntries(Object.entries(prev.contentGenerationPlans).map(([nodeId, plan]) => [
        request.idMap?.[nodeId] || nodeId,
        plan,
      ]));
      return {
        ...prev,
        ...(saved || {}),
        outlineData: saved?.outlineData || request.outlineData,
        contentGenerationSections,
        contentGenerationPlans,
      };
    });
  };

  const saveOutlineNodeKnowledge = async (nodeId: string, knowledgeFolderIds: string[], knowledgeDocumentIds: string[]) => {
    const saved = await window.yibiao?.technicalPlan.saveOutlineNodeKnowledge({ projectId, nodeId, knowledgeFolderIds, knowledgeDocumentIds });
    setState((prev) => ({ ...prev, ...(saved || {}) }));
  };

  const saveOutlineSelection = async (request: SaveOutlineSelectionRequest) => {
    await window.yibiao?.technicalPlan.saveOutlineSelection({ ...request, projectId });
  };

  const openBidTemplate = async () => {
    const result = await window.yibiao?.technicalPlan.openBidTemplate(projectPayload);
    if (!result?.success) {
      showToast(result?.message || '无法打开投标模版', 'error');
    }
  };

  const saveOutlineConfig = async (config: {
    referenceKnowledgeDocumentIds: string[];
    remoteKnowledgeScopes: RemoteKnowledgeScope[];
    outlineMode: TechnicalPlanState['outlineMode'];
    outlineExpansionMode: TechnicalPlanState['outlineExpansionMode'];
    wordControlOptions: OutlineWordControlOptions;
  }) => {
    await window.yibiao!.technicalPlan.saveOutlineConfig({ ...config, projectId });
    setState((prev) => ({
      ...prev,
      outlineMode: config.outlineMode,
      outlineExpansionMode: config.outlineExpansionMode,
      outlineWordControlOptions: config.wordControlOptions,
      referenceKnowledgeDocumentIds: config.referenceKnowledgeDocumentIds,
      remoteKnowledgeScopes: config.remoteKnowledgeScopes,
    }));
  };

  const outlineGenerationStatus = state.outlineGenerationTask?.status;
  const isOutlineGenerating = outlineGenerationStatus === 'running' || outlineGenerationStatus === 'pausing';
  const outlineAdjustmentStatus = state.outlineAdjustmentTask?.status;
  const isOutlineAdjusting = outlineAdjustmentStatus === 'running' || outlineAdjustmentStatus === 'pausing';
  const isGlobalFactsGenerating = state.globalFactsTask?.status === 'running' || state.globalFactsTask?.status === 'pausing';
  const homeAction: FloatingToolbarAction = {
    id: 'home',
    label: '首页',
    icon: <ToolbarHomeIcon />,
    disabled: activeIndex <= 0,
    tooltip: activeIndex <= 0 ? '当前已经是第一步' : '回到选择标书',
    onClick: () => { void switchStep(steps[0]); },
  };
  const previousStepAction: FloatingToolbarAction = {
    id: 'previous-step',
    label: '上一步',
    icon: <ToolbarArrowLeftIcon />,
    disabled: activeIndex <= 0,
    tooltip: activeIndex <= 0 ? '当前已经是第一步' : `返回${stepLabels[steps[activeIndex - 1]]}`,
    onClick: () => { void goToOffset(-1); },
  };
  const nextStepAction: FloatingToolbarAction = {
    id: 'next-step',
    label: '下一步',
    icon: <ToolbarArrowRightIcon />,
    variant: 'primary' as const,
    disabled: isNextDisabled,
    tooltip: nextTooltip,
    onClick: () => { void goToOffset(1); },
  };
  const exportWordAction: FloatingToolbarAction = {
    id: 'export-word',
    label: isExporting ? '导出中...' : '导出 Word',
    icon: <ToolbarDocumentIcon />,
    variant: 'primary' as const,
    disabled: isContentGenerating || isExporting || !state.outlineData || !hasGeneratedContent(state.outlineData?.outline || []),
    tooltip: isContentGenerating
      ? '正文生成或暂停处理中，完成暂停后再导出'
      : isExporting
        ? 'Word 正在导出，请稍候'
        : !hasGeneratedContent(state.outlineData?.outline || [])
          ? '正文尚未生成，生成正文后才可导出'
          : isContentPaused
            ? '正文生成已暂停，可导出当前已完成内容'
            : '导出当前技术方案正文',
    onClick: () => { setExportDialogOpen(true); },
  };
  const navigationActions = state.step === 'content-edit'
    ? [homeAction, previousStepAction, exportWordAction]
    : [homeAction, previousStepAction, nextStepAction];

  return (
    <div className="page-stack technical-workbench">
      <header className="bid-project-context-bar">
        <button type="button" className="text-button bid-project-context-back" onClick={() => onSectionChange?.('bid-projects')}>
          返回项目列表
        </button>
        <div className="bid-project-context-main">
          <span className="section-kicker">{projectId ? '当前标书项目' : '当前流程'}</span>
          <strong>{projectId ? bidProject?.projectName || '正在读取项目名称...' : workflowLabel(workflowKind)}</strong>
          <span>{projectId ? `${bidProject?.sourceFileName || '招标文件'}${bidProject?.sectionLabel ? ` · ${bidProject.sectionLabel}` : ''}` : '本地默认工作区'}</span>
        </div>
        <div className="bid-project-context-meta">
          {projectId ? <span>同源第 {bidProject?.sourceSequence || 1} 份</span> : null}
          <span>{stepLabels[state.step]}</span>
        </div>
        <div className="bid-project-context-actions" role="group" aria-label="流程导航">
          {navigationActions.map((action) => (
            <button
              type="button"
              key={action.id}
              className={`bid-project-context-action is-${action.variant || 'secondary'}`}
              onClick={action.onClick}
              disabled={action.disabled}
              title={action.tooltip}
              aria-label={action.label}
            >
              <span className="bid-project-context-action-icon" aria-hidden="true">{action.icon}</span>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </header>
      {[state.outlineGenerationTask, state.globalFactsTask, state.contentGenerationTask].some((task) => task?.remote_knowledge_action_required) && (
        <button type="button" className="secondary-action remote-knowledge-task-action" onClick={showRemoteKnowledgeDecision}>处理远程知识异常</button>
      )}
      {state.step === 'document-analysis' && (
        <DocumentAnalysisPage
          projectId={projectId}
          workflowKind={workflowKind}
          tenderFile={state.tenderFile}
          tenderFiles={state.tenderFiles || []}
          tenderMarkdown={tenderMarkdown}
          originalPlanFile={state.originalPlanFile}
          originalPlanMarkdown={originalPlanMarkdown}
          bidSectionMode={state.bidSectionMode}
          bidSections={state.bidSections}
          bidSectionExtractionTask={state.bidSectionExtractionTask}
          bidSectionExtractionStatus={state.bidSectionExtractionStatus}
          bidSectionExtractionError={state.bidSectionExtractionError}
          outlineWordControlOptions={state.outlineWordControlOptions}
          contentGenerationOptions={state.contentGenerationOptions}
          contentTaskStatus={state.contentGenerationTask?.status}
          hasDownstreamData={hasDownstreamData}
          onFileImported={(nextState, markdown) => {
            tenderMarkdownRequestRef.current += 1;
            tenderMarkdownVersionRef.current = nextState.tenderFile ? nextState.tenderFile.contentHash || nextState.tenderFile.updatedAt : null;
            setState((prev) => ({ ...prev, ...nextState }));
            setTenderMarkdown(nextState.tenderFile ? markdown : '');
            setTenderMarkdownLoading(false);
            setTenderMarkdownError('');
          }}
          onOriginalPlanImported={(nextState, markdown) => {
            setState((prev) => ({ ...prev, ...nextState }));
            setOriginalPlanMarkdown(markdown);
          }}
          onOutlineWordControlChange={async (wordControlOptions) => {
            // STEP 01 前置：只改字数控制，其他 outline config 字段保持现状不变
            await saveOutlineConfig({
              referenceKnowledgeDocumentIds: state.referenceKnowledgeDocumentIds,
              remoteKnowledgeScopes: state.remoteKnowledgeScopes,
              outlineMode: state.outlineMode,
              outlineExpansionMode: state.outlineExpansionMode || 'ai-complement',
              wordControlOptions,
            });
          }}
          onContentGenerationOptionsChange={saveContentGenerationOptions}
          onResetBidSectionDownstream={resetBidSectionDownstream}
          onCustomPageStateChange={handleCustomPageStateChange}
          onStateRefresh={async () => {
            const nextState = await window.yibiao?.technicalPlan.loadState(projectPayload);
            if (nextState) setState((prev) => ({ ...prev, ...nextState }));
          }}
        />
      )}

      {state.step === 'bid-analysis' && (
        <BidAnalysisPage
          projectId={projectId}
          hasTenderFile={Boolean(state.tenderFile)}
          mode={state.bidAnalysisMode}
          selectedTaskIds={state.bidAnalysisSelectedTaskIds}
          bidSectionMode={state.bidSectionMode}
          bidSectionExtractionTask={state.bidSectionExtractionTask}
          selectedSectionTitle={state.tenderFile?.selectedSectionTitle}
          contentTaskStatus={state.contentGenerationTask?.status}
          tasks={state.bidAnalysisTasks}
          task={state.bidAnalysisTask}
          progress={state.bidAnalysisProgress}
          focusTaskRequest={bidAnalysisFocusRequest}
          onProgressChange={(progress) => setState((prev) => ({ ...prev, bidAnalysisProgress: progress }))}
          onConfigSaved={(nextState) => setState((prev) => ({ ...prev, ...nextState }))}
        />
      )}
      {state.step === 'outline-generation' && (
          <OutlineEditPage
            projectId={projectId}
            workflowKind={workflowKind}
            projectOverview={state.projectOverview}
            outlineMode={state.outlineMode}
            outlineExpansionMode={state.outlineExpansionMode || 'ai-complement'}
          outlineWordControlOptions={state.outlineWordControlOptions}
          outlineWordControlSnapshot={state.outlineWordControlSnapshot}
          referenceKnowledgeDocumentIds={state.referenceKnowledgeDocumentIds}
          remoteKnowledgeScopes={state.remoteKnowledgeScopes}
          outlineData={state.outlineData}
          task={state.outlineGenerationTask}
          tenderMarkdown={tenderMarkdown}
          tenderMarkdownLoading={tenderMarkdownLoading}
          tenderMarkdownError={tenderMarkdownError}
          onReloadTenderMarkdown={loadTenderMarkdown}
          contentTaskStatus={state.contentGenerationTask?.status}
          aiAdjustmentRunning={isOutlineAdjusting}
          onOutlineConfigChange={saveOutlineConfig}
          onOutlineSaved={saveOutline}
          onOutlineNodeKnowledgeSaved={saveOutlineNodeKnowledge}
          onOutlineSelectionSaved={saveOutlineSelection}
          bidTemplateExists={Boolean(state.bidTemplateExists)}
          onOpenBidTemplate={openBidTemplate}
          onSortGuardChange={(guard) => {
            sortGuardRef.current = guard;
          }}
        />
      )}
      {state.step === 'global-facts' && (
        <GlobalFactsPage
          projectId={projectId}
          outlineData={state.outlineData}
          globalFacts={state.globalFacts}
          globalFactsMode={state.globalFactsMode || 'fabricate'}
          task={state.globalFactsTask}
          aiAdjustmentRunning={isGlobalFactsAdjusting}
          focusGroupRequest={globalFactsFocusRequest}
          onGlobalFactsSaved={saveGlobalFacts}
          onGlobalFactsConfigChange={saveGlobalFactsConfig}
        />
      )}
      {state.step === 'content-edit' && (
        <ContentEditPage
          projectId={projectId}
          workflowKind={workflowKind}
          outlineWordControlSnapshot={state.outlineWordControlSnapshot}
          outlineData={state.outlineData}
          task={state.contentGenerationTask}
          contentGenerationOptions={state.contentGenerationOptions}
          contentIllustrationPlan={state.contentIllustrationPlan}
          sections={state.contentGenerationSections}
          onContentGenerationOptionsChange={saveContentGenerationOptions}
          onContentSaved={saveChapterContent}
          onPlanPatched={(patch) => setState((prev) => ({ ...prev, ...patch }))}
        />
      )}
      {state.step === 'expand' && (
        <div className="plan-step-body technical-plan-expand-page">
          <section className="technical-plan-expand-command-bar">
            <div>
              <span className="section-kicker">STEP 06</span>
              <strong>扩写改写</strong>
              <p>后续接入旧方案导入、章节扩写和人工校准。</p>
            </div>
          </section>
          <section className="empty-panel compact-placeholder technical-plan-expand-placeholder">
            <div className="feature-under-development-overlay" role="status" aria-live="polite">
              <strong>正在开发中，敬请期待</strong>
              <span>此功能尚未完成，请先不要使用。</span>
            </div>
          </section>
        </div>
      )}

      <AppDialog
        open={resetDialogOpen}
        onOpenChange={(open) => !isResetting && setResetDialogOpen(open)}
        kicker="清空当前项目"
        title="确定重置技术方案吗？"
        description={`将清空“${bidProject?.projectName || '当前技术方案'}”的招标文件解析结果、目录、全局事实和正文，并停止当前项目的后台任务。此操作不可撤销。`}
        preventClose={isResetting}
        actions={(
          <>
            <button type="button" className="secondary-action" onClick={() => setResetDialogOpen(false)} disabled={isResetting}>取消</button>
            <button type="button" className="danger-action" onClick={() => { void confirmResetTechnicalPlan(); }} disabled={isResetting}>
              {isResetting ? '正在重置...' : '确认重置'}
            </button>
          </>
        )}
      />

      <AppDialog
        open={sortLeaveDialogOpen}
        onOpenChange={(open) => !open && continueSorting()}
        kicker="目录排序"
        title="排序结果是否保存"
        description="当前目录排序还没有保存。保存后会更新目录编号并保留已生成正文；不保存则丢弃本次排序草稿。"
        cardClassName="outline-sort-leave-card"
        actions={(
          <>
            <button type="button" className="secondary-action" onClick={continueSorting} disabled={savingSortBeforeLeave}>继续排序</button>
            <button type="button" className="secondary-action" onClick={discardSortAndLeave} disabled={savingSortBeforeLeave}>不保存</button>
            <button type="button" className="primary-action" onClick={() => { void saveSortAndLeave(); }} disabled={savingSortBeforeLeave}>
              {savingSortBeforeLeave ? '正在保存...' : '保存排序'}
            </button>
          </>
        )}
      />

      <AppDialog
        open={Boolean(wordControlWarningDialog)}
        onOpenChange={(open) => !open && setWordControlWarningDialog(null)}
        kicker="结果提醒"
        title={wordControlWarningDialog?.title}
        description={wordControlWarningDialog?.message}
        cardClassName="word-control-result-card"
        actions={<Dialog.Close className="primary-action" type="button">知道了</Dialog.Close>}
      >
        <div className="word-control-result-body">
              <div className="word-control-result-metrics">
                {wordControlWarningDialog?.metrics.map((metric) => (
                  <section className="word-control-result-metric" key={metric.label}>
                    <strong>{metric.label}</strong>
                    <dl>
                      <div>
                        <dt>预期</dt>
                        <dd>{metric.expected}</dd>
                      </div>
                      <div>
                        <dt>实际</dt>
                        <dd>{metric.actual}</dd>
                      </div>
                    </dl>
                  </section>
                ))}
              </div>
              {wordControlWarningDialog?.sections.length ? (
                <section className="word-control-result-sections">
                  <div className="word-control-result-sections-head">
                    <strong>未达标小节</strong>
                    <span>{wordControlWarningDialog.sections.length} 个</span>
                  </div>
                  <div className="word-control-result-section-list">
                    {wordControlWarningDialog.sections.map((section) => (
                      <div className="word-control-result-section" key={section.id}>
                        <span>{section.id} {section.title}</span>
                        <strong>{section.words.toLocaleString('zh-CN')} 字</strong>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
        </div>
      </AppDialog>

      <WordExportDialog
        open={exportDialogOpen}
        outline={state.outlineData?.outline}
        onOpenChange={setExportDialogOpen}
        onBusyChange={setIsExporting}
        onCreateTemplate={onSectionChange ? () => onSectionChange('new-template') : undefined}
        onExport={({ requestId, exportFormat }) => window.yibiao!.export.exportWord({
          requestId,
          project_name: state.outlineData?.project_name,
          outline: state.outlineData?.outline || [],
          export_format: exportFormat,
          ...(projectId ? { project_id: projectId } : {}),
          ...(projectId && bidProject ? {
            workflow_analytics: {
              projectId,
              projectName: bidProject.projectName || state.outlineData?.project_name,
              workflowKind,
            },
          } : {}),
        })}
      />

    </div>
  );
}

export default TechnicalPlanHome;
