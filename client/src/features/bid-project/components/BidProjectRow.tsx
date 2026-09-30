import type { BidProject, BidProjectDuplicateSummary } from '../types';
import { formatDuplicateSummary } from '../services/duplicateRewriteUi';
import { ProgressBar } from '../../../shared/ui';

const statusLabels: Record<BidProject['status'], string> = {
  generating: '生成中',
  incomplete: '未完成',
  completed: '已完成',
  failed: '生成失败',
};

const typeLabels: Record<BidProject['projectType'], string> = {
  'technical-plan': '技术方案',
  'existing-plan-expansion': '已有方案扩写',
  'historical-bid-adaptation': '历史标书适配',
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
  onCreateVariant?: (project: BidProject) => void;
  onRetryUniqueness?: (project: BidProject) => void;
  commandPending?: boolean;
  uniquenessProgress?: number;
}

function getUniquenessLabel(project: BidProject): string {
  if (project.lastError?.includes('来源项目')) return '来源项目已删除';
  if (project.uniquenessStatus === 'checking') return '查重改写中';
  if (project.uniquenessStatus === 'passed') return '查重通过';
  if (project.uniquenessStatus === 'failed') return '查重未通过';
  return '待查重';
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
  onCreateVariant,
  onRetryUniqueness,
  commandPending = false,
  uniquenessProgress,
}: BidProjectRowProps) {
  const updatedAt = new Date(project.updatedAt).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const isDerived = Boolean(project.derivedFromProjectId);
  const canExport = project.status === 'completed'
    && (!isDerived || project.uniquenessStatus === 'passed');
  const canCreateVariant = project.projectType === 'technical-plan'
    && !project.derivedFromProjectId
    && project.status === 'completed';
  const hasCompletedBody = project.lastTaskType === 'variant-deduplication'
    || (project.lastTaskType === 'content-generation' && project.lastTaskStatus === 'success');
  const canRetryUniqueness = isDerived
    && (project.uniquenessStatus === 'pending' || project.uniquenessStatus === 'failed')
    && !project.lastError?.includes('来源项目已删除')
    && project.status !== 'generating'
    && hasCompletedBody;
  const exportDisabledReason = project.status === 'generating'
    ? '项目正在生成中，请等待任务结束后再导出'
    : isDerived && project.uniquenessStatus !== 'passed'
      ? '同源正文查重通过后才可导出'
    : project.status === 'failed'
      ? '标书生成失败，请重新生成后再导出'
      : '标书生成完成后才可导出';
  const displayStatus = isDerived ? getUniquenessLabel(project) : statusLabels[project.status];
  const duplicateLabel = duplicateSummary
    ? `最近对比：${duplicateSummary.otherProjectName} · ${formatDuplicateSummary(duplicateSummary)}`
    : '最近查重：暂无结果';

  return (
    <article className="bid-project-row">
      <button type="button" className="bid-project-row-main" onClick={() => onOpen(project)}>
        <strong title={project.projectName}>{project.projectName}</strong>
        <span className={`bid-project-row-duplicate-summary${duplicateSummary ? '' : ' is-empty'}`} title={duplicateLabel}>
          {duplicateLabel}
        </span>
      </button>
      <span className="bid-project-row-type">{typeLabels[project.projectType]}</span>
      <div className="bid-project-uniqueness-status">
        <span className={`bid-project-status is-${project.status}`}><i />{displayStatus}</span>
        {typeof uniquenessProgress === 'number' ? (
          <span className="bid-project-row-progress">
            <ProgressBar
              value={uniquenessProgress}
              active
              label={`同源正文查重进度 ${Math.round(uniquenessProgress)}%`}
            />
            <small>{Math.round(uniquenessProgress)}%</small>
          </span>
        ) : null}
      </div>
      <span className="bid-project-row-time">{updatedAt}</span>
      <div className="bid-project-row-actions">
        <div className="bid-project-row-actions-group is-primary">
          {canCreateVariant && onCreateVariant ? (
            <button type="button" className="text-button" onClick={() => onCreateVariant(project)} disabled={commandPending}>
              {commandPending ? '正在创建' : '再生成一份'}
            </button>
          ) : null}
          {canRetryUniqueness && onRetryUniqueness ? (
            <button type="button" className="text-button" onClick={() => onRetryUniqueness(project)} disabled={commandPending}>
              {commandPending ? '正在启动' : '重新查重'}
            </button>
          ) : null}
          {onCompare ? <button type="button" className={`text-button ${compareSelected ? 'is-selected' : ''}`} onClick={() => onCompare(project)} aria-pressed={compareSelected}>{compareSelected ? '已选查重' : '选择查重'}</button> : null}
        </div>
        <div className="bid-project-row-actions-group is-secondary">
          <button type="button" className="text-button" onClick={() => onRename(project)}>重命名</button>
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
            disabled={!canExport}
            title={canExport ? '选择导出模板并导出 Word' : exportDisabledReason}
          >
            导出
          </button>
          <button type="button" className="text-button danger-text" onClick={() => onDelete(project)}>删除</button>
        </div>
      </div>
    </article>
  );
}

export default BidProjectRow;
