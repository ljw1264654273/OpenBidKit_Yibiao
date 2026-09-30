import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FloatingToolbar, isLibreOfficeRequiredMessage, ProgressBar, ToolbarArrowRightIcon, ToolbarDocumentIcon,
  UploadBoard, UploadEmpty, UploadFilePill, UploadRow, useDocumentParseNotice, useToast,
} from '../../../shared/ui';
import { initializeTechnicalPlanCheckPage } from '../controller';
import { getTechnicalPlanCheckActions, initialTechnicalPlanCheckState } from '../state';
import type { TechnicalPlanCheckFileRole } from '../types';

const inputRows = [
  { role: 'tender', key: 'tenderFile', title: '招标文件' },
  { role: 'requirements', key: 'requirementsFile', title: '采购需求文件' },
  { role: 'scoring', key: 'scoringFile', title: '主观分评分标准' },
  { role: 'proposal', key: 'proposalFile', title: '投标技术方案' },
] as const;

const statusLabels: Record<string, string> = {
  running: '正在检查', queued: '等待检查', pausing: '正在暂停', paused: '已暂停',
  success: '检查完成', error: '检查失败', canceled: '检查已取消',
};

function TechnicalPlanCheckPage() {
  const [state, setState] = useState(initialTechnicalPlanCheckState);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const [actionError, setActionError] = useState('');
  const sessionRef = useRef<ReturnType<typeof initializeTechnicalPlanCheckPage> | null>(null);
  const lastNoticeRef = useRef('');
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const showError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setActionError(message);
    if (isLibreOfficeRequiredMessage(message)) showDocumentParseNotice(message);
    showToast(message, 'error');
  }, [showDocumentParseNotice, showToast]);

  useEffect(() => {
    const session = initializeTechnicalPlanCheckPage(window.yibiao, setState, showError);
    sessionRef.current = session;
    void session.ready.finally(() => {
      if (sessionRef.current === session) setLoading(false);
    });
    return () => {
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [showError]);

  const task = state.checkTask;
  useEffect(() => {
    if (!task || !['success', 'error'].includes(task.status)) return;
    const key = `${task.task_id}:${task.status}`;
    if (lastNoticeRef.current === key) return;
    lastNoticeRef.current = key;
    if (task.status === 'success') showToast('检查完成，检查记录已生成', 'success');
    else showError(task.error || '检查失败，请查看阶段日志后重新检查');
  }, [task, showError, showToast]);

  const runAction = async (label: string, action: (session: NonNullable<typeof sessionRef.current>) => Promise<void>) => {
    const session = sessionRef.current;
    if (!session || pendingAction) return;
    setPendingAction(label);
    setActionError('');
    try {
      await action(session);
    } catch (error) {
      if (sessionRef.current === session) showError(error);
    } finally {
      if (sessionRef.current === session) setPendingAction('');
    }
  };

  const selectInput = (role: TechnicalPlanCheckFileRole) => runAction('选择文件', async (session) => {
    const next = await window.yibiao.technicalPlanCheck.selectInput(role);
    session.updateState(next);
  });
  const selectOutput = () => runAction('选择输出位置', async (session) => {
    const next = await window.yibiao.technicalPlanCheck.selectOutput();
    session.updateState(next);
  });
  const startCheck = () => runAction('启动检查', async (session) => {
    const nextTask = await window.yibiao.tasks.startTechnicalPlanCheck();
    session.applyEvent({ task: nextTask });
  });
  const openReport = () => runAction('打开检查记录', async (session) => {
    const result = await window.yibiao.technicalPlanCheck.openReport();
    if (sessionRef.current !== session) return;
    if (!result.success) throw new Error(result.message || '无法打开检查记录，请确认报告文件仍在原位置');
  });

  const actions = getTechnicalPlanCheckActions(state);
  const pendingReason = loading ? '正在读取检查状态' : pendingAction ? `正在${pendingAction}` : '';
  const inputDisabledReason = pendingReason || actions.inputDisabledReason;
  const startDisabledReason = pendingReason || actions.startDisabledReason;
  const openReportDisabledReason = pendingReason || actions.openReportDisabledReason;
  const progress = Math.max(0, Math.min(100, task?.progress || 0));
  const errorMessage = actionError || (task?.status === 'error' ? task.error : '');

  return (
    <div className="technical-plan-check-page" aria-busy={loading}>
      <header className="technical-plan-check-heading">
        <h1>投标技术方案检查工具</h1>
        <p>依据招标文件、采购需求与主观分评分标准，全面检查投标技术方案的响应性与内部质量</p>
      </header>
      <UploadBoard title="输入文件" className="technical-plan-check-inputs">
        {inputRows.map(({ role, key, title }, index) => {
          const file = state[key];
          return (
            <UploadRow key={role} index={String(index + 1).padStart(2, '0')} title={title} actions={
              <span title={inputDisabledReason || `选择${title}`}>
                <button type="button" className="secondary-action" aria-label={`浏览${title}`} disabled={Boolean(inputDisabledReason)} onClick={() => void selectInput(role)}>浏览</button>
              </span>
            }>
              {file ? <UploadFilePill badge={file.name.split('.').pop()?.toUpperCase() || '文件'} name={file.name} /> : <UploadEmpty title="未选择" />}
            </UploadRow>
          );
        })}
        <UploadRow index="" title="输出文件" className="technical-plan-check-output" actions={
          <span title={inputDisabledReason || '选择检查记录保存位置'}>
            <button type="button" className="secondary-action" aria-label="另存为检查记录" disabled={Boolean(pendingReason) || actions.outputDisabled} onClick={() => void selectOutput()}>另存为</button>
          </span>
        }>
          <p className={`technical-plan-check-output-path${state.outputPath ? '' : ' is-empty'}`} title={state.outputPath || undefined}>
            {state.outputPath || '选择投标技术方案后自动生成'}
          </p>
        </UploadRow>
      </UploadBoard>
      <div className="technical-plan-check-actions">
        <FloatingToolbar label="技术方案检查操作" groups={[{ id: 'check', actions: [
          { id: 'start', label: pendingAction === '启动检查' ? '正在启动' : '开始检查', icon: <ToolbarArrowRightIcon />, variant: 'primary', disabled: Boolean(startDisabledReason), tooltip: startDisabledReason || '开始检查', onClick: () => void startCheck() },
          { id: 'open-report', label: '打开检查记录', icon: <ToolbarDocumentIcon />, disabled: Boolean(openReportDisabledReason), tooltip: openReportDisabledReason || '打开检查记录', onClick: () => void openReport() },
        ] }]} />
        {startDisabledReason ? <p className="technical-plan-check-action-reason" role="status">{startDisabledReason}</p> : null}
      </div>
      <section className="technical-plan-check-progress" aria-labelledby="technical-plan-check-progress-title">
        <div className="technical-plan-check-progress-heading">
          <h2 id="technical-plan-check-progress-title">检查进度</h2>
          <span>{loading ? '正在读取' : task ? statusLabels[task.status] || '等待检查' : '尚未开始'} · {progress}%</span>
        </div>
        <div role="progressbar" aria-label="技术方案检查进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <ProgressBar value={progress} label={`检查进度 ${progress}%`} active={false} />
        </div>
        {errorMessage ? <p className="technical-plan-check-error" role="alert">{errorMessage}</p> : null}
        <div className="technical-plan-check-log" role="log" aria-label="检查阶段日志" tabIndex={0}>
          {task?.logs.length ? task.logs.map((line, index) => <p key={index}>{line}</p>) : <p className="technical-plan-check-log-empty">暂无检查记录</p>}
        </div>
      </section>
    </div>
  );
}

export default TechnicalPlanCheckPage;
