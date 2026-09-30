import type { TaskEvent } from '../../shared/types/ipc';
import type { TechnicalPlanCheckState } from './types';

export const initialTechnicalPlanCheckState: TechnicalPlanCheckState = {
  tenderFile: null,
  requirementsFile: null,
  scoringFile: null,
  proposalFile: null,
  outputPath: '',
  reportPath: '',
  summary: null,
};

type CheckStateEvent = Pick<Partial<TaskEvent>, 'task' | 'technicalPlanCheck' | 'technicalPlanCheckPatch'>;

export function mergeTechnicalPlanCheckState(state: TechnicalPlanCheckState, event: CheckStateEvent): TechnicalPlanCheckState {
  if (!event.technicalPlanCheck && !event.technicalPlanCheckPatch && event.task?.type !== 'technical-plan-check') return state;
  const next = { ...(event.technicalPlanCheck || state) };
  if (event.task?.type === 'technical-plan-check') next.checkTask = event.task;
  const patch = event.technicalPlanCheckPatch;
  if (patch) {
    for (const key of Object.keys(initialTechnicalPlanCheckState).concat('checkTask') as (keyof TechnicalPlanCheckState)[]) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) Object.assign(next, { [key]: patch[key] });
    }
  }
  return next;
}

export function getTechnicalPlanCheckActions(state: TechnicalPlanCheckState) {
  const running = ['running', 'queued', 'pausing'].includes(state.checkTask?.status || '');
  const busyReason = running ? '检查任务进行中，请等待当前任务结束' : '';
  const missingInputs = !state.tenderFile || !state.requirementsFile || !state.scoringFile || !state.proposalFile;
  const startDisabledReason = busyReason || (missingInputs ? '请先选择全部四份输入文件' : !state.outputPath ? '请先选择检查记录输出位置' : '');
  const openReportDisabledReason = busyReason || (state.checkTask?.status !== 'success' || !state.reportPath ? '检查成功后可打开检查记录' : '');
  return {
    inputsDisabled: running,
    outputDisabled: running,
    inputDisabledReason: busyReason,
    startDisabled: Boolean(startDisabledReason),
    startDisabledReason,
    openReportDisabled: Boolean(openReportDisabledReason),
    openReportDisabledReason,
  };
}
