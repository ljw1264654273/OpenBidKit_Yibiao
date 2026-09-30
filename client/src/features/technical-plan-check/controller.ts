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
  const updateState = (next: TechnicalPlanCheckState) => {
    if (disposed) return;
    state = next;
    onState(state);
  };
  const applyEvent = (event: TaskEvent) => {
    if (disposed) return;
    const next = mergeTechnicalPlanCheckState(state, event);
    if (next !== state) updateState(next);
  };
  const ready = (async () => {
    try {
      const snapshot = await bridge.technicalPlanCheck.loadState();
      if (disposed) return;
      updateState(snapshot);
      unsubscribe = bridge.tasks.onTaskEvent(applyEvent);
      const tasks = await bridge.tasks.getActiveTasks();
      if (disposed) return;
      for (const task of tasks) applyEvent({ task });
    } catch (error) {
      if (!disposed) onError(error);
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
