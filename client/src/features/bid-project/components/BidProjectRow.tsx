import type { BidProject, BidProjectDuplicateSummary } from '../types';
import { formatDuplicateSummary } from '../services/duplicateRewriteUi';

const statusLabels: Record<BidProject['status'], string> = {
  generating: '生成中',
  incomplete: '未完成',
  completed: '已完成',
  failed: '生成失败',
};

const typeLabels: Record<BidProject['projectType'], string> = {
  'technical-plan': '技术方案',
  'existing-plan-expansion': '已有方案扩写',
};

interface BidProjectRowProps {
  project: BidProject;
  onOpen: (project: BidProject) => void;
  onRename: (project: BidProject) => void;
  onDelete: (project: BidProject) => void;
  onExport: (project: BidProject) => void;
  onCompare?: (project: BidProject) => void;
  compareSelected?: boolean;
  duplicateSummary?: BidProjectDuplicateSummary | null;
  onViewDuplicateResult?: (project: BidProject) => void;
}

function BidProjectRow({
  project,
  onOpen,
  onRename,
  onDelete,
  onExport,
  onCompare,
  compareSelected = false,
  duplicateSummary,
  onViewDuplicateResult,
}: BidProjectRowProps) {
  const updatedAt = new Date(project.updatedAt).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const canExport = project.status === 'completed';
  const exportDisabledReason = project.status === 'generating'
    ? '项目正在生成中，请等待任务结束后再导出'
    : project.status === 'failed'
      ? '标书生成失败，请重新生成后再导出'
      : '标书生成完成后才可导出';

  return (
    <article className="bid-project-row">
      <button type="button" className="bid-project-row-main" onClick={() => onOpen(project)}>
        <strong>{project.projectName}</strong>
        <span>{project.sourceFileName || '尚未上传招标文件'}{project.sectionLabel ? ` · ${project.sectionLabel}` : ''} · 同源第 {project.sourceSequence || 1} 份</span>
        <span className={`bid-project-row-duplicate-summary${duplicateSummary ? '' : ' is-empty'}`}>
          {duplicateSummary ? `最近对比：${duplicateSummary.otherProjectName} · ${formatDuplicateSummary(duplicateSummary)}` : '最近查重：暂无结果'}
        </span>
      </button>
      <span className="bid-project-row-type">{typeLabels[project.projectType]}</span>
      <span className={`bid-project-status is-${project.status}`}><i />{statusLabels[project.status]}</span>
      <span className="bid-project-row-time">{updatedAt}</span>
      <div className="bid-project-row-actions">
        <button type="button" className="text-button" onClick={() => onRename(project)}>重命名</button>
        {onCompare ? <button type="button" className={`text-button ${compareSelected ? 'is-selected' : ''}`} onClick={() => onCompare(project)} aria-pressed={compareSelected}>{compareSelected ? '已选查重' : '选择查重'}</button> : null}
        {onViewDuplicateResult ? (
          <button
            type="button"
            className="text-button"
            onClick={() => onViewDuplicateResult(project)}
            disabled={!duplicateSummary}
            title={duplicateSummary ? '查看最近一次查重结果' : '暂无查重结果'}
          >
            查看查重结果
          </button>
        ) : null}
        <button
          type="button"
          className="text-button"
          onClick={() => onExport(project)}
          disabled={project.status !== 'completed'}
          title={canExport ? '选择导出模板并导出 Word' : exportDisabledReason}
        >
          导出
        </button>
        <button type="button" className="text-button danger-text" onClick={() => onDelete(project)}>删除</button>
      </div>
    </article>
  );
}

export default BidProjectRow;
