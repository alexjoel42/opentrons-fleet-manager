/**
 * API client for robot proxy endpoints. All requests go to the FastAPI backend;
 * the browser never talks to robot IPs directly (avoids CORS).
 */
const BASE = (import.meta.env.VITE_API_URL as string) ?? '';

export interface RobotErrorBody {
  error: string;
  code: string;
}

export async function fetchRobotList(): Promise<{ ips: string[] }> {
  const res = await fetch(`${BASE}/api/robots`);
  if (!res.ok) throw new Error('Failed to load robot list');
  return res.json();
}

export async function addRobotIp(ip: string): Promise<{ ips: string[] }> {
  const res = await fetch(`${BASE}/api/robots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip: ip.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as { ips: string[] };
}

export async function importRobotIpsBulk(
  ips: string[]
): Promise<{ ips: string[]; added: number }> {
  const res = await fetch(`${BASE}/api/robots/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ips }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as { ips: string[]; added: number };
}

export async function removeRobotIp(ip: string): Promise<{ ips: string[] }> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as { ips: string[] };
}

function getErrorFromResponse(data: unknown, fallback: string): string {
  const d = data as { detail?: RobotErrorBody | string; error?: string };
  if (d?.detail && typeof d.detail === 'object' && 'error' in d.detail) return (d.detail as RobotErrorBody).error;
  if (typeof d?.detail === 'string') return d.detail;
  if (d?.error) return d.error;
  return fallback;
}

export async function fetchRobotHealth(ip: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}/health`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as Record<string, unknown>;
}

export async function fetchRobotModules(ip: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}/modules`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return Array.isArray(data) ? data : [];
}

export async function fetchRobotPipettes(ip: string): Promise<unknown> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}/pipettes`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data;
}

export async function fetchRobotLogs(ip: string): Promise<{ logs: string | null }> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}/logs`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as { logs: string | null };
}

export async function fetchRobotSerialNumber(ip: string): Promise<{ serial_number: string | null }> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}/serial_number`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as { serial_number: string | null };
}

/** Run list response from Opentrons API (GET /runs) */
export interface RunsResponse {
  data: RunListItem[];
  links?: { current?: { href: string; meta?: Record<string, unknown> } };
  meta?: { cursor?: number; totalLength?: number };
}

/** One robot row from GET /api/fleet/snapshot */
export interface FleetRobotSnapshotRow {
  health: Record<string, unknown> | null;
  modules: Array<Record<string, unknown>> | null;
  pipettes: unknown | null;
  runs: RunsResponse | null;
}

export interface FleetSnapshotResponse {
  robots: Record<string, FleetRobotSnapshotRow>;
  errors: Record<string, string>;
}

export async function fetchFleetSnapshot(): Promise<FleetSnapshotResponse> {
  const res = await fetch(`${BASE}/api/fleet/snapshot`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as FleetSnapshotResponse;
}

/** Protocol file from run data.files (role "main" = primary Python/protocol file). */
export interface RunProtocolFile {
  name: string;
  role?: string;
}

export interface RunListItem {
  id: string;
  ok?: boolean;
  createdAt?: string;
  status?: string;
  current?: boolean;
  protocolId?: string;
  /** Full run payload; data.files[role=main].name is the protocol file name to display. */
  data?: {
    files?: RunProtocolFile[];
    protocolType?: string;
    [key: string]: unknown;
  };
  errors?: Array<{ id?: string; detail?: string; errorType?: string; errorCode?: string }>;
  pipettes?: Array<{ id?: string; pipetteName?: string; mount?: string; serialNumber?: string }>;
  modules?: Array<{ id?: string; model?: string; serialNumber?: string }>;
  completedAt?: string;
  startedAt?: string;
}

/** Prefer protocol file name (main) over protocolId/id for display. */
export function getRunDisplayName(run: RunListItem): string {
  const mainFile = run.data?.files?.find((f) => f.role === 'main');
  if (mainFile?.name?.trim()) return mainFile.name.trim();
  if (run.protocolId?.trim()) return run.protocolId.trim();
  return run.id;
}

/** Main `.py` file name from a single-run payload (`data.data.files` or `data.files`) only — no extra HTTP. */
export function mainProtocolFileNameFromRunData(run: Record<string, unknown> | null): string | null {
  if (!run) return null;
  const inner =
    run.data != null && typeof run.data === 'object' && !Array.isArray(run.data)
      ? (run.data as Record<string, unknown>)
      : null;
  const raw = inner?.files ?? run.files;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const files = raw as Array<{ name?: string; role?: string }>;
  const main = files.find((f) => f.role === 'main' && typeof f.name === 'string');
  if (main?.name?.trim()) return main.name.trim();
  const first = files[0];
  if (typeof first?.name === 'string' && first.name.trim()) return first.name.trim();
  return null;
}

export async function fetchRobotRuns(ip: string): Promise<RunsResponse> {
  const res = await fetch(`${BASE}/api/robots/${encodeURIComponent(ip)}/runs`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as RunsResponse;
}

/** Full run detail (includes data.files with protocol file name). Use when list item has no data.files. */
export interface RunDetail {
  data?: {
    files?: RunProtocolFile[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function fetchRobotRun(ip: string, runId: string): Promise<RunDetail> {
  const res = await fetch(
    `${BASE}/api/robots/${encodeURIComponent(ip)}/runs/${encodeURIComponent(runId)}`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as RunDetail;
}

/** Resolved main protocol source file name (from run and/or GET /protocols/{id} metadata). */
export async function fetchRobotRunProtocolFileName(
  ip: string,
  runId: string
): Promise<{ protocolFileName: string | null }> {
  const res = await fetch(
    `${BASE}/api/robots/${encodeURIComponent(ip)}/runs/${encodeURIComponent(runId)}/protocol-name`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as { protocolFileName: string | null };
}

/** Response from GET /api/robots/{ip}/runs/{runId}/protocol (run + protocol metadata + main file content). */
export interface RunProtocolResponse {
  runId: string;
  run: Record<string, unknown>;
  protocolId: string | null;
  protocol: Record<string, unknown> | null;
  protocolFileName: string | null;
  protocolFileContent: string | null;
  message?: string;
}

export async function fetchRobotRunProtocol(
  ip: string,
  runId: string
): Promise<RunProtocolResponse> {
  const res = await fetch(
    `${BASE}/api/robots/${encodeURIComponent(ip)}/runs/${encodeURIComponent(runId)}/protocol`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as RunProtocolResponse;
}

/** Preliminary check: validate run detail and troubleshooting zip are available for this run. */
export interface RunEndpointCheck {
  runDetailAvailable: boolean;
  troubleshootingZipAvailable: boolean;
}

export async function fetchRunEndpointCheck(
  ip: string,
  runId: string
): Promise<RunEndpointCheck> {
  const res = await fetch(
    `${BASE}/api/robots/${encodeURIComponent(ip)}/runs/${encodeURIComponent(runId)}/check`
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getErrorFromResponse(data, res.statusText));
  return data as RunEndpointCheck;
}

export async function fetchTroubleshootingZip(ip: string, runId?: string): Promise<Blob> {
  const path = `${BASE}/api/robots/${encodeURIComponent(ip)}/troubleshooting.zip`;
  const url = runId ? `${path}?runId=${encodeURIComponent(runId)}` : path;
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getErrorFromResponse(data, res.statusText));
  }
  return res.blob();
}
