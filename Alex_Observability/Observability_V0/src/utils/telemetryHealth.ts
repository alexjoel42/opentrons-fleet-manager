/**
 * Normalize health objects from relay-agent telemetry. Opentrons GET /health JSON
 * uses robot_serial, robot_model, etc.; older code paths used header-style serial_number.
 */
import { getRunDisplayName, type RunListItem, type RunsResponse } from '../api/robotApi';
import { formatNoteTimestamp } from './robotFormat';
import { deriveRobotFleetVisualStatus, type RobotFleetVisualStatus } from './robotFleetStatus';

export function telemetrySerial(health: Record<string, unknown> | null | undefined): string | null {
  if (!health) return null;
  const a = health.serial_number;
  const b = health.robot_serial;
  if (a != null && String(a).trim()) return String(a);
  if (b != null && String(b).trim()) return String(b);
  return null;
}

export function telemetryRobotName(health: Record<string, unknown> | null | undefined): string | null {
  if (!health) return null;
  const n = health.name;
  if (n != null && String(n).trim()) return String(n);
  return null;
}

export function telemetryStatus(health: Record<string, unknown> | null | undefined): string | null {
  if (!health) return null;
  const s = health.status;
  if (s != null && String(s).trim()) return String(s);
  return null;
}

/** Robot server software version from GET /health (`api_version`). */
export function telemetryApiVersion(health: Record<string, unknown> | null | undefined): string | null {
  if (!health) return null;
  const v = health.api_version;
  if (v != null && String(v).trim()) return String(v).trim();
  return null;
}

/** Coerce stored telemetry `runs` (dict or legacy list) into RunsResponse for fleet helpers. */
export function coerceRunsForFleetStatus(runs: unknown): RunsResponse | null {
  if (runs == null) return null;
  if (Array.isArray(runs)) {
    return { data: runs as RunListItem[] };
  }
  if (typeof runs === 'object' && Array.isArray((runs as { data?: unknown }).data)) {
    return runs as RunsResponse;
  }
  return null;
}

export function telemetryHealthLooksSparse(health: Record<string, unknown> | null | undefined): boolean {
  if (!health) return true;
  const keys = [
    telemetryStatus(health),
    telemetrySerial(health),
    telemetryRobotName(health),
    health.robot_model != null ? String(health.robot_model) : '',
    health.api_version != null ? String(health.api_version) : '',
  ];
  return keys.every((k) => !k);
}

/** Avoid "10.x.x.x · 10.x.x.x" when the DB name is the IP and serial is missing. */
export function cloudRobotCardTitle(input: {
  id: string;
  name: string | null;
  robot_serial: string | null;
  ip_last_seen: string | null;
  health: Record<string, unknown> | null;
}): string {
  const ip = input.ip_last_seen ?? '';
  const serial = input.robot_serial ?? telemetrySerial(input.health);
  const healthName = telemetryRobotName(input.health);
  const storeName = (input.name ?? '').trim();
  if (healthName && healthName !== ip) return healthName;
  if (storeName && storeName !== ip) return storeName;
  if (serial && serial !== ip) return serial;
  return ip || input.id;
}

export function cloudRobotCardSubtitle(
  title: string,
  input: {
    robot_serial: string | null;
    ip_last_seen: string | null;
    health: Record<string, unknown> | null;
  },
): string | null {
  const ip = input.ip_last_seen ?? '';
  const serial = input.robot_serial ?? telemetrySerial(input.health);
  const parts: string[] = [];
  if (ip && ip !== title) parts.push(ip);
  if (serial && serial !== title && !parts.includes(serial)) parts.push(serial);
  return parts.length ? parts.join(' · ') : null;
}

/** One line for cloud fleet cards from stored runs JSON. */
export function telemetryLatestRunSummary(runs: unknown): string | null {
  const r = coerceRunsForFleetStatus(runs);
  if (!r?.data?.length) return null;
  const cur = r.data.find((x) => x.current);
  const item = cur ?? r.data[0];
  if (!item) return null;
  const st = item.status ?? '—';
  const pid = item.protocolId != null ? String(item.protocolId) : null;
  if (pid) return `Run: ${pid} (${st})`;
  const id = item.id != null ? String(item.id) : '';
  if (id.length > 10) return `Run ${id.slice(0, 8)}… (${st})`;
  return id ? `Run ${id} (${st})` : `Latest run: ${st}`;
}

function isRunFailed(run: RunListItem): boolean {
  const st = (run.status ?? '').toLowerCase();
  if (st === 'failed') return true;
  if (Array.isArray(run.errors) && run.errors.length > 0) return true;
  return false;
}

function runRecencyMs(run: RunListItem): number {
  for (const key of ['completedAt', 'startedAt', 'createdAt'] as const) {
    const v = run[key];
    if (v != null && String(v).trim()) {
      const t = Date.parse(String(v));
      if (!Number.isNaN(t)) return t;
    }
  }
  return 0;
}

/**
 * Most recent failed run in telemetry (status `failed` or non-empty `errors`),
 * ordered by `completedAt` then `startedAt` then `createdAt`. For fleet cards.
 */
export function telemetryLastFailedRunLine(runs: unknown): string | null {
  const r = coerceRunsForFleetStatus(runs);
  if (!r?.data?.length) return null;
  const failed = r.data.filter(isRunFailed);
  if (failed.length === 0) return null;
  failed.sort((a, b) => {
    const dt = runRecencyMs(b) - runRecencyMs(a);
    if (dt !== 0) return dt;
    return String(b.id).localeCompare(String(a.id));
  });
  const last = failed[0];
  const name = getRunDisplayName(last);
  const tsRaw = last.completedAt ?? last.startedAt ?? last.createdAt;
  const ts = formatNoteTimestamp(tsRaw ?? null);
  if (ts) return `Last failed: ${name} · ${ts}`;
  return `Last failed: ${name}`;
}

/** Same fleet status as local dashboard cards, from cloud telemetry health + runs. */
export function cloudRobotFleetVisualStatus(robot: {
  health?: unknown;
  runs?: unknown;
}): RobotFleetVisualStatus {
  const health =
    robot.health && typeof robot.health === 'object'
      ? (robot.health as Record<string, unknown>)
      : null;
  const runsCoerced = coerceRunsForFleetStatus(robot.runs);
  return deriveRobotFleetVisualStatus({
    fleetError: null,
    healthLoading: false,
    healthError: false,
    healthData: health,
    runsData: runsCoerced ?? undefined,
  });
}
