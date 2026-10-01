import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { OutlineData, OutlineItem } from '../../../shared/types';
import { ProgressBar, useToast } from '../../../shared/ui';
import type { BidProject } from '../../bid-project/types';
import type {
  HistoricalAdaptationOutlineChange,
  SaveOutlineReason,
  TechnicalPlanState,
} from '../../technical-plan/types';

interface AdaptationOutlinePageProps {
  projectId: string;
  project: BidProject | null;
  state: TechnicalPlanState;
  onStateChange: Dispatch<SetStateAction<TechnicalPlanState | null>>;
  onBack: () => void;
}

interface RenumberResult {
  outline: OutlineItem[];
  idMap: Record<string, string>;
}

function renumberOutline(items: OutlineItem[], prefix = ''): RenumberResult {
  const idMap: Record<string, string> = {};
  const outline = items.map((item, index) => {
    const id = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    idMap[item.id] = id;
    const childResult = item.children?.length ? renumberOutline(item.children, id) : undefined;
    if (childResult) Object.assign(idMap, childResult.idMap);
    return {
      ...item,
      id,
      ...(childResult?.outline.length
        ? { children: childResult.outline, content_mode: undefined }
        : { children: undefined, content_mode: item.content_mode || 'ai-generate' as const }),
    };
  });
  return { outline, idMap };
}

function mapNode(items: OutlineItem[], nodeId: string, mapper: (item: OutlineItem) => OutlineItem): OutlineItem[] {
  return items.map((item) => item.id === nodeId
    ? mapper(item)
    : { ...item, children: item.children ? mapNode(item.children, nodeId, mapper) : undefined });
}

function removeNode(items: OutlineItem[], nodeId: string): OutlineItem[] {
  return items.filter((item) => item.id !== nodeId).map((item) => ({
    ...item,
    children: item.children ? removeNode(item.children, nodeId) : undefined,
  }));
}

function findNode(items: OutlineItem[], nodeId: string): OutlineItem | undefined {
  for (const item of items) {
    if (item.id === nodeId) return item;
    const nested = item.children ? findNode(item.children, nodeId) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function findPath(items: OutlineItem[], nodeId: string, parents: string[] = []): string[] {
  for (const item of items) {
    const path = [...parents, item.title];
    if (item.id === nodeId) return path;
    const nested = item.children ? findPath(item.children, nodeId, path) : [];
    if (nested.length) return nested;
  }
  return [];
}

function findPathByTitle(items: OutlineItem[], title: string, parents: string[] = []): string[] {
  for (const item of items) {
    const path = [...parents, item.title];
    if (item.title === title) return path;
    const nested = item.children ? findPathByTitle(item.children, title, path) : [];
    if (nested.length) return nested;
  }
  return [];
}

function moveSibling(items: OutlineItem[], nodeId: string, direction: -1 | 1): OutlineItem[] {
  const index = items.findIndex((item) => item.id === nodeId);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }
  return items.map((item) => ({
    ...item,
    children: item.children ? moveSibling(item.children, nodeId, direction) : undefined,
  }));
}

function OutlineTree({ items, selectedId, onSelect, readonly = false }: {
  items: OutlineItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  readonly?: boolean;
}) {
  return (
    <div className={`adaptation-outline-tree${readonly ? ' is-readonly' : ''}`}>
      {items.map((item) => (
        <div className="adaptation-outline-branch" key={item.id}>
          <button type="button" className={selectedId === item.id ? 'is-selected' : ''} onClick={() => onSelect?.(item.id)} disabled={readonly}>
            <span>{item.id}</span><strong title={item.title}>{item.title}</strong>
          </button>
          {item.children?.length ? <OutlineTree items={item.children} selectedId={selectedId} onSelect={onSelect} readonly={readonly} /> : null}
        </div>
      ))}
    </div>
  );
}

function AdaptationOutlinePage({ projectId, project, state, onStateChange, onBack }: AdaptationOutlinePageProps) {
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const task = state.historicalAdaptationOutlineTask;
  const running = task?.status === 'queued' || task?.status === 'running' || task?.status === 'pausing' || task?.status === 'paused';
  const outlineData = state.outlineData;
  const outlineComplete = Boolean(state.historicalAdaptationOutlineConfirmedAt);
  const selected = useMemo(() => findNode(outlineData?.outline || [], selectedId), [outlineData, selectedId]);
  const selectedChanges = useMemo(() => state.historicalAdaptationOutlineChanges.filter(
    (change) => change.target_node_id === selectedId,
  ), [selectedId, state.historicalAdaptationOutlineChanges]);
  const deletedChanges = useMemo(() => state.historicalAdaptationOutlineChanges.filter(
    (change) => change.change_type === 'deleted',
  ), [state.historicalAdaptationOutlineChanges]);
  const differenceTitles = useMemo(() => new Map(
    state.historicalAdaptationDifferences.map((difference) => [difference.id, difference.title]),
  ), [state.historicalAdaptationDifferences]);

  useEffect(() => {
    if (!selected && outlineData?.outline?.[0]) setSelectedId(outlineData.outline[0].id);
  }, [outlineData, selected]);

  useEffect(() => {
    setTitle(selected?.title || '');
    setDescription(selected?.description || '');
  }, [selected]);

  const startGeneration = async () => {
    try {
      await window.yibiao.tasks.startHistoricalAdaptationOutline({ projectId, projectName: project?.projectName });
      showToast('目录适配任务已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动目录适配失败', 'error');
    }
  };

  const persist = async (
    items: OutlineItem[],
    reason: SaveOutlineReason,
    changes: HistoricalAdaptationOutlineChange[],
    affectedNodeIds: string[] = [],
  ) => {
    const renumbered = renumberOutline(items);
    setSaving(true);
    try {
      const nextState = await window.yibiao.technicalPlan.saveHistoricalAdaptationOutline({
        projectId,
        outlineData: { ...outlineData, outline: renumbered.outline } as OutlineData,
        reason,
        idMap: renumbered.idMap,
        affectedNodeIds,
        changes,
      });
      onStateChange(nextState);
      setSelectedId(renumbered.idMap[selectedId] || renumbered.outline[0]?.id || '');
      showToast('适配目录已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存适配目录失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!selected || !title.trim()) return;
    const nextItems = mapNode(outlineData?.outline || [], selected.id, (item) => ({
      ...item, title: title.trim(), description: description.trim(),
    }));
    const existing = state.historicalAdaptationOutlineChanges.find((change) => change.target_node_id === selected.id);
    const changes = existing
      ? state.historicalAdaptationOutlineChanges.map((change) => change.id === existing.id
        ? { ...change, target_title: title.trim(), reason: '人工调整目录标题或编制说明' }
        : change)
      : [...state.historicalAdaptationOutlineChanges, {
        id: `manual-edit-${Date.now()}`,
        change_type: 'updated' as const,
        original_path: findPathByTitle(state.historicalAdaptationOriginalOutline?.outline || [], selected.title).join(' / '),
        target_node_id: selected.id,
        target_title: title.trim(),
        reason: '人工调整目录标题或编制说明',
        difference_ids: [],
      }];
    await persist(nextItems, 'edit', changes, [selected.id]);
  };

  const addRoot = async () => {
    const tempId = `new-${Date.now()}`;
    const item: OutlineItem = { id: tempId, title: '新建一级目录', description: '请填写本节编制范围。', content_mode: 'ai-generate' };
    await persist([...(outlineData?.outline || []), item], 'add-root', [...state.historicalAdaptationOutlineChanges, {
      id: `manual-add-${Date.now()}`, change_type: 'added', original_path: '', target_node_id: tempId,
      target_title: item.title, reason: '人工增加一级目录', difference_ids: [],
    }], [tempId]);
  };

  const addChild = async () => {
    if (!selected) return;
    const tempId = `new-${Date.now()}`;
    const child: OutlineItem = { id: tempId, title: '新建子目录', description: '请填写本节编制范围。', content_mode: 'ai-generate' };
    const nextItems = mapNode(outlineData?.outline || [], selected.id, (item) => ({
      ...item, content_mode: undefined, children: [...(item.children || []), child],
    }));
    await persist(nextItems, 'add-child', [...state.historicalAdaptationOutlineChanges, {
      id: `manual-add-${Date.now()}`, change_type: 'added', original_path: '', target_node_id: tempId,
      target_title: child.title, reason: `人工在“${selected.title}”下增加子目录`, difference_ids: [],
    }], [selected.id, tempId]);
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const originalPath = findPath(state.historicalAdaptationOriginalOutline?.outline || [], selected.id).join(' / ')
      || findPath(outlineData?.outline || [], selected.id).join(' / ');
    const changes = state.historicalAdaptationOutlineChanges
      .filter((change) => change.target_node_id !== selected.id)
      .concat({
        id: `manual-delete-${Date.now()}`, change_type: 'deleted', original_path: originalPath,
        target_node_id: '', target_title: '', reason: '人工删除不适用目录', difference_ids: [],
      });
    await persist(removeNode(outlineData?.outline || [], selected.id), 'delete', changes, [selected.id]);
  };

  const move = async (direction: -1 | 1) => {
    if (!selected) return;
    const moved = moveSibling(outlineData?.outline || [], selected.id, direction);
    await persist(moved, 'sort', state.historicalAdaptationOutlineChanges);
  };

  const confirm = async () => {
    setSaving(true);
    try {
      const nextState = await window.yibiao.technicalPlan.confirmHistoricalAdaptationOutline({ projectId });
      onStateChange(nextState);
      showToast('目录已确认，当前进入等待验收状态', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '确认目录失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="historical-adaptation-outline-page">
      <header className="historical-adaptation-outline-head">
        <div><span className="section-kicker">环节四 · 目录适配</span><h1>{project?.projectName || '历史标书适配项目'}</h1><p>以历史标书目录为骨架，根据已确认差异和招标基线完成定向调整。</p></div>
        <div className="historical-adaptation-outline-actions">
          <button type="button" className="secondary-action" onClick={onBack}>返回我的标书</button>
          <button type="button" className="primary-action" onClick={() => { void startGeneration(); }} disabled={running || saving}>{running ? '适配中...' : outlineData ? '重新生成目录' : '开始目录适配'}</button>
        </div>
      </header>

      {running ? <section className="historical-adaptation-outline-progress"><span>后台适配进度</span><ProgressBar value={task?.progress || 0} /></section> : null}
      {task?.status === 'error' ? <section className="historical-adaptation-difference-error"><strong>目录适配失败</strong><span>{task.error || '请重新生成目录。'}</span></section> : null}

      {outlineData?.outline?.length ? (
        <div className="historical-adaptation-outline-workbench">
          <section className="adaptation-outline-column is-original">
            <header><strong>原目录</strong><span>只读快照</span></header>
            <div className="adaptation-outline-scroll">
              <OutlineTree items={state.historicalAdaptationOriginalOutline?.outline || []} readonly />
              {deletedChanges.length ? <div className="adaptation-outline-deleted-list"><strong>已删除目录</strong>{deletedChanges.map((change) => <article key={change.id}><span>{change.original_path}</span><small>{change.reason}</small>{change.difference_ids.length ? <em>关联差异：{change.difference_ids.map((id) => differenceTitles.get(id) || id).join('；')}</em> : null}</article>)}</div> : null}
            </div>
          </section>
          <section className="adaptation-outline-column is-adapted">
            <header><strong>适配后目录</strong><span>{outlineData.outline.length} 个一级目录</span></header>
            <div className="adaptation-outline-toolbar">
              <button type="button" onClick={() => { void addRoot(); }} disabled={running || saving}>增加一级目录</button>
              <button type="button" onClick={() => { void addChild(); }} disabled={!selected || running || saving}>增加子目录</button>
              <button type="button" title="上移同级目录" onClick={() => { void move(-1); }} disabled={!selected || running || saving}>上移</button>
              <button type="button" title="下移同级目录" onClick={() => { void move(1); }} disabled={!selected || running || saving}>下移</button>
              <button type="button" className="is-danger" onClick={() => { void deleteSelected(); }} disabled={!selected || running || saving}>删除</button>
            </div>
            <div className="adaptation-outline-scroll"><OutlineTree items={outlineData.outline} selectedId={selectedId} onSelect={setSelectedId} /></div>
          </section>
          <section className="adaptation-outline-column is-detail">
            <header><strong>变更依据</strong><span>{selectedChanges.length} 项记录</span></header>
            {selected ? <div className="adaptation-outline-editor">
              <label>目录标题<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={running || saving} /></label>
              <label>编制说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={running || saving} rows={5} /></label>
              <button type="button" className="primary-action" onClick={() => { void saveEdit(); }} disabled={!title.trim() || running || saving}>保存编辑</button>
              <div className="adaptation-outline-change-list">
                {selectedChanges.map((change) => <article key={change.id}><span>{change.change_type === 'renamed' ? '标题调整' : change.change_type === 'added' ? '新增目录' : change.change_type === 'moved' ? '位置调整' : '内容调整'}</span><strong>{change.reason}</strong>{change.original_path ? <small>原路径：{change.original_path}</small> : null}{change.difference_ids.length ? <em>关联差异：{change.difference_ids.map((id) => differenceTitles.get(id) || id).join('；')}</em> : null}</article>)}
                {!selectedChanges.length ? <p>该目录沿用历史结构，暂无单独变更记录。</p> : null}
              </div>
            </div> : <div className="adaptation-outline-empty">请选择适配后目录查看详情</div>}
          </section>
        </div>
      ) : <section className="historical-adaptation-difference-empty"><strong>{running ? '正在提取并适配历史目录' : '尚未生成适配目录'}</strong><p>点击“开始目录适配”，系统将按已确认差异定向调整历史目录。</p></section>}

      <section className={`historical-adaptation-outline-acceptance${outlineComplete ? ' is-complete' : ''}`}>
        <div><span className="section-kicker">环节四状态</span><strong>{outlineComplete ? '目录适配已确认，等待验收' : '请核对并确认适配目录'}</strong></div>
        {outlineData?.outline?.length ? <button type="button" className="primary-action" onClick={() => { void confirm(); }} disabled={running || saving || outlineComplete}>{outlineComplete ? '已确认' : '确认目录'}</button> : <span>环节五保持锁定</span>}
      </section>
    </div>
  );
}

export default AdaptationOutlinePage;
