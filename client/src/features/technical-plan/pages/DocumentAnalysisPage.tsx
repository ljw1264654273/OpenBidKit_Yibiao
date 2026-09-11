import { useEffect, useMemo, useState } from 'react';
import { AppSwitch, isLibreOfficeRequiredMessage, MarkdownFullscreenViewer, MarkdownRenderer, UploadBoard, UploadEmpty, UploadFilePill, UploadRow, useDocumentParseNotice, useToast } from '../../../shared/ui';
import type { FileParserProvider, OutlineWordControlOptions } from '../../../shared/types';
import { DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS } from '../../../shared/types';
import type {
  BackgroundTaskState,
  BidSectionExtractionStatus,
  BidSectionMode,
  ContentGenerationOptions,
  ContentTableRequirement,
  DetectedBidSection,
  TechnicalPlanOriginalPlanFile,
  TechnicalPlanState,
  TechnicalPlanTenderFile,
  TechnicalPlanTenderSourceFile,
  TechnicalPlanWorkflowKind,
} from '../types';
import BidSectionSelectorDialog from '../components/BidSectionSelectorDialog';

type TechnicalPlanUploadBusy = 'tender' | 'originalPlan' | null;

const parserLabels: Record<FileParserProvider, string> = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};

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
  onFileImported: (state: TechnicalPlanState, markdown: string) => void;
  onOriginalPlanImported: (state: TechnicalPlanState, markdown: string) => void;
  onOutlineWordControlChange: (options: OutlineWordControlOptions) => Promise<void>;
  onContentGenerationOptionsChange: (options: ContentGenerationOptions) => Promise<void>;
  onStateRefresh: () => Promise<void>;
}

// 快速配置：标书篇幅页数阶梯预设
// 与 OutlineEditPage 的 getEstimatedPages（650 字/页）保持同一换算
// 每档同时给最小/最大字数 + 每小节字数；选择 0 档表示不控制
const WORDS_PER_PAGE = 650;
type PageLadderKey = 'none' | 'p30' | 'p50' | 'p80' | 'p100';

const pageLadderPresets: Record<PageLadderKey, {
  label: string;
  description: string;
  options: OutlineWordControlOptions;
}> = {
  none: {
    label: '默认（不控制）',
    description: '由 AI 自由决定篇幅',
    options: { ...DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS, strictSectionWords: false },
  },
  p30: {
    label: '30 页',
    description: `约 ${(30 * WORDS_PER_PAGE / 10000).toFixed(1)} 万字`,
    options: {
      minimumWords: 18000,
      maximumWords: 21000,
      sectionWords: 500,
      strictSectionWords: false,
    },
  },
  p50: {
    label: '50 页',
    description: `约 ${(50 * WORDS_PER_PAGE / 10000).toFixed(1)} 万字`,
    options: {
      minimumWords: 30000,
      maximumWords: 36000,
      sectionWords: 800,
      strictSectionWords: false,
    },
  },
  p80: {
    label: '80 页',
    description: `约 ${(80 * WORDS_PER_PAGE / 10000).toFixed(1)} 万字`,
    options: {
      minimumWords: 47000,
      maximumWords: 57000,
      sectionWords: 1400,
      strictSectionWords: false,
    },
  },
  p100: {
    label: '100 页',
    description: `约 ${(100 * WORDS_PER_PAGE / 10000).toFixed(1)} 万字`,
    options: {
      minimumWords: 58000,
      maximumWords: 72000,
      sectionWords: 1800,
      strictSectionWords: false,
    },
  },
};

const tableDensityOptions: Array<{ value: ContentTableRequirement; label: string }> = [
  { value: 'none', label: '不要' },
  { value: 'light', label: '少量' },
  { value: 'moderate', label: '适中' },
  { value: 'heavy', label: '大量' },
];

const DEFAULT_TABLE_DENSITY: ContentTableRequirement = 'heavy';
const DEFAULT_USE_AI_IMAGES = false;
const DEFAULT_USE_MERMAID_IMAGES = true;
const DEFAULT_USE_HTML_IMAGES = true;

function resolvePageLadderKey(options: OutlineWordControlOptions): PageLadderKey {
  const min = options.minimumWords;
  const max = options.maximumWords;
  if (min === 0 && max === 0) return 'none';
  if (min >= 17000 && min <= 19000 && max >= 20000 && max <= 22000) return 'p30';
  if (min >= 28000 && min <= 32000 && max >= 34000 && max <= 38000) return 'p50';
  if (min >= 45000 && min <= 49000 && max >= 55000 && max <= 59000) return 'p80';
  if (min >= 56000 && min <= 60000 && max >= 70000 && max <= 74000) return 'p100';
  // 自定义档：返回 none 标记交由 STEP 03 精确控制
  return 'none';
}

function resolveContentGenerationOptionsForQuickConfig(
  options: ContentGenerationOptions | undefined,
): ContentGenerationOptions {
  return {
    useAiImages: options?.useAiImages ?? DEFAULT_USE_AI_IMAGES,
    maxAiImages: options?.maxAiImages ?? 6,
    useMermaidImages: options?.useMermaidImages ?? DEFAULT_USE_MERMAID_IMAGES,
    useAiRedesignForMermaid: options?.useAiRedesignForMermaid ?? false,
    maxMermaidImages: options?.maxMermaidImages ?? 5,
    useHtmlImages: options?.useHtmlImages ?? DEFAULT_USE_HTML_IMAGES,
    maxHtmlImages: options?.maxHtmlImages ?? 10,
    htmlImageTypes: options?.htmlImageTypes ?? '甘特图、进度网络图、组织架构图、泳道图、RACI 职责矩阵、风险矩阵、系统架构与拓扑图、WBS 工作分解结构图、鱼骨图、柱状图、折线图、饼图',
    tableRequirement: options?.tableRequirement ?? DEFAULT_TABLE_DENSITY,
    enableConsistencyAudit: options?.enableConsistencyAudit ?? true,
    consistencyRepairMode: options?.consistencyRepairMode ?? 'agent',
    enableOriginalPlanCoverageAudit: options?.enableOriginalPlanCoverageAudit ?? false,
    originalPlanCoverageRepairMode: options?.originalPlanCoverageRepairMode ?? 'agent',
  };
}

function DocumentAnalysisPage({
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
  onFileImported,
  onOriginalPlanImported,
  onOutlineWordControlChange,
  onContentGenerationOptionsChange,
  onStateRefresh,
}: DocumentAnalysisPageProps) {
  const [configuredParserLabel, setConfiguredParserLabel] = useState(parserLabels.local);
  const [busy, setBusy] = useState<TechnicalPlanUploadBusy>(null);
  const [activeDocumentTab, setActiveDocumentTab] = useState('tender');
  const [tenderSourceMarkdowns, setTenderSourceMarkdowns] = useState<Record<string, string>>({});
  const [loadingTenderSourceId, setLoadingTenderSourceId] = useState('');
  // 仅在导入那一刻保留本地检测结论，不持久化、不进 TechnicalPlanState
  const [bidSectionDetection, setBidSectionDetection] = useState<{ hasMultiple: boolean; totalDeclared: number | null } | null>(null);
  const [sectionSelectorOpen, setSectionSelectorOpen] = useState(false);
  const [sectionExtracting, setSectionExtracting] = useState(false);
  const [quickConfigSaving, setQuickConfigSaving] = useState<string | null>(null);
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const isExpansionWorkflow = workflowKind === 'existing-plan-expansion';
  const isBusy = busy !== null;
  const firstTenderSourceId = tenderFiles[0]?.id || '';
  const resolvedContentOptions = useMemo(
    () => resolveContentGenerationOptionsForQuickConfig(contentGenerationOptions),
    [contentGenerationOptions],
  );
  const pageLadderKey = useMemo(() => resolvePageLadderKey(outlineWordControlOptions), [outlineWordControlOptions]);
  const sectionExtractionRunning = bidSectionExtractionStatus === 'running';

  useEffect(() => {
    let mounted = true;

    const loadParserConfig = async () => {
      if (!window.yibiao) {
        return;
      }

      try {
        const config = await window.yibiao.config.load();
        if (mounted) {
          setConfiguredParserLabel(parserLabels[config.components?.file_parser?.provider] || parserLabels.local);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '读取文件解析配置失败', 'error');
      }
    };

    loadParserConfig();

    return () => {
      mounted = false;
    };
  }, [showToast]);

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
    window.yibiao?.technicalPlan.readTenderSourceMarkdown(sourceId).then((markdown) => {
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
  }, [activeDocumentTab, showToast, tenderSourceMarkdowns]);

  // STEP 01 前置：标段识别成功后自动打开选择弹窗
  useEffect(() => {
    if (bidSectionExtractionStatus !== 'success') return;
    if (!bidSections.length || bidSections.length < 2) return;
    if (tenderFile?.selectedSectionTitle) return;
    if (sectionSelectorOpen) return;
    setSectionSelectorOpen(true);
  }, [bidSectionExtractionStatus, bidSections, sectionSelectorOpen, tenderFile?.selectedSectionTitle]);

  const resolveDroppedFilePaths = (files: FileList) =>
    Array.from(files).map((file) => window.yibiao?.file.getPathForFile(file) || '').filter(Boolean);

  const startBidSectionExtraction = async () => {
    if (sectionExtracting || sectionExtractionRunning) return;
    setSectionExtracting(true);
    try {
      await window.yibiao?.tasks.startBidSectionExtraction({});
      showToast('多标段识别任务已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动多标段识别失败', 'error');
    } finally {
      setSectionExtracting(false);
    }
  };

  const handleSectionSelect = async (sectionId: string) => {
    const selectedSection = bidSections.find((section) => section.id === sectionId);
    if (!selectedSection) {
      showToast('未找到选择的投标范围', 'error');
      return;
    }
    try {
      setSectionExtracting(true);
      const result = await window.yibiao?.technicalPlan.selectBidSection(selectedSection);
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

  const applyPageLadder = async (key: PageLadderKey) => {
    const preset = pageLadderPresets[key];
    if (!preset) return;
    setQuickConfigSaving(`pageLadder:${key}`);
    try {
      await onOutlineWordControlChange(preset.options);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存标书篇幅失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const applyTableDensity = async (value: ContentTableRequirement) => {
    if (value === resolvedContentOptions.tableRequirement) return;
    setQuickConfigSaving(`table:${value}`);
    try {
      await onContentGenerationOptionsChange({
        ...resolvedContentOptions,
        tableRequirement: value,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存表格密度失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const applyImageToggle = async (
    key: 'useAiImages' | 'useMermaidImages' | 'useHtmlImages',
    value: boolean,
  ) => {
    if (resolvedContentOptions[key] === value) return;
    setQuickConfigSaving(`image:${key}`);
    try {
      await onContentGenerationOptionsChange({
        ...resolvedContentOptions,
        [key]: value,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存图片配置失败', 'error');
    } finally {
      setQuickConfigSaving(null);
    }
  };

  const importTenderDocument = async (filePaths?: string[]) => {
    try {
      setBusy('tender');
      const result = await window.yibiao?.technicalPlan.importTenderDocument(filePaths);

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

      const state = await window.yibiao.technicalPlan.loadState();
      onFileImported(state, result.markdown);
      const lastSource = state.tenderFiles?.[state.tenderFiles.length - 1];
      if (lastSource) {
        setTenderSourceMarkdowns(state.tenderFiles.length === 1 ? { [lastSource.id]: result.markdown } : {});
        setActiveDocumentTab(`tender:${lastSource.id}`);
      }
      // 本地标段检测结论：仅停留在 DocumentAnalysisPage 本地，不落库
      setBidSectionDetection(result.bidSectionDetection || null);
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

  const removeTenderDocument = async (sourceId: string) => {
    try {
      setBusy('tender');
      const result = await window.yibiao?.technicalPlan.removeTenderDocument(sourceId);
      if (!result?.success) {
        showToast(result?.message || '移除招标文件失败', 'error');
        return;
      }
      const state = await window.yibiao.technicalPlan.loadState();
      onFileImported(state, result.markdown || '');
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
      const result = await window.yibiao?.technicalPlan.importOriginalPlanDocument(filePaths);

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

      const state = await window.yibiao.technicalPlan.loadState();
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
  const hasSectionHint = Boolean(selectedSectionTitle);
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
  const readerEmptyText = visibleDocumentTab === 'originalPlan'
    ? '请上传一份已经写好的技术方案，页面会在这里展示解析后的 Markdown 正文。'
    : '当前步骤只负责把招标文件解析成 Markdown。下一步再基于这里的 Markdown 内容进行 AI 标书理解。';
  const documentTabs = [
    ...(tenderFiles.length ? tenderFiles.map((file, index) => ({ id: `tender:${file.id}`, label: `招标文件${index + 1}` })) : [{ id: 'tender', label: '招标文件' }]),
    ...(isExpansionWorkflow ? [{ id: 'originalPlan', label: '原方案' }] : []),
  ];
  const hasDocumentTabs = isExpansionWorkflow || tenderFiles.length > 1;
  const activeTenderSourceLoading = activeTenderSource && loadingTenderSourceId === activeTenderSource.id;

  return (
    <div className={`plan-step-body document-analysis-page technical-document-page${hasSectionHint ? ' has-section-hint' : ''}${hasDocumentTabs ? ' has-document-tabs' : ''}`}>
      <UploadBoard
        className="technical-document-upload-board"
        kicker="STEP 01"
        title="选择标书"
        subtitle={`默认解析方案：${configuredParserLabel}`}
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
              本地检测识别出
              {bidSectionDetection.totalDeclared
                ? ` ${bidSectionDetection.totalDeclared} 个标段/标包`
                : '多个标段/标包'}
              ，建议先识别并选择投标范围再继续。
            </span>
          </div>
          <button
            type="button"
            className="primary-action"
            onClick={() => void startBidSectionExtraction()}
            disabled={sectionExtracting || sectionExtractionRunning || !tenderFile}
          >
            {sectionExtractionRunning
              ? '识别中...'
              : bidSectionExtractionStatus === 'success'
                ? '重新识别标段'
                : '识别标段'}
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
            disabled={sectionExtracting || sectionExtractionRunning}
          >
            重试
          </button>
        </section>
      )}

      <section className="quick-config-section" aria-label="快速配置">
          <div className="quick-config-head">
            <span className="section-kicker">快速配置</span>
            <strong>先选好这些常用参数</strong>
            <small>所有选项都会同步到后续步骤，此处只做早选；如需精调，进入对应页面后再改。</small>
          </div>
          <div className="quick-config-grid">
            <article className="quick-config-card">
              <div className="quick-config-card-head">
                <strong>投标范围</strong>
                <small>STEP 02 也会同步</small>
              </div>
              {selectedSectionTitle ? (
                <>
                  <div className="quick-config-card-value quick-config-card-chip">{selectedSectionTitle}</div>
                  <div className="quick-config-card-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => setSectionSelectorOpen(true)}
                      disabled={bidSections.length < 2 || sectionExtracting}
                    >
                      {bidSections.length < 2 ? '需要先识别标段' : '更换标段'}
                    </button>
                  </div>
                </>
              ) : !tenderFile ? (
                <>
                  <div className="quick-config-card-value quick-config-card-muted">待上传招标文件</div>
                  <div className="quick-config-card-actions">
                    <span className="quick-config-card-hint">上传后可识别并选择标段</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="quick-config-card-value quick-config-card-muted">未选择</div>
                  <div className="quick-config-card-actions">
                    {bidSections.length >= 2 ? (
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => setSectionSelectorOpen(true)}
                      >
                        选择投标范围
                      </button>
                    ) : bidSectionMode === 'multiple' ? (
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => void startBidSectionExtraction()}
                        disabled={sectionExtracting || sectionExtractionRunning}
                      >
                        {sectionExtractionRunning ? '识别中...' : '开始识别'}
                      </button>
                    ) : (
                      <span className="quick-config-card-hint">下一步可调整</span>
                    )}
                  </div>
                </>
              )}
            </article>

            <article className="quick-config-card">
              <div className="quick-config-card-head">
                <strong>标书篇幅</strong>
                <small>STEP 03 也会同步</small>
              </div>
              <div className="quick-config-card-value">
                {outlineWordControlOptions.minimumWords > 0 || outlineWordControlOptions.maximumWords > 0
                  ? `${(outlineWordControlOptions.minimumWords / 10000).toFixed(1)}-${(outlineWordControlOptions.maximumWords / 10000).toFixed(1)} 万字`
                  : '默认（不控制）'}
              </div>
              <div className="quick-config-card-pills" role="radiogroup" aria-label="标书篇幅">
                {(Object.keys(pageLadderPresets) as PageLadderKey[]).map((key) => {
                  const preset = pageLadderPresets[key];
                  const isActive = key === pageLadderKey && preset.options.minimumWords === outlineWordControlOptions.minimumWords;
                  const isLoading = quickConfigSaving === `pageLadder:${key}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`quick-config-pill${isActive ? ' is-active' : ''}`}
                      onClick={() => void applyPageLadder(key)}
                      disabled={quickConfigSaving !== null}
                      title={preset.description}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.description}</small>
                    </button>
                  );
                })}
              </div>
              {outlineWordControlOptions.minimumWords > 0 &&
                pageLadderKey === 'none' && (
                  <small className="quick-config-card-note">
                    当前为自定义字数，将在 STEP 03 精调（每节 {outlineWordControlOptions.sectionWords} 字）
                  </small>
                )}
            </article>

            <article className="quick-config-card">
              <div className="quick-config-card-head">
                <strong>表格密度</strong>
                <small>STEP 05 也会同步</small>
              </div>
              <div className="quick-config-card-value">{tableDensityOptions.find((opt) => opt.value === resolvedContentOptions.tableRequirement)?.label || '大量'}</div>
              <div className="quick-config-card-pills" role="radiogroup" aria-label="表格密度">
                {tableDensityOptions.map((option) => {
                  const isActive = option.value === resolvedContentOptions.tableRequirement;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`quick-config-pill${isActive ? ' is-active' : ''}`}
                      onClick={() => void applyTableDensity(option.value)}
                      disabled={quickConfigSaving !== null}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </article>

            <article className="quick-config-card">
              <div className="quick-config-card-head">
                <strong>图片开关</strong>
                <small>STEP 05 也会同步</small>
              </div>
              <div className="quick-config-card-toggles">
                <label className="quick-config-toggle-row">
                  <span>
                    <strong>AI 生图</strong>
                    <small>需要图片模型可用</small>
                  </span>
                  <AppSwitch
                    checked={resolvedContentOptions.useAiImages}
                    onCheckedChange={(value) => void applyImageToggle('useAiImages', value)}
                    disabled={quickConfigSaving !== null}
                    aria-label="启用 AI 生图"
                  />
                </label>
                <label className="quick-config-toggle-row">
                  <span>
                    <strong>Mermaid 图</strong>
                    <small>流程图、时序图等</small>
                  </span>
                  <AppSwitch
                    checked={resolvedContentOptions.useMermaidImages}
                    onCheckedChange={(value) => void applyImageToggle('useMermaidImages', value)}
                    disabled={quickConfigSaving !== null}
                    aria-label="启用 Mermaid 图"
                  />
                </label>
                <label className="quick-config-toggle-row">
                  <span>
                    <strong>HTML 图</strong>
                    <small>甘特图、矩阵等</small>
                  </span>
                  <AppSwitch
                    checked={resolvedContentOptions.useHtmlImages}
                    onCheckedChange={(value) => void applyImageToggle('useHtmlImages', value)}
                    disabled={quickConfigSaving !== null}
                    aria-label="启用 HTML 图"
                  />
                </label>
              </div>
            </article>
          </div>
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
        className="technical-document-reader-card analysis-markdown-card"
        role={hasDocumentTabs ? 'tabpanel' : undefined}
        id={hasDocumentTabs ? `technical-document-panel-${activeDocumentTab}` : undefined}
        aria-labelledby={hasDocumentTabs ? `document-switch-tab-${activeDocumentTab}` : undefined}
      >
        <div className="analysis-result-head technical-document-reader-head">
          <strong>{documentLabels[visibleDocumentTab]}内容</strong>
          <span>{activeFile ? `${activeFile.fileName} · ${activeFile.markdownChars} 字` : '等待上传'}</span>
        </div>

        {activeTenderSourceLoading ? (
          <div className="markdown-empty-state">
            <strong>正在读取招标文件正文...</strong>
            <p>文件较大时需要稍等片刻。</p>
          </div>
        ) : activeMarkdown ? (
          <MarkdownFullscreenViewer title={`${documentLabels[visibleDocumentTab]}全屏预览`}>
            <MarkdownRenderer>
              {activeMarkdown}
            </MarkdownRenderer>
          </MarkdownFullscreenViewer>
        ) : (
          <div className="markdown-empty-state">
            <strong>尚未导入{documentLabels[visibleDocumentTab]}</strong>
            <p>{readerEmptyText}</p>
          </div>
        )}
      </section>

      <BidSectionSelectorDialog
        open={sectionSelectorOpen}
        sections={bidSections}
        busy={sectionExtracting}
        onSelect={(sectionId) => void handleSectionSelect(sectionId)}
        onCancel={handleSectionCancel}
      />
    </div>
  );
}

export default DocumentAnalysisPage;
