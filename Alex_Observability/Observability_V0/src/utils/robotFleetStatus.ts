import type { RunListItem, RunsResponse } from '../api/robotApi';

/** Normalized fleet card status for styling + filtering */
export type RobotFleetVisualStatus =
  | 'loading'
  | 'unreachable'
  | 'idle'
  | 'running'
  | 'paused'
  | 'failed'
  | 'awaiting-recovery'
  | 'succeeded'
  | 'stopped'
  | 'error';

export type FleetStatusFilter = 'all' | 'attention' | RobotFleetVisualStatus;

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
}

/** True if the API raw status string adds detail beyond the visual bucket label. */
export function rawRobotStatusDiffersFromLabel(
  raw: string,
  visual: RobotFleetVisualStatus
): boolean {
  const a = norm(raw);
  const b = norm(FLEET_STATUS_LABELS[visual]);
  return a !== b && a.length > 0;
}

function parseRunStatus(run: { status?: string } | undefined): string {
  return norm(run?.status ?? '');
}

/** Derive a single visual status from health, run, and connection state. */
export function deriveRobotFleetVisualStatus(input: {
  fleetError?: string | null;
  healthLoading: boolean;
  healthError: boolean;
  healthData?: Record<string, unknown> | null;
  runsData?: RunsResponse | null;
}): RobotFleetVisualStatus {
  const { fleetError, healthLoading, healthError, healthData, runsData } = input;

  if (fleetError) return 'unreachable';
  if (healthError) return 'unreachable';
  if (healthLoading && !healthData) return 'loading';

  const runsList = Array.isArray(runsData?.data) ? runsData.data : [];
  const currentRun = runsList.find((r) => r.current);
  const hasRunError =
    currentRun &&
    Array.isArray(currentRun.errors) &&
    currentRun.errors.length > 0;

  if (currentRun) {
    if (hasRunError) return 'failed';
    const rs = parseRunStatus(currentRun);
    if (rs.includes('awaiting') && rs.includes('recovery')) return 'awaiting-recovery';
    if (rs === 'awaiting-recovery') return 'awaiting-recovery';
    if (rs === 'running') return 'running';
    if (rs === 'paused') return 'paused';
    if (rs === 'failed') return 'failed';
    if (rs === 'succeeded' || rs === 'succeed') return 'succeeded';
    if (rs === 'stopped') return 'stopped';
  }

  const hs = norm(String(healthData?.status ?? ''));
  if (!hs || hs === 'ok') return 'idle';
  if (hs.includes('awaiting') && hs.includes('recovery')) return 'awaiting-recovery';
  if (hs === 'awaiting-recovery') return 'awaiting-recovery';
  if (hs === 'running') return 'running';
  if (hs === 'paused') return 'paused';
  if (hs === 'failed' || hs === 'error' || hs.includes('fail')) return 'error';
  if (hs === 'idle' || hs === 'ready' || hs === 'standby') return 'idle';
  if (hs === 'stopped') return 'stopped';
  if (hs === 'succeeded') return 'succeeded';

  return 'idle';
}

/** Visual status for a single run row (protocol list, detail pages). */
export function deriveRunListItemFleetStatus(run: RunListItem): RobotFleetVisualStatus {
  const hasRunError = Array.isArray(run.errors) && run.errors.length > 0;
  if (hasRunError) return 'failed';
  const rs = parseRunStatus(run);
  if (rs.includes('awaiting') && rs.includes('recovery')) return 'awaiting-recovery';
  if (rs === 'awaiting-recovery') return 'awaiting-recovery';
  if (rs === 'running') return 'running';
  if (rs === 'paused') return 'paused';
  if (rs === 'failed') return 'failed';
  if (rs === 'succeeded' || rs === 'succeed') return 'succeeded';
  if (rs === 'stopped') return 'stopped';
  return 'idle';
}

export const FLEET_STATUS_LABELS: Record<RobotFleetVisualStatus, string> = {
  loading: 'Loading',
  unreachable: 'Unreachable',
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  failed: 'Failed',
  'awaiting-recovery': 'Awaiting recovery',
  succeeded: 'Succeeded',
  stopped: 'Stopped',
  error: 'Robot error',
};

/** Rows under “Check first” in the status summary table. */
export const FLEET_ATTENTION_TABLE_ORDER: RobotFleetVisualStatus[] = [
  'failed',
  'error',
  'unreachable',
  'awaiting-recovery',
  'paused',
];

/** True if this normalized status counts as “need attention” (failures, errors, unreachable, recovery, paused). */
export function isRobotFleetAttentionStatus(s: RobotFleetVisualStatus): boolean {
  return FLEET_ATTENTION_TABLE_ORDER.includes(s);
}

/** Header legend + summary table: errors and pauses first, then normal operation. */
export const FLEET_SUMMARY_TABLE_ORDER: RobotFleetVisualStatus[] = [
  ...FLEET_ATTENTION_TABLE_ORDER,
  'running',
  'succeeded',
  'idle',
  'stopped',
  'loading',
];

/**
 * Compact strip in the app header — matches card colors; includes connectivity errors.
 */
export const FLEET_HEADER_LEGEND_ORDER: RobotFleetVisualStatus[] = [
  'failed',
  'error',
  'unreachable',
  'awaiting-recovery',
  'paused',
  'running',
  'succeeded',
];

/** Counts that need operator attention (errors, connectivity, recovery, paused runs). */
export function fleetAttentionCount(
  counts: Partial<Record<RobotFleetVisualStatus, number>>
): number {
  return FLEET_ATTENTION_TABLE_ORDER.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
}

/** Ordered filters for the fleet toolbar (exclude loading from filter list — use "all"). */
export const FLEET_FILTER_OPTIONS: Array<{ value: FleetStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Need attention' },
  { value: 'loading', label: 'Loading' },
  { value: 'idle', label: 'Idle' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'awaiting-recovery', label: 'Awaiting recovery' },
  { value: 'failed', label: 'Failed' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'error', label: 'Robot error' },
  { value: 'unreachable', label: 'Unreachable' },
];
