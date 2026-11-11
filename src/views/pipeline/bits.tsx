import { ProgressCircle } from '@dynatrace/strato-components/content';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { ClockIcon, CriticalFailedIcon, SuccessIcon } from '@dynatrace/strato-icons';
import type { Pipeline, StageStatus } from '../../model/types';

export type AnyStatus = StageStatus | Pipeline['status'];

export function StatusIcon({ status }: { status: AnyStatus }) {
  switch (status) {
    case 'passed':
      return <SuccessIcon style={{ color: Colors.Icon.Success.Default, flex: 'none' }} aria-label="passed" />;
    case 'failed':
      return <CriticalFailedIcon style={{ color: Colors.Icon.Critical.Default, flex: 'none' }} aria-label="failed" />;
    case 'running':
      return <ProgressCircle size="small" aria-label="running" />;
    case 'skipped':
      return <ClockIcon style={{ color: Colors.Icon.Neutral.Disabled, flex: 'none', opacity: 0.5 }} aria-label="skipped" />;
    default:
      return <ClockIcon style={{ color: Colors.Icon.Neutral.Subdued, flex: 'none' }} aria-label="queued" />;
  }
}

export const statusColor = (s: AnyStatus) =>
  s === 'passed'
    ? Colors.Text.Success.Default
    : s === 'failed'
      ? Colors.Text.Critical.Default
      : s === 'running'
        ? Colors.Text.Primary.Default
        : Colors.Text.Neutral.Subdued;
