import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { BidProject } from '../../bid-project/types';
import type {
  HistoricalAdaptationDifference,
  HistoricalAdaptationDifferenceCategory,
  TechnicalPlanState,
} from '../../technical-plan/types';
import { ProgressBar, useToast } from '../../../shared/ui';

const categories: HistoricalAdaptationDifferenceCategory[] = [
  '删除内容',
  '名称地点替换',
  '数据更新',
  '工期进度更新',
  '其他人工判断',
];

type DifferenceFilter = 'all' | 'pending' | HistoricalAdaptationDifferenceCategory;

interface AdaptationDifferencePageProps {
  projectId: string;
  project: BidProject | null;
  state: TechnicalPlanState;
  onStateChange: Dispatch<SetStateAction<TechnicalPlanState | null>>;
  onBack: () => void;
}

function AdaptationDifferencePage({ projectId, project, state, onStateChange, onBack }: AdaptationDifferencePageProps) {
  const [filter, setFilter] = useState<DifferenceFilter>('pending');
  const [drafts, setDrafts] = useState<Record<string, HistoricalAdaptationDifference>>({});
  const [savingId, setSavingId] = useState('');
  const { showToast } = useToast();
  const differences = state.historicalAdaptationDifferences || [];
  const task = state.historicalAdaptationDifferenceTask;
  const running = task?.status === 'running' || task?.status === 'pausing';
  const processedCount = differences.filter((item) => item.decision !== 'pending').length;
  const differenceComplete = Boolean(state.historicalAdaptationDifferenceConfirmedAt);

  useEffect(() => {
    setDrafts(Object.fromEntries(differences.map((item) => [item.id, { ...item }])));
  }, [differences]);

  useEffect(() => {
    if (differenceComplete) setFilter('all');
  }, [differenceComplete]);

  const filtered = useMemo(() => differences.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return item.decision === 'pending';
    return item.category === filter;
  }), [differences, filter]);

  const countFor = (value: DifferenceFilter) => {
    if (value === 'all') return differences.length;
    if (value === 'pending') return differences.length - processedCount;
    return differences.filter((item) => item.category === value).length;
  };

  const startAnalysis = async () => {
    try {
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
    setSavingId(id);
    try {
      const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationDifferences({ projectId, differences: nextDifferences });
      onStateChange(nextState);
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
          <button type="button" className="primary-action" onClick={() => { void startAnalysis(); }} disabled={running}>
            {running ? '分析中...' : differences.length ? '重新分析差异' : '开始差异分析'}
          </button>
        </div>
      </header>

      <section className="historical-adaptation-difference-overview" aria-label="差异确认进度">
        <div><span>识别差异</span><strong>{differences.length}</strong></div>
        <div><span>待确认</span><strong className={differences.length - processedCount > 0 ? 'is-warning' : 'is-success'}>{differences.length - processedCount}</strong></div>
        <div><span>已处理</span><strong>{processedCount}</strong></div>
        <div className="historical-adaptation-difference-progress">
          <span>{running ? '后台分析进度' : differenceComplete ? '已全部处理，等待验收' : '确认进度'}</span>
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
              <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>
                <span>{label}</span><strong>{countFor(value)}</strong>
              </button>
            ))}
          </aside>

          <section className="historical-adaptation-difference-list" aria-label="差异台账">
            {!filtered.length ? <div className="historical-adaptation-difference-no-result">当前筛选下没有差异项</div> : null}
            {filtered.map((item, index) => {
              const draft = drafts[item.id] || item;
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
                      <span>{item.decision === 'confirmed' ? '已确认' : item.decision === 'ignored' ? '无需处理' : '待确认'}</span>
                    </div>
                  </header>

                  <div className="historical-adaptation-difference-evidence">
                    <div><span>历史标书现状</span><p>{item.historical_excerpt || '未提供摘录'}</p></div>
                    <div><span>招标基线要求</span><p>{item.tender_requirement}</p></div>
                  </div>

                  <div className="historical-adaptation-difference-editor">
                    <label>处理类型
                      <select value={draft.category} disabled={running} onChange={(event) => updateDraft(item.id, { category: event.target.value as HistoricalAdaptationDifferenceCategory })}>
                        {categories.map((category) => <option value={category} key={category}>{category}</option>)}
                      </select>
                    </label>
                    <label>处理要求
                      <textarea value={draft.action} disabled={running} onChange={(event) => updateDraft(item.id, { action: event.target.value })} rows={3} />
                    </label>
                    <label>确认备注
                      <input value={draft.note} disabled={running} onChange={(event) => updateDraft(item.id, { note: event.target.value })} placeholder="可选：记录人工判断依据" />
                    </label>
                  </div>

                  <footer>
                    <button type="button" className="text-button" disabled={saving || running} onClick={() => { void saveDifference(item.id); }}>保存修改</button>
                    <button type="button" className="secondary-action" disabled={saving || running} onClick={() => { void saveDifference(item.id, 'ignored'); }}>无需处理</button>
                    <button type="button" className="primary-action" disabled={saving || running} onClick={() => { void saveDifference(item.id, 'confirmed'); }}>确认此项</button>
                  </footer>
                </article>
              );
            })}
          </section>
        </div>
      )}

      <section className={`historical-adaptation-difference-acceptance${differenceComplete ? ' is-complete' : ''}`}>
        <div><span className="section-kicker">环节三状态</span><strong>{differenceComplete ? '全部差异已处理，等待验收' : '请完成全部差异确认'}</strong></div>
        <span>环节四保持锁定</span>
      </section>
    </div>
  );
}

export default AdaptationDifferencePage;
