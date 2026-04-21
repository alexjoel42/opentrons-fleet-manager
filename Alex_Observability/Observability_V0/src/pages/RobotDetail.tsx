import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRobot, useRobotLogs, useRobotRuns } from '../hooks';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';
import { formatPipettes, formatModules, formatNoteTimestamp, orDash } from '../utils/robotFormat';
import {
  deriveRunListItemFleetStatus,
  FLEET_STATUS_LABELS,
} from '../utils/robotFleetStatus';
import { telemetryApiVersion } from '../utils/telemetryHealth';
import {
  fetchTroubleshootingZip,
  fetchRobotRun,
  fetchRunEndpointCheck,
  fetchLocalRunNotes,
  patchLocalRunNotes,
  getRunDisplayName,
} from '../api/robotApi';
import type { RunListItem } from '../api/robotApi';
import {
  averageSuccessfulRunWallClock,
  firstRunErrorLine,
  formatRunDurationMs,
  runWallClockDurationMs,
  sortRunsNewestFirst,
} from '../utils/runMetadata';

function triggerZipDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RobotDetail() {
  const { ip } = useParams<{ ip: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const robot = useRobot(ip ?? null);
  const logs = useRobotLogs(ip ?? null);
  const runs = useRobotRuns(ip ?? null);
  const [zipPendingFor, setZipPendingFor] = useState<string | null>(null);

  const runNotesQuery = useQuery({
    queryKey: ['robot', ip, 'run-notes'],
    queryFn: () => fetchLocalRunNotes(ip!),
    enabled: Boolean(ip),
    staleTime: UI_POLL_INTERVAL_MS,
  });

  const [pendingRunNotes, setPendingRunNotes] = useState<
    Record<string, { detail?: string; inline?: string }>
  >({});

  useEffect(() => {
    setPendingRunNotes({});
  }, [ip]);

  const saveRunSlotMutation = useMutation({
    mutationFn: ({
      runId,
      slot,
      text,
    }: {
      runId: string;
      slot: 'detail' | 'inline';
      text: string;
    }) => {
      const t = text.trim();
      return patchLocalRunNotes(ip!, runId, slot === 'detail' ? { detail: t || null } : { inline: t || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robot', ip, 'run-notes'] });
    },
  });

  if (!ip) {
    return (
      <div className="max-w-3xl">
        <p className="text-muted-foreground">Missing robot IP.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const { health, modules, pipettes, isLoading, isError, error, refetch } = robot;
  const healthObj = health.data && typeof health.data === 'object' ? (health.data as Record<string, unknown>) : null;
  const serialRaw =
    healthObj?.serial_number != null
      ? healthObj.serial_number
      : healthObj?.robot_serial != null
        ? healthObj.robot_serial
        : null;
  const robotSerialDisplay = serialRaw != null && String(serialRaw).trim() ? String(serialRaw) : '—';
  const robotNameDisplay = orDash(healthObj?.name);
  const statusDisplay = orDash(healthObj?.status);
  const showSerialInTitle = robotSerialDisplay !== '—';
  const titleName = robotNameDisplay !== '—' ? robotNameDisplay : ip;
  const softwareVersion = telemetryApiVersion(healthObj);
  const pipetteLines = pipettes.data != null ? formatPipettes(pipettes.data) : [];
  const moduleLines = Array.isArray(modules.data) ? formatModules(modules.data) : [];
  const RUNS_LIST_LIMIT = 20;

  const runsAllDeduped: RunListItem[] = useMemo(() => {
    const raw = runs.data?.data;
    if (!Array.isArray(raw)) return [];
    const deduped = (raw as RunListItem[]).filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
    return sortRunsNewestFirst(deduped);
  }, [runs.data]);

  const runsList = runsAllDeduped.slice(0, RUNS_LIST_LIMIT);

  const successfulRunDurationStats = useMemo(
    () => averageSuccessfulRunWallClock(runsAllDeduped),
    [runsAllDeduped],
  );

  const [runFileNames, setRunFileNames] = useState<Record<string, string>>({});
  const runIds = runsList.map((r) => r.id).join(',');
  useEffect(() => {
    if (!ip || runsList.length === 0) return;
    const missing = runsList.filter((r) => !r.data?.files?.length);
    missing.forEach((run) => {
      fetchRobotRun(ip, run.id)
        .then((detail) => {
          const main = detail.data?.files?.find((f) => f.role === 'main');
          if (main?.name?.trim()) {
            setRunFileNames((prev) => ({ ...prev, [run.id]: main.name.trim() }));
          }
        })
        .catch(() => {});
    });
  }, [ip, runIds]);

  const getRunDisplayLabel = (run: RunListItem) =>
    runFileNames[run.id] ?? getRunDisplayName(run);

  const runCheckResults = useQueries({
    queries: runsList.map((run) => ({
      queryKey: ['robot', ip, 'run-check', run.id],
      queryFn: () => fetchRunEndpointCheck(ip!, run.id),
      enabled: Boolean(ip && run.id),
      retry: false,
      staleTime: UI_POLL_INTERVAL_MS,
    })),
  });
  const runCheckById = runsList.reduce<Record<string, { available: boolean; loading: boolean }>>(
    (acc, run, i) => {
      const q = runCheckResults[i];
      const available =
        !q?.isError && Boolean(q?.data?.runDetailAvailable ?? q?.data?.troubleshootingZipAvailable);
      acc[run.id] = { available: !!available, loading: q?.isPending ?? false };
      return acc;
    },
    {}
  );

  const runsNoteMap = runNotesQuery.data?.runs ?? {};

  const displaySlot = (runId: string, slot: 'detail' | 'inline') => {
    const p = pendingRunNotes[runId]?.[slot];
    if (p !== undefined) return p;
    return runsNoteMap[runId]?.[slot]?.body ?? '';
  };

  const slotUpdatedAt = (runId: string, slot: 'detail' | 'inline') =>
    runsNoteMap[runId]?.[slot]?.updated_at;

  const commitSlot = (runId: string, slot: 'detail' | 'inline') => {
    const text = displaySlot(runId, slot);
    saveRunSlotMutation.mutate(
      { runId, slot, text },
      {
        onSuccess: () => {
          setPendingRunNotes((prev) => {
            const next = { ...prev };
            const row = { ...next[runId] };
            delete row[slot];
            if (Object.keys(row).length === 0) delete next[runId];
            else next[runId] = row;
            return next;
          });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-1 sm:px-0">
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-accent to-accent-secondary px-6 py-8 text-white shadow-accent">
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mb-4 inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-white/90 transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-accent"
            >
              ← Back to fleet
            </button>
            <h1 className="font-display text-3xl font-normal tracking-tight md:text-4xl">
              {titleName}
              {showSerialInTitle && (
                <span className="block font-sans text-lg font-normal text-white/85 md:inline md:text-2xl">
                  {' '}
                  · {robotSerialDisplay}
                </span>
              )}
            </h1>
            <p className="mt-2 font-mono text-sm text-white/80">{ip}</p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading}
            title="Refresh data from robot"
            className="shrink-0 rounded-xl border border-white/30 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {isError && error && (
        <div className="mb-8 rounded-xl border border-error/50 bg-error-muted/50 px-5 py-4 text-error shadow-sm">
          <strong className="font-semibold">Could not load robot</strong>
          <p className="mt-1 text-sm opacity-90">{error instanceof Error ? error.message : String(error)}</p>
        </div>
      )}

      {isLoading && !health.data && !health.error && (
        <p className="mb-8 text-muted-foreground">Loading robot data…</p>
      )}

      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-normal tracking-tight text-foreground">Summary</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: 'Name', value: robotNameDisplay },
            { label: 'Serial', value: robotSerialDisplay },
            { label: 'Health status', value: statusDisplay },
            ...(softwareVersion
              ? [{ label: 'Software', value: softwareVersion }]
              : []),
          ].map((row) => (
            <div
              key={row.label}
              className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
            >
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {row.label}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">{row.value}</p>
            </div>
          ))}
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Network address
              </p>
              <p className="mt-1 font-mono text-sm font-medium text-foreground">{ip}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Average successful run
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {runs.isLoading && !runs.data
                  ? '…'
                  : successfulRunDurationStats
                    ? `${formatRunDurationMs(successfulRunDurationStats.averageMs)} (${successfulRunDurationStats.count} run${successfulRunDurationStats.count === 1 ? '' : 's'})`
                    : '—'}
              </p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground" title="Wall‑clock from startedAt to completedAt. Only status succeeded, no errors. Failed runs excluded.">
                Succeeded runs only; failed excluded.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-normal tracking-tight text-foreground">Pipettes</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
          <ul className="divide-y divide-border">
            {pipetteLines.length > 0
              ? pipetteLines.map((line, i) => (
                  <li key={i} className="px-5 py-3 text-sm text-foreground">
                    {line}
                  </li>
                ))
              : ['Left: —', 'Right: —'].map((line, i) => (
                  <li key={i} className="px-5 py-3 text-sm text-muted-foreground">
                    {line}
                  </li>
                ))}
          </ul>
        </div>
      </section>

      {moduleLines.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 font-display text-xl font-normal tracking-tight text-foreground">Modules</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
            <ul className="divide-y divide-border">
              {moduleLines.map((line, i) => (
                <li key={i} className="px-5 py-3 text-sm text-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-normal tracking-tight text-foreground">Runs</h2>
            <p className="text-sm text-muted-foreground">Recent protocol runs and notes</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-0 shadow-md">
          {runs.isLoading && !runs.data && (
            <p className="p-6 text-muted-foreground">Loading runs…</p>
          )}
          {runs.isError && <p className="border-b border-border p-6 text-error">Failed to load runs.</p>}
          {!runs.isLoading && runs.data != null && runsList.length === 0 && (
            <p className="p-6 text-muted-foreground">No runs recorded yet.</p>
          )}
          {runsList.length > 0 && (
            <ul className="space-y-5 p-5 sm:space-y-6">
              {runsList.map((run) => {
                const hasError = run.errors && run.errors.length > 0;
                const errLine = firstRunErrorLine(run);
                const durationMs = runWallClockDurationMs(run);
                const durationLabel =
                  durationMs != null ? formatRunDurationMs(durationMs) : '— (missing start/end in API)';
                const pending = zipPendingFor === run.id;
                const displayName = getRunDisplayLabel(run);
                const runVisual = deriveRunListItemFleetStatus(run);
                const check = runCheckById[run.id] ?? { available: false, loading: true };
                const canViewOrZip = check.available;
                const savingDetail =
                  saveRunSlotMutation.isPending &&
                  saveRunSlotMutation.variables?.runId === run.id &&
                  saveRunSlotMutation.variables?.slot === 'detail';
                const savingInline =
                  saveRunSlotMutation.isPending &&
                  saveRunSlotMutation.variables?.runId === run.id &&
                  saveRunSlotMutation.variables?.slot === 'inline';
                const inlineTs = formatNoteTimestamp(slotUpdatedAt(run.id, 'inline'));
                const detailTs = formatNoteTimestamp(slotUpdatedAt(run.id, 'detail'));
                return (
                  <li
                    key={run.id}
                    className="robot-fleet-card overflow-hidden rounded-xl border border-border border-l-4 bg-card shadow-md transition-shadow hover:shadow-lg"
                    data-fleet-status={runVisual}
                  >
                    <div className="p-5 sm:p-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 gap-y-2">
                            {run.current ? (
                              <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent ring-1 ring-accent/25">
                                Current
                              </span>
                            ) : null}
                            <span
                              className="fleet-status-pill text-xs"
                              data-fleet-status={runVisual}
                              title={orDash(run.status)}
                            >
                              {FLEET_STATUS_LABELS[runVisual]}
                            </span>
                            {hasError ? (
                              <span className="text-xs font-medium text-error">Run error</span>
                            ) : null}
                          </div>
                          <h3 className="mt-2 font-sans text-base font-semibold leading-snug text-foreground">
                            {displayName}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            <span className="text-muted-foreground">Wall‑clock duration:</span>{' '}
                            <span className="font-medium text-foreground">{durationLabel}</span>
                          </p>
                          {hasError && errLine ? (
                            <p
                              className="mt-2 rounded-lg border border-error/40 bg-error-muted/30 px-3 py-2 text-xs text-error"
                              role="alert"
                            >
                              <span className="font-semibold">Error: </span>
                              {errLine}
                            </p>
                          ) : null}
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all" title={run.id}>
                            {run.id}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start">
                          {check.loading ? (
                            <span
                              className="inline-flex rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
                              title="Validating endpoint…"
                            >
                              Checking…
                            </span>
                          ) : canViewOrZip ? (
                            <Link
                              to={`/robot/${encodeURIComponent(ip!)}/runs/${encodeURIComponent(run.id)}`}
                              className="inline-flex items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              title="Open run detail"
                            >
                              View run
                            </Link>
                          ) : (
                            <span
                              className="inline-flex rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
                              title="Run not available from robot (endpoint check failed)"
                            >
                              Unavailable
                            </span>
                          )}
                          <div className="min-w-[12rem] max-w-md flex-1" onClick={(e) => e.stopPropagation()}>
                            <label
                              className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                              htmlFor={`run-inline-${run.id}`}
                            >
                              Quick note
                            </label>
                            <textarea
                              id={`run-inline-${run.id}`}
                              value={displaySlot(run.id, 'inline')}
                              onChange={(e) =>
                                setPendingRunNotes((p) => ({
                                  ...p,
                                  [run.id]: { ...p[run.id], inline: e.target.value },
                                }))
                              }
                              rows={2}
                              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              placeholder="Short reminder…"
                            />
                            {inlineTs ? (
                              <p className="mt-1 text-[11px] text-muted-foreground">Saved {inlineTs}</p>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => commitSlot(run.id, 'inline')}
                              disabled={savingInline}
                              className="mt-2 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
                            >
                              {savingInline ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </div>
                      {(run.current || hasError) && (
                        <button
                          type="button"
                          disabled={pending || !canViewOrZip}
                          onClick={() => {
                            if (!ip || !canViewOrZip) return;
                            setZipPendingFor(run.id);
                            fetchTroubleshootingZip(ip, run.id)
                              .then((blob) => triggerZipDownload(blob, 'troubleshooting.zip'))
                              .finally(() => setZipPendingFor(null));
                          }}
                          className="mt-4 w-full rounded-xl border border-accent bg-transparent px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
                          title={!canViewOrZip ? 'Run not available from robot' : undefined}
                        >
                          {pending ? 'Downloading…' : 'Download troubleshooting zip'}
                        </button>
                      )}
                      <div className="mt-5 rounded-xl border border-border/80 bg-muted/20 p-4">
                        <label
                          className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                          htmlFor={`run-detail-${run.id}`}
                        >
                          Run notes
                        </label>
                        <textarea
                          id={`run-detail-${run.id}`}
                          value={displaySlot(run.id, 'detail')}
                          onChange={(e) =>
                            setPendingRunNotes((p) => ({
                              ...p,
                              [run.id]: { ...p[run.id], detail: e.target.value },
                            }))
                          }
                          rows={3}
                          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Longer context for this run…"
                        />
                        {detailTs ? (
                          <p className="mt-1.5 text-xs text-muted-foreground">Saved {detailTs}</p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => commitSlot(run.id, 'detail')}
                          disabled={savingDetail}
                          className="mt-3 rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium hover:bg-muted disabled:opacity-60"
                        >
                          {savingDetail ? 'Saving…' : 'Save run notes'}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-normal tracking-tight text-foreground">Health</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
          {healthObj && (
            <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-border bg-muted/15 px-5 py-4 text-sm">
              <span>
                <span className="text-muted-foreground">Status</span>{' '}
                <span className="font-medium text-foreground">{statusDisplay}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Serial</span>{' '}
                <span className="font-medium text-foreground">{robotSerialDisplay}</span>
              </span>
              {orDash(healthObj.name) !== '—' && (
                <span>
                  <span className="text-muted-foreground">Name</span>{' '}
                  <span className="font-medium text-foreground">{orDash(healthObj.name)}</span>
                </span>
              )}
              {orDash(healthObj.date) !== '—' && (
                <span>
                  <span className="text-muted-foreground">Date</span>{' '}
                  <span className="font-medium text-foreground">{orDash(healthObj.date)}</span>
                </span>
              )}
            </div>
          )}
          <details className="group p-5">
            <summary className="cursor-pointer list-none text-sm font-medium text-accent marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1">
                Raw JSON
                <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
              </span>
            </summary>
            <pre
              className="data-block mt-3 max-h-[240px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed"
              tabIndex={0}
            >
              {health.data ? JSON.stringify(health.data, null, 2) : '—'}
            </pre>
          </details>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-normal tracking-tight text-foreground">Logs</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
          <pre
            className="data-block max-h-[320px] overflow-auto whitespace-pre-wrap bg-muted/20 p-5 font-mono text-sm leading-relaxed"
            tabIndex={0}
          >
            {logs.data?.logs?.trim() ?? (logs.error ? String(logs.error) : 'No logs.')}
          </pre>
        </div>
      </section>
    </div>
  );
}
