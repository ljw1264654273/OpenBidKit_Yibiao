import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { OutlineItem } from '../../../shared/types';
import { AppDialog, MarkdownEditor, MarkdownRenderer, ProgressBar, useToast, type MarkdownEditorSelection, type MarkdownEditorSelectionRequest } from '../../../shared/ui';
import type { BidProject } from '../../bid-project/types';
import ContentAiRewriteDrawer, { type ContentAiCandidate } from '../../technical-plan/components/ContentAiRewriteDrawer';
import ContentAiRewriteMenu, { type ContentAiRewriteMode } from '../../technical-plan/components/ContentAiRewriteMenu';
import { applyContentAiTextCandidate, createContentLengthEditSnapshot, validateContentAiEditSnapshot, type ContentAiEditSnapshot } from '../../technical-plan/services/contentAiEdit';
import type { HistoricalAdaptationContentMode, HistoricalAdaptationSourceSection, TechnicalPlanState } from '../../technical-plan/types';
import { renderMarkdownHtml } from '../../../shared/markdown/renderMarkdownHtml';
import { compareRenderedContent } from '../contentComparison';

interface AdaptationContentPageProps {
  projectId: string;
  project: BidProject | null;
  state: TechnicalPlanState;
  onStateChange: Dispatch<SetStateAction<TechnicalPlanState | null>>;
  onPreparePlan: (payload: { projectId: string; includeNodeId?: string; recommendationsOnly?: boolean }) => Promise<TechnicalPlanState>;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}

interface LeafEntry {
  item: OutlineItem;
  path: string[];
  ancestorIds: string[];
  level: number;
}

type PendingNavigation = { type: 'chapter'; nodeId: string } | { type: 'back' };
type ChapterMigration = { nodeId: string; mode: HistoricalAdaptationContentMode; instruction?: string };
type ChapterFilter = 'all' | 'incomplete' | 'complete';

const chapterFilterLabels: Record<ChapterFilter, string> = {
  all: '全部',
  incomplete: '未完成',
  complete: '已完成',
};

const modeLabels: Record<HistoricalAdaptationContentMode, string> = {
  direct: '直接迁移',
  'local-rewrite': '局部改写',
  rewrite: '定向改写',
};

const statusLabels = {
  idle: '待迁移',
  running: '迁移中',
  success: '已完成',
  review: '待人工处理',
  stale: '待重新迁移',
  error: '失败',
} as const;

function flattenLeaves(items: OutlineItem[], parents: string[] = [], level = 0, result: LeafEntry[] = [], ancestorIds: string[] = []) {
  for (const item of items) {
    const path = [...parents, item.title];
    if (item.children?.length) flattenLeaves(item.children, path, level + 1, result, [...ancestorIds, item.id]);
    else result.push({ item, path, level, ancestorIds });
  }
  return result;
}

function effectiveMode(item?: TechnicalPlanState['historicalAdaptationContentItems'][number]): HistoricalAdaptationContentMode | '' {
  return item?.manual_mode || item?.recommended_mode || '';
}

function effectiveInstruction(item?: TechnicalPlanState['historicalAdaptationContentItems'][number]) {
  return item?.manual_mode ? item.manual_instruction : item?.recommended_instruction || '';
}

function AdaptationContentPage({ projectId, project, state, onStateChange, onPreparePlan, onDirtyChange, onBack }: AdaptationContentPageProps) {
  const leaves = useMemo(() => flattenLeaves(state.outlineData?.outline || []), [state.outlineData]);
  const itemByNode = useMemo(() => new Map(
    state.historicalAdaptationContentItems.map((item) => [item.node_id, item]),
  ), [state.historicalAdaptationContentItems]);
  const [selectedId, setSelectedId] = useState(leaves[0]?.item.id || '');
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>('all');
  const visibleLeaves = useMemo(() => leaves.filter((entry) => {
    if (chapterFilter === 'all') return true;
    const complete = itemByNode.get(entry.item.id)?.status === 'success';
    return chapterFilter === 'complete' ? complete : !complete;
  }), [chapterFilter, itemByNode, leaves]);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'edit' | 'preview'>('preview');
  const [saving, setSaving] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sourceSection, setSourceSection] = useState<HistoricalAdaptationSourceSection | null>(null);
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceRetry, setSourceRetry] = useState(0);
  const [strategyMode, setStrategyMode] = useState<HistoricalAdaptationContentMode | ''>('');
  const [strategyInstruction, setStrategyInstruction] = useState('');
  const [editorSelection, setEditorSelection] = useState<MarkdownEditorSelection | null>(null);
  const [editorSelectionRequest, setEditorSelectionRequest] = useState<MarkdownEditorSelectionRequest>();
  const [aiEditMode, setAiEditMode] = useState<'expand' | 'shrink' | null>(null);
  const [aiEditSnapshot, setAiEditSnapshot] = useState<ContentAiEditSnapshot | null>(null);
  const [aiCandidate, setAiCandidate] = useState<ContentAiCandidate | null>(null);
  const [aiCandidateBusy, setAiCandidateBusy] = useState(false);
  const [aiEditError, setAiEditError] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [pendingManualOverwrite, setPendingManualOverwrite] = useState<ChapterMigration | null>(null);
  const strategyDefaults = useRef<{ nodeId?: string; mode: HistoricalAdaptationContentMode | ''; instruction: string }>({ mode: '', instruction: '' });
  const recommendationRequest = useRef('');
  const { showToast } = useToast();
  const migrationTask = state.historicalAdaptationContentTask;
  const checkTask = state.historicalAdaptationContentCheckTask;
  const migrationRunning = ['queued', 'running', 'pausing', 'paused'].includes(migrationTask?.status || '');
  const checkRunning = ['queued', 'running', 'pausing', 'paused'].includes(checkTask?.status || '');
  const running = migrationRunning || checkRunning || strategySaving || preparing || retrying;
  const selectedLeaf = leaves.find((entry) => entry.item.id === selectedId) || leaves[0];
  const selectedItem = selectedLeaf ? itemByNode.get(selectedLeaf.item.id) : undefined;
  const dirty = Boolean(selectedLeaf && draft !== (selectedLeaf.item.content || ''));
  const strategyChanged = Boolean(selectedItem && (strategyMode !== effectiveMode(selectedItem)
    || (strategyMode === 'rewrite' && strategyInstruction.trim() !== effectiveInstruction(selectedItem).trim())));
  const unsaved = dirty || strategyChanged;
  const addedLeaves = useMemo(() => {
    const addedIds = new Set(state.historicalAdaptationOutlineChanges.filter((change) => change.change_type === 'added').map((change) => change.target_node_id));
    return leaves.filter((leaf) => [...leaf.ancestorIds, leaf.item.id].some((id) => addedIds.has(id)));
  }, [leaves, state.historicalAdaptationOutlineChanges]);
  const hasHistoricalSource = Boolean(sourceNodeId === selectedItem?.node_id && sourceSection?.available);
  const retryCount = state.historicalAdaptationContentItems.filter((item) => ['idle', 'stale', 'error', 'running'].includes(item.status) && item.content_origin !== 'manual').length;
  const successCount = state.historicalAdaptationContentItems.filter((item) => item.status === 'success').length;
  const reviewCount = state.historicalAdaptationContentItems.filter((item) => ['review', 'stale', 'error'].includes(item.status)).length;
  const stageConfirmed = Boolean(state.historicalAdaptationContentConfirmedAt);
  const check = state.historicalAdaptationContentCheck;
  const checkBlockingCount = check.findings.filter((finding) => finding.blocking).length;
  const selectedDifferences = selectedItem?.difference_ids
    .map((id) => state.historicalAdaptationDifferences.find((difference) => difference.id === id))
    .filter(Boolean) || [];
  const comparison = useMemo(() => {
    if (!hasHistoricalSource || (!draft && !selectedItem?.content_origin)) return { before: [], after: [] };
    const renderedText = (value: string) => {
      const html = renderMarkdownHtml(value, { allowRawHtml: false, allowHtmlTables: true });
      return new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild?.textContent || '';
    };
    const changes = compareRenderedContent(sourceSection?.available ? sourceSection.content : undefined, draft, renderedText);
    return {
      before: changes.before.map((range) => ({ ...range, className: 'adaptation-content-diff-removed' })),
      after: changes.after.map((range) => ({ ...range, className: 'adaptation-content-diff-added' })),
    };
  }, [hasHistoricalSource, sourceSection, selectedItem?.content_origin, draft]);

  useEffect(() => {
    let active = true;
    setSourceSection(null);
    setSourceNodeId('');
    if (!selectedItem) { setSourceLoading(false); return; }
    setSourceLoading(true);
    void window.yibiao.technicalPlan.getHistoricalAdaptationSourceSection({ projectId, nodeId: selectedItem.node_id })
      .then((section) => {
        if (!active) return;
        setSourceSection(section);
        setSourceNodeId(selectedItem.node_id);
      })
      .catch((error) => {
        if (!active) return;
        setSourceSection({ available: false, content: '', error: error instanceof Error ? error.message : '历史原文读取失败' });
        setSourceNodeId(selectedItem.node_id);
      })
      .finally(() => { if (active) setSourceLoading(false); });
    return () => { active = false; };
  }, [projectId, selectedItem?.node_id, selectedItem?.source_section_id, selectedItem?.source_version_hash, sourceRetry]);

  useEffect(() => {
    if (!selectedLeaf && leaves[0]) setSelectedId(leaves[0].item.id);
  }, [leaves, selectedLeaf]);

  useEffect(() => {
    setDraft(selectedLeaf?.item.content || '');
    setEditorSelection(null);
    setAiEditMode(null);
    setAiEditSnapshot(null);
    setAiCandidate(null);
    setAiEditError('');
  }, [selectedLeaf?.item.content, selectedLeaf?.item.id]);

  useEffect(() => {
    const previous = strategyDefaults.current;
    const next = { nodeId: selectedLeaf?.item.id, mode: effectiveMode(selectedItem), instruction: effectiveInstruction(selectedItem) };
    const chapterChanged = previous.nodeId !== next.nodeId;
    setStrategyMode((value) => chapterChanged || value === previous.mode ? next.mode : value);
    setStrategyInstruction((value) => chapterChanged || value === previous.instruction ? next.instruction : value);
    strategyDefaults.current = next;
  }, [selectedLeaf?.item.id, selectedItem?.manual_instruction, selectedItem?.manual_mode, selectedItem?.recommended_instruction, selectedItem?.recommended_mode]);

  useEffect(() => {
    onDirtyChange(unsaved);
  }, [unsaved, onDirtyChange]);

  useEffect(() => {
    if (!state.historicalAdaptationOutlineConfirmedAt || running || saving || unsaved) return;
    const missing = addedLeaves.filter((leaf) => {
      const item = itemByNode.get(leaf.item.id);
      return !item || (!item.manual_mode && item.content_origin !== 'manual' && !item.recommended_instruction && item.error_code !== 'recommendation-failed');
    });
    if (!missing.length) return;
    const key = JSON.stringify([projectId, state.historicalAdaptationOutlineConfirmedAt, missing.map((leaf) => [leaf.item.id, leaf.path, leaf.item.description])]);
    if (recommendationRequest.current === key) return;
    recommendationRequest.current = key;
    setPreparing(true);
    void onPreparePlan({ projectId, recommendationsOnly: true })
      .catch((error) => showToast(error instanceof Error ? error.message : '推荐提纲准备失败，可点击“建立/更新迁移”重试', 'error'))
      .finally(() => setPreparing(false));
  }, [projectId, state.historicalAdaptationOutlineConfirmedAt, addedLeaves, itemByNode, running, saving, unsaved, onPreparePlan, showToast]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const continueNavigation = (navigation: PendingNavigation) => {
    setPendingNavigation(null);
    if (navigation.type === 'chapter') setSelectedId(navigation.nodeId);
    else onBack();
  };

  const requestNavigation = (navigation: PendingNavigation) => {
    if (navigation.type === 'chapter' && navigation.nodeId === selectedLeaf?.item.id) return;
    if (unsaved) {
      setPendingNavigation(navigation);
      return;
    }
    continueNavigation(navigation);
  };

  const preparePlan = async () => {
    if (running || saving) return;
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存后再迁移', 'info');
      return;
    }
    if (strategyChanged && selectedItem?.content_origin === 'manual') {
      showToast('当前章节是人工正文，请点击“按此方式迁移本章”并确认覆盖；批量迁移会保留人工正文', 'info');
      return;
    }
    if (strategyChanged && selectedItem?.recommended_mode === 'rewrite' && !selectedItem.manual_mode) {
      showToast('请校核定向改写要求后点击“按此方式迁移本章”，再进行批量迁移', 'info');
      return;
    }
    setPreparing(true);
    try {
      if (strategyChanged && selectedItem && strategyMode) {
        if (strategyMode === 'rewrite' && !strategyInstruction.trim()) {
          showToast('定向改写必须填写具体要求', 'info');
          return;
        }
        const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationContentStrategy({
          projectId, nodeId: selectedItem.node_id, mode: strategyMode,
          instruction: strategyMode === 'rewrite' ? strategyInstruction.trim() : undefined,
        });
        onStateChange(nextState);
      }
      await onPreparePlan({ projectId, ...(strategyChanged && selectedItem ? { includeNodeId: selectedItem.node_id } : {}) });
      setView('preview');
      showToast(selectedItem && !strategyMode
        ? '可迁移章节已启动；当前章节仍需选择迁移方式'
        : '迁移已启动；待处理章节将按推荐或当前选择的方式执行，人工正文保留', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(`建立/更新迁移失败：${message}`, 'error');
    } finally {
      setPreparing(false);
    }
  };

  const retryIncomplete = async () => {
    if (running || saving || dirty) return;
    setRetrying(true);
    try {
      await window.yibiao.tasks.retryHistoricalAdaptationContent({ projectId });
      showToast('未完成章节已开始重试，已完成及人工正文保留', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重试正文迁移失败', 'error');
    } finally {
      setRetrying(false);
    }
  };

  const resetStrategies = async () => {
    if (running || saving) return;
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存人工修改后再恢复默认', 'info');
      return;
    }
    setStrategySaving(true);
    try {
      const nextState = await window.yibiao.technicalPlan.resetHistoricalAdaptationContentStrategies({ projectId });
      onStateChange(nextState);
      setStrategyMode(effectiveMode(nextState.historicalAdaptationContentItems.find((item) => item.node_id === selectedLeaf?.item.id)));
      setStrategyInstruction(effectiveInstruction(nextState.historicalAdaptationContentItems.find((item) => item.node_id === selectedLeaf?.item.id)));
      showToast('已恢复默认处理方式；点击“建立/更新迁移”更新正文，已保存的人工正文保留', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '恢复默认处理方式失败', 'error');
    } finally {
      setStrategySaving(false);
    }
  };

  const migrateChapter = async (request?: ChapterMigration, forceOverwriteManual = false) => {
    if (!selectedItem || running) return;
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存人工修改后再迁移', 'info');
      return;
    }
    const mode = request?.mode || strategyMode;
    if (!mode) return;
    const migration = request || {
      nodeId: selectedItem.node_id,
      mode,
      instruction: mode === 'rewrite' ? strategyInstruction.trim() : undefined,
    };
    if (migration.mode === 'rewrite' && !migration.instruction) {
      showToast('定向改写必须填写具体要求', 'info');
      return;
    }
    if (itemByNode.get(migration.nodeId)?.content_origin === 'manual' && !forceOverwriteManual) {
      setPendingManualOverwrite(migration);
      return;
    }
    setPendingManualOverwrite(null);
    setStrategySaving(true);
    let strategyApplied = false;
    try {
      const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationContentStrategy({
        projectId,
        ...migration,
      });
      strategyApplied = true;
      onStateChange(nextState);
      await window.yibiao.tasks.startHistoricalAdaptationContent({
        projectId,
        nodeId: migration.nodeId,
        ...(forceOverwriteManual ? { forceOverwriteManual: true } : {}),
      });
      showToast(`当前章节已按“${modeLabels[migration.mode]}”开始迁移`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      showToast(strategyApplied ? `方式已应用，迁移启动失败：${message}。请重试迁移。` : `迁移方式未应用：${message}`, 'error');
    } finally {
      setStrategySaving(false);
    }
  };

  const runConsistencyCheck = async () => {
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存后再检查', 'info');
      return;
    }
    try {
      await window.yibiao.tasks.startHistoricalAdaptationContentCheck({ projectId });
      showToast('一致性检查已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动一致性检查失败', 'error');
    }
  };

  const saveCurrent = async () => {
    if (!selectedLeaf) return;
    setSaving(true);
    try {
      const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationChapterContent({ projectId, nodeId: selectedLeaf.item.id, content: draft });
      onStateChange(nextState);
      showToast('当前章节正文已保存；请重新运行一致性检查', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存章节正文失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openLengthEdit = (mode: ContentAiRewriteMode) => {
    if (mode !== 'expand' && mode !== 'shrink') return;
    if (!selectedLeaf || running) return;
    try {
      const snapshot = createContentLengthEditSnapshot({
        nodeId: selectedLeaf.item.id,
        content: draft,
        selectionStart: editorSelection?.start || 0,
        selectionEnd: editorSelection?.end || 0,
        surface: editorSelection?.surface || 'inline',
      });
      setAiEditMode(mode);
      setAiEditSnapshot(snapshot);
      setAiCandidate(null);
      setAiEditError('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法处理当前选区', 'info');
    }
  };

  const generateLengthCandidate = async (instruction: string) => {
    if (!selectedLeaf || !aiEditMode || !aiEditSnapshot) return;
    setAiCandidateBusy(true);
    setAiEditError('');
    try {
      const candidate = await window.yibiao.technicalPlan.aiEditContent({
        projectId,
        nodeId: selectedLeaf.item.id,
        nodeTitle: selectedLeaf.item.title,
        nodeDescription: selectedLeaf.item.description,
        content: aiEditSnapshot.content,
        selectionStart: aiEditSnapshot.selectionStart,
        selectionEnd: aiEditSnapshot.selectionEnd,
        instruction,
        mode: aiEditMode,
      });
      setAiCandidate(candidate);
    } catch (error) {
      setAiEditError(error instanceof Error ? error.message : 'AI 生成失败');
    } finally {
      setAiCandidateBusy(false);
    }
  };

  const applyLengthCandidate = () => {
    if (!selectedLeaf || !aiEditSnapshot || !aiCandidate || 'assetUrl' in aiCandidate || aiCandidate.mode === 'continue') return;
    const validation = validateContentAiEditSnapshot({ currentNodeId: selectedLeaf.item.id, currentContent: draft, snapshot: aiEditSnapshot });
    if (!validation.valid) {
      setAiEditError(validation.message);
      return;
    }
    const result = applyContentAiTextCandidate({
      currentNodeId: selectedLeaf.item.id,
      currentContent: draft,
      snapshot: aiEditSnapshot,
      mode: aiCandidate.mode,
      candidateText: aiCandidate.replacementText,
    });
    setDraft(result.content);
    setEditorSelectionRequest({ ...result.selection, surface: aiEditSnapshot.surface, requestId: `adaptation-length-${Date.now()}` });
    setAiEditMode(null);
    setAiEditSnapshot(null);
    setAiCandidate(null);
    setAiEditError('');
    showToast('候选已应用到草稿，点击保存后写入正文', 'success');
  };

  const closeLengthEdit = () => {
    setAiEditMode(null);
    setAiEditSnapshot(null);
    setAiCandidate(null);
    setAiEditError('');
  };

  const confirmStage = async () => {
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存', 'info');
      return;
    }
    try {
      const readiness = await window.yibiao.technicalPlan.getHistoricalAdaptationContentReadiness({ projectId });
      if (!readiness.ready) {
        if (readiness.firstNodeId) setSelectedId(readiness.firstNodeId);
        showToast(`仍有 ${readiness.blockingCount} 个阻断问题，请先处理并重新检查`, 'info');
        return;
      }
      const nextState = await window.yibiao.technicalPlan.confirmHistoricalAdaptationContent({ projectId });
      onStateChange(nextState);
      showToast('正文迁移已按阶段统一确认', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '确认正文迁移失败', 'error');
    }
  };

  const checkStatusLabel = checkRunning
    ? '检查中'
    : check.status === 'success'
      ? checkBlockingCount ? `${checkBlockingCount} 个阻断问题` : '检查通过'
      : check.status === 'stale' ? '结果已失效' : check.status === 'error' ? '检查失败' : '尚未检查';

  return (
    <div className="historical-adaptation-content-page">
      <header className="historical-adaptation-content-head">
        <div>
          <span className="section-kicker">环节五 · 正文迁移</span>
          <h1>{project?.projectName || '历史标书适配项目'}</h1>
        </div>
        <div className="historical-adaptation-content-actions">
          <button type="button" className="secondary-action" onClick={() => requestNavigation({ type: 'back' })}>返回我的标书</button>
          <button type="button" className="primary-action" disabled={running || saving || dirty} title={dirty ? '请先保存人工修改' : '应用当前选择，建立方案并迁移待处理章节；保留人工正文'} onClick={() => { void preparePlan(); }}>{preparing ? '建立迁移中...' : '建立/更新迁移'}</button>
          <button type="button" className="secondary-action" disabled={running || saving || dirty || !retryCount} onClick={() => { void retryIncomplete(); }}>{retrying ? '重试启动中...' : '重试未完成章节'}</button>
          <button type="button" className="secondary-action" disabled={running || saving || dirty || !state.historicalAdaptationContentItems.length} title={dirty ? '请先保存人工修改' : '清除全部人工选择和改写要求，恢复默认规则；正文在执行迁移后更新，已保存的人工正文保留'} onClick={() => { void resetStrategies(); }}>恢复默认处理方式</button>
        </div>
      </header>

      <section className="historical-adaptation-content-overview" aria-label="正文迁移进度">
        <div><span>正文章节</span><strong>{leaves.length}</strong></div>
        <div><span>迁移完成</span><strong className="is-success">{successCount}</strong></div>
        <div><span>待人工处理 / 失败</span><strong className={reviewCount ? 'is-warning' : ''}>{reviewCount}</strong></div>
        <div className="historical-adaptation-content-progress">
          <span>{preparing ? '正在建立并启动迁移' : migrationRunning ? '后台迁移中' : checkRunning ? '一致性检查中' : migrationTask?.status === 'error' ? '迁移任务异常' : stageConfirmed ? '本阶段已确认' : '等待迁移或审阅'}</span>
          <ProgressBar value={migrationTask?.progress || (stageConfirmed ? 100 : leaves.length ? Math.round((successCount / leaves.length) * 100) : 0)} />
        </div>
      </section>

      {migrationTask?.status === 'error' ? <div className="historical-adaptation-content-error">{migrationTask.error || '正文迁移任务失败，请重试。'}</div> : null}

      <div className="adaptation-content-diff-legend" aria-label="修改对比说明">
        <span><mark className="adaptation-content-diff-removed">修改前 / 已删除</mark>历史正文</span>
        <span><mark className="adaptation-content-diff-added">修改后 / 新增</mark>迁移后正文</span>
      </div>

      <section className="historical-adaptation-content-workbench">
        <div className="adaptation-content-column is-outline">
          <header>
            <div className="adaptation-content-outline-heading"><strong>适配目录</strong><span>{chapterFilter === 'all' ? `${leaves.length} 章` : `${visibleLeaves.length} / ${leaves.length} 章`}</span></div>
            <div className="adaptation-content-outline-filters" role="group" aria-label="章节完成状态筛选">
              {(Object.keys(chapterFilterLabels) as ChapterFilter[]).map((filter) => (
                <button type="button" key={filter} className={chapterFilter === filter ? 'is-active' : ''} aria-pressed={chapterFilter === filter} onClick={() => setChapterFilter(filter)}>{chapterFilterLabels[filter]}</button>
              ))}
            </div>
          </header>
          <div className="adaptation-content-outline-list">
            {!visibleLeaves.length ? <div className="adaptation-content-empty">{chapterFilter === 'incomplete' ? '没有未完成章节' : chapterFilter === 'complete' ? '暂无已完成章节' : '暂无正文章节'}</div> : null}
            {visibleLeaves.map((entry) => {
              const migration = itemByNode.get(entry.item.id);
              return (
                <button type="button" key={entry.item.id} className={`${entry.item.id === selectedLeaf?.item.id ? 'is-selected' : ''}${migration?.status === 'success' ? ' is-confirmed' : ''}`} onClick={() => requestNavigation({ type: 'chapter', nodeId: entry.item.id })}>
                  <span>{entry.item.id}</span>
                  <div><strong title={entry.path.join(' / ')}>{entry.item.title}</strong><small>{statusLabels[migration?.status || 'idle']}</small></div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="adaptation-content-column is-source">
          <header><strong>历史原文 / 迁移依据</strong><span>{selectedItem ? modeLabels[effectiveMode(selectedItem) as HistoricalAdaptationContentMode] || '待选择方式' : '未建立方案'}</span></header>
          <div className="adaptation-content-source">
            {selectedItem ? (
              <>
                <section className="adaptation-content-strategy">
                  <label htmlFor="adaptation-content-mode">迁移方式</label>
                  <select id="adaptation-content-mode" value={strategyMode} disabled={running || strategySaving} onChange={(event) => setStrategyMode(event.target.value as HistoricalAdaptationContentMode)}>
                    {!strategyMode ? <option value="" disabled>请选择迁移方式</option> : null}
                    {Object.entries(modeLabels).map(([mode, label]) => <option key={mode} value={mode} disabled={mode !== 'rewrite' && !hasHistoricalSource}>{label}</option>)}
                  </select>
                  {strategyMode === 'rewrite' ? <label>定向改写要求<textarea value={strategyInstruction} disabled={running} onChange={(event) => setStrategyInstruction(event.target.value)} placeholder="说明需要改写或补充的重点、边界和表达要求" /></label> : null}
                  <small>{strategyMode === 'direct' ? '完整复制历史正文，不调用 AI。' : strategyMode === 'local-rewrite' ? '仅调整地点与实施对象、工作量、工期进度，保留其余正文。' : strategyMode === 'rewrite' ? hasHistoricalSource ? '按填写的要求改写本章历史正文。' : '本章无可靠历史正文，将按招标基线和填写的要求补充生成。' : '本章无可靠历史正文，可选择定向改写补充生成，或直接编辑正文。'}</small>
                  <small role="status">{selectedItem.recommended_mode === 'rewrite' && !selectedItem.manual_mode
                    ? migrationRunning || preparing ? '正在准备新增章节的推荐提纲...' : '请校核或调整推荐提纲，再点击“按此方式迁移本章”生成正文。'
                    : strategyChanged ? '选择尚未应用，可迁移本章或点击上方按钮建立并执行迁移。' : '选择方式不会改变正文，点击迁移按钮才执行。'}</small>
                  <button type="button" className="primary-action" disabled={running || saving || dirty || !strategyMode || (strategyMode === 'rewrite' && !strategyInstruction.trim())} title={dirty ? '请先保存人工修改' : undefined} onClick={() => { void migrateChapter(); }}>{strategySaving ? '启动迁移中...' : '按此方式迁移本章'}</button>
                  <small>系统推荐：{selectedItem.recommended_mode ? modeLabels[selectedItem.recommended_mode] : '待人工选择'}{selectedItem.manual_mode ? ' · 已人工调整' : ''}</small>
                </section>
                <dl>
                  <div><dt>历史路径</dt><dd>{selectedItem.source_path || '未可靠定位'}</dd></div>
                  <div><dt>处理原因</dt><dd>{selectedItem.reason || '待补充'}</dd></div>
                  <div><dt>正文来源</dt><dd>{selectedItem.content_origin || '尚未生成'}</dd></div>
                </dl>
                {selectedItem.residuals.length ? <div className="adaptation-content-residual"><strong>检测到历史残留</strong><span>{selectedItem.residuals.join('、')}</span></div> : null}
                {selectedItem.error ? <div className="adaptation-content-residual"><strong>本章迁移失败</strong><span>{selectedItem.error}</span></div> : null}
                <section><h2>历史正文</h2>{sourceLoading ? <div className="adaptation-content-empty" role="status">正在读取历史原文...</div> : hasHistoricalSource ? <div className="markdown-viewer adaptation-content-source-markdown"><MarkdownRenderer allowRawHtml={false} allowHtmlTables preserveTableCellSpans textHighlights={comparison.before}>{sourceSection?.content || '历史章节正文为空。'}</MarkdownRenderer></div> : <div className="adaptation-content-source-unavailable"><span>{sourceSection?.error || '本章无可靠历史原文，无法显示修改对比。'}</span><button type="button" className="text-button" onClick={() => setSourceRetry((value) => value + 1)}>重新读取原文</button></div>}</section>
                <section>
                  <h2>关联差异</h2>
                  {selectedDifferences.length ? selectedDifferences.map((difference) => difference ? <article key={difference.id}><span>{difference.category}</span><strong>{difference.title}</strong><p>{difference.action}</p></article> : null) : <p className="adaptation-content-no-difference">无直接关联差异</p>}
                </section>
              </>
            ) : <div className="adaptation-content-empty">{preparing ? '正在准备新增章节的推荐提纲...' : '点击“建立/更新迁移”，自动按推荐方式迁移正文。'}</div>}
          </div>
        </div>

        <div className="adaptation-content-column is-editor">
          <header>
            <strong>迁移后正文</strong>
            <div className="adaptation-content-editor-tools">
              {view === 'edit' ? <ContentAiRewriteMenu selection={editorSelection} disabled={running || !selectedLeaf} compact enableLengthEditing lengthEditingOnly onSelect={openLengthEdit} /> : null}
              <div className="adaptation-content-view-switch"><button type="button" className={view === 'edit' ? 'is-active' : ''} onClick={() => setView('edit')}>编辑</button><button type="button" className={view === 'preview' ? 'is-active' : ''} disabled={!hasHistoricalSource} onClick={() => setView('preview')}>修改对比</button></div>
            </div>
          </header>
          <div className="adaptation-content-editor-body">
            {selectedLeaf ? view === 'edit' ? <MarkdownEditor value={draft} onChange={(value) => { setDraft(value); if (aiCandidate) setAiEditError('正文已发生变化，请重新生成候选'); }} onSelectionChange={setEditorSelection} selectionRequest={editorSelectionRequest} disabled={running} className="adaptation-content-markdown-editor" fullscreenTitle={`${selectedLeaf.item.id} ${selectedLeaf.item.title}`} toolbarEnd={(surface) => <ContentAiRewriteMenu selection={editorSelection?.surface === surface ? editorSelection : null} disabled={running} compact enableLengthEditing lengthEditingOnly onSelect={openLengthEdit} />} /> : <div className="markdown-viewer adaptation-content-preview"><MarkdownRenderer allowRawHtml={false} allowHtmlTables preserveTableCellSpans textHighlights={comparison.after}>{draft || '当前章节正文为空。'}</MarkdownRenderer></div> : <div className="adaptation-content-empty">当前没有可编辑章节。</div>}
          </div>
          <footer>
            <button type="button" className="primary-action" disabled={running || saving || !selectedLeaf || !dirty} onClick={() => { void saveCurrent(); }}>{saving ? '保存中...' : '保存人工修改'}</button>
          </footer>
        </div>
      </section>

      <section className={`historical-adaptation-content-check${check.status === 'success' && !checkBlockingCount ? ' is-complete' : ''}`}>
        <header>
          <div><span className="section-kicker">一致性检查</span><strong>{checkStatusLabel}</strong><p>检查工作量、工期进度、跨章节冲突、历史残留与待核实占位符。</p></div>
          <button type="button" className="secondary-action" disabled={running || !state.historicalAdaptationContentItems.length} onClick={() => { void runConsistencyCheck(); }}>运行一致性检查</button>
        </header>
        {check.error ? <div className="historical-adaptation-content-error">{check.error}</div> : null}
        {check.findings.length ? <div className="adaptation-content-check-findings">{check.findings.map((finding) => <button type="button" key={finding.id} onClick={() => finding.node_ids[0] && requestNavigation({ type: 'chapter', nodeId: finding.node_ids[0] })}><span>{finding.severity}{finding.blocking ? ' · 阻断' : ''}</span><strong>{finding.message}</strong>{finding.evidence ? <small>{finding.evidence}</small> : null}</button>)}</div> : null}
      </section>

      <section className={`historical-adaptation-content-acceptance${stageConfirmed ? ' is-complete' : ''}`}>
        <div><strong>{stageConfirmed ? '正文迁移已按阶段确认' : '完成一致性检查后统一确认'}</strong><span>{stageConfirmed ? '审核导出已开放。' : '无需逐章点击确认；系统会一次校验全部章节、检查快照和阻断问题。'}</span></div>
        {stageConfirmed ? <span>已确认</span> : <button type="button" className="primary-action" disabled={running || dirty || !state.historicalAdaptationContentItems.length} title={dirty ? '请先保存当前章节' : undefined} onClick={() => { void confirmStage(); }}>确认本阶段</button>}
      </section>

      <AppDialog open={Boolean(pendingNavigation)} onOpenChange={(open) => !open && setPendingNavigation(null)} kicker="未保存修改" title="当前章节有未保存修改" description="继续操作会放弃当前章节尚未保存的内容。" actions={<><button type="button" className="secondary-action" onClick={() => setPendingNavigation(null)}>继续编辑</button><button type="button" className="danger-action" onClick={() => pendingNavigation && continueNavigation(pendingNavigation)}>放弃修改并继续</button></>} />
      <AppDialog open={Boolean(pendingManualOverwrite)} onOpenChange={(open) => !open && setPendingManualOverwrite(null)} kicker="人工正文保护" title="覆盖人工正文" description="按所选方式迁移会覆盖当前章节已人工保存的正文。此操作仅影响当前章节。" actions={<><button type="button" className="secondary-action" onClick={() => setPendingManualOverwrite(null)}>取消</button><button type="button" className="danger-action" onClick={() => pendingManualOverwrite && void migrateChapter(pendingManualOverwrite, true)}>确认覆盖并迁移</button></>} />
      <ContentAiRewriteDrawer open={Boolean(aiEditMode && aiEditSnapshot)} mode={aiEditMode} chapterTitle={selectedLeaf ? `${selectedLeaf.item.id} ${selectedLeaf.item.title}` : ''} snapshot={aiEditSnapshot} candidate={aiCandidate} busy={aiCandidateBusy} error={aiEditError} imageModelAvailable={false} onGenerateText={(instruction) => { void generateLengthCandidate(instruction); }} onGenerateImage={() => undefined} onImportFile={() => undefined} onImportDataUrl={() => undefined} onApply={applyLengthCandidate} onDiscard={closeLengthEdit} />
    </div>
  );
}

export default AdaptationContentPage;
