import type { RunListItem } from '../api/robotApi';

/** Wall‑clock duration from run JSON `startedAt` → `completedAt` (UTC), in milliseconds. */
export function runWallClockDurationMs(run: RunListItem): number | null {
  const a = run.startedAt != null ? Date.parse(String(run.startedAt)) : NaN;
  const b = run.completedAt != null ? Date.parse(String(run.completedAt)) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return b - a;
}

/** Human‑readable duration (wall‑clock from run metadata). */
export function formatRunDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min === 0 ? `${h}h` : `${h}h ${min}m`;
}

export function isRunFailed(run: RunListItem): boolean {
  const st = (run.status ?? '').toLowerCase();
  if (st === 'failed') return true;
  if (Array.isArray(run.errors) && run.errors.length > 0) return true;
  return false;
}

/**
 * Completed run counted as successful for averages: **only** `status === "succeeded"`, no recorded
 * errors, not explicitly failed, no error-recovery flag, valid wall‑clock timestamps.
 * Failed runs (including `ProtocolCommandFailedError`, etc.) are excluded even if duration exists.
 */
export function isSuccessfulCompletedRun(run: RunListItem): boolean {
  if (run.ok === false) return false;
  if (runWallClockDurationMs(run) == null) return false;
  if (Array.isArray(run.errors) && run.errors.length > 0) return false;
  if (run.hasEverEnteredErrorRecovery === true) return false;
  const st = (run.status ?? '').toLowerCase();
  if (st !== 'succeeded') return false;
  return true;
}

/** Primary error line for display (API `errors[0]`). */
export function firstRunErrorLine(run: RunListItem): string | null {
  if (!Array.isArray(run.errors) || run.errors.length === 0) return null;
  const e = run.errors[0];
  const raw = e.detail ?? e.errorType ?? e.errorCode;
  if (raw == null || !String(raw).trim()) return null;
  return String(raw).trim();
}

export type SuccessfulRunDurationStats = {
  /** Mean wall‑clock ms over successful completed runs in the input list. */
  averageMs: number;
  /** Number of runs included in the average. */
  count: number;
};

/** Average wall‑clock duration over successful completed runs only (excludes failed / missing timestamps). */
export function averageSuccessfulRunWallClock(runs: RunListItem[]): SuccessfulRunDurationStats | null {
  const durations: number[] = [];
  for (const run of runs) {
    if (!isSuccessfulCompletedRun(run)) continue;
    const ms = runWallClockDurationMs(run);
    if (ms != null) durations.push(ms);
  }
  if (durations.length === 0) return null;
  const sum = durations.reduce((a, b) => a + b, 0);
  return { averageMs: sum / durations.length, count: durations.length };
}
