import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { useRobot, useRobotLogs, useRobotRuns } from '../hooks';
import { formatPipettes, formatModules, orDash } from '../utils/robotFormat';
import { fetchTroubleshootingZip, fetchRobotRun, fetchRunEndpointCheck, getRunDisplayName } from '../api/robotApi';
import type { RunListItem } from '../api/robotApi';

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
  const robot = useRobot(ip ?? null);
  const logs = useRobotLogs(ip ?? null);
  const runs = useRobotRuns(ip ?? null);
  const [zipPendingFor, setZipPendingFor] = useState<string | null>(null);

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
  const robotSerialDisplay = orDash(healthObj?.serial_number);
  const robotNameDisplay = orDash(healthObj?.name);
  const statusDisplay = orDash(healthObj?.status);
  const showSerialInTitle = robotSerialDisplay !== '—';
  const titleName = robotNameDisplay !== '—' ? robotNameDisplay : ip;
  const pipetteLines = pipettes.data != null ? formatPipettes(pipettes.data) : [];
  const moduleLines = Array.isArray(modules.data) ? formatModules(modules.data) : [];
  const runsList = runs.data?.data && Array.isArray(runs.data.data)
    ? (runs.data.data as RunListItem[]).filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i).slice(0, 10)
    : [];

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
      staleTime: 60_000,
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

  return (
    <div className="max-w-3xl">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ← Back
        </button>
        <h1 className="font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
          Robot {titleName}
          {showSerialInTitle && (
            <span className="font-sans font-normal text-muted-foreground"> · {robotSerialDisplay}</span>
          )}
        </h1>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          title="Retry"
          className="ml-auto rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isLoading ? 'Refreshing…' : 'Retry'}
        </button>
      </div>

      {isError && error && (
        <div className="mb-6 rounded-xl border border-error/50 bg-error-muted/50 p-4 text-error">
          <strong>Error:</strong> {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {isLoading && !health.data && !health.error && (
        <p className="text-muted-foreground">Loading robot data…</p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Summary</h2>
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          <div className="space-y-2">
            <div className="flex gap-3">
              <span className="min-w-[4rem] text-sm text-muted-foreground">Name</span>
              <span>{robotNameDisplay}</span>
            </div>
            <div className="flex gap-3">
              <span className="min-w-[4rem] text-sm text-muted-foreground">IP</span>
              <span>{ip}</span>
            </div>
            <div className="flex gap-3">
              <span className="min-w-[4rem] text-sm text-muted-foreground">Serial</span>
              <span>{robotSerialDisplay}</span>
            </div>
            <div className="flex gap-3">
              <span className="min-w-[4rem] text-sm text-muted-foreground">Status</span>
              <span>{statusDisplay}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Pipettes</h2>
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          <ul className="list-inside list-disc space-y-1 text-foreground">
            {pipetteLines.length > 0
              ? pipetteLines.map((line, i) => <li key={i}>{line}</li>)
              : (
                <>
                  <li>Left: —</li>
                  <li>Right: —</li>
                </>
              )}
          </ul>
        </div>
      </section>

      {moduleLines.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Modules</h2>
          <div className="rounded-xl border border-border bg-card p-5 shadow-md">
            <ul className="list-inside list-disc space-y-1 text-foreground">
              {moduleLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Runs</h2>
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          {runs.isLoading && !runs.data && <p className="text-muted-foreground">Loading runs…</p>}
          {runs.isError && (
            <p className="text-error">Failed to load runs.</p>
          )}
          {!runs.isLoading && runs.data != null && runsList.length === 0 && (
            <p className="text-muted-foreground">No runs.</p>
          )}
          {runsList.length > 0 && (
            <ul className="space-y-3">
              {runsList.map((run) => {
                const hasError = run.errors && run.errors.length > 0;
                const pending = zipPendingFor === run.id;
                const displayName = getRunDisplayLabel(run);
                const check = runCheckById[run.id] ?? { available: false, loading: true };
                const canViewOrZip = check.available;
                return (
                  <li key={run.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground">
                      {run.current && <strong>Current · </strong>}
                      {displayName} — {orDash(run.status)}
                      {hasError && <span className="text-error"> (error)</span>}
                    </span>
                    {check.loading ? (
                      <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground" title="Validating endpoint…">
                        Checking…
                      </span>
                    ) : canViewOrZip ? (
                      <Link
                        to={`/robot/${encodeURIComponent(ip!)}/runs/${encodeURIComponent(run.id)}`}
                        className="rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        title="Get run"
                      >
                        View
                      </Link>
                    ) : (
                      <span
                        className="rounded-lg px-2 py-1 text-xs text-muted-foreground opacity-70"
                        title="Run not available from robot (endpoint check failed)"
                      >
                        View (unavailable)
                      </span>
                    )}
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
                        className="rounded-lg border border-accent bg-transparent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                        title={!canViewOrZip ? 'Run not available from robot' : undefined}
                      >
                        {pending ? 'Downloading…' : 'Download troubleshooting zip'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Health</h2>
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          {healthObj && (
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><strong className="text-muted-foreground">Status:</strong> {statusDisplay}</span>
              <span><strong className="text-muted-foreground">Serial:</strong> {robotSerialDisplay}</span>
              {orDash(healthObj.name) !== '—' && (
                <span><strong className="text-muted-foreground">Name:</strong> {orDash(healthObj.name)}</span>
              )}
              {orDash(healthObj.date) !== '—' && (
                <span><strong className="text-muted-foreground">Date:</strong> {orDash(healthObj.date)}</span>
              )}
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Raw JSON</summary>
            <pre className="data-block mt-2 max-h-[240px] overflow-auto rounded border border-border bg-muted/30 p-3 text-xs" tabIndex={0}>
              {health.data ? JSON.stringify(health.data, null, 2) : '—'}
            </pre>
          </details>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Logs</h2>
        <div className="rounded-xl border border-border bg-card p-5 shadow-md">
          <pre
            className="data-block max-h-[300px] whitespace-pre-wrap overflow-auto text-sm"
            tabIndex={0}
          >
            {logs.data?.logs?.trim() ?? (logs.error ? String(logs.error) : 'No logs.')}
          </pre>
        </div>
      </section>
    </div>
  );
}
