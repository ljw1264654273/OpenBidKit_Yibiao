import type { OutlineItem } from '../../shared/types';
import type { BackgroundTaskState, HistoricalAdaptationContentItem, TechnicalPlanState } from '../technical-plan/types';

interface ContentPatchEvent {
  task?: { task_id: string; status: string };
  technicalPlan?: TechnicalPlanState;
  technicalPlanPatch?: Partial<TechnicalPlanState>;
  contentItemPatch?: Partial<HistoricalAdaptationContentItem>;
  outlineContentPatch?: { nodeId: string; content?: string };
}

const owns = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

function updateOutlineContent(items: OutlineItem[], patch: { nodeId: string; content?: string }): OutlineItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.id === patch.nodeId) {
      changed = true;
      return { ...item, content: patch.content };
    }
    if (!item.children?.length) return item;
    const children = updateOutlineContent(item.children, patch);
    if (children === item.children) return item;
    changed = true;
    return { ...item, children };
  });
  return changed ? next : items;
}

export function applyHistoricalAdaptationContentPatch(previous: TechnicalPlanState, event: ContentPatchEvent): TechnicalPlanState {
  const snapshot = owns(event, 'technicalPlanPatch') ? event.technicalPlanPatch : event.technicalPlan;
  const next = { ...previous, ...snapshot };
  // Patch values (including undefined and empty collections) replace only present fields.
  if (owns(event, 'contentItemPatch') && event.contentItemPatch) {
    const patch = event.contentItemPatch;
    const items = next.historicalAdaptationContentItems;
    const index = items.findIndex((item) => item.node_id === patch.node_id);
    next.historicalAdaptationContentItems = index < 0
      ? [...items, patch as HistoricalAdaptationContentItem]
      : items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
  }
  if (owns(event, 'outlineContentPatch') && event.outlineContentPatch && owns(event.outlineContentPatch, 'content') && next.outlineData) {
    const outline = updateOutlineContent(next.outlineData.outline, event.outlineContentPatch);
    if (outline !== next.outlineData.outline) next.outlineData = { ...next.outlineData, outline };
  }
  return next;
}

export function replayHistoricalAdaptationContentEvents(snapshot: TechnicalPlanState, events: ContentPatchEvent[]): TechnicalPlanState {
  return events.reduce((previous, event) => ({
    ...applyHistoricalAdaptationContentPatch(previous, event),
    ...(event.task ? { historicalAdaptationContentTask: event.task as BackgroundTaskState } : {}),
  }), snapshot);
}
