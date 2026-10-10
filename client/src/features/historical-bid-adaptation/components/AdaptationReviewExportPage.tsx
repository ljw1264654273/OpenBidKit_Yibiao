import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { OutlineItem } from '../../../shared/types';
import { AppDialog, useToast } from '../../../shared/ui';
import type { BidProject } from '../../bid-project/types';
import WordExportDialog from '../../export-format/components/WordExportDialog';
import type { HistoricalAdaptationReviewFinding, TechnicalPlanState } from '../../technical-plan/types';

interface AdaptationReviewExportPageProps {
  projectId: string;
  project: BidProject | null;
  state: TechnicalPlanState;
  onStateChange: Dispatch<SetStateAction<TechnicalPlanState | null>>;
  onBack: () => void;
}

type FindingFilter = 'all' | 'P0' | 'P1' | 'P2';

const severityOrder: Record<HistoricalAdaptationReviewFinding['severity'], number> = { P0: 0, P1: 1, P2: 2 };

function AdaptationReviewExportPage({ projectId, project, state, onStateChange, onBack }: AdaptationReviewPageProps) {
  const [filter, setFilter] = useState<FindingFilter>('all');
  const [selectedId, setSelectedId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pendingExportWarning, setPendingExportWarning] = useState(false);
  const [pendingAcceptance, setPendingAcceptance] = useState(false);
  const { showToast } = useToast();
  const findings = state.historicalAdaptationReviewFindings || [];
  const sortedFindings = useMemo(() => [...findings].sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || left.chapter_path.localeCompare(right.chapter_path, 'zh-CN')), [findings]);
  const visibleFindings = sortedFindings.filter((finding) => filter === 'all' || finding.severity === filter);
  const selected = findings.find((finding) => finding.id === selectedId) || visibleFindings[0];
  const counts = {
    P0: findings.filter((finding) => finding.severity === 'P0').length,
    P1: findings.filter((finding) => finding.severity === 'P1').length,
    P2: findings.filter((finding) => finding.severity === 'P2').length,
  };
  const openP0 = findings.filter((finding) => finding.severity === 'P0' && finding.resolution !== 'resolved').length;
  const reviewConfirmed = Boolean(state.historicalAdaptationReviewConfirmedAt);
  const placeholderFindings = findings.filter((finding) => finding.code === 'placeholder' || /【(?:待核实|待补充)】/u.test(finding.evidence));
  const contentCheck = state.historicalAdaptationContentCheck;
  const contentCheckBlocking = contentCheck.findings.filter((finding) => finding.blocking).length;
  const contentCheckRunning = ['queued', 'running', 'pausing', 'paused'].includes(state.historicalAdaptationContentCheckTask?.status || '');

  const runContentCheck = async () => {
    try {
      await window.yibiao!.tasks.startHistoricalAdaptationContentCheck({ projectId });
      showToast('一致性检查已在后台启动', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '启动一致性检查失败', 'error');
    }
  };

  const requestExport = () => {
    const risk = contentCheck.status !== 'success' || contentCheckBlocking > 0 || contentCheck.findings.length > 0;
    if (risk) {
      setPendingExportWarning(true);
      return;
    }
    setExportOpen(true);
  };

  const acceptFinding = async (resolution: 'resolved' | 'ignored') => {
    if (!selected || !resolutionNote.trim()) {
      showToast('请填写问题处置说明', 'info');
      return;
    }
    if (selected.severity === 'P0' && resolution !== 'resolved') {
      showToast('P0 阻断问题必须整改后才能关闭', 'info');
      return;
    }
    setSaving(true);
    try {
      const next = await window.yibiao!.technicalPlan.setHistoricalAdaptationReviewFinding({
        projectId,
        findingId: selected.id,
        resolution,
        resolutionNote,
      });
      onStateChange(next);
      setResolutionNote('');
      showToast('问题处置已保存', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存问题处置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runReview = async () => {
    setSaving(true);
    try {
      const next = await window.yibiao!.technicalPlan.runHistoricalAdaptationReview({ projectId });
      onStateChange(next);
      setSelectedId('');
      setResolutionNote('');
      showToast('终审完成，请逐项查看检查结果', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '运行终审失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmReview = async () => {
    setSaving(true);
    try {
      const next = await window.yibiao!.technicalPlan.confirmHistoricalAdaptationReview({ projectId });
      onStateChange(next);
      setPendingAcceptance(false);
      showToast('终审验收已确认，可以导出 Word', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '确认终审失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="historical-adaptation-review-page">
      <header className="historical-adaptation-review-head">
        <div>
          <span className="section-kicker">环节六 · 审核导出</span>
          <h1>{project?.projectName || '历史标书适配项目'}</h1>
          <p>检查历史残留、正文完整性和差异覆盖；检查结果供人工验收参考，不替代招标响应判断。</p>
        </div>
        <div className="historical-adaptation-review-actions">
          <button type="button" className="secondary-action" onClick={onBack}>返回我的标书</button>
          <button type="button" className="primary-action" disabled={saving} onClick={() => { void runReview(); }}>
            {findings.length ? '重新终审' : '运行终审'}
          </button>
        </div>
      </header>

      <section className="historical-adaptation-review-summary" aria-label="终审问题统计">
        <div className="review-summary-conclusion">
          <span>终审状态</span>
          <strong>{!findings.length ? '尚未运行' : openP0 ? `${openP0} 项阻断待整改` : '阻断项已清零'}</strong>
          <small>{state.historicalAdaptationReviewConfirmedAt ? `人工验收 · ${new Date(state.historicalAdaptationReviewConfirmedAt).toLocaleString('zh-CN')}` : '检查完成后需人工验收'}</small>
        </div>
        {(['P0', 'P1', 'P2'] as const).map((severity) => (
          <button type="button" key={severity} className={`review-summary-count is-${severity.toLowerCase()}${filter === severity ? ' is-active' : ''}`} onClick={() => setFilter(filter === severity ? 'all' : severity)}>
            <span>{severity}</span><strong>{counts[severity]}</strong><small>{severity === 'P0' ? '阻断' : severity === 'P1' ? '重要' : '提示'}</small>
          </button>
        ))}
      </section>

      <section className={`historical-adaptation-review-check-summary${contentCheck.status === 'success' && contentCheckBlocking === 0 ? ' is-complete' : ''}`}>
        <div>
          <span className="section-kicker">正文一致性检查（可选）</span>
          <strong>{contentCheck.status === 'success' ? contentCheckBlocking ? `${contentCheckBlocking} 项问题` : '检查通过' : contentCheck.status === 'stale' ? '检查结果已失效' : contentCheck.status === 'error' ? '检查失败' : '尚未运行检查'}</strong>
          <p>{contentCheck.checked_at ? `检查时间：${new Date(contentCheck.checked_at).toLocaleString('zh-CN')}` : '检查结果仅供人工参考，不影响终审或导出。'}</p>
        </div>
        <div className="historical-adaptation-review-check-actions">
          <span>{contentCheck.findings.length} 项检查结果</span>
          <button type="button" className="secondary-action" disabled={saving || contentCheckRunning} onClick={() => { void runContentCheck(); }}>{contentCheckRunning ? '检查中...' : contentCheck.status === 'success' ? '重新运行检查' : '运行一致性检查'}</button>
        </div>
      </section>

      {contentCheck.findings.length ? <section className="historical-adaptation-review-content-findings" aria-label="正文一致性检查结果">
        {contentCheck.findings.map((finding) => <article key={finding.id}>
          <span>{finding.severity}{finding.blocking ? ' · 问题' : ' · 提示'}</span>
          <strong>{finding.message}</strong>
          {finding.evidence ? <p>{finding.evidence}</p> : null}
        </article>)}
      </section> : null}

      <section className="historical-adaptation-review-workbench">
        <aside className="adaptation-review-list-column">
          <header>
            <strong>问题清单</strong>
            <select aria-label="问题级别筛选" value={filter} onChange={(event) => setFilter(event.target.value as FindingFilter)}>
              <option value="all">全部级别</option><option value="P0">P0 阻断</option><option value="P1">P1 重要</option><option value="P2">P2 提示</option>
            </select>
          </header>
          <div className="adaptation-review-list">
            {visibleFindings.map((finding) => (
              <button
                type="button"
                key={finding.id}
                className={`adaptation-review-finding is-${finding.severity.toLowerCase()}${finding.id === selected?.id ? ' is-selected' : ''}`}
                onClick={() => { setSelectedId(finding.id); setResolutionNote(finding.resolution_note || ''); }}
              >
                <span>{finding.severity}</span>
                <div><strong>{finding.title}</strong><small>{finding.chapter_path}</small></div>
                <em>{finding.resolution === 'resolved' ? '已整改' : finding.resolution === 'ignored' ? '已说明' : '待处理'}</em>
              </button>
            ))}
            {!visibleFindings.length ? <div className="adaptation-review-empty">{findings.length ? '当前筛选没有问题' : '运行终审后显示检查结果'}</div> : null}
          </div>
        </aside>

        <section className="adaptation-review-detail-column" aria-label="问题证据与处置">
          {selected ? (
            <>
              <header className={`is-${selected.severity.toLowerCase()}`}>
                <div><span>{selected.severity} · {selected.code}</span><h2>{selected.title}</h2></div>
                <span>{selected.resolution === 'resolved' ? '已整改' : selected.resolution === 'ignored' ? '已人工确认' : '待处理'}</span>
              </header>
              <div className="adaptation-review-detail">
                <dl>
                  <div><dt>定位章节</dt><dd>{selected.chapter_path}</dd></div>
                  <div><dt>检查说明</dt><dd>{selected.message}</dd></div>
                  <div><dt>命中证据</dt><dd><pre>{selected.evidence || '未提取到文本证据'}</pre></dd></div>
                </dl>
                {selected.resolution_note ? <p className="adaptation-review-resolution-note">上次处置：{selected.resolution_note}</p> : null}
                <label htmlFor="adaptation-review-note">处置说明</label>
                <textarea id="adaptation-review-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="说明整改内容或人工确认依据" rows={4} />
              </div>
              <footer>
                {selected.node_id ? <span>定位：{selected.node_id}</span> : null}
                <button type="button" className="secondary-action" disabled={saving || !resolutionNote.trim()} onClick={() => { void acceptFinding('ignored'); }}>人工确认</button>
                <button type="button" className="primary-action" disabled={saving || !resolutionNote.trim()} onClick={() => { void acceptFinding('resolved'); }}>标记已整改</button>
              </footer>
            </>
          ) : (
            <div className="adaptation-review-detail-empty"><strong>当前没有待查看问题</strong><span>终审通过后可确认验收并导出 Word。</span></div>
          )}
        </section>
      </section>

      <section className={`historical-adaptation-review-acceptance${reviewConfirmed ? ' is-complete' : ''}`}>
        <div><strong>{reviewConfirmed ? '终审验收已确认' : openP0 ? 'P0 阻断问题未清零' : findings.length ? '请完成人工终审验收' : '运行终审后进入验收'}</strong>
          <span>{reviewConfirmed ? placeholderFindings.length ? '已确认。仍有待核实/待补充内容，请在导出的 Word 中人工处理。' : '内容变更会使本次验收失效。' : openP0 ? `还有 ${openP0} 项 P0 未标记为已整改。` : placeholderFindings.length ? `检测到 ${placeholderFindings.length} 项待核实/待补充内容，允许导出 Word，导出后请人工处理。` : '自动检查仅提供风险线索，需由投标负责人完成人工验收。'}</span></div>
        <div>
          <button type="button" className="secondary-action" disabled={!findings.length || openP0 > 0 || saving || reviewConfirmed} onClick={() => setPendingAcceptance(true)}>确认终审</button>
          <button type="button" className="primary-action" disabled={openP0 > 0} onClick={requestExport}>导出 Word</button>
        </div>
      </section>

      <AppDialog
        open={pendingAcceptance}
        onOpenChange={(open) => !open && setPendingAcceptance(false)}
        kicker="人工验收"
        title="确认已完成终审？"
        description={placeholderFindings.length ? '自动审核只检查可确定的规则项。当前存在待核实/待补充内容，确认后允许导出 Word，请在导出文件中人工处理；任何正文、目录或差异变更都会使验收失效。' : '自动审核只检查可确定的规则项。确认后将允许导出当前适配技术方案；任何正文、目录或差异变更都会使验收失效。'}
        actions={(
          <>
            <button type="button" className="secondary-action" onClick={() => setPendingAcceptance(false)}>继续检查</button>
            <button type="button" className="primary-action" disabled={saving || openP0 > 0} onClick={() => { void confirmReview(); }}>确认验收</button>
          </>
        )}
      />
      <AppDialog
        open={pendingExportWarning}
        onOpenChange={(open) => !open && setPendingExportWarning(false)}
        kicker="导出提示"
        title="当前正文一致性检查未完成"
        description={contentCheck.status === 'success' && contentCheckBlocking ? `检查发现 ${contentCheckBlocking} 项问题。导出不会被阻止，请确认已了解风险并继续。` : '当前未运行最新一致性检查或检查结果已过期。导出不会被阻止，请确认已了解风险并继续。'}
        actions={<>
          <button type="button" className="secondary-action" onClick={() => setPendingExportWarning(false)}>返回检查</button>
          <button type="button" className="primary-action" onClick={() => { setPendingExportWarning(false); setExportOpen(true); }}>确认并导出</button>
        </>}
      />
      <WordExportDialog
        open={exportOpen}
        outline={state.outlineData?.outline}
        onOpenChange={setExportOpen}
        onExport={async ({ requestId, exportFormat }) => {
          await window.yibiao!.technicalPlan.assertHistoricalAdaptationExportAllowed({ projectId });
          return window.yibiao!.export.exportWord({
            requestId,
            project_name: project?.projectName || state.outlineData?.project_name,
            project_id: projectId,
            outline: (state.outlineData?.outline || []) as OutlineItem[],
            export_format: exportFormat,
            historical_adaptation: true,
            workflow_analytics: {
              projectId,
              projectName: project?.projectName || state.outlineData?.project_name,
              workflowKind: 'historical-bid-adaptation',
            },
          });
        }}
      />
    </div>
  );
}

type AdaptationReviewPageProps = AdaptationReviewExportPageProps;

export default AdaptationReviewExportPage;
