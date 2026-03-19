/**
 * Cloud API: labs, cloud robots, auth. Requires JWT when VITE_USE_CLOUD=true.
 */
const RAW_BASE = (import.meta.env.VITE_API_URL as string) ?? '';
const BASE = RAW_BASE.replace(/\/$/, '');

function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!BASE) {
    throw new Error(
      'VITE_API_URL was not set when this app was built. In Vercel (or .env), set it to your API base URL with no trailing slash (e.g. https://opentrons-fleet-manager.onrender.com), then redeploy the frontend.',
    );
  }
  return `${BASE}${p}`;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  try {
    return await fetch(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      throw new Error(
        `Cannot reach the API (${url}). Usual causes: (1) CORS — on the API set CORS_ORIGINS to this site’s origin (e.g. https://opentrons-fleet-manager.vercel.app); (2) wrong VITE_API_URL at build time; (3) API offline or blocked.`,
      );
    }
    throw e;
  }
}

function authHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function login(email: string, password: string): Promise<{ access_token: string }> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Login failed');
  return data as { access_token: string };
}

export async function signup(email: string, password: string): Promise<{ access_token: string }> {
  const res = await apiFetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Signup failed');
  return data as { access_token: string };
}

export interface LabSummary {
  id: string;
  name: string;
  created_at: string | null;
}

export async function fetchLabs(token: string): Promise<LabSummary[]> {
  const res = await apiFetch('/api/labs', { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to load labs');
  return Array.isArray(data) ? data : [];
}

export async function createLab(token: string, name?: string): Promise<LabSummary> {
  const res = await apiFetch('/api/labs', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name: name?.trim() || 'My lab' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to create lab');
  return data as LabSummary;
}

/** Plain agent token is returned once; store it in the relay agent config or BACKEND_URL + env. */
export async function createLabAgentToken(
  token: string,
  labId: string,
  options?: { label?: string },
): Promise<{ token: string; lab_id: string }> {
  const res = await apiFetch(`/api/labs/${encodeURIComponent(labId)}/tokens`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ label: options?.label?.trim() || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to create agent token');
  return data as { token: string; lab_id: string };
}

/** Public API base URL (from build); relay agent `backend_url` / `BACKEND_URL` should match this. */
export function getCloudApiBaseUrl(): string {
  return BASE;
}

export interface CloudRobotSummary {
  id: string;
  lab_id: string;
  name: string | null;
  robot_serial: string | null;
  ip_last_seen: string | null;
  last_seen_at: string | null;
  health: Record<string, unknown> | null;
  runs: unknown;
  logs: string | null;
}

/** Targets the relay agent fetches from GET /api/agent/robot-poll-targets (edited here, not on the agent). */
export interface RobotPollTarget {
  ip: string;
  scheme: 'http' | 'https';
  port: number;
}

export async function fetchRobotPollTargets(token: string, labId: string): Promise<RobotPollTarget[]> {
  const res = await apiFetch(`/api/labs/${encodeURIComponent(labId)}/robot-poll-targets`, {
    headers: authHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to load robot poll targets');
  const robots = (data as { robots?: unknown }).robots;
  if (!Array.isArray(robots)) return [];
  return robots as RobotPollTarget[];
}

export async function saveRobotPollTargets(
  token: string,
  labId: string,
  robots: RobotPollTarget[],
): Promise<RobotPollTarget[]> {
  const res = await apiFetch(`/api/labs/${encodeURIComponent(labId)}/robot-poll-targets`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ robots }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to save robot poll targets');
  const out = (data as { robots?: unknown }).robots;
  return Array.isArray(out) ? (out as RobotPollTarget[]) : [];
}

export async function fetchCloudRobots(token: string, labId?: string): Promise<CloudRobotSummary[]> {
  const path = labId
    ? `/api/cloud/robots?lab_id=${encodeURIComponent(labId)}`
    : '/api/cloud/robots';
  const res = await apiFetch(path, { headers: authHeaders(token) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to load robots');
  return Array.isArray(data) ? data : [];
}

export interface CloudRobotDetail extends CloudRobotSummary {
  created_at: string | null;
}

export async function fetchCloudRobot(token: string, robotId: string): Promise<CloudRobotDetail> {
  const res = await apiFetch(`/api/cloud/robots/${encodeURIComponent(robotId)}`, {
    headers: authHeaders(token),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { detail?: string }).detail ?? 'Failed to load robot');
  return data as CloudRobotDetail;
}

/** Seconds after which robot data is considered stale (configurable via env). */
export const STALE_THRESHOLD_SECONDS = Number(import.meta.env.VITE_STALE_THRESHOLD_SECONDS) || 60;

export function isStale(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return true;
  const t = new Date(lastSeenAt).getTime();
  return (Date.now() - t) / 1000 > STALE_THRESHOLD_SECONDS;
}

export function lastSeenLabel(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return 'Never';
  const sec = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
