import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { OutlineItem } from '../../../shared/types';
import { AppDialog, MarkdownEditor, MarkdownRenderer, ProgressBar, useToast, type MarkdownEditorSelection, type MarkdownEditorSelectionRequest } from '../../../shared/ui';
import type { BidProject } from '../../bid-project/types';
import ContentAiRewriteDrawer, { type ContentAiCandidate } from '../../technical-plan/components/ContentAiRewriteDrawer';
import ContentAiRewriteMenu, { type ContentAiRewriteMode } from '../../technical-plan/components/ContentAiRewriteMenu';
import { applyContentAiTextCandidate, createContentLengthEditSnapshot, validateContentAiEditSnapshot, type ContentAiEditSnapshot } from '../../technical-plan/services/contentAiEdit';
import type { HistoricalAdaptationContentFactEntry, HistoricalAdaptationContentFactsSnapshot, HistoricalAdaptationContentMode, HistoricalAdaptationSourceSection, TechnicalPlanState } from '../../technical-plan/types';
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

type PendingNavigation = { type: 'chapter'; nodeId: string; reveal?: boolean } | { type: 'back' };
type ChapterMigration = { nodeId: string; mode: HistoricalAdaptationContentMode; instruction?: string };
type ChapterFilter = 'all' | 'incomplete' | 'complete';

const chapterFilterLabels: Record<ChapterFilter, string> = {
  all: '全部',
  incomplete: '未完成',
  complete: '已完成',
};

const factFields = [
  ['name', 'project_name', '项目名称'], ['name', 'project_number', '项目编号'],
  ['name', 'client_name', '采购人名称'], ['name', 'provider_name', '投标人名称'],
  ['location', 'project_location', '项目地点'], ['location', 'service_location', '服务地点'], ['location', 'client_address', '采购人地址'],
  ['object', 'service_object', '服务对象'], ['object', 'deliverable', '成果对象'], ['object', 'coordinate_system', '坐标系统'],
  ['workload', 'service_quantity', '工作量'], ['workload', 'staffing', '人员配备'], ['workload', 'threshold', '数量阈值'],
  ['amount', 'budget', '预算金额'], ['amount', 'fee', '费用'], ['amount', 'bid_amount', '投标金额'], ['amount', 'unit_price', '单价'],
  ['schedule', 'contract_duration', '合同期限'], ['schedule', 'completion_deadline', '完成期限'], ['schedule', 'milestone', '进度节点'], ['schedule', 'payment_schedule', '付款安排'],
  ['service', 'service_scope', '服务范围'], ['service', 'deliverable_scope', '成果范围'], ['service', 'method', '实施方法'],
] as const;
const factKindLabels: Record<string, string> = { name: '名称', location: '地点', object: '对象', workload: '工作量', amount: '金额', schedule: '工期进度', service: '服务内容' };

function mergeFactEntries(snapshot: HistoricalAdaptationContentFactsSnapshot): HistoricalAdaptationContentFactEntry[] {
  const entries = new Map(snapshot.facts.map((fact) => [String(fact.fact_key || fact.fact_id || ''), fact]));
  for (const override of snapshot.overrides) {
    const fact = entries.get(override.fact_key);
    entries.set(override.fact_key, fact
      ? { ...fact, canonical_value: override.canonical_value, manually_overridden: true, conflict: false }
      : { fact_key: override.fact_key, kind: override.kind, canonical_value: override.canonical_value, manually_overridden: true, chapter_node_ids: [], evidence: [override.note || '人工补录事实'] });
  }
  return [...entries.values()];
}

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

const checkStageLabels: Record<NonNullable<TechnicalPlanState['historicalAdaptationContentCheck']['stage']>, string> = {
  precheck: '预检中',
  facts: '提取全文事实',
  semantic: '检查跨章节口径',
  repair: '自动修复',
  recheck: '复查全文',
};

const missingFactsBridgeMessage = '当前客户端尚未加载全文事实修复接口。请完全退出并重新打开客户端（仅刷新页面或等待热更新不够），再打开本页面重试。';

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

function isEmptyHistoricalSource(
  item: TechnicalPlanState['historicalAdaptationContentItems'][number] | undefined,
  sourceSection: HistoricalAdaptationSourceSection | null,
  sourceNodeId: string,
) {
  return Boolean(item
    && sourceNodeId === item.node_id
    && item.source_path
    && item.source_section_id
    && !item.source_content_hash
    && !item.source_excerpt
    && sourceSection?.available === false
    && /历史原文为空/u.test(sourceSection.error || ''));
}

function AdaptationContentPage({ projectId, project, state, onStateChange, onPreparePlan, onDirtyChange, onBack }: AdaptationContentPageProps) {
  const leaves = useMemo(() => flattenLeaves(state.outlineData?.outline || []), [state.outlineData]);
  const itemByNode = useMemo(() => new Map(
    state.historicalAdaptationContentItems.map((item) => [item.node_id, item]),
  ), [state.historicalAdaptationContentItems]);
  const [selectedId, setSelectedId] = useState(leaves[0]?.item.id || '');
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>('all');
  const [revealTarget, setRevealTarget] = useState<{ nodeId: string } | null>(null);
  const workbenchRef = useRef<HTMLElement>(null);
  const outlineListRef = useRef<HTMLDivElement>(null);
  const outlineRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const visibleLeaves = useMemo(() => leaves.filter((entry) => {
    if (chapterFilter === 'all') return true;
    const complete = itemByNode.get(entry.item.id)?.status === 'success';
    return chapterFilter === 'complete' ? complete : !complete;
  }), [chapterFilter, itemByNode, leaves]);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'edit' | 'preview'>('preview');
  const [saving, setSaving] = useState(false);
  const [chapterConfirming, setChapterConfirming] = useState(false);
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
  const [pendingPlaceholderConfirmation, setPendingPlaceholderConfirmation] = useState(false);
  const [factsDialogOpen, setFactsDialogOpen] = useState(false);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsSaving, setFactsSaving] = useState(false);
  const [factsSnapshot, setFactsSnapshot] = useState<HistoricalAdaptationContentFactsSnapshot | null>(null);
  const [factDrafts, setFactDrafts] = useState<Record<string, string>>({});
  const [factEntries, setFactEntries] = useState<HistoricalAdaptationContentFactEntry[]>([]);
  const [newFactSlot, setNewFactSlot] = useState<string>('project_name');
  const [newFactValue, setNewFactValue] = useState('');
  const [newFactNote, setNewFactNote] = useState('');
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
  const factsEditable = Boolean(factsSnapshot?.contentHash && factsSnapshot.inputsHash && factsSnapshot.protocolHash);
  const selectedNeedsManualConfirmation = Boolean(selectedItem && !selectedItem.confirmed_at && (
    selectedItem.status !== 'success'
    || selectedItem.residuals.length > 0
    || !draft.trim()
    || /【(?:待核实|待补充)】/u.test(draft)
    || state.historicalAdaptationContentCheck.findings.some((finding) => (finding.code === 'plan-stale' || finding.code === 'source-stale') && finding.node_ids.includes(selectedItem.node_id))
  ));
  const strategyChanged = Boolean(selectedItem && (strategyMode !== effectiveMode(selectedItem)
    || (strategyMode === 'rewrite' && strategyInstruction.trim() !== effectiveInstruction(selectedItem).trim())));
  const unsaved = dirty || strategyChanged;
  const addedLeaves = useMemo(() => {
    const addedIds = new Set(state.historicalAdaptationOutlineChanges.filter((change) => change.change_type === 'added').map((change) => change.target_node_id));
    return leaves.filter((leaf) => [...leaf.ancestorIds, leaf.item.id].some((id) => addedIds.has(id)));
  }, [leaves, state.historicalAdaptationOutlineChanges]);
  const hasHistoricalSource = Boolean(sourceNodeId === selectedItem?.node_id && sourceSection?.available);
  const emptySourceRewritePending = strategyMode === 'rewrite'
    && !strategyInstruction.trim()
    && isEmptyHistoricalSource(selectedItem, sourceSection, sourceNodeId);
  const retryCount = state.historicalAdaptationContentItems.filter((item) => ['idle', 'stale', 'error', 'running'].includes(item.status) && item.content_origin !== 'manual').length;
  const successCount = state.historicalAdaptationContentItems.filter((item) => item.status === 'success').length;
  const reviewCount = state.historicalAdaptationContentItems.filter((item) => ['review', 'stale', 'error'].includes(item.status)).length;
  const stageConfirmed = Boolean(state.historicalAdaptationContentConfirmedAt);
  const check = state.historicalAdaptationContentCheck;
  const checkStage = state.historicalAdaptationContentCheck.stage;
  const checkBlockingCount = check.findings.filter((finding) => finding.blocking).length;
  const blockerNodeIds = new Set(check.findings.filter((finding) => finding.blocking).flatMap((finding) => finding.node_ids));
  const checkAdvisoryCount = check.findings.filter((finding) => !finding.blocking).length;
  const checkStageLabel = checkStage ? (checkStage === 'repair' ? `自动修复第 ${check.repair_round || 1} 轮` : checkStageLabels[checkStage]) : '';
  const autoRepairedCount = check.auto_repaired_count || 0;
  const manualCount = check.manual_count || 0;
  const placeholderFindings = check.findings.filter((finding) => finding.category === 'placeholder' || finding.code === 'unresolved-placeholder');
  const detectedPlaceholderCount = useMemo(() => leaves.reduce((count, leaf) => count + ((leaf.item.content || '').match(/【(?:待核实|待补充)】/gu) || []).length, 0), [leaves]);
  const placeholderCount = Math.max(detectedPlaceholderCount, placeholderFindings.reduce((count, finding) => count + (finding.evidence.match(/【(?:待核实|待补充)】/gu) || []).length, 0));
  const hasPlaceholders = placeholderCount > 0;
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
    if (!selectedItem || strategyMode !== 'rewrite' || strategyInstruction.trim() || running || saving || unsaved && selectedItem.manual_mode
      || !isEmptyHistoricalSource(selectedItem, sourceSection, sourceNodeId)) return;
    const key = JSON.stringify(['empty-source-rewrite', projectId, selectedItem.node_id, selectedItem.input_fingerprint]);
    if (recommendationRequest.current === key) return;
    recommendationRequest.current = key;
    setPreparing(true);
    void onPreparePlan({ projectId, includeNodeId: selectedItem.node_id, recommendationsOnly: true })
      .catch((error) => showToast(error instanceof Error ? `推荐提纲生成失败：${error.message}` : '推荐提纲生成失败，可直接填写定向改写要求', 'error'))
      .finally(() => setPreparing(false));
  }, [projectId, selectedItem, sourceSection, sourceNodeId, strategyMode, strategyInstruction, running, saving, unsaved, onPreparePlan, showToast]);

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

  useEffect(() => {
    if (!revealTarget || chapterFilter !== 'all') return;
    const frame = requestAnimationFrame(() => {
      const list = outlineListRef.current;
      const row = outlineRowRefs.current.get(revealTarget.nodeId);
      if (list && row) {
        const listRect = list.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        list.scrollTop += rowRect.top - listRect.top - (listRect.height - rowRect.height) / 2;
        workbenchRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      setRevealTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealTarget, chapterFilter]);

  const continueNavigation = (navigation: PendingNavigation) => {
    setPendingNavigation(null);
    if (navigation.type === 'chapter') {
      setSelectedId(navigation.nodeId);
      if (navigation.reveal) {
        setChapterFilter('all');
        setRevealTarget({ nodeId: navigation.nodeId });
      }
    }
    else onBack();
  };

  const requestNavigation = (navigation: PendingNavigation) => {
    if (navigation.type === 'chapter' && navigation.nodeId === selectedLeaf?.item.id) {
      if (navigation.reveal) continueNavigation(navigation);
      return;
    }
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

  const handleStrategyModeChange = (mode: HistoricalAdaptationContentMode) => {
    setStrategyMode(mode);
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

  const openFactsDialog = async () => {
    setFactsDialogOpen(true);
    setFactsLoading(true);
    setFactEntries([]);
    setFactDrafts({});
    setNewFactValue('');
    setNewFactNote('');
    if (typeof window.yibiao.technicalPlan.getHistoricalAdaptationContentFacts !== 'function') {
      setFactsSnapshot({ ok: false, code: 'unavailable', message: missingFactsBridgeMessage, contentHash: '', inputsHash: '', protocolHash: '', checkStatus: check.status, facts: [], overrides: [] });
      showToast(missingFactsBridgeMessage, 'error');
      setFactsLoading(false);
      return;
    }
    try {
      const snapshot = await window.yibiao.technicalPlan.getHistoricalAdaptationContentFacts({ projectId });
      setFactsSnapshot(snapshot);
      const entries = mergeFactEntries(snapshot);
      setFactEntries(entries);
      setFactDrafts(Object.fromEntries(entries.map((fact) => [String(fact.fact_key || fact.fact_id || ''), fact.canonical_value || '']).filter(([key]) => key)));
    } catch (error) {
      setFactsSnapshot({ ok: false, code: 'unavailable', message: error instanceof Error ? error.message : '全文事实读取失败', contentHash: '', inputsHash: '', protocolHash: '', checkStatus: check.status, facts: [], overrides: [] });
      showToast('全文事实读取失败，请先运行一致性检查后重试', 'error');
    } finally {
      setFactsLoading(false);
    }
  };

  const addManualFact = () => {
    if (!newFactValue.trim()) {
      showToast('请输入确认后的事实值', 'info');
      return;
    }
    const [kind, slot, label] = factFields.find((field) => field[1] === newFactSlot)!;
    const key = `${kind}:${slot}:${label}`;
    setFactEntries((current) => current.some((fact) => (fact.fact_key || fact.fact_id) === key) ? current : [...current, {
      fact_key: key, kind, canonical_value: '', chapter_node_ids: [], evidence: [newFactNote.trim() || '人工补录事实'],
    }]);
    setFactDrafts((current) => ({ ...current, [key]: newFactValue.trim() }));
    setNewFactValue('');
    setNewFactNote('');
  };

  const saveFactRepairs = async () => {
    if (!factsSnapshot || !factsEditable || factsSaving) return;
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存后再修正事实', 'info');
      return;
    }
    if (newFactValue.trim()) {
      showToast('补录值尚未添加，请先点击“添加事实”再保存', 'info');
      return;
    }
    if (typeof window.yibiao.technicalPlan.saveHistoricalAdaptationContentFactOverrides !== 'function') {
      showToast(missingFactsBridgeMessage, 'error');
      return;
    }
    setFactsSaving(true);
    let saved = false;
    try {
      const priorEntries = new Map(mergeFactEntries(factsSnapshot).map((fact) => [String(fact.fact_key || fact.fact_id || ''), fact]));
      const overrides = factEntries.map((fact) => {
        const key = String(fact.fact_key || fact.fact_id || '').trim();
        const canonicalValue = String(factDrafts[key] || '').trim();
        if (canonicalValue === String(priorEntries.get(key)?.canonical_value || '').trim()) return null;
        return { fact_key: key, canonical_value: canonicalValue, kind: fact.kind, basis: 'manual', note: fact.evidence[0] || '一致性检查事实弹窗人工修正' };
      }).filter((item): item is NonNullable<typeof item> => Boolean(item?.fact_key));
      const result = await window.yibiao.technicalPlan.saveHistoricalAdaptationContentFactOverrides({
        projectId,
        expectedContentHash: factsSnapshot.contentHash,
        expectedInputsHash: factsSnapshot.inputsHash,
        expectedProtocolHash: factsSnapshot.protocolHash,
        overrides,
      });
      if (!result.ok) {
        showToast(result.code === 'conflict' ? '正文或检查输入已变化，请重新读取全文事实后再保存。' : result.message, result.code === 'conflict' ? 'info' : 'error');
        if (result.code === 'conflict') await openFactsDialog();
        return;
      }
      saved = true;
      await openFactsDialog();
      const nextState = await window.yibiao.technicalPlan.loadState({ projectId });
      onStateChange(nextState);
      await window.yibiao.tasks.startHistoricalAdaptationContentCheck({ projectId });
      showToast('事实修正已保存，一致性检查已在后台启动', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '请重试';
      showToast(saved ? `事实修正已保存，但重新检查启动失败：${message}。请点击“重新运行一致性检查”。` : `保存事实修正失败：${message}`, 'error');
    } finally {
      setFactsSaving(false);
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

  const confirmChapter = async () => {
    if (!selectedItem || running || chapterConfirming) return;
    if (dirty) {
      showToast('当前章节有未保存修改，请先保存人工修改后再确认', 'info');
      return;
    }
    setChapterConfirming(true);
    try {
      const nextState = await window.yibiao.technicalPlan.confirmHistoricalAdaptationContentItem({
        projectId,
        nodeId: selectedItem.node_id,
      });
      onStateChange(nextState);
      showToast('当前章节已确认完成，保留现有人工处理内容；导出 Word 后可继续人工处理', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '确认当前章节失败', 'error');
    } finally {
      setChapterConfirming(false);
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

  const requestStageConfirmation = () => {
    if (hasPlaceholders) {
      setPendingPlaceholderConfirmation(true);
      return;
    }
    void confirmStage();
  };

  const checkStatusLabel = checkTask?.status === 'error'
    ? '检查失败'
    : checkRunning
    ? checkStageLabel || '检查中'
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

      <section className="historical-adaptation-content-workbench" ref={workbenchRef}>
        <div className="adaptation-content-column is-outline">
          <header>
            <div className="adaptation-content-outline-heading"><strong>适配目录</strong><span>{chapterFilter === 'all' ? `${leaves.length} 章` : `${visibleLeaves.length} / ${leaves.length} 章`}</span></div>
            <div className="adaptation-content-outline-filters" role="group" aria-label="章节完成状态筛选">
              {(Object.keys(chapterFilterLabels) as ChapterFilter[]).map((filter) => (
                <button type="button" key={filter} className={chapterFilter === filter ? 'is-active' : ''} aria-pressed={chapterFilter === filter} onClick={() => setChapterFilter(filter)}>{chapterFilterLabels[filter]}</button>
              ))}
            </div>
          </header>
          <div className="adaptation-content-outline-list" ref={outlineListRef}>
            {!visibleLeaves.length ? <div className="adaptation-content-empty">{chapterFilter === 'incomplete' ? '没有未完成章节' : chapterFilter === 'complete' ? '暂无已完成章节' : '暂无正文章节'}</div> : null}
            {visibleLeaves.map((entry) => {
              const migration = itemByNode.get(entry.item.id);
              return (
                <button type="button" key={entry.item.id} ref={(element) => { if (element) outlineRowRefs.current.set(entry.item.id, element); else outlineRowRefs.current.delete(entry.item.id); }} className={`${entry.item.id === selectedLeaf?.item.id ? 'is-selected' : ''}${migration?.status === 'success' ? ' is-confirmed' : ''}${blockerNodeIds.has(entry.item.id) ? ' has-check-blocker' : ''}`} onClick={() => requestNavigation({ type: 'chapter', nodeId: entry.item.id })}>
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
                  <select id="adaptation-content-mode" value={strategyMode} disabled={running || strategySaving} onChange={(event) => handleStrategyModeChange(event.target.value as HistoricalAdaptationContentMode)}>
                    {!strategyMode ? <option value="" disabled>请选择迁移方式</option> : null}
                    {Object.entries(modeLabels).map(([mode, label]) => <option key={mode} value={mode} disabled={mode !== 'rewrite' && !hasHistoricalSource}>{label}</option>)}
                  </select>
                  {strategyMode === 'rewrite' ? <label>定向改写要求<textarea value={strategyInstruction} disabled={running} onChange={(event) => setStrategyInstruction(event.target.value)} placeholder="说明需要改写或补充的重点、边界和表达要求" /></label> : null}
                  <small>{strategyMode === 'direct' ? '完整复制历史正文，不调用 AI。' : strategyMode === 'local-rewrite' ? '仅调整地点与实施对象、工作量、工期进度，保留其余正文。' : strategyMode === 'rewrite' ? hasHistoricalSource ? '按填写的要求改写本章历史正文。' : '本章无可靠历史正文，将按招标基线和填写的要求补充生成。' : '本章无可靠历史正文，可选择定向改写补充生成，或直接编辑正文。'}</small>
                  <small role="status">{emptySourceRewritePending
                    ? preparing ? '正在生成定向改写推荐提纲...' : selectedItem.error_code === 'recommendation-failed' ? '推荐提纲生成失败，可直接填写定向改写要求。' : '正在准备定向改写推荐提纲...'
                    : selectedItem.recommended_mode === 'rewrite' && !selectedItem.manual_mode
                    ? migrationRunning || preparing ? '正在准备新增章节的推荐提纲...' : '请校核或调整推荐提纲，再点击“按此方式迁移本章”生成正文。'
                    : strategyChanged ? '选择尚未应用，可迁移本章或点击上方按钮建立并执行迁移。' : '选择方式不会改变正文，点击迁移按钮才执行。'}</small>
                  <button type="button" className="primary-action" disabled={running || saving || dirty || !strategyMode || (strategyMode === 'rewrite' && !strategyInstruction.trim())} title={dirty ? '请先保存人工修改' : undefined} onClick={() => { void migrateChapter(); }}>{strategySaving ? '启动迁移中...' : '按此方式迁移本章'}</button>
                  {selectedNeedsManualConfirmation ? <button type="button" className="secondary-action" disabled={running || saving || chapterConfirming || dirty} title={dirty ? '请先保存人工修改' : '允许确认空正文、历史残留或待核实/待补充占位符；确认后正文不会被修改'} onClick={() => { void confirmChapter(); }}>{chapterConfirming ? '确认中...' : '确认本章已处理'}</button> : null}
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
          <div><span className="section-kicker">一致性检查</span><strong>{checkStatusLabel}</strong>{checkStageLabel && !checkRunning ? <span>{checkStageLabel}</span> : null}<p>检查工作量、工期进度、跨章节冲突、历史残留与待核实占位符。</p></div>
          <div className="historical-adaptation-content-check-actions">
            <button type="button" className="secondary-action" disabled={running || !state.historicalAdaptationContentItems.length} onClick={() => { void openFactsDialog(); }}>查看全文事实</button>
            <button type="button" className="secondary-action" disabled={running || !state.historicalAdaptationContentItems.length} onClick={() => { void runConsistencyCheck(); }}>运行一致性检查</button>
          </div>
        </header>
        {checkTask?.status === 'error' ? <div className="historical-adaptation-content-error">{checkTask?.error || check.error || '一致性检查任务失败，请重试。'}</div> : check.error ? <div className="historical-adaptation-content-error">{check.error}</div> : null}
        {checkStage === 'precheck' && checkBlockingCount > 0 ? <p className="historical-adaptation-content-error">预检尚未通过，因此还没有提取全文事实。请按下方问题定位章节并处理，然后重新运行一致性检查。</p> : null}
        <div className="historical-adaptation-content-check-stats" aria-label="一致性检查结果统计">
          <span>自动修复成功 <strong>{autoRepairedCount}</strong></span>
          <span>仍有阻断 <strong>{checkBlockingCount}</strong></span>
          <span>仅提示 <strong>{checkAdvisoryCount}</strong></span>
          <span>人工处理 <strong>{manualCount}</strong></span>
        </div>
        {check.findings.length ? <div className="adaptation-content-check-findings">{check.findings.map((finding) => <button type="button" key={finding.id} disabled={!finding.node_ids.length && (running || factsLoading || factsSaving)} onClick={() => finding.node_ids[0] ? requestNavigation({ type: 'chapter', nodeId: finding.node_ids[0], reveal: true }) : void openFactsDialog()}><span>{finding.severity}{finding.blocking ? ' · 阻断' : ' · 提示'}</span><strong>{finding.message}</strong><div><small className="is-chapter-path">{finding.node_ids.length ? `对应章节：${finding.node_ids.map((nodeId) => {
          const entry = leaves.find((leaf) => leaf.item.id === nodeId);
          return entry ? `${nodeId} ${entry.path.join(' / ')}` : nodeId;
        }).join('；')}` : '全局问题 · 点击补录事实或重试检查'}</small>{finding.evidence ? <small>{finding.evidence}</small> : null}</div></button>)}</div> : null}
      </section>

      <section className={`historical-adaptation-content-acceptance${stageConfirmed ? ' is-complete' : ''}`}>
        <div><strong>{stageConfirmed ? '正文迁移已按阶段确认' : hasPlaceholders ? '存在待核实或待补充内容' : '完成一致性检查后统一确认'}</strong><span>{stageConfirmed ? '审核导出已开放。' : hasPlaceholders ? `已发现 ${placeholderCount} 处待核实/待补充内容，允许导出 Word；导出 Word 后请人工处理。` : '无需逐章点击确认；系统会一次校验全部章节、检查快照和阻断问题。'}</span></div>
        {stageConfirmed ? <span>已确认</span> : <button type="button" className="primary-action" disabled={running || dirty || !state.historicalAdaptationContentItems.length} title={dirty ? '请先保存当前章节' : undefined} onClick={requestStageConfirmation}>{hasPlaceholders ? '确认保留并继续' : '确认本阶段'}</button>}
      </section>

      <AppDialog
        open={factsDialogOpen}
        onOpenChange={(open) => { if (!factsSaving) setFactsDialogOpen(open); }}
        kicker="一致性检查输入"
        title="全文事实与证据"
        description="核对提取值、冲突来源和原文证据。缺少事实时可人工补录，保存后重新检查。修正仅覆盖一致性检查的事实口径，不会修改章节正文或标书生成的全局事实。"
        cardClassName="historical-adaptation-facts-dialog"
        actions={<>
          <button type="button" className="secondary-action" disabled={factsSaving || running} onClick={() => { setFactsDialogOpen(false); void runConsistencyCheck(); }}>重新运行一致性检查</button>
          <button type="button" className="primary-action" disabled={!factsEditable || factsLoading || factsSaving || running} onClick={() => { void saveFactRepairs(); }}>{factsSaving ? '保存并检查中...' : '保存修正并重新检查'}</button>
        </>}
      >
        <div className="historical-adaptation-facts-body">
          {factsLoading ? <div className="adaptation-content-empty" role="status">正在读取全文事实...</div> : <>
          {!factsSnapshot?.ok ? <div className="historical-adaptation-content-error" role="status">{factsSnapshot?.checkError || factsSnapshot?.message || '尚无可用的全文事实快照。'}{factsEditable ? ' 可在下方补录或修正事实，再保存并重新检查；若为请求失败，可直接重试检查。' : ''}</div> : null}
          {factsEditable ? <section className="historical-adaptation-fact historical-adaptation-fact-add">
            <header><div><strong>人工补录事实</strong><span>选择缺失的事实字段并填写确认值，添加后统一保存。</span></div></header>
            <label>事实字段<select value={newFactSlot} disabled={factsSaving || running} onChange={(event) => setNewFactSlot(event.target.value)}>{factFields.map((field) => <option key={field[1]} value={field[1]}>{field[2]}</option>)}</select></label>
            <label>确认后的事实值<input value={newFactValue} disabled={factsSaving || running} onChange={(event) => setNewFactValue(event.target.value)} placeholder="例如：本次招标项目的完整名称" /></label>
            <label>依据或说明（选填）<input value={newFactNote} disabled={factsSaving || running} onChange={(event) => setNewFactNote(event.target.value)} placeholder="例如：招标文件项目概况第 2 页" /></label>
            <div><button type="button" className="secondary-action" disabled={factsSaving || running} onClick={addManualFact}>添加事实</button></div>
          </section> : null}
          {!factEntries.length ? <div className="adaptation-content-empty">暂无可展示的事实。可补录缺失事实，或重新运行检查。</div> : factEntries.map((fact: HistoricalAdaptationContentFactEntry, index) => {
            const factKey = String(fact.fact_key || fact.fact_id || `fact-${index}`);
            const overridden = factsSnapshot?.overrides.some((item) => item.fact_key === factKey);
            const field = factFields.find((item) => item[1] === factKey.split(':')[1]);
            const qualifier = factKey.split(':').slice(2).join(':');
            return <article className="historical-adaptation-fact historical-adaptation-fact-entry" key={factKey}>
              <header><div><strong>{field?.[2] || factKindLabels[fact.kind] || '全文事实'}{qualifier && qualifier !== field?.[2] ? ` · ${qualifier}` : ''}</strong><span>{factKindLabels[fact.kind] || '未分类'}{fact.conflict ? ' · 存在冲突' : ''}{overridden ? ' · 已人工修正' : !factsSnapshot?.facts.some((item) => (item.fact_key || item.fact_id) === factKey) ? ' · 人工补录' : ''}</span></div></header>
              <label>统一口径<input value={factDrafts[factKey] ?? fact.canonical_value} disabled={factsSaving || running} onChange={(event) => setFactDrafts((current) => ({ ...current, [factKey]: event.target.value }))} placeholder="输入确认后的事实值；清空后将移除人工修正" /></label>
              <p className="historical-adaptation-fact-no-evidence">清空并保存将移除人工修正；已有提取事实会恢复提取值。</p>
              {fact.values?.length ? <div className="historical-adaptation-fact-values"><strong>提取到的值</strong><span>{fact.values.join(' / ')}</span></div> : null}
              <div className="historical-adaptation-fact-sources"><strong>来源章节</strong><div>{fact.chapter_node_ids.length ? fact.chapter_node_ids.map((nodeId) => {
                const leaf = leaves.find((entry) => entry.item.id === nodeId);
                return <button key={nodeId} type="button" className="text-button" onClick={() => { setFactsDialogOpen(false); requestNavigation({ type: 'chapter', nodeId }); }}>{leaf ? `${nodeId} ${leaf.item.title}` : nodeId} · 定位章节</button>;
              }) : <span>未关联章节</span>}</div></div>
              {fact.evidence.length ? <div className="historical-adaptation-fact-evidence"><strong>原文证据</strong>{fact.evidence.map((evidence, evidenceIndex) => <div className="markdown-viewer" key={`${factKey}-evidence-${evidenceIndex}`}><MarkdownRenderer allowRawHtml={false}>{evidence}</MarkdownRenderer></div>)}</div> : <p className="historical-adaptation-fact-no-evidence">当前快照未保存原文证据，可定位章节核对正文。</p>}
            </article>;
          })}
          </>}
        </div>
      </AppDialog>

      <AppDialog open={Boolean(pendingNavigation)} onOpenChange={(open) => !open && setPendingNavigation(null)} kicker="未保存修改" title="当前章节有未保存修改" description="继续操作会放弃当前章节尚未保存的内容。" actions={<><button type="button" className="secondary-action" onClick={() => setPendingNavigation(null)}>继续编辑</button><button type="button" className="danger-action" onClick={() => pendingNavigation && continueNavigation(pendingNavigation)}>放弃修改并继续</button></>} />
      <AppDialog open={Boolean(pendingManualOverwrite)} onOpenChange={(open) => !open && setPendingManualOverwrite(null)} kicker="人工正文保护" title="覆盖人工正文" description="按所选方式迁移会覆盖当前章节已人工保存的正文。此操作仅影响当前章节。" actions={<><button type="button" className="secondary-action" onClick={() => setPendingManualOverwrite(null)}>取消</button><button type="button" className="danger-action" onClick={() => pendingManualOverwrite && void migrateChapter(pendingManualOverwrite, true)}>确认覆盖并迁移</button></>} />
      <AppDialog open={pendingPlaceholderConfirmation} onOpenChange={(open) => !open && setPendingPlaceholderConfirmation(false)} kicker="待人工处理" title="确认保留待处理占位符？" description={`当前正文包含 ${placeholderCount} 处【待核实】或【待补充】。系统允许先导出 Word，请在导出文件中完成人工核实和补充。`} actions={<><button type="button" className="secondary-action" onClick={() => setPendingPlaceholderConfirmation(false)}>继续检查</button><button type="button" className="primary-action" disabled={running || dirty} onClick={() => { setPendingPlaceholderConfirmation(false); void confirmStage(); }}>确认保留并继续</button></>} />
      <ContentAiRewriteDrawer open={Boolean(aiEditMode && aiEditSnapshot)} mode={aiEditMode} chapterTitle={selectedLeaf ? `${selectedLeaf.item.id} ${selectedLeaf.item.title}` : ''} snapshot={aiEditSnapshot} candidate={aiCandidate} busy={aiCandidateBusy} error={aiEditError} imageModelAvailable={false} onGenerateText={(instruction) => { void generateLengthCandidate(instruction); }} onGenerateImage={() => undefined} onImportFile={() => undefined} onImportDataUrl={() => undefined} onApply={applyLengthCandidate} onDiscard={closeLengthEdit} />
    </div>
  );
}

export default AdaptationContentPage;
