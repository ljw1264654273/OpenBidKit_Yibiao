import * as Popover from '@radix-ui/react-popover';
import type { ReactNode } from 'react';
import { ProgressBar, type ProgressBarTone } from '../../../shared/ui';

interface CompactTaskProgressProps {
  value: number;
  label: string;
  summary: string;
  status: string;
  tone?: ProgressBarTone;
  active?: boolean;
  error?: boolean;
  children: ReactNode;
}

function CompactTaskProgress({
  value,
  label,
  summary,
  status,
  tone = 'primary',
  active = false,
  error = false,
  children,
}: CompactTaskProgressProps) {
  return (
    <div className={`compact-task-progress${error ? ' is-error' : ''}`}>
      <ProgressBar value={value} label={label} tone={tone} active={active} />
      <strong>{summary}</strong>
      <span>{status}</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="compact-task-progress-trigger" aria-label="查看过程">过程</button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="compact-task-progress-popover" align="end" sideOffset={8} collisionPadding={12}>
            <div className="compact-task-progress-popover-head">
              <strong>{status}</strong>
              <span>{summary}</span>
            </div>
            <div className="compact-task-progress-details">{children}</div>
            <Popover.Arrow className="compact-task-progress-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export default CompactTaskProgress;
