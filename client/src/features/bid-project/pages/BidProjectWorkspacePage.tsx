import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppDialog, EmptyState, useToast } from '../../../shared/ui';
import type { SectionId } from '../../../shared/types/navigation';
import { bidProjectStorage } from '../services/bidProjectStorage';
import type { BidContentDuplicateResult, BidProject, BidProjectDuplicateSummary, BidProjectStatus } from '../types';
import BidProjectCompareBar from '../components/BidProjectCompareBar';
import BidProjectDuplicateResultDialog from '../components/BidProjectDuplicateResultDialog';
import BidProjectRow from '../components/BidProjectRow';

interface BidProjectWorkspacePageProps {
  onSectionChange: (section: SectionId) => void;
  onProjectChange?: (projectId: string | null) => void;
}

function BidProjectWorkspacePage({ onSectionChange, onProjectChange }: BidProjectWorkspacePageProps) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<BidProject[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | BidProjectStatus>('all');
  const [type, setType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState<BidProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BidProject | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [compareSensitivity, setCompareSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  const [comparePair, setComparePair] = useState<[BidProject, BidProject] | null>(null);
  const [compareResult, setCompareResult] = useState<BidContentDuplicateResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [recentDuplicateSummaries, setRecentDuplicateSummaries] = useState<Record<string, BidProjectDuplicateSummary | null>>({});
  const compareRequestRef = useRef(0);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await bidProjectStorage.list({ query, status, type }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取标书项目失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [query, showToast, status, type]);

  const loadRecentDuplicateSummaries = useCallback(async (items: BidProject[]) => {
    if (!items.length) {
      setRecentDuplicateSummaries({});
      return;
    }
    try {
      setRecentDuplicateSummaries(await bidProjectStorage.listRecentDuplicateSummaries(items.map((project) => project.projectId)));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取最近查重结果失败', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadRecentDuplicateSummaries(projects);
  }, [loadRecentDuplicateSummaries, projects]);

  const counts = useMemo(() => ({
    all: projects.length,
    generating: projects.filter((project) => project.status === 'generating').length,
    incomplete: projects.filter((project) => project.status === 'incomplete').length,
    completed: projects.filter((project) => project.status === 'completed').length,
  }), [projects]);

  const selectedProjects = useMemo(
    () => compareSelection
      .map((projectId) => projects.find((project) => project.projectId === projectId))
      .filter(Boolean) as BidProject[],
    [compareSelection, projects],
  );

  const openProject = async (project: BidProject) => {
    try {
      await window.yibiao?.bidProject.open(project.projectId);
      onProjectChange?.(project.projectId);
      onSectionChange(project.projectType === 'existing-plan-expansion' ? 'existing-plan-expansion' : 'technical-plan');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打开标书项目失败', 'error');
    }
  };

  const createProject = async () => {
    try {
      const selected = await window.yibiao?.file.selectDuplicateCheckFiles({ multiple: true });
      const filePaths = selected?.files?.map((file) => file.file_path).filter(Boolean) || [];
      if (!filePaths.length) return;
      const preview = await bidProjectStorage.prepareImport(filePaths);
      if (!preview.success || !preview.token) throw new Error(preview.message || '准备招标文件失败');
      if (preview.matches?.length) {
        showToast(
          `检测到这份招标文件已有 ${preview.matches.length} 份同源标书，本次将继续创建第 ${Math.max(...preview.matches.map((item) => item.sourceSequence || 1)) + 1} 份。`,
          'info',
          { duration: 5000 },
        );
      }
      const project = await window.yibiao!.bidProject.confirmImport(preview.token, {
        projectName: preview.fileName || '未命名标书',
        projectType: 'technical-plan',
      });
      await openProject(project);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '新建标书失败', 'error');
    }
  };

  const runCompare = async (pair: [BidProject, BidProject], sensitivity = compareSensitivity) => {
    const requestId = compareRequestRef.current + 1;
    compareRequestRef.current = requestId;
    setComparePair(pair);
    setCompareResult(null);
    setCompareLoading(true);
    try {
      const result = await bidProjectStorage.compareContent({
        leftProjectId: pair[0].projectId,
        rightProjectId: pair[1].projectId,
        sensitivity,
      });
      if (requestId !== compareRequestRef.current) return;
      setCompareResult(result);
      await loadRecentDuplicateSummaries(projects);
    } catch (error) {
      if (requestId !== compareRequestRef.current) return;
      showToast(error instanceof Error ? error.message : '正文查重失败', 'error');
    } finally {
      if (requestId === compareRequestRef.current) setCompareLoading(false);
    }
  };

  const chooseCompare = (project: BidProject) => {
    if (!compareSelection.includes(project.projectId) && compareSelection.length === 1) {
      const selectedProject = projects.find((item) => item.projectId === compareSelection[0]);
      if (!selectedProject || !selectedProject.sourceGroupId || selectedProject.sourceGroupId !== project.sourceGroupId) {
        showToast('正文查重请选择同一招标文件生成的两份标书', 'info');
        return;
      }
    }
    setCompareSelection((previous) => {
      if (previous.includes(project.projectId)) return previous.filter((projectId) => projectId !== project.projectId);
      return [...previous, project.projectId].slice(-2);
    });
  };

  const selectedPair = selectedProjects.length === 2 ? [selectedProjects[0], selectedProjects[1]] as [BidProject, BidProject] : null;
  const clearCompareSelection = () => setCompareSelection([]);
  const swapCompareSelection = () => setCompareSelection((previous) => [previous[1], previous[0]].filter(Boolean));

  const openLatestDuplicateResult = async (project: BidProject) => {
    if (compareLoading) {
      showToast('当前正在对比正文，请等待本次对比完成', 'info');
      return;
    }
    try {
      const result = await bidProjectStorage.loadLatestDuplicateResult(project.projectId);
      if (!result) {
        showToast('暂无查重结果', 'info');
        return;
      }
      const leftProject = result.leftProject || projects.find((item) => item.projectId === result.leftProjectId);
      const rightProject = result.rightProject || projects.find((item) => item.projectId === result.rightProjectId);
      if (!leftProject || !rightProject) throw new Error('查重结果对应的项目已不存在');
      if (result.sensitivity === 'low' || result.sensitivity === 'medium' || result.sensitivity === 'high') {
        setCompareSensitivity(result.sensitivity);
      }
      setComparePair([leftProject, rightProject]);
      setCompareResult(result);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '读取查重结果失败', 'error');
    }
  };

  const closeCompareResult = () => {
    if (compareLoading) return;
    compareRequestRef.current += 1;
    setComparePair(null);
    setCompareResult(null);
  };

  const confirmRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await bidProjectStorage.update(renameTarget.projectId, { projectName: renameValue.trim() });
      setRenameTarget(null);
      await loadProjects();
      showToast('标书项目已重命名', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重命名失败', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const result = await bidProjectStorage.remove(deleteTarget.projectId);
      if (!result.success) throw new Error(result.message || '删除失败');
      setDeleteTarget(null);
      setCompareSelection((previous) => previous.filter((projectId) => projectId !== deleteTarget.projectId));
      if (comparePair?.some((project) => project.projectId === deleteTarget.projectId)) {
        compareRequestRef.current += 1;
        setCompareLoading(false);
        setComparePair(null);
        setCompareResult(null);
      }
      await loadProjects();
      showToast('标书项目已删除', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除标书项目失败', 'error');
    }
  };

  const exportProject = async (project: BidProject) => {
    if (project.status === 'generating') {
      showToast('项目正在生成中，请等待任务结束后再导出', 'info');
      return;
    }
    try {
      const result = await bidProjectStorage.exportWord(project.projectId, {
        requestId: `project-export-${project.projectId}-${Date.now()}`,
      });
      if (result?.canceled) {
        showToast('已取消导出', 'info');
      } else {
        showToast(result?.message || 'Word 已导出', result?.warnings?.length ? 'info' : 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导出 Word 失败', 'error');
    }
  };

  return (
    <div className="bid-project-page">
      <header className="bid-project-page-head">
        <div>
          <span className="section-kicker">我的标书</span>
          <h1>我的标书</h1>
          <p>管理本机上的多份标书，随时继续编辑、查重或导出。</p>
        </div>
        <button type="button" className="primary-action" onClick={() => { void createProject(); }}>＋ 新建标书</button>
      </header>

      <div className="bid-project-summary">
        <button type="button" className={`bid-project-summary-card ${status === 'all' ? 'is-active' : ''}`} onClick={() => setStatus('all')}>
          <span>全部项目</span><strong>{counts.all}</strong><small>本机保存</small>
        </button>
        <button type="button" className={`bid-project-summary-card ${status === 'generating' ? 'is-active' : ''}`} onClick={() => setStatus('generating')}>
          <span>生成中</span><strong>{counts.generating}</strong><small>后台任务</small>
        </button>
        <button type="button" className={`bid-project-summary-card ${status === 'incomplete' ? 'is-active' : ''}`} onClick={() => setStatus('incomplete')}>
          <span>未完成</span><strong>{counts.incomplete}</strong><small>可以继续处理</small>
        </button>
        <button type="button" className={`bid-project-summary-card ${status === 'completed' ? 'is-active' : ''}`} onClick={() => setStatus('completed')}>
          <span>已完成</span><strong>{counts.completed}</strong><small>可直接导出</small>
        </button>
      </div>

      <BidProjectCompareBar
        selectedProjects={selectedProjects}
        sensitivity={compareSensitivity}
        loading={compareLoading}
        onSensitivityChange={setCompareSensitivity}
        onSwap={swapCompareSelection}
        onClear={clearCompareSelection}
        onStart={() => { if (selectedPair) void runCompare(selectedPair, compareSensitivity); }}
      />

      <section className="bid-project-list-panel">
        <div className="bid-project-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标书名称、来源文件或标段" />
          <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | BidProjectStatus)} aria-label="状态筛选">
            <option value="all">状态：全部</option>
            <option value="generating">状态：生成中</option>
            <option value="incomplete">状态：未完成</option>
            <option value="completed">状态：已完成</option>
            <option value="failed">状态：生成失败</option>
          </select>
          <select value={type} onChange={(event) => setType(event.target.value)} aria-label="类型筛选">
            <option value="all">类型：全部</option>
            <option value="technical-plan">技术方案</option>
            <option value="existing-plan-expansion">已有方案扩写</option>
          </select>
        </div>
        <div className="bid-project-list-head"><span>标书</span><span>类型</span><span>状态</span><span>更新时间</span><span>操作</span></div>
        {loading ? <div className="bid-project-loading">正在读取本机标书项目...</div> : null}
        {!loading && projects.length === 0 ? (
          <EmptyState title="还没有标书项目" hint="新建一份标书后，目录、正文和生成进度都会独立保存。">
            <button type="button" className="primary-action" onClick={() => { void createProject(); }}>新建第一份标书</button>
          </EmptyState>
        ) : null}
        {!loading && projects.map((project) => (
          <BidProjectRow
            key={project.projectId}
            project={project}
            onOpen={(target) => { void openProject(target); }}
            onRename={(target) => { setRenameTarget(target); setRenameValue(target.projectName); }}
            onDelete={setDeleteTarget}
            onExport={(target) => { void exportProject(target); }}
            onCompare={chooseCompare}
            compareSelected={compareSelection.includes(project.projectId)}
            duplicateSummary={recentDuplicateSummaries[project.projectId]}
            onViewDuplicateResult={(target) => { void openLatestDuplicateResult(target); }}
          />
        ))}
      </section>

      <AppDialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        kicker="项目管理"
        title="重命名标书项目"
        description="只修改项目名称，不会影响招标文件、目录或正文。"
        actions={(
          <>
            <button type="button" className="secondary-action" onClick={() => setRenameTarget(null)}>取消</button>
            <button type="button" className="primary-action" onClick={() => { void confirmRename(); }}>保存名称</button>
          </>
        )}
      >
        <input className="app-dialog-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
      </AppDialog>

      <AppDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        kicker="直接删除"
        title="确定删除这份标书？"
        description={`将直接删除“${deleteTarget?.projectName || ''}”及其本机正文、生成状态和导出上下文，不进入回收站。`}
        actions={(
          <>
            <button type="button" className="secondary-action" onClick={() => setDeleteTarget(null)}>取消</button>
            <button type="button" className="danger-action" onClick={() => { void confirmDelete(); }}>直接删除</button>
          </>
        )}
      />

      <BidProjectDuplicateResultDialog
        open={Boolean(compareResult)}
        result={compareResult}
        leftProject={comparePair?.[0] || null}
        rightProject={comparePair?.[1] || null}
        onOpenChange={(open) => { if (!open) closeCompareResult(); }}
        onResultChange={setCompareResult}
        onRecompare={async () => {
          if (comparePair) await runCompare(comparePair, compareSensitivity);
        }}
      />
    </div>
  );
}

export default BidProjectWorkspacePage;
