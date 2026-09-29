import type { OutlineMinimumDepth } from '../../../shared/types';
import type { BackgroundTaskStatus } from '../types';

const lockedTaskStatuses = new Set<BackgroundTaskStatus>(['running', 'pausing', 'paused']);

export function normalizeOutlineMinimumDepth(value: unknown): OutlineMinimumDepth {
  return value === 3 || value === 4 || value === 5 ? value : 0;
}

export function formatOutlineMinimumDepth(value: unknown) {
  const normalized = normalizeOutlineMinimumDepth(value);
  if (normalized === 3) return '三级';
  if (normalized === 4) return '四级';
  if (normalized === 5) return '五级';
  return '默认';
}

export function isOutlineConfigLocked(statuses: {
  outline?: BackgroundTaskStatus;
  adjustment?: BackgroundTaskStatus;
  content?: BackgroundTaskStatus;
}) {
  return [statuses.outline, statuses.adjustment, statuses.content]
    .some((status) => status && lockedTaskStatuses.has(status));
}
