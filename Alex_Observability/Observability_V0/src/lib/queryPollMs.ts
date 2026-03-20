/**
 * Browser → API polling interval. Default 60s to keep Render usage low with many users.
 * Override: VITE_POLL_INTERVAL_MS=30000 (minimum 5000).
 */
function pollMsFromEnv(fallback: number): number {
  const raw = import.meta.env.VITE_POLL_INTERVAL_MS as string | undefined;
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 5000) return fallback;
  return n;
}

export const UI_POLL_INTERVAL_MS = pollMsFromEnv(60_000);
