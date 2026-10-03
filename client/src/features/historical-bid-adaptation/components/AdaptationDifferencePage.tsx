import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { BidProject } from '../../bid-project/types';
import type {
  HistoricalAdaptationContentChangeScope,
  HistoricalAdaptationDifference,
  HistoricalAdaptationDifferenceCategory,
  HistoricalAdaptationEvidenceKind,
  HistoricalAdaptationConfidence,
  HistoricalAdaptationTargetAction,
  TechnicalPlanState,
} from '../../technical-plan/types';
import { AppDialog, ProgressBar, useToast } from '../../../shared/ui';
import { buildBulkConfirmedDifferences } from '../differenceConfirmation';
import { buildDifferenceRecommendation } from '../differenceRecommendation';

const categories: HistoricalAdaptationDifferenceCategory[] = [
  '删除内容',
  '名称地点替换',
  '数据更新',
  '工期进度更新',
  '其他人工判断',
];

const contentChangeScopeLabels: Record<HistoricalAdaptationContentChangeScope, string> = {
  'location-target': '地点 / 实施对象局改',
  workload: '工作量局改',
  schedule: '工期 / 进度局改',
  none: '不自动改写',
};

const targetActionLabels: Record<HistoricalAdaptationTargetAction, string> = {
  replace: '确定替换',
  remove: '删除旧内容',
  'rewrite-fragment': '局部重写',
  review: '仅人工复核',
};

const evidenceKindLabels: Record<HistoricalAdaptationEvidenceKind, string> = {
  'exact-value': '精确值',
  'locked-range': '锁定范围',
  contextual: '上下文复核',
};

const confidenceLabels: Record<HistoricalAdaptationConfidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

function getDifferenceConfirmationError(item: HistoricalAdaptationDifference): string {
  if (item.difference_schema_version !== 2) return '该差异缺少 v2 结构化契约，请先重新分析或补全字段。';
  const replacements = item.replacements || [];
  if (item.target_action === 'replace') {
    if (item.evidence_kind !== 'exact-value') return '确定替换必须使用“精确值”证据类型。';
    const completeReplacements = replacements.filter((replacement) => (
      replacement.old_value.trim()
      && replacement.new_value.trim()
      && replacement.old_value.trim() !== replacement.new_value.trim()
    ));
    if (!completeReplacements.length) {
      return '确定替换必须填写至少一组完整的旧值和新值。';
    }
    const newValuesByOldValue = new Map<string, string>();
    for (const replacement of completeReplacements) {
      const oldValue = replacement.old_value.trim();
      const newValue = replacement.new_value.trim();
      const previous = newValuesByOldValue.get(oldValue);
      if (previous && previous !== newValue) return `旧值“${oldValue}”存在多个新值，请保留唯一映射。`;
      newValuesByOldValue.set(oldValue, newValue);
    }
  }
  if (item.target_action === 'remove' || item.target_action === 'rewrite-fragment') {
    if (item.content_change_scope !== 'none') return '删除或局部重写的正文影响范围必须为“不自动改写”。';
    if (replacements.length > 0) return '删除或局部重写不能携带可执行替换映射。';
    if (item.evidence_kind !== 'locked-range') return '删除或局部重写必须使用“锁定范围”证据类型。';
    if (!(item.old_content_evidence || []).some((evidence) => evidence.trim())) {
      return '删除或局部重写必须保留完整的旧内容证据。';
    }
  }
  if (item.target_action === 'review') {
    const isContextualEvidence = item.evidence_kind === 'contextual';
    if (!isContextualEvidence) return '人工复核差异必须使用“上下文复核”证据类型。';
    if (item.content_change_scope !== 'none') return '人工复核差异的正文影响范围必须为“不自动改写”。';
    if (replacements.length > 0) return '人工复核差异不能携带可执行替换映射。';
    if (item.confidence === 'high') return '上下文复核证据不能标记为高置信度。';
  }
  return '';
}

type DifferenceFilter = 'all' | 'pending' | HistoricalAdaptationDifferenceCategory;

interface AdaptationDifferencePageProps {
  projectId: string;
  project: BidProject | null;
  state: TechnicalPlanState;
  onStateChange: Dispatch<SetStateAction<TechnicalPlanState | null>>;
  onBack: () => void;
  onContinue: () => void;
}

function AdaptationDifferencePage({ projectId, project, state, onStateChange, onBack, onContinue }: AdaptationDifferencePageProps) {
  const [filter, setFilter] = useState<DifferenceFilter>('pending');
  const [drafts, setDrafts] = useState<Record<string, HistoricalAdaptationDifference>>({});
  const [savingId, setSavingId] = useState('');
  const [recentlyConfirmedId, setRecentlyConfirmedId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const { showToast } = useToast();
  const differences = state.historicalAdaptationDifferences || [];
  const task = state.historicalAdaptationDifferenceTask;
  const outlineTaskStatus = state.historicalAdaptationOutlineTask?.status;
  const running = task?.status === 'running'
    || task?.status === 'pausing'
    || ['queued', 'running', 'pausing', 'paused'].includes(outlineTaskStatus || '');
  const processedCount = differences.filter((item) => item.decision !== 'pending').length;
  const pendingCount = differences.length - processedCount;
  const differenceComplete = Boolean(state.historicalAdaptationDifferenceConfirmedAt);
  const mutationPending = Boolean(savingId) || bulkSaving;

  useEffect(() => {
    setDrafts(Object.fromEntries(differences.map((item) => [item.id, { ...item }])));
  }, [differences]);

  useEffect(() => {
    if (differenceComplete) setFilter('all');
  }, [differenceComplete]);

  const filtered = useMemo(() => differences.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return item.decision === 'pending' || item.id === recentlyConfirmedId;
    return item.category === filter;
  }), [differences, filter, recentlyConfirmedId]);

  const countFor = (value: DifferenceFilter) => {
    if (value === 'all') return differences.length;
    if (value === 'pending') return differences.length - processedCount;
    return differences.filter((item) => item.category === value).length;
  };

  const startAnalysis = async () => {
    try {
      setRecentlyConfirmedId('');
      await window.yibiao.tasks.startHistoricalAdaptationDifference({ projectId });
      showToast('历史标书差异分析任务已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动差异分析失败', 'error');
    }
  };

  const saveDifference = async (id: string, decision?: HistoricalAdaptationDifference['decision']) => {
    const draft = drafts[id];
    if (!draft) return;
    const nextDifferences = differences.map((item) => item.id === id ? {
      ...draft,
      decision: decision || draft.decision,
    } : item);
    if (decision === 'confirmed') {
      const validationError = getDifferenceConfirmationError(nextDifferences.find((item) => item.id === id)!);
      if (validationError) {
        showToast(validationError, 'error');
        return;
      }
    }
    setSavingId(id);
    try {
      const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationDifferences({ projectId, differences: nextDifferences });
      onStateChange(nextState);
      setRecentlyConfirmedId(decision === 'confirmed' ? id : '');
      showToast(decision === 'confirmed' ? '差异项已确认' : decision === 'ignored' ? '差异项已标记为无需处理' : '处理要求已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存差异确认失败', 'error');
    } finally {
      setSavingId('');
    }
  };

  const updateDraft = (id: string, patch: Partial<HistoricalAdaptationDifference>) => {
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...(previous[id] || differences.find((item) => item.id === id)!), ...patch },
    }));
  };

  const changeTargetAction = (id: string, target_action: HistoricalAdaptationTargetAction) => {
    updateDraft(id, target_action === 'replace'
      ? { target_action }
      : { target_action, content_change_scope: 'none', replacements: [] });
  };

  const confirmAllPending = async () => {
    if (!pendingCount) return;
    const nextDifferences = buildBulkConfirmedDifferences(differences, drafts);
    const validationError = nextDifferences
      .filter((item) => item.decision === 'confirmed' && differences.find((original) => original.id === item.id)?.decision === 'pending')
      .map(getDifferenceConfirmationError)
      .find(Boolean);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }
    setBulkSaving(true);
    try {
      const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationDifferences({
        projectId,
        differences: nextDifferences,
      });
      onStateChange(nextState);
      setRecentlyConfirmedId('');
      setBulkConfirmOpen(false);
      showToast(`已确认 ${pendingCount} 个待确认差异项`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '批量确认差异失败', 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <div className="historical-adaptation-difference-page">
      <header className="historical-adaptation-difference-head">
        <div>
          <span className="section-kicker">环节三 · 差异确认</span>
          <h1>{project?.projectName || '历史标书适配项目'}</h1>
          <p>逐项核对历史标书与招标基线，确认后续目录和正文的处理规则。</p>
        </div>
        <div className="historical-adaptation-difference-actions">
          <button type="button" className="secondary-action" onClick={onBack}>返回我的标书</button>
          <button type="button" className="primary-action" onClick={() => { void startAnalysis(); }} disabled={running || mutationPending}>
            {running ? '分析中...' : differences.length ? '重新分析差异' : '开始差异分析'}
          </button>
        </div>
      </header>

      <section className="historical-adaptation-difference-overview" aria-label="差异确认进度">
        <div><span>识别差异</span><strong>{differences.length}</strong></div>
        <div><span>待确认</span><strong className={pendingCount > 0 ? 'is-warning' : 'is-success'}>{pendingCount}</strong></div>
        <div><span>已处理</span><strong>{processedCount}</strong></div>
        <div className="historical-adaptation-difference-progress">
          <div>
            <span>{running ? '后台分析进度' : differenceComplete ? '已全部处理，等待验收' : '确认进度'}</span>
            {differences.length ? (
              <button
                type="button"
                className="secondary-action historical-adaptation-difference-bulk-action"
                disabled={running || bulkSaving || Boolean(savingId) || pendingCount === 0}
                onClick={() => setBulkConfirmOpen(true)}
              >
                {pendingCount ? `确认全部待确认项（${pendingCount}）` : '全部待确认项已处理'}
              </button>
            ) : null}
          </div>
          <ProgressBar value={running ? task?.progress || 0 : differences.length ? Math.round((processedCount / differences.length) * 100) : 0} />
        </div>
      </section>

      {task?.status === 'error' ? (
        <section className="historical-adaptation-difference-error"><strong>差异分析失败</strong><span>{task.error || '请重新执行差异分析。'}</span></section>
      ) : null}

      {!differences.length ? (
        <section className="historical-adaptation-difference-empty">
          <strong>{running ? '正在比对招标基线与历史标书' : task?.status === 'success' ? '未发现需要确认的实质差异' : '尚未生成差异台账'}</strong>
          <p>{running ? '任务在后台运行，离开页面不会中断。' : task?.status === 'success' ? '本阶段已完成，等待验收。' : '开始分析后，系统会生成删除、替换、数据和工期等差异项。'}</p>
        </section>
      ) : (
        <div className="historical-adaptation-difference-workbench">
          <aside className="historical-adaptation-difference-filters" aria-label="差异筛选">
            {([['all', '全部差异'], ['pending', '待确认'], ...categories.map((category) => [category, category])] as Array<[DifferenceFilter, string]>).map(([value, label]) => (
              <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => { setFilter(value); setRecentlyConfirmedId(''); }}>
                <span>{label}</span><strong>{countFor(value)}</strong>
              </button>
            ))}
          </aside>

          <section className="historical-adaptation-difference-list" aria-label="差异台账">
            {!filtered.length ? <div className="historical-adaptation-difference-no-result">当前筛选下没有差异项</div> : null}
            {filtered.map((item, index) => {
              const draft = drafts[item.id] || item;
              const replacements = draft.replacements || [];
              const recommendation = buildDifferenceRecommendation(draft);
              const saving = savingId === item.id;
              return (
                <article className={`historical-adaptation-difference-item is-${item.decision}`} key={item.id}>
                  <header>
                    <div className="historical-adaptation-difference-title">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div><strong>{item.title}</strong><small>{item.historical_location || '未标注位置'}</small></div>
                    </div>
                    <div className="historical-adaptation-difference-state">
                      <em className={`priority-${item.priority}`}>{item.priority === 'high' ? '高优先级' : item.priority === 'low' ? '低优先级' : '中优先级'}</em>
                      <em>{contentChangeScopeLabels[item.content_change_scope || 'none']}</em>
                      <span className={`is-${item.decision}`}>{item.decision === 'confirmed' ? '已确认' : item.decision === 'ignored' ? '无需处理' : '待确认'}</span>
                    </div>
                  </header>

                  <div className="historical-adaptation-difference-evidence">
                    <div><span>历史标书现状</span><p>{item.historical_excerpt || '未提供摘录'}</p></div>
                    <div><span>招标基线要求</span><p>{item.tender_requirement}</p></div>
                  </div>

                  <section className={`historical-adaptation-difference-recommendation is-${recommendation.action}`} aria-label="系统推荐处理方案">
                    <div className="historical-adaptation-difference-recommendation-head">
                      <span>系统推荐</span>
                      <strong>{recommendation.title.replace('系统推荐：', '')}</strong>
                    </div>
                    <p>{recommendation.summary}</p>
                    <small>{recommendation.impact}</small>
                  </section>

                  <details
                    className="historical-adaptation-difference-advanced"
                    open={advancedOpen[item.id] ?? recommendation.requiresAdvancedReview}
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      setAdvancedOpen((previous) => ({ ...previous, [item.id]: open }));
                    }}
                  >
                    <summary>高级编辑（技术字段）</summary>
                    <div className="historical-adaptation-difference-editor">
                    <label>处理类型
                      <select value={draft.category} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, { category: event.target.value as HistoricalAdaptationDifferenceCategory })}>
                        {categories.map((category) => <option value={category} key={category}>{category}</option>)}
                      </select>
                    </label>
                    <label>正文影响范围
                      <select value={draft.content_change_scope} disabled={running || mutationPending || draft.target_action !== 'replace'} onChange={(event) => updateDraft(item.id, { content_change_scope: event.target.value as HistoricalAdaptationContentChangeScope })}>
                        {Object.entries(contentChangeScopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>目标动作
                      <select value={draft.target_action || 'review'} disabled={running || mutationPending} onChange={(event) => changeTargetAction(item.id, event.target.value as HistoricalAdaptationTargetAction)}>
                        {Object.entries(targetActionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>证据类型
                      <select value={draft.evidence_kind || 'contextual'} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, { evidence_kind: event.target.value as HistoricalAdaptationEvidenceKind })}>
                        {Object.entries(evidenceKindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>置信度
                      <select value={draft.confidence || 'low'} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, { confidence: event.target.value as HistoricalAdaptationConfidence })}>
                        {Object.entries(confidenceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>旧内容证据
                      <textarea
                        aria-label="旧内容证据"
                        value={(draft.old_content_evidence || []).join('\n')}
                        disabled={running || mutationPending}
                        onChange={(event) => updateDraft(item.id, {
                          old_content_evidence: event.target.value.split(/\r?\n/).map((evidence) => evidence.trim()).filter(Boolean),
                        })}
                        rows={3}
                        placeholder="每行填写一条完整旧内容或可定位段落"
                      />
                    </label>
                    <label>处理要求
                      <textarea value={draft.action} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, { action: event.target.value })} rows={3} />
                    </label>
                    <div className="historical-adaptation-difference-replacements">
                      <span>旧值 / 新值</span>
                      {replacements.map((replacement, replacementIndex) => (
                        <div key={`${item.id}-replacement-${replacementIndex}`}>
                          <input aria-label={`旧值 ${replacementIndex + 1}`} value={replacement.old_value} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, {
                            replacements: replacements.map((current, index) => index === replacementIndex ? { ...current, old_value: event.target.value } : current),
                          })} placeholder="旧值" />
                          <input aria-label={`新值 ${replacementIndex + 1}`} value={replacement.new_value} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, {
                            replacements: replacements.map((current, index) => index === replacementIndex ? { ...current, new_value: event.target.value } : current),
                          })} placeholder="新值" />
                          <button type="button" className="text-button" disabled={running || mutationPending} onClick={() => updateDraft(item.id, { replacements: replacements.filter((_, index) => index !== replacementIndex) })}>删除映射</button>
                        </div>
                      ))}
                      <button type="button" className="text-button" disabled={running || mutationPending} onClick={() => updateDraft(item.id, { replacements: [...(draft.replacements || []), { old_value: '', new_value: '' }] })}>添加替换映射</button>
                    </div>
                    <label>确认备注
                      <input value={draft.note} disabled={running || mutationPending} onChange={(event) => updateDraft(item.id, { note: event.target.value })} placeholder="可选：记录人工判断依据" />
                    </label>
                    </div>
                  </details>

                  <div className="historical-adaptation-difference-action-note">
                    {recommendation.requiresAdvancedReview
                      ? '当前推荐不会自动修改正文；如需自动处理，请先在高级编辑中补充完整证据。'
                      : '确认后将按系统推荐处理，未被证据覆盖的正文不会被改动。'}
                  </div>

                  <footer>
                    <button type="button" className="text-button" disabled={mutationPending || running} onClick={() => { void saveDifference(item.id); }}>保存修改</button>
                    <button type="button" className="secondary-action" disabled={mutationPending || running} onClick={() => { void saveDifference(item.id, 'ignored'); }}>无需处理</button>
                    {item.decision === 'confirmed' ? (
                      <button type="button" className="historical-adaptation-difference-confirmed-action" disabled aria-label={`${item.title}已确认`}>
                        <span aria-hidden="true">✓</span>已确认
                      </button>
                    ) : (
                      <button type="button" className="primary-action" disabled={mutationPending || running} onClick={() => { void saveDifference(item.id, 'confirmed'); }}>{saving ? '正在确认...' : '确认此项（按系统推荐）'}</button>
                    )}
                  </footer>
                </article>
              );
            })}
          </section>
        </div>
      )}

      <section className={`historical-adaptation-difference-acceptance${differenceComplete ? ' is-complete' : ''}`}>
        <div><span className="section-kicker">环节三状态</span><strong>{differenceComplete ? '全部差异已处理，等待验收' : '请完成全部差异确认'}</strong></div>
        {differenceComplete
          ? <button type="button" className="primary-action" onClick={onContinue}>进入目录适配</button>
          : <span>环节四保持锁定</span>}
      </section>

      <AppDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => !bulkSaving && setBulkConfirmOpen(open)}
        kicker="批量确认差异"
        title={`确认全部 ${pendingCount} 个待确认项`}
        description="将按当前处理类型、处理要求和确认备注一次性确认全部待确认项；已确认和无需处理的项目不会改变。"
        preventClose={bulkSaving}
        actions={<>
          <button type="button" className="secondary-action" disabled={bulkSaving} onClick={() => setBulkConfirmOpen(false)}>取消</button>
          <button type="button" className="primary-action" disabled={bulkSaving || pendingCount === 0} onClick={() => { void confirmAllPending(); }}>
            {bulkSaving ? '正在确认...' : '确认全部待确认项'}
          </button>
        </>}
      />
    </div>
  );
}

export default AdaptationDifferencePage;
