import { useCallback, useEffect, useState } from 'react';
import ExpansionProjectCreatePage from '../../bid-project/pages/ExpansionProjectCreatePage';
import type { BidProject } from '../../bid-project/types';
import type { TechnicalPlanState } from '../../technical-plan/types';
import { InlineSpinner } from '../../../shared/ui';

interface HistoricalBidAdaptationPageProps {
  projectId?: string;
  onBack: () => void;
  onProjectCreated: (project: BidProject) => void;
}

const stages = ['上传材料', '招标基线', '差异确认', '目录适配', '正文迁移', '审核导出'] as const;

function HistoricalBidAdaptationPage({ projectId, onBack, onProjectCreated }: HistoricalBidAdaptationPageProps) {
  return (
    <div className="historical-adaptation-page">
      <section className="historical-adaptation-stage-panel" aria-label="历史标书适配流程">
        <div className="historical-adaptation-stages">
          {stages.map((stage, index) => (
            <div
              key={stage}
              className={`historical-adaptation-stage ${index === 0 ? 'is-current' : 'is-locked'}`}
              aria-current={index === 0 ? 'step' : undefined}
              aria-disabled={index > 0 ? 'true' : undefined}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{stage}</strong>
              <small>{index === 0 ? (projectId ? '待验收' : '进行中') : '待开放'}</small>
            </div>
          ))}
        </div>
        <p>后续环节将在本阶段验收后开放</p>
      </section>

      <div className="historical-adaptation-content">
        {projectId ? (
          <MaterialAcceptance projectId={projectId} onBack={onBack} />
        ) : (
          <ExpansionProjectCreatePage
            variant="historical-adaptation"
            onBack={onBack}
            onProjectCreated={onProjectCreated}
          />
        )}
      </div>
    </div>
  );
}

function MaterialAcceptance({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [state, setState] = useState<TechnicalPlanState | null>(null);
  const [project, setProject] = useState<BidProject | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  if (loading) {
    return <div className="historical-adaptation-loading"><InlineSpinner />正在读取已入库材料...</div>;
  }

  if (error || !state) {
    return (
      <section className="historical-adaptation-error">
        <strong>材料读取失败</strong>
        <span>{error || '未找到项目材料。'}</span>
        <button type="button" className="secondary-action" onClick={() => { void loadMaterials(); }}>重试</button>
      </section>
    );
  }

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
          <strong>材料已就绪，等待验收</strong>
          <p>本页仅完成材料上传、解析和入库确认，尚未执行招标基线提取或历史标书改写。</p>
        </div>
        <span className="historical-adaptation-locked-message">后续环节将在本阶段验收后开放</span>
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
