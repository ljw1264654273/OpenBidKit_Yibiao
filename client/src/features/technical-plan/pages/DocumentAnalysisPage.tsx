import { useEffect, useMemo, useRef, useState } from 'react';
import { AppDialog, isLibreOfficeRequiredMessage, MarkdownFullscreenViewer, MarkdownRenderer, UploadBoard, UploadEmpty, UploadFilePill, UploadRow, useDocumentParseNotice, useToast } from '../../../shared/ui';
import type { OutlineWordControlOptions } from '../../../shared/types';
import type {
  BackgroundTaskState,
  BackgroundTaskStatus,
  BidSectionExtractionStatus,
  BidSectionMode,
  ContentGenerationOptions,
  ContentImagePreset,
  ContentTableRequirement,
  DetectedBidSection,
  TechnicalPlanOriginalPlanFile,
  TechnicalPlanState,
  TechnicalPlanTenderFile,
  TechnicalPlanTenderSourceFile,
  TechnicalPlanWorkflowKind,
} from '../types';
import BidSectionSelectorDialog from '../components/BidSectionSelectorDialog';
import {
  IMAGE_PRESET_LABELS,
  QUICK_CONFIG_IMAGE_OPTIONS,
  applyImagePreset,
  inferImagePreset,
} from '../services/imageConfig';
import {
  createCustomPageOptions,
  DEFAULT_PAGE_LADDER_KEY,
  isQuickConfigLocked,
  isQuickConfigOptionLocked,
  isValidCustomPageCount,
  mergeContentGenerationOptionsForQuickConfig,
  PAGE_LADDER_KEYS,
  PAGE_LADDER_PRESETS,
  QUICK_CONFIG_STORAGE_KEY,
  resolveContentGenerationOptionsForQuickConfig,
  resolveCustomPageCount,
  resolveCustomPageDraft,
  resolvePageLadderKey,
} from '../services/quickConfig';

type TechnicalPlanUploadBusy = 'tender' | 'originalPlan' | null;
type PendingResetAction = () => Promise<void>;

function resolveImportToastType(message: string, success: boolean) {
  if (message.includes('失败')) return 'error' as const;
  if (success) return 'success' as const;
  if (message === '已取消选择' || message.startsWith('已跳过')) return 'info' as const;
  return 'error' as const;
}

const documentLabels = {
  tender: '招标文件',
  originalPlan: '原方案',
};

function DocumentFilePill({ file, onRemove, removeDisabled = false }: { file: TechnicalPlanTenderFile | TechnicalPlanTenderSourceFile | TechnicalPlanOriginalPlanFile; onRemove?: () => void; removeDisabled?: boolean }) {
  return (
    <UploadFilePill
      badge="MD"
      name={file.fileName}
      meta={[file.parserLabel, `${file.markdownChars} 字`].filter(Boolean).join(' · ')}
      onRemove={onRemove}
      removeDisabled={removeDisabled}
    />
  );
}

interface DocumentAnalysisPageProps {
  projectId?: string;
  workflowKind: TechnicalPlanWorkflowKind;
  tenderFile: TechnicalPlanTenderFile | null;
  tenderFiles: TechnicalPlanTenderSourceFile[];
  tenderMarkdown: string;
  originalPlanFile: TechnicalPlanOriginalPlanFile | null;
  originalPlanMarkdown: string;
  bidSectionMode: BidSectionMode;
  bidSections: DetectedBidSection[];
  bidSectionExtractionTask?: BackgroundTaskState;
  bidSectionExtractionStatus: BidSectionExtractionStatus;
  bidSectionExtractionError?: string;
  outlineWordControlOptions: OutlineWordControlOptions;
  contentGenerationOptions?: ContentGenerationOptions;
  contentTaskStatus?: BackgroundTaskStatus;
  hasDownstreamData: boolean;
  onFileImported: (state: TechnicalPlanState, markdown: string) => void;
  onOriginalPlanImported: (state: TechnicalPlanState, markdown: string) => void;
  onOutlineWordControlChange: (options: OutlineWordControlOptions) => Promise<void>;
  onContentGenerationOptionsChange: (options: ContentGenerationOptions) => Promise<void>;
  onResetBidSectionDownstream: () => Promise<void>;
  onStateRefresh: () => Promise<void>;
  onCustomPageStateChange?: (state: { selected: boolean; draft: string }) => void;
}

const tableDensityOptions: Array<{ value: ContentTableRequirement; label: string }> = [
  { value: 'none', label: '无表格' },
  { value: 'light', label: '少量' },
  { value: 'moderate', label: '适中' },
  { value: 'heavy', label: '丰富' },
];

function DocumentAnalysisPage({
  projectId,
  workflowKind,
  tenderFile,
  tenderFiles,
  tenderMarkdown,
  originalPlanFile,
  originalPlanMarkdown,
  bidSectionMode,
  bidSections,
  bidSectionExtractionTask,
  bidSectionExtractionStatus,
  bidSectionExtractionError,
  outlineWordControlOptions,
  contentGenerationOptions,
  contentTaskStatus,
  hasDownstreamData,
  onFileImported,
  onOriginalPlanImported,
  onOutlineWordControlChange,
  onContentGenerationOptionsChange,
  onResetBidSectionDownstream,
  onStateRefresh,
  onCustomPageStateChange,
}: DocumentAnalysisPageProps) {
  const [busy, setBusy] = useState<TechnicalPlanUploadBusy>(null);
  const [activeDocumentTab, setActiveDocumentTab] = useState('tender');
  const [tenderSourceMarkdowns, setTenderSourceMarkdowns] = useState<Record<string, string>>({});
  const [loadingTenderSourceId, setLoadingTenderSourceId] = useState('');
  // 仅在导入那一刻保留本地检测结论，不持久化、不进 TechnicalPlanState
  const [bidSectionDetection, setBidSectionDetection] = useState<{ hasMultiple: boolean; totalDeclared: number | null } | null>(null);
  const [sectionSelectorOpen, setSectionSelectorOpen] = useState(false);
  const [sectionExtracting, setSectionExtracting] = useState(false);
  const [quickConfigSaving, setQuickConfigSaving] = useState<string | null>(null);
  const [customPageDraft, setCustomPageDraft] = useState('');
  const [customPageSelected, setCustomPageSelected] = useState(false);
  const [quickConfigExpanded, setQuickConfigExpanded] = useState(() => {
    try {
      const storedValue = window.localStorage.getItem(QUICK_CONFIG_STORAGE_KEY);
      return storedValue === 'true';
    } catch {
      return false;
    }
  });
  const [imageModelAvailable, setImageModelAvailable] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const pendingResetActionRef = useRef<PendingResetAction | null>(null);
  const sectionDetectionRequestRef = useRef(0);
  const detectedDocumentVersionRef = useRef<string | null>(null);
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const isExpansionWorkflow = workflowKind === 'existing-plan-expansion';
  const isBusy = busy !== null;
  const firstTenderSourceId = tenderFiles[0]?.id || '';
  const resolvedContentOptions = useMemo(
    () => resolveContentGenerationOptionsForQuickConfig(contentGenerationOptions, imageModelAvailable),
    [contentGenerationOptions, imageModelAvailable],
  );
  const resolvedImagePreset = useMemo(
    () => contentGenerationOptions?.imagePreset
      || (contentGenerationOptions ? inferImagePreset(contentGenerationOptions) : resolvedContentOptions.imagePreset || 'enhanced'),
    [contentGenerationOptions, resolvedContentOptions.imagePreset],
  );
  const pageLadderKey = useMemo(() => resolvePageLadderKey(outlineWordControlOptions), [outlineWordControlOptions]);
  const sectionExtractionRunning = bidSectionExtractionStatus === 'running';
  const contentTaskLocked = isQuickConfigLocked(contentTaskStatus);
  const quickConfigOptionLocked = isQuickConfigOptionLocked(contentTaskStatus);
  const tenderDocumentVersion = tenderFile?.contentHash || tenderFile?.updatedAt || tenderFiles.map((file) => `${file.id}:${file.contentHash || file.updatedAt}`).join('|') || null;

  const requestResetConfirmation = (action: PendingResetAction) => {
    if (!hasDownstreamData) {
      void action().catch((error) => {
        showToast(error instanceof Error ? error.message : '执行当前操作失败', 'error');
      });
      return;
    }
    pendingResetActionRef.current = action;
    setResetConfirmOpen(true);
  };

  const confirmResetAndContinue = async () => {
    const action = pendingResetActionRef.current;
    if (!action || resetConfirming) return;
    setResetConfirming(true);
    try {
      await action();
      pendingResetActionRef.current = null;
      setResetConfirmOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重置当前标书失败', 'error');
    } finally {
      setResetConfirming(false);
    }
  };

  useEffect(() => {
    setCustomPageDraft((currentDraft) => resolveCustomPageDraft(outlineWordControlOptions, currentDraft));
  }, [
    outlineWordControlOptions.maximumWords,
    outlineWordControlOptions.minimumWords,
    outlineWordControlOptions.sectionWords,
    outlineWordControlOptions.strictSectionWords,
  ]);

  useEffect(() => {
    setCustomPageSelected(pageLadderKey === 'custom');
  }, [pageLadderKey]);

  useEffect(() => {
    onCustomPageStateChange?.({
      selected: customPageSelected,
      draft: customPageDraft,
    });
  }, [customPageDraft, customPageSelected, onCustomPageStateChange]);

  useEffect(() => {
    let mounted = true;

    const loadImageModelConfig = async () => {
      if (!window.yibiao) {
        return;
      }

      try {
        const config = await window.yibiao.config.load();
        if (mounted) {
          setImageModelAvailable(config.image_model?.status === 'available');
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '读取图片模型配置失败', 'error');
      }
    };

    loadImageModelConfig();

    return () => {
      mounted = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!tenderMarkdown || !tenderDocumentVersion || detectedDocumentVersionRef.current === tenderDocumentVersion) {
      if (!tenderMarkdown || !tenderDocumentVersion) {
        setBidSectionDetection(null);
        detectedDocumentVersionRef.current = null;
      }
      return;
    }

    const requestId = sectionDetectionRequestRef.current + 1;
    sectionDetectionRequestRef.current = requestId;
    const requestVersion = tenderDocumentVersion;
    let active = true;

    window.yibiao?.technicalPlan.checkBidSections(projectId ? { projectId } : undefined).then((detection) => {
      if (!active || requestId !== sectionDetectionRequestRef.current || requestVersion !== tenderDocumentVersion) return;
      detectedDocumentVersionRef.current = requestVersion;
      const hasMultiple = Boolean(detection?.hasMultiple);
      setBidSectionDetection({
        hasMultiple,
        totalDeclared: detection?.totalDeclared ?? null,
      });
    }).catch((error) => {
      if (active && requestId === sectionDetectionRequestRef.current) {
        showToast(error instanceof Error ? error.message : '检测标段失败', 'error');
      }
    });

    return () => {
      active = false;
      if (sectionDetectionRequestRef.current === requestId) {
        sectionDetectionRequestRef.current += 1;
      }
    };
  }, [
    showToast,
    tenderDocumentVersion,
    tenderMarkdown,
    projectId,
  ]);

  useEffect(() => {
    if (isExpansionWorkflow) return;
    if (!firstTenderSourceId) {
      setActiveDocumentTab('tender');
      return;
    }
    const activeTenderSourceId = activeDocumentTab.startsWith('tender:') ? activeDocumentTab.slice('tender:'.length) : '';
    if (!activeTenderSourceId || !tenderFiles.some((file) => file.id === activeTenderSourceId)) {
      setActiveDocumentTab(`tender:${firstTenderSourceId}`);
    }
  }, [activeDocumentTab, firstTenderSourceId, isExpansionWorkflow, tenderFiles]);

  useEffect(() => {
    if (activeDocumentTab.startsWith('tender:')) return;
    if (activeDocumentTab === 'originalPlan') return;
    if (firstTenderSourceId) {
      setActiveDocumentTab(`tender:${firstTenderSourceId}`);
    }
  }, [activeDocumentTab, firstTenderSourceId]);

  useEffect(() => {
    if (!activeDocumentTab.startsWith('tender:')) return;
    const sourceId = activeDocumentTab.slice('tender:'.length);
    if (!sourceId || tenderSourceMarkdowns[sourceId] !== undefined) return;
    let mounted = true;
    setLoadingTenderSourceId(sourceId);
    window.yibiao?.technicalPlan.readTenderSourceMarkdown({ projectId, sourceId }).then((markdown) => {
      if (mounted) {
        setTenderSourceMarkdowns((prev) => ({ ...prev, [sourceId]: markdown || '' }));
      }
    }).catch((error) => {
      if (mounted) showToast(error instanceof Error ? error.message : '读取招标文件正文失败', 'error');
    }).finally(() => {
      if (mounted) setLoadingTenderSourceId((current) => (current === sourceId ? '' : current));
    });
    return () => {
      mounted = false;
    };
  }, [activeDocumentTab, projectId, showToast, tenderSourceMarkdowns]);

  // STEP 01 前置：标段识别成功后自动打开选择弹窗
  useEffect(() => {
    if (bidSectionExtractionStatus !== 'success') return;
    if (!bidSections.length || bidSections.length < 2) return;
    if (tenderFile?.selectedSectionTitle) return;
    if (contentTaskLocked) return;
    if (sectionSelectorOpen) return;
    setSectionSelectorOpen(true);
  }, [bidSectionExtractionStatus, bidSections, contentTaskLocked, sectionSelectorOpen, tenderFile?.selectedSectionTitle]);

  const resolveDroppedFilePaths = (files: FileList) =>
    Array.from(files).map((file) => window.yibiao?.file.getPathForFile(file) || '').filter(Boolean);

  const startBidSectionExtraction = async (skipResetConfirmation = false) => {
    if (contentTaskLocked || sectionExtracting || sectionExtractionRunning) return;
    if (!skipResetConfirmation && hasDownstreamData) {
      requestResetConfirmation(() => startBidSectionExtraction(true));
      return;
    }
    setSectionExtracting(true);
    try {
      if (hasDownstreamData) {
        await onResetBidSectionDownstream();
      }
      await window.yibiao?.tasks.startBidSectionExtraction({ projectId });
      showToast('多标段识别任务已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动多标段识别失败', 'error');
    } finally {
      setSectionExtracting(false);
    }
  };

  const handleSectionSelect = async (sectionId: string, skipResetConfirmation = false) => {
    if (contentTaskLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整投标范围', 'info');
      return;
    }
    if (!skipResetConfirmation && hasDownstreamData) {
      requestResetConfirmation(() => handleSectionSelect(sectionId, true));
      return;
    }
    const selectedSection = bidSections.find((section) => section.id === sectionId);
    if (!selectedSection) {
      showToast('未找到选择的投标范围', 'error');
      return;
    }
    try {
      setSectionExtracting(true);
      const result = await window.yibiao?.technicalPlan.selectBidSection({ projectId, selectedSection });
      if (!result?.success) {
        showToast(result?.message || '投标范围选择失败', 'error');
        return;
      }
      await onStateRefresh();
      setSectionSelectorOpen(false);
      showToast(result.message || '已选择投标范围', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '投标范围选择失败', 'error');
    } finally {
      setSectionExtracting(false);
    }
  };

  const handleSectionCancel = () => {
    setSectionSelectorOpen(false);
  };

  const applyPageLadder = async (key: keyof typeof PAGE_LADDER_PRESETS) => {
    if (quickConfigOptionLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整快速配置', 'info');
      return;
    }
    const preset = PAGE_LADDER_PRESETS[key];
    if (!preset) return;
    setCustomPageSelected(false);
    setQuickConfigSaving(`pageLadder:${key}`);
    try {
      await onOutlineWordControlChange(preset.options);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存标书篇幅失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const selectCustomPage = () => {
    if (quickConfigOptionLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整快速配置', 'info');
      return;
    }
    setCustomPageDraft((currentDraft) => resolveCustomPageDraft(outlineWordControlOptions, currentDraft));
    setCustomPageSelected(true);
  };

  const applyCustomPage = async (value: string) => {
    if (quickConfigOptionLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整快速配置', 'info');
      return;
    }
    if (!isValidCustomPageCount(value)) return;
    const pageCount = Number(value);
    setQuickConfigSaving('pageLadder:custom');
    try {
      await onOutlineWordControlChange(createCustomPageOptions(pageCount));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存自定义标书篇幅失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const applyTableDensity = async (value: ContentTableRequirement) => {
    if (quickConfigOptionLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整快速配置', 'info');
      return;
    }
    if (value === resolvedContentOptions.tableRequirement) return;
    setQuickConfigSaving(`table:${value}`);
    try {
      await onContentGenerationOptionsChange(mergeContentGenerationOptionsForQuickConfig(
        contentGenerationOptions,
        {
          tableRequirement: value,
        },
        imageModelAvailable,
      ));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存表格密度失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const applyImagePresetSelection = async (preset: Exclude<ContentImagePreset, 'custom'>) => {
    if (quickConfigOptionLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整快速配置', 'info');
      return;
    }
    if (resolvedImagePreset === preset) return;
    if ((preset === 'enhanced' || preset === 'rich') && !imageModelAvailable) {
      showToast('图片模型当前不可用，已保存图片模式；开始生成正文时会按运行环境自动处理 AI 配图', 'info');
    }
    setQuickConfigSaving(`image:${preset}`);
    try {
      await onContentGenerationOptionsChange(mergeContentGenerationOptionsForQuickConfig(
        contentGenerationOptions,
        applyImagePreset(preset),
        imageModelAvailable,
      ));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存图片模式失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const importTenderDocument = async (filePaths?: string[], skipResetConfirmation = false) => {
    if (!skipResetConfirmation && hasDownstreamData) {
      requestResetConfirmation(() => importTenderDocument(filePaths, true));
      return;
    }
    try {
      setBusy('tender');
      const result = await window.yibiao?.technicalPlan.importTenderDocument({ projectId, filePaths });

      if (!result?.success) {
        const message = result?.message || '未导入文件';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, resolveImportToastType(message, false));
        return;
      }

      if (!result.markdown) {
        showToast('招标文件解析结果为空', 'error');
        return;
      }

      const state = await window.yibiao.technicalPlan.loadState({ projectId });
      onFileImported(state, result.markdown);
      updateQuickConfigExpanded(true);
      detectedDocumentVersionRef.current = state.tenderFile
        ? state.tenderFile.contentHash || state.tenderFile.updatedAt
        : null;
      const lastSource = state.tenderFiles?.[state.tenderFiles.length - 1];
      if (lastSource) {
        setTenderSourceMarkdowns(state.tenderFiles.length === 1 ? { [lastSource.id]: result.markdown } : {});
        setActiveDocumentTab(`tender:${lastSource.id}`);
      }
      // 本地标段检测结论：仅停留在 DocumentAnalysisPage 本地，不落库
      setBidSectionDetection(result.bidSectionDetection || null);
      if (result.bidSectionDetection?.hasMultiple) {
        // STEP 01 直接复用后续步骤已有的 AI 标段识别任务，完成后自动弹出投标范围选择。
        void startBidSectionExtraction(true);
      }
      const message = result.message || '招标文件已导入';
      showToast(message, resolveImportToastType(message, true));
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件解析失败';
      if (isLibreOfficeRequiredMessage(message)) {
        showDocumentParseNotice(message);
        return;
      }
      showToast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const removeTenderDocument = async (sourceId: string, skipResetConfirmation = false) => {
    if (!skipResetConfirmation && hasDownstreamData) {
      requestResetConfirmation(() => removeTenderDocument(sourceId, true));
      return;
    }
    try {
      setBusy('tender');
      const result = await window.yibiao?.technicalPlan.removeTenderDocument({ projectId, sourceId });
      if (!result?.success) {
        showToast(result?.message || '移除招标文件失败', 'error');
        return;
      }
      const state = await window.yibiao.technicalPlan.loadState({ projectId });
      onFileImported(state, result.markdown || '');
      detectedDocumentVersionRef.current = state.tenderFile
        ? state.tenderFile.contentHash || state.tenderFile.updatedAt
        : null;
      const firstSource = state.tenderFiles?.[0];
      if (firstSource) {
        setTenderSourceMarkdowns(state.tenderFiles.length === 1 ? { [firstSource.id]: result.markdown || '' } : {});
        setActiveDocumentTab(`tender:${firstSource.id}`);
      } else {
        setTenderSourceMarkdowns({});
        setActiveDocumentTab('tender');
        // 全部移除招标文件：清空本地标段检测结论
        setBidSectionDetection(null);
      }
      showToast(result.message || '已移除招标文件', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '移除招标文件失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const importOriginalPlanDocument = async (filePaths?: string[]) => {
    try {
      setBusy('originalPlan');
      const result = await window.yibiao?.technicalPlan.importOriginalPlanDocument({ projectId, filePaths });

      if (!result?.success) {
        const message = result?.message || '未导入文件';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, message === '已取消选择' ? 'info' : 'error');
        return;
      }

      if (!result.markdown) {
        showToast('原方案解析结果为空', 'error');
        return;
      }

      const state = await window.yibiao.technicalPlan.loadState({ projectId });
      onOriginalPlanImported(state, result.markdown);
      setActiveDocumentTab('originalPlan');
      showToast(result.message || '原方案已导入', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件解析失败';
      if (isLibreOfficeRequiredMessage(message)) {
        showDocumentParseNotice(message);
        return;
      }
      showToast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const selectedSectionTitle = tenderFile?.selectedSectionTitle;
  const hasSectionHint = Boolean(bidSectionDetection?.hasMultiple && !selectedSectionTitle);
  const hasFormalBidSections = bidSections.length >= 2;
  const sectionActionLabel = hasFormalBidSections ? '确认投标范围' : '识别标段';
  const activePageOption = customPageSelected ? 'custom' : pageLadderKey;
  const isCustomPageActive = activePageOption === 'custom';
  const activePresetKey = pageLadderKey !== 'unset' && pageLadderKey !== 'custom'
    ? pageLadderKey
    : DEFAULT_PAGE_LADDER_KEY;
  const customPageCount = isValidCustomPageCount(customPageDraft)
    ? Number(customPageDraft)
    : resolveCustomPageCount(outlineWordControlOptions);
  const quickConfigPageSummary = isCustomPageActive
    ? `自定义${customPageCount || ''}页`
    : pageLadderKey === 'unset'
      ? PAGE_LADDER_PRESETS[DEFAULT_PAGE_LADDER_KEY].label
      : PAGE_LADDER_PRESETS[activePresetKey].label;
  const quickConfigTableSummary = tableDensityOptions.find((option) => option.value === resolvedContentOptions.tableRequirement)?.label || '丰富';
  const hasTableDensitySelection = true;
  const hasImageSelection = Boolean(contentGenerationOptions?.imagePreset) || !contentGenerationOptions;
  const quickConfigImageSummary = hasImageSelection ? IMAGE_PRESET_LABELS[resolvedImagePreset] : '待选择';
  const updateQuickConfigExpanded = (expanded: boolean) => {
    setQuickConfigExpanded(expanded);
    try {
      window.localStorage.setItem(QUICK_CONFIG_STORAGE_KEY, String(expanded));
    } catch {
      // localStorage 不可用时仍保持当前页面内的折叠状态。
    }
  };
  const openSectionSelector = () => {
    if (contentTaskLocked) {
      showToast('正文生成任务进行中，请等待任务结束后再调整投标范围', 'info');
      return;
    }
    if (hasFormalBidSections) {
      setSectionSelectorOpen(true);
      return;
    }
    void startBidSectionExtraction();
  };
  const activeTenderSource = activeDocumentTab.startsWith('tender:')
    ? tenderFiles.find((file) => file.id === activeDocumentTab.slice('tender:'.length)) || null
    : null;
  const visibleDocumentTab = activeDocumentTab === 'originalPlan' ? 'originalPlan' : 'tender';
  const activeFile = visibleDocumentTab === 'originalPlan' ? originalPlanFile : activeTenderSource || tenderFile;
  const activeMarkdown = visibleDocumentTab === 'originalPlan'
    ? originalPlanMarkdown
    : activeTenderSource
      ? tenderSourceMarkdowns[activeTenderSource.id] || ''
      : tenderMarkdown;
  const documentTabs = [
    ...(tenderFiles.length ? tenderFiles.map((file, index) => ({ id: `tender:${file.id}`, label: `招标文件${index + 1}` })) : [{ id: 'tender', label: '招标文件' }]),
    ...(isExpansionWorkflow ? [{ id: 'originalPlan', label: '原方案' }] : []),
  ];
  const hasDocumentTabs = isExpansionWorkflow || tenderFiles.length > 1;
  const activeTenderSourceLoading = activeTenderSource && loadingTenderSourceId === activeTenderSource.id;

  return (
    <div className={`plan-step-body document-analysis-page technical-document-page${hasSectionHint ? ' has-section-hint' : ''}${bidSectionExtractionError ? ' has-section-error' : ''}${hasDocumentTabs ? ' has-document-tabs' : ''}`}>
      <UploadBoard
        className="technical-document-upload-board"
        kicker="STEP 01"
        title="选择标书"
      >
        <UploadRow
          index="01"
          title="招标文件"
          onDropFiles={(files) => {
            const paths = resolveDroppedFilePaths(files);
            if (paths.length) void importTenderDocument(paths);
          }}
          dropDisabled={isBusy}
          actions={(
            <button type="button" className="primary-action" onClick={() => void importTenderDocument()} disabled={isBusy}>
              {busy === 'tender' ? '解析中...' : tenderFiles.length ? '继续上传' : '上传'}
            </button>
          )}
        >
          {tenderFiles.length ? (
            <div className="upload-file-list">
              {tenderFiles.map((file) => (
                <DocumentFilePill
                  key={file.id}
                  file={file}
                  onRemove={() => void removeTenderDocument(file.id)}
                  removeDisabled={isBusy}
                />
              ))}
            </div>
          ) : (
            <UploadEmpty title="等待招标文件" hint="用于解析项目概况、技术要求、评分项和后续正文约束。">
              <button type="button" className="text-button" onClick={() => void importTenderDocument()} disabled={isBusy}>选择招标文件</button>
            </UploadEmpty>
          )}
        </UploadRow>

        {isExpansionWorkflow && (
          <UploadRow
            index="02"
            title="原方案"
            onDropFiles={(files) => {
              const paths = resolveDroppedFilePaths(files);
              if (paths.length) void importOriginalPlanDocument(paths);
            }}
            dropDisabled={isBusy}
            actions={(
              <button type="button" className="primary-action" onClick={() => void importOriginalPlanDocument()} disabled={isBusy}>
                {busy === 'originalPlan' ? '解析中...' : originalPlanFile ? '替换' : '上传'}
              </button>
            )}
          >
            {originalPlanFile ? (
              <DocumentFilePill file={originalPlanFile} />
            ) : (
              <UploadEmpty title="等待原方案" hint="上传已经写好的技术方案，后续用于优化和扩充。">
                <button type="button" className="text-button" onClick={() => void importOriginalPlanDocument()} disabled={isBusy}>导入原方案</button>
              </UploadEmpty>
            )}
          </UploadRow>
        )}
      </UploadBoard>

      {bidSectionDetection?.hasMultiple && !selectedSectionTitle && (
        <section className="analysis-section-hint quick-config-bid-section-hint">
          <div>
            <strong>疑似多标段</strong>
            <span>
              本地检测识别出{bidSectionDetection?.totalDeclared ? ` ${bidSectionDetection.totalDeclared} 个标段/标包` : '多个标段/标包'}，建议先识别并选择投标范围再继续。
            </span>
          </div>
          <button
            type="button"
            className="primary-action"
            onClick={openSectionSelector}
            disabled={contentTaskLocked || sectionExtracting || sectionExtractionRunning || !tenderFile}
          >
            {sectionExtractionRunning ? '识别中...' : sectionActionLabel}
          </button>
        </section>
      )}

      {bidSectionExtractionError && (
        <section className="analysis-section-hint quick-config-error-hint">
          <div>
            <strong>多标段识别失败</strong>
            <span>{bidSectionExtractionError}</span>
          </div>
            <button
              type="button"
              className="secondary-action"
              onClick={() => void startBidSectionExtraction()}
            disabled={contentTaskLocked || sectionExtracting || sectionExtractionRunning}
            >
            重试
          </button>
        </section>
      )}

      <section className={`quick-config-collapsible${quickConfigExpanded ? ' is-expanded' : ''}`} aria-label="快速配置">
        <div className="quick-config-summary">
          <div className="quick-config-summary-title">
            <span className="section-kicker">快速配置</span>
            <strong>生成约束</strong>
          </div>
              <div className="quick-config-summary-values" aria-label="当前快速配置">
                <span>篇幅 <b>{quickConfigPageSummary}</b></span>
                <span>表格 <b>{hasTableDensitySelection ? quickConfigTableSummary : '待选择'}</b></span>
                <span>图片 <b>{quickConfigImageSummary}</b></span>
          </div>
          <button
            type="button"
            className="outline-config-action quick-config-toggle"
            aria-expanded={quickConfigExpanded}
            aria-controls="technical-plan-quick-config-panel"
            onClick={() => updateQuickConfigExpanded(!quickConfigExpanded)}
            title={quickConfigExpanded ? '收起设置' : '展开设置'}
            aria-label={quickConfigExpanded ? '收起快速配置' : '展开快速配置'}
          >
            {quickConfigExpanded ? '收起' : '设置'}
          </button>
        </div>

        {quickConfigExpanded && (
          <div className="quick-config-panel" id="technical-plan-quick-config-panel">
            <div className="quick-config-head">
              <div>
                <span className="section-kicker">快速配置</span>
                <strong>本次标书的生成约束</strong>
              </div>
              <small>早选不早生效：STEP 03 目录生成、STEP 05 正文生成时仍可调整</small>
            </div>

            <div className="quick-config-row">
              <div className="quick-config-label"><strong>投标范围</strong><small>决定下游全部输入</small></div>
              <div className="quick-config-row-body">
                <span className={`quick-config-value${selectedSectionTitle ? '' : ' is-muted'}`}>
                  {selectedSectionTitle ? `当前：多标段 · ${selectedSectionTitle}` : bidSectionMode === 'multiple' ? '当前：多标段 · 待选择' : '当前：单标段'}
                </span>
                <span className="quick-config-spacer" />
                {(selectedSectionTitle || bidSectionMode === 'multiple' || bidSectionDetection?.hasMultiple || hasFormalBidSections) && (
                  <button type="button" className="secondary-action" onClick={openSectionSelector} disabled={contentTaskLocked || sectionExtracting || sectionExtractionRunning || !tenderFile}>
                    {selectedSectionTitle ? '更换标段' : hasFormalBidSections ? '选择标段' : '识别标段'}
                  </button>
                )}
              </div>
            </div>

            <div className="quick-config-row">
              <div className="quick-config-label"><strong>标书篇幅</strong><small>字数控制预设</small></div>
              <div className="quick-config-row-body quick-config-ladder-row">
                <div className="quick-config-ladder" role="radiogroup" aria-label="标书篇幅">
                  {PAGE_LADDER_KEYS.map((key) => {
                    const preset = PAGE_LADDER_PRESETS[key];
                    const isActive = activePageOption === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={`quick-config-pill${isActive ? ' is-active' : ''}`}
                        onClick={() => void applyPageLadder(key)}
                        disabled={quickConfigSaving !== null || quickConfigOptionLocked}
                        title={preset.description}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                      <div className={`quick-config-custom-page${isCustomPageActive ? ' is-active' : ''}`}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={isCustomPageActive}
                          className={`quick-config-pill${isCustomPageActive ? ' is-active' : ''}`}
                          onClick={selectCustomPage}
                          disabled={quickConfigSaving !== null || quickConfigOptionLocked}
                        >
                          自定义
                        </button>
                        {isCustomPageActive && (
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={customPageDraft}
                            aria-label="自定义页数"
                            placeholder="页数"
                            onChange={(event) => setCustomPageDraft(event.target.value)}
                            onBlur={() => {
                              if (customPageDraft.trim()) void applyCustomPage(customPageDraft);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void applyCustomPage(customPageDraft);
                              }
                            }}
                            disabled={quickConfigSaving !== null || quickConfigOptionLocked}
                          />
                        )}
                      </div>
                </div>
                <small className="quick-config-note">
                  {isCustomPageActive
                    ? `当前为自定义字数，将在 STEP 03 精调（每节 ${outlineWordControlOptions.sectionWords || '未设置'} 字）`
                    : pageLadderKey === 'unset'
                      ? `默认按 ${PAGE_LADDER_PRESETS[DEFAULT_PAGE_LADDER_KEY].label} 生成`
                      : `换算为全文 ${PAGE_LADDER_PRESETS[activePresetKey].description}，STEP 03 可精确调整上下限与单节字数。`}
                </small>
              </div>
            </div>

            <div className="quick-config-row">
              <div className="quick-config-label"><strong>表格密度</strong><small>正文表格要求</small></div>
              <div className="quick-config-row-body">
                <div className="quick-config-segment" role="radiogroup" aria-label="表格密度">
                  {tableDensityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={option.value === resolvedContentOptions.tableRequirement}
                      className={hasTableDensitySelection && option.value === resolvedContentOptions.tableRequirement ? 'is-active' : ''}
                      onClick={() => void applyTableDensity(option.value)}
                      disabled={quickConfigSaving !== null || quickConfigOptionLocked}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="quick-config-note">对应 STEP 05 生成配置</span>
              </div>
            </div>

            <div className="quick-config-row">
              <div className="quick-config-label"><strong>图片设置</strong><small>图文丰富度</small></div>
              <div className="quick-config-row-body">
                <div className="quick-config-image-options" role="radiogroup" aria-label="图片模式">
                  {QUICK_CONFIG_IMAGE_OPTIONS.map(({ preset, label, description }) => {
                    const active = hasImageSelection && resolvedImagePreset === preset;
                    const disabled = quickConfigSaving !== null || quickConfigOptionLocked;
                    return (
                      <div className={`quick-config-image-option${active ? ' is-active' : ''}`} key={preset}>
                        <button
                          type="button"
                          role="radio"
                          className={`quick-config-image-pill${active ? ' is-active' : ''}`}
                          aria-checked={active}
                          onClick={() => void applyImagePresetSelection(preset)}
                          disabled={disabled}
                        >
                          <span className="quick-config-image-dot" aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                        <small className="quick-config-image-description">{description}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {hasDocumentTabs && (
        <div className="document-switch-tabs" role="tablist" aria-label="技术方案文件正文切换">
          {documentTabs.map((tab) => {
            const isActive = tab.id === activeDocumentTab;
            return (
              <button
                type="button"
                className={`document-switch-tab${isActive ? ' is-active' : ''}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`technical-document-panel-${tab.id}`}
                id={`document-switch-tab-${tab.id}`}
                key={tab.id}
                onClick={() => setActiveDocumentTab(tab.id)}
              >
                <strong>{tab.label}</strong>
              </button>
            );
          })}
        </div>
      )}

      <section
        className="technical-document-reader-card analysis-markdown-card is-compact"
        role={hasDocumentTabs ? 'tabpanel' : undefined}
        id={hasDocumentTabs ? `technical-document-panel-${activeDocumentTab}` : undefined}
        aria-labelledby={hasDocumentTabs ? `document-switch-tab-${activeDocumentTab}` : undefined}
      >
        <div className="analysis-result-head technical-document-reader-head">
          <div className="technical-document-reader-title">
            <strong>{documentLabels[visibleDocumentTab]}内容</strong>
            <span>{activeFile ? `${activeFile.fileName} · ${activeFile.markdownChars} 字` : '等待上传'}</span>
          </div>
          <div className="technical-document-reader-actions">
            {activeTenderSourceLoading && <span className="technical-document-reader-loading">正在读取正文...</span>}
            {!activeTenderSourceLoading && !activeMarkdown && (
              <span className="technical-document-reader-empty">{activeFile ? '正文尚未解析完成' : `尚未导入${documentLabels[visibleDocumentTab]}`}</span>
            )}
            <MarkdownFullscreenViewer
              title={`${documentLabels[visibleDocumentTab]}全屏查看`}
              buttonLabel="全屏查看"
              fullscreenTriggerOnly
              disabled={!activeMarkdown || Boolean(activeTenderSourceLoading)}
            >
              <MarkdownRenderer>
                {activeMarkdown}
              </MarkdownRenderer>
            </MarkdownFullscreenViewer>
          </div>
        </div>
      </section>

      <BidSectionSelectorDialog
        open={sectionSelectorOpen}
        sections={bidSections}
        busy={sectionExtracting}
        onSelect={(sectionId) => void handleSectionSelect(sectionId)}
        onCancel={handleSectionCancel}
      />

      <AppDialog
        open={resetConfirmOpen}
        onOpenChange={(open) => !resetConfirming && setResetConfirmOpen(open)}
        kicker="重置当前标书"
        title="继续操作前重置当前标书？"
        description="当前标书已经存在招标解析、目录、全局事实或正文内容。继续后将清空这些下游信息，此操作不可撤销。"
        preventClose={resetConfirming}
        actions={(
          <>
            <button type="button" className="secondary-action" onClick={() => setResetConfirmOpen(false)} disabled={resetConfirming}>取消</button>
            <button type="button" className="danger-action" onClick={() => { void confirmResetAndContinue(); }} disabled={resetConfirming}>
              {resetConfirming ? '正在重置...' : '确认重置并继续'}
            </button>
          </>
        )}
      />
    </div>
  );
}

export default DocumentAnalysisPage;
