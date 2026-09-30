import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import ExpansionProjectCreatePage from '../../bid-project/pages/ExpansionProjectCreatePage';
import type { BidProject } from '../../bid-project/types';
import BidAnalysisPage from '../../technical-plan/pages/BidAnalysisPage';
import { bidAnalysisTasks, isMissingBidAnalysisResult } from '../../technical-plan/services/bidAnalysisWorkflow';
import type { BackgroundTaskState, TechnicalPlanState } from '../../technical-plan/types';
import { InlineSpinner } from '../../../shared/ui';
import AdaptationDifferencePage from '../components/AdaptationDifferencePage';

interface HistoricalBidAdaptationPageProps {
  projectId?: string;
  onBack: () => void;
  onProjectCreated: (project: BidProject) => void;
}

const stages = ['上传材料', '招标基线', '差异确认', '目录适配', '正文迁移', '审核导出'] as const;

function HistoricalBidAdaptationPage({ projectId, onBack, onProjectCreated }: HistoricalBidAdaptationPageProps) {
  const [activeStage, setActiveStage] = useState(projectId ? 1 : 0);

  useEffect(() => {
    setActiveStage(projectId ? 1 : 0);
  }, [projectId]);

  if (projectId) {
    return (
      <AdaptationProjectWorkspace
        projectId={projectId}
        activeStage={activeStage}
        onStageChange={setActiveStage}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="historical-adaptation-page">
      <StageNavigation activeStage={0} projectReady={false} onStageChange={setActiveStage} />

      <div className="historical-adaptation-content">
        <ExpansionProjectCreatePage
          variant="historical-adaptation"
          onBack={onBack}
          onProjectCreated={onProjectCreated}
        />
      </div>
    </div>
  );
}

function AdaptationProjectWorkspace({
  projectId,
  activeStage,
  onStageChange,
  onBack,
}: {
  projectId: string;
  activeStage: number;
  onStageChange: (stage: number) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<TechnicalPlanState | null>(null);
  const [project, setProject] = useState<BidProject | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadWorkspace = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [nextState, nextProject] = await Promise.all([
        window.yibiao!.technicalPlan.loadState({ projectId }),
        window.yibiao!.bidProject.get(projectId),
      ]);
      setState(nextState);
      setProject(nextProject);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取项目材料失败');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const taskBridge = window.yibiao?.tasks;
    if (!taskBridge) return undefined;

    const unsubscribe = taskBridge.onTaskEvent<TechnicalPlanState>((event) => {
      const eventProjectId = event.task.project_id || event.task.projectId || event.task.scope_id;
      if (eventProjectId !== projectId) return;
      const taskType = event.task.type;
      if (taskType !== 'bid-analysis' && taskType !== 'historical-adaptation-difference') return;
      const technicalPlan = event.technicalPlanPatch || event.technicalPlan || {};

      setState((previous) => previous ? {
        ...previous,
        ...technicalPlan,
        ...(taskType === 'bid-analysis'
          ? { bidAnalysisTask: (technicalPlan.bidAnalysisTask || event.task) as BackgroundTaskState }
          : { historicalAdaptationDifferenceTask: (technicalPlan.historicalAdaptationDifferenceTask || event.task) as BackgroundTaskState }),
        bidAnalysisTasks: {
          ...previous.bidAnalysisTasks,
          ...(technicalPlan.bidAnalysisTasks || {}),
          ...(event.bidItem ? { [event.bidItem.id]: event.bidItem } : {}),
        },
      } : previous);
    });

    void taskBridge.getActiveTasks()
      .then(() => loadWorkspace(false))
      .catch(() => undefined);

    return unsubscribe;
  }, [loadWorkspace, projectId]);

  if (loading) {
    return <div className="historical-adaptation-loading"><InlineSpinner />正在读取已入库材料...</div>;
  }

  if (error || !state) {
    return (
      <section className="historical-adaptation-error">
        <strong>材料读取失败</strong>
        <span>{error || '未找到项目材料。'}</span>
        <button type="button" className="secondary-action" onClick={() => { void loadWorkspace(); }}>重试</button>
      </section>
    );
  }

  const baselineComplete = bidAnalysisTasks.every((definition) => {
    const item = state.bidAnalysisTasks[definition.id];
    return item?.status === 'success' && !isMissingBidAnalysisResult(definition, item.content);
  });
  const baselineRunning = state.bidAnalysisTask?.status === 'running' || state.bidAnalysisTask?.status === 'pausing';
  const differenceComplete = Boolean(state.historicalAdaptationDifferenceConfirmedAt);
  const differenceRunning = state.historicalAdaptationDifferenceTask?.status === 'running'
    || state.historicalAdaptationDifferenceTask?.status === 'pausing';

  return (
    <div className="historical-adaptation-page">
      <StageNavigation
        activeStage={activeStage}
        projectReady
        baselineComplete={baselineComplete}
        baselineRunning={baselineRunning}
        differenceComplete={differenceComplete}
        differenceRunning={differenceRunning}
        onStageChange={onStageChange}
      />
      <div className="historical-adaptation-content">
        {activeStage === 0 ? (
          <MaterialAcceptance
            state={state}
            project={project}
            onBack={onBack}
            onContinue={() => onStageChange(1)}
          />
        ) : activeStage === 1 ? (
          <TenderBaseline
            projectId={projectId}
            state={state}
            project={project}
            baselineComplete={baselineComplete}
            onStateChange={setState}
            onBack={onBack}
            onContinue={() => onStageChange(2)}
          />
        ) : (
          <AdaptationDifferencePage
            projectId={projectId}
            state={state}
            project={project}
            onStateChange={setState}
            onBack={onBack}
          />
        )}
      </div>
    </div>
  );
}

function StageNavigation({
  activeStage,
  projectReady,
  baselineComplete = false,
  baselineRunning = false,
  differenceComplete = false,
  differenceRunning = false,
  onStageChange,
}: {
  activeStage: number;
  projectReady: boolean;
  baselineComplete?: boolean;
  baselineRunning?: boolean;
  differenceComplete?: boolean;
  differenceRunning?: boolean;
  onStageChange: (stage: number) => void;
}) {
  return (
    <section className="historical-adaptation-stage-panel" aria-label="历史标书适配流程">
      <div className="historical-adaptation-stages">
        {stages.map((stage, index) => {
          const disabled = index > 2 || (!projectReady && index > 0) || (!baselineComplete && index === 2);
          const current = index === activeStage;
          const completed = projectReady && (index === 0 || (index === 1 && baselineComplete) || (index === 2 && differenceComplete));
          const status = index === 0
            ? projectReady ? '已完成' : '进行中'
            : index === 1 && projectReady
              ? baselineRunning ? '提取中' : baselineComplete ? '待验收' : '可开始'
              : baselineComplete && index === 2
                ? differenceRunning ? '分析中' : differenceComplete ? '待验收' : '可开始'
                : '待开放';

          return (
            <button
              type="button"
              key={stage}
              className={`historical-adaptation-stage${current ? ' is-current' : ''}${completed ? ' is-complete' : ''}${disabled ? ' is-locked' : ''}`}
              aria-current={current ? 'step' : undefined}
              aria-disabled={disabled ? 'true' : undefined}
              disabled={disabled}
              onClick={() => onStageChange(index)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage}</strong>
              <small>{status}</small>
            </button>
          );
        })}
      </div>
      <p>{!projectReady
        ? '完成材料上传后开放招标基线'
        : !baselineComplete
          ? '完整提取招标基线后开放差异确认'
          : differenceComplete
            ? '差异确认已完成，等待本阶段验收'
            : '完成全部差异确认后进入本阶段验收'}</p>
    </section>
  );
}

function MaterialAcceptance({
  state,
  project,
  onBack,
  onContinue,
}: {
  state: TechnicalPlanState;
  project: BidProject | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="historical-adaptation-acceptance">
      <header className="historical-adaptation-acceptance-head">
        <div>
          <span className="section-kicker">环节一 · 材料验收</span>
          <h1>{project?.projectName || '历史标书适配项目'}</h1>
          <p>材料已复制到项目并完成解析，请核对文件名称、数量和解析结果。</p>
        </div>
        <button type="button" className="secondary-action" onClick={onBack}>返回我的标书</button>
      </header>

      <section className="historical-adaptation-summary" aria-label="材料汇总">
        <div><span>招标文件</span><strong>{state.tenderFiles.length} 份</strong></div>
        <div><span>历史标书</span><strong>{state.originalPlanFile ? '1 份' : '0 份'}</strong></div>
        <div><span>解析状态</span><strong className="is-success">{state.tenderFiles.length && state.originalPlanFile ? '全部成功' : '材料不完整'}</strong></div>
      </section>

      <section className="historical-adaptation-materials">
        <MaterialGroup
          index="01"
          title="招标文件"
          files={state.tenderFiles.map((file) => ({
            name: file.fileName,
            parser: file.parserLabel,
            chars: file.markdownChars,
            importedAt: file.importedAt || file.updatedAt,
          }))}
        />
        <MaterialGroup
          index="02"
          title="历史标书"
          files={state.originalPlanFile ? [{
            name: state.originalPlanFile.fileName,
            parser: state.originalPlanFile.parserLabel,
            chars: state.originalPlanFile.markdownChars,
            importedAt: state.originalPlanFile.importedAt || state.originalPlanFile.updatedAt,
          }] : []}
        />
      </section>

      <section className="historical-adaptation-acceptance-note">
        <div>
          <span className="section-kicker">当前状态</span>
          <strong>材料已完成验收</strong>
          <p>招标文件和历史标书均已入库，可以进入环节二提取招标基线。</p>
        </div>
        <button type="button" className="primary-action" onClick={onContinue}>进入招标基线</button>
      </section>
    </div>
  );
}

function TenderBaseline({
  projectId,
  state,
  project,
  baselineComplete,
  onStateChange,
  onBack,
  onContinue,
}: {
  projectId: string;
  state: TechnicalPlanState;
  project: BidProject | null;
  baselineComplete: boolean;
  onStateChange: Dispatch<SetStateAction<TechnicalPlanState | null>>;
  onBack: () => void;
  onContinue: () => void;
}) {
  const taskRunning = state.bidAnalysisTask?.status === 'running' || state.bidAnalysisTask?.status === 'pausing';

  return (
    <div className="historical-adaptation-baseline">
      <header className="historical-adaptation-baseline-head">
        <div>
          <span className="section-kicker">历史标书适配</span>
          <strong>{project?.projectName || '历史标书适配项目'}</strong>
        </div>
        <button type="button" className="secondary-action" onClick={onBack}>返回我的标书</button>
      </header>

      <BidAnalysisPage
        variant="tender-baseline"
        projectId={projectId}
        hasTenderFile={Boolean(state.tenderFile)}
        mode="full"
        selectedTaskIds={bidAnalysisTasks.map((task) => task.id)}
        bidSectionMode={state.bidSectionMode}
        bidSectionExtractionTask={state.bidSectionExtractionTask}
        selectedSectionTitle={state.tenderFile?.selectedSectionTitle}
        tasks={state.bidAnalysisTasks}
        task={state.bidAnalysisTask}
        progress={state.bidAnalysisProgress}
        onProgressChange={(progress) => onStateChange((previous) => (
          previous ? { ...previous, bidAnalysisProgress: progress } : previous
        ))}
        onConfigSaved={onStateChange}
      />

      <section className={`historical-adaptation-baseline-status${baselineComplete ? ' is-complete' : ''}`}>
        <div>
          <span className="section-kicker">环节二状态</span>
          <strong>{baselineComplete ? '招标基线已提取完成，等待验收' : taskRunning ? '正在提取招标基线' : '招标基线尚未完整提取'}</strong>
          <p>{baselineComplete
            ? '本阶段结果已持久化；差异确认尚未执行。'
            : taskRunning ? '任务在后台运行，离开页面不会中断。' : '点击“开始提取基线”，完成全部解析项后再进行验收。'}</p>
        </div>
        {baselineComplete
          ? <button type="button" className="primary-action" onClick={onContinue}>进入差异确认</button>
          : <span>环节三保持锁定</span>}
      </section>
    </div>
  );
}

interface MaterialFile {
  name: string;
  parser?: string;
  chars: number;
  importedAt?: string;
}

function MaterialGroup({ index, title, files }: { index: string; title: string; files: MaterialFile[] }) {
  return (
    <article className="historical-adaptation-material-group">
      <header><span>{index}</span><div><strong>{title}</strong><small>{files.length} 份已入库</small></div></header>
      <div className="historical-adaptation-file-list">
        {files.map((file) => (
          <div className="historical-adaptation-file" key={`${title}-${file.name}`}>
            <span className="historical-adaptation-file-badge">{file.name.split('.').pop()?.toUpperCase() || 'FILE'}</span>
            <div><strong title={file.name}>{file.name}</strong><span>{file.parser || '未知解析方式'} · {file.chars.toLocaleString('zh-CN')} 字{file.importedAt ? ` · ${new Date(file.importedAt).toLocaleString('zh-CN')}` : ''}</span></div>
            <em>解析成功</em>
          </div>
        ))}
        {!files.length ? <div className="historical-adaptation-file-empty">未找到已入库文件</div> : null}
      </div>
    </article>
  );
}

export default HistoricalBidAdaptationPage;
