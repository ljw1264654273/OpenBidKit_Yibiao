import type { TaskEvent, TaskEventTask } from '../../shared/types/ipc';
import type { TechnicalPlanCheckState } from './types';
import { initialTechnicalPlanCheckState, mergeTechnicalPlanCheckState } from './state';

interface TechnicalPlanCheckPageBridge {
  technicalPlanCheck: { loadState: () => Promise<TechnicalPlanCheckState> };
  tasks: {
    onTaskEvent: (callback: (event: TaskEvent) => void) => () => void;
    getActiveTasks: () => Promise<TaskEventTask[]>;
  };
}

export function initializeTechnicalPlanCheckPage(
  bridge: TechnicalPlanCheckPageBridge,
  onState: (state: TechnicalPlanCheckState) => void,
  onError: (error: unknown) => void,
) {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  let state = initialTechnicalPlanCheckState;
  let eventRevision = 0;
  let selectionRevision = 0;
  let refreshEvents: TaskEvent[] | undefined;
  const publishState = (next: TechnicalPlanCheckState) => {
    if (disposed) return;
    state = next;
    onState(state);
  };
  const updateState = (next: TechnicalPlanCheckState) => {
    selectionRevision += 1;
    publishState(next);
  };
  const applyEvent = (event: TaskEvent) => {
    if (disposed) return;
    const next = mergeTechnicalPlanCheckState(state, event);
    if (next !== state) {
      eventRevision += 1;
      refreshEvents?.push(event);
      publishState(next);
    }
  };
  const ready = (async () => {
    try {
      const snapshot = await bridge.technicalPlanCheck.loadState();
      if (disposed) return;
      publishState(snapshot);
      unsubscribe = bridge.tasks.onTaskEvent(applyEvent);
      const replayRevision = eventRevision;
      const tasks = await bridge.tasks.getActiveTasks();
      if (disposed) return;
      if (eventRevision === replayRevision) {
        for (const task of tasks) applyEvent({ task });
      }
      // 活动任务不包含刚完成的任务；订阅后再读快照，补齐首次读取的事件窗口。
      refreshEvents = [];
      const refreshSelectionRevision = selectionRevision;
      const refreshed = await bridge.technicalPlanCheck.loadState();
      if (disposed) return;
      if (selectionRevision === refreshSelectionRevision) {
        publishState(refreshEvents.reduce(mergeTechnicalPlanCheckState, refreshed));
      }
    } catch (error) {
      if (!disposed) onError(error);
    } finally {
      refreshEvents = undefined;
    }
  })();
  return {
    ready,
    updateState,
    applyEvent,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
    },
  };
}
