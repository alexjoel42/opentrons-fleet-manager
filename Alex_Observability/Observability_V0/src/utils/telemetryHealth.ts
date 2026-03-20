/**
 * Normalize health objects from relay-agent telemetry. Opentrons GET /health JSON
 * uses robot_serial, robot_model, etc.; older code paths used header-style serial_number.
 */
import type { RunListItem, RunsResponse } from '../api/robotApi';

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
