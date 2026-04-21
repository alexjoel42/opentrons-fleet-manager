import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/authContext';
import {
  fetchCloudRobot,
  isStale,
  lastSeenLabel,
  patchCloudRobotNotes,
  putCloudRunNote,
} from '../api/cloudApi';
import { getRunDisplayName, type RunListItem } from '../api/robotApi';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';
import { formatNoteTimestamp, orDash } from '../utils/robotFormat';
import {
  averageSuccessfulRunWallClock,
  firstRunErrorLine,
  formatRunDurationMs,
  runWallClockDurationMs,
} from '../utils/runMetadata';
import {
  cloudRobotCardSubtitle,
  cloudRobotCardTitle,
  coerceRunsForFleetStatus,
  telemetryApiVersion,
  telemetryHealthLooksSparse,
  telemetryRobotName,
  telemetrySerial,
  telemetryStatus,
} from '../utils/telemetryHealth';

export function CloudRobotDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data: robot, isLoading, isError, error } = useQuery({
    queryKey: ['cloud', 'robot', id, token],
    queryFn: () => fetchCloudRobot(token!, id!),
    enabled: !!token && !!id,
    staleTime: UI_POLL_INTERVAL_MS,
    refetchInterval: (q) => (q.state.status === 'error' ? false : UI_POLL_INTERVAL_MS),
  });

  const [robotEdit, setRobotEdit] = useState<string | null>(null);
  const [pendingRunEdits, setPendingRunEdits] = useState<
    Record<string, { detail?: string; inline?: string }>
  >({});

  useEffect(() => {
    setRobotEdit(null);
    setPendingRunEdits({});
  }, [id]);

  const saveRobotNotesMutation = useMutation({
    mutationFn: () => {
      if (!token || !id) throw new Error('Not signed in');
      const raw = robotEdit !== null ? robotEdit : (robot?.notes ?? '');
      const trimmed = raw.trim();
      return patchCloudRobotNotes(token, id, trimmed ? trimmed : null);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['cloud', 'robot', id, token], data);
      queryClient.invalidateQueries({ queryKey: ['cloud', 'robots', token] });
      setRobotEdit(null);
    },
  });

  const saveRunNoteMutation = useMutation({
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
      return putCloudRunNote(
        token!,
        id!,
        runId,
        slot === 'detail' ? { note: t ? t : null } : { inline: t ? t : null },
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['cloud', 'robot', id, token], data);
      queryClient.invalidateQueries({ queryKey: ['cloud', 'robots', token] });
    },
  });

  const runsCoerced = coerceRunsForFleetStatus(robot?.runs ?? null);
  const runsAllDeduped: RunListItem[] = useMemo(() => {
    if (!runsCoerced?.data?.length) return [];
    return runsCoerced.data.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
  }, [runsCoerced]);

  const runsList = useMemo(() => runsAllDeduped.slice(0, 50), [runsAllDeduped]);

  const successfulRunDurationStats = useMemo(
    () => averageSuccessfulRunWallClock(runsAllDeduped),
    [runsAllDeduped],
  );

  const runNotesMap = robot?.run_notes ?? {};
  const telemetryIds = useMemo(() => new Set(runsAllDeduped.map((r) => r.id)), [runsAllDeduped]);
  const orphanRunIds = useMemo(
    () => Object.keys(runNotesMap).filter((rid) => !telemetryIds.has(rid)),
    [runNotesMap, telemetryIds],
  );

  const showRunsSection =
    robot?.runs != null || runsList.length > 0 || orphanRunIds.length > 0;

  if (!id) {
    return (
      <div className="max-w-3xl">
        <p className="text-muted-foreground">Missing robot id.</p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Loading robot…</p>
      </div>
    );
  }

  if (isError || !robot) {
    return (
      <div className="max-w-3xl">
        <p className="text-error">{error instanceof Error ? error.message : 'Failed to load robot'}</p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const robotNoteValue =
    robotEdit !== null ? robotEdit : (robot.notes ?? '');
  const runNotes = robot.run_notes ?? {};

  const stale = isStale(robot.last_seen_at);
  const label = lastSeenLabel(robot.last_seen_at);
  const health = robot.health && typeof robot.health === 'object' ? robot.health : null;
  const softwareVersion = telemetryApiVersion(health);
  const displayName = cloudRobotCardTitle({
    id: robot.id,
    name: robot.name,
    robot_serial: robot.robot_serial,
    ip_last_seen: robot.ip_last_seen,
    health,
  });
  const headerSubtitle = cloudRobotCardSubtitle(displayName, {
    robot_serial: robot.robot_serial,
    ip_last_seen: robot.ip_last_seen,
    health,
  });

  const displaySlot = (runId: string, slot: 'detail' | 'inline') => {
    const p = pendingRunEdits[runId]?.[slot];
    if (p !== undefined) return p;
    return runNotes[runId]?.[slot]?.body ?? '';
  };

  const slotUpdatedAt = (runId: string, slot: 'detail' | 'inline') =>
    runNotes[runId]?.[slot]?.updated_at ?? null;

  const commitSlot = (runId: string, slot: 'detail' | 'inline') => {
    const text = displaySlot(runId, slot);
    saveRunNoteMutation.mutate(
      { runId, slot, text },
      {
        onSuccess: () => {
          setPendingRunEdits((p) => {
            const next = { ...p };
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
    <div className="max-w-3xl">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
            {displayName}
          </h1>
          {headerSubtitle ? (
            <p className="mt-1 font-sans text-sm font-normal text-muted-foreground">{headerSubtitle}</p>
          ) : null}
        </div>
        <div className={`ml-auto text-sm ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          Last updated {label}
          {stale && (
            <p className="mt-1" role="status">
              Robot data may be outdated
            </p>
          )}
        </div>
      </div>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-normal tracking-tight text-foreground">Summary</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              label: 'Name',
              value: orDash(telemetryRobotName(health) || robot.name || null),
            },
            { label: 'Serial', value: orDash(robot.robot_serial ?? telemetrySerial(health)) },
            { label: 'Health status', value: orDash(telemetryStatus(health)) },
            ...(softwareVersion ? [{ label: 'Software', value: softwareVersion }] : []),
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
              <p className="mt-1 font-mono text-sm font-medium text-foreground">{orDash(robot.ip_last_seen)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-shadow hover:shadow-md">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Average successful run time
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {successfulRunDurationStats
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

      <section className="mb-8 rounded-xl border border-border bg-card p-5 shadow-md">
        <h2 className="font-display text-lg font-normal text-foreground">Robot notes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Notes for this instrument (shared with your team via this account). Clear the field and save to remove.
        </p>
        <textarea
          value={robotNoteValue}
          onChange={(e) => setRobotEdit(e.target.value)}
          rows={5}
          className="mt-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Calibration reminders, hardware quirks, who to ping…"
          aria-label="Robot notes"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => saveRobotNotesMutation.mutate()}
            disabled={saveRobotNotesMutation.isPending}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            {saveRobotNotesMutation.isPending ? 'Saving…' : 'Save robot notes'}
          </button>
          {saveRobotNotesMutation.isError && (
            <span className="text-sm text-error">
              {saveRobotNotesMutation.error instanceof Error
                ? saveRobotNotesMutation.error.message
                : 'Save failed'}
            </span>
          )}
        </div>
      </section>

      {health && (
        <section className="mb-8 rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="font-display text-lg font-normal text-foreground">Health</h2>
          {telemetryHealthLooksSparse(health) ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Stored health is mostly empty (common if the relay agent only forwarded response headers). After updating
              the agent to merge the GET <code className="rounded bg-muted px-1 text-xs">/health</code> JSON body, name,
              serial, and status should populate on the next poll.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                <strong className="text-muted-foreground">Status:</strong> {orDash(telemetryStatus(health))}
              </span>
              <span>
                <strong className="text-muted-foreground">Serial:</strong> {orDash(telemetrySerial(health))}
              </span>
              {orDash(telemetryRobotName(health)) !== '—' ? (
                <span>
                  <strong className="text-muted-foreground">Name:</strong> {orDash(telemetryRobotName(health))}
                </span>
              ) : null}
              {health.robot_model != null && String(health.robot_model).trim() ? (
                <span>
                  <strong className="text-muted-foreground">Model:</strong> {String(health.robot_model)}
                </span>
              ) : null}
              {softwareVersion ? (
                <span>
                  <strong className="text-muted-foreground">Software:</strong> {softwareVersion}
                </span>
              ) : null}
              {health.date != null && String(health.date).trim() ? (
                <span>
                  <strong className="text-muted-foreground">Date:</strong> {String(health.date)}
                </span>
              ) : null}
            </div>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Raw JSON</summary>
            <pre className="data-block mt-2 max-h-[240px] overflow-auto rounded border border-border bg-muted/30 p-3 text-xs" tabIndex={0}>
              {JSON.stringify(robot.health, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {showRunsSection && (
        <section className="mb-8 rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="font-display text-lg font-normal text-foreground">Runs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Notes are keyed by run id and persist even if the run drops off the robot&apos;s list later.
          </p>

          {runsList.length > 0 && (
            <ul className="mt-4 space-y-6">
              {runsList.map((run) => {
                const hasErr = run.errors && run.errors.length > 0;
                const errLine = firstRunErrorLine(run);
                const durationMs = runWallClockDurationMs(run);
                const durationLabel =
                  durationMs != null ? formatRunDurationMs(durationMs) : '— (missing start/end in telemetry)';
                const savingDetail =
                  saveRunNoteMutation.isPending &&
                  saveRunNoteMutation.variables?.runId === run.id &&
                  saveRunNoteMutation.variables?.slot === 'detail';
                const savingInline =
                  saveRunNoteMutation.isPending &&
                  saveRunNoteMutation.variables?.runId === run.id &&
                  saveRunNoteMutation.variables?.slot === 'inline';
                return (
                  <li key={run.id} className="rounded-lg border border-border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="flex flex-wrap items-baseline gap-2">
                          {run.current ? (
                            <span className="font-medium text-accent">Current</span>
                          ) : null}
                          <span className="font-medium text-foreground">{getRunDisplayName(run)}</span>
                          <span className="text-muted-foreground">— {orDash(run.status)}</span>
                          {hasErr ? <span className="text-error">(error)</span> : null}
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          Wall‑clock duration:{' '}
                          <span className="font-medium text-foreground">{durationLabel}</span>
                        </p>
                        {hasErr && errLine ? (
                          <p
                            className="mt-2 rounded-lg border border-error/40 bg-error-muted/30 px-3 py-2 text-xs text-error"
                            role="alert"
                          >
                            <span className="font-semibold">Error: </span>
                            {errLine}
                          </p>
                        ) : null}
                        <p className="mt-1 font-mono text-xs text-muted-foreground">Run id: {run.id}</p>
                      </div>
                      <div className="min-w-[10rem] max-w-xs shrink-0">
                        <label
                          className="mb-0.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
                          htmlFor={`cloud-run-inline-${run.id}`}
                        >
                          Quick note
                        </label>
                        <textarea
                          id={`cloud-run-inline-${run.id}`}
                          value={displaySlot(run.id, 'inline')}
                          onChange={(e) =>
                            setPendingRunEdits((p) => ({
                              ...p,
                              [run.id]: { ...p[run.id], inline: e.target.value },
                            }))
                          }
                          rows={2}
                          className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Short reminder…"
                        />
                        {formatNoteTimestamp(slotUpdatedAt(run.id, 'inline')) ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            Saved {formatNoteTimestamp(slotUpdatedAt(run.id, 'inline'))}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => commitSlot(run.id, 'inline')}
                          disabled={savingInline}
                          className="mt-1 rounded border border-border bg-card px-2 py-0.5 text-[10px] font-medium hover:bg-muted disabled:opacity-60"
                        >
                          {savingInline ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-border pt-3">
                      <label
                        className="mb-1 block text-xs font-medium text-muted-foreground"
                        htmlFor={`cloud-run-detail-${run.id}`}
                      >
                        Run notes
                      </label>
                      <textarea
                        id={`cloud-run-detail-${run.id}`}
                        value={displaySlot(run.id, 'detail')}
                        onChange={(e) =>
                          setPendingRunEdits((p) => ({
                            ...p,
                            [run.id]: { ...p[run.id], detail: e.target.value },
                          }))
                        }
                        rows={3}
                        className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      {formatNoteTimestamp(slotUpdatedAt(run.id, 'detail')) ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Saved {formatNoteTimestamp(slotUpdatedAt(run.id, 'detail'))}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => commitSlot(run.id, 'detail')}
                        disabled={savingDetail}
                        className="mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                      >
                        {savingDetail ? 'Saving…' : 'Save run notes'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {orphanRunIds.length > 0 && (
            <div className={runsList.length > 0 ? 'mt-8' : 'mt-4'}>
              <h3 className="text-sm font-medium text-foreground">Saved notes (run not in current telemetry)</h3>
              <ul className="mt-3 space-y-5">
                {orphanRunIds.map((runId) => {
                  const savingDetail =
                    saveRunNoteMutation.isPending &&
                    saveRunNoteMutation.variables?.runId === runId &&
                    saveRunNoteMutation.variables?.slot === 'detail';
                  const savingInline =
                    saveRunNoteMutation.isPending &&
                    saveRunNoteMutation.variables?.runId === runId &&
                    saveRunNoteMutation.variables?.slot === 'inline';
                  return (
                    <li key={runId} className="rounded-lg border border-border border-dashed bg-muted/10 p-4">
                      <p className="font-mono text-xs text-muted-foreground">Run id: {runId}</p>
                      <div className="mt-3 flex flex-wrap gap-4">
                        <div className="min-w-[10rem] max-w-xs flex-1">
                          <label
                            className="mb-0.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
                            htmlFor={`orphan-inline-${runId}`}
                          >
                            Quick note
                          </label>
                          <textarea
                            id={`orphan-inline-${runId}`}
                            value={displaySlot(runId, 'inline')}
                            onChange={(e) =>
                              setPendingRunEdits((p) => ({
                                ...p,
                                [runId]: { ...p[runId], inline: e.target.value },
                              }))
                            }
                            rows={2}
                            className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1 text-xs"
                          />
                          {formatNoteTimestamp(slotUpdatedAt(runId, 'inline')) ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              Saved {formatNoteTimestamp(slotUpdatedAt(runId, 'inline'))}
                            </p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => commitSlot(runId, 'inline')}
                            disabled={savingInline}
                            className="mt-1 rounded border border-border bg-card px-2 py-0.5 text-[10px] font-medium hover:bg-muted disabled:opacity-60"
                          >
                            {savingInline ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 border-t border-border pt-3">
                        <label
                          className="mb-1 block text-xs font-medium text-muted-foreground"
                          htmlFor={`orphan-detail-${runId}`}
                        >
                          Run notes
                        </label>
                        <textarea
                          id={`orphan-detail-${runId}`}
                          value={displaySlot(runId, 'detail')}
                          onChange={(e) =>
                            setPendingRunEdits((p) => ({
                              ...p,
                              [runId]: { ...p[runId], detail: e.target.value },
                            }))
                          }
                          rows={3}
                          className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        />
                        {formatNoteTimestamp(slotUpdatedAt(runId, 'detail')) ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Saved {formatNoteTimestamp(slotUpdatedAt(runId, 'detail'))}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => commitSlot(runId, 'detail')}
                          disabled={savingDetail}
                          className="mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                        >
                          {savingDetail ? 'Saving…' : 'Save run notes'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {robot.runs != null && runsList.length === 0 && orphanRunIds.length === 0 && (
            <pre className="mt-4 overflow-auto rounded-lg bg-muted/50 p-4 text-xs text-foreground max-h-96">
              {JSON.stringify(robot.runs, null, 2)}
            </pre>
          )}

          {robot.runs != null && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Raw runs JSON
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted/50 p-4 text-xs text-foreground">
                {JSON.stringify(robot.runs, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}

      {robot.logs != null && robot.logs !== '' && (
        <section className="mb-8 rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="font-display text-lg font-normal text-foreground">Logs</h2>
          <pre className="mt-3 overflow-auto rounded-lg bg-muted/50 p-4 text-xs text-foreground whitespace-pre-wrap max-h-96">
            {robot.logs}
          </pre>
        </section>
      )}
    </div>
  );
}
