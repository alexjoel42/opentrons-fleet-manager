import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  fetchRobotRun,
  fetchRobotRunProtocolFileName,
  mainProtocolFileNameFromRunData,
} from '../api/robotApi';
import { orDash } from '../utils/robotFormat';

/**
 * Get run by ID (Opentrons GET /runs/{runId}). Shows protocol file name, status, and full run payload.
 */
export function RunDetail() {
  const { ip, runId } = useParams<{ ip: string; runId: string }>();
  const navigate = useNavigate();
  const { data: runPayload, isLoading, isError, error } = useQuery({
    queryKey: ['robot', ip, 'runs', runId],
    queryFn: () => (ip && runId ? fetchRobotRun(ip, runId) : Promise.reject(new Error('Missing ip or runId'))),
    enabled: Boolean(ip && runId),
  });
  const { data: protocolNamePayload } = useQuery({
    queryKey: ['robot', ip, 'runs', runId, 'protocol-name'],
    queryFn: () =>
      ip && runId
        ? fetchRobotRunProtocolFileName(ip, runId)
        : Promise.reject(new Error('Missing ip or runId')),
    enabled: Boolean(ip && runId),
  });
  if (!ip || !runId) {
    return (
      <div className="max-w-3xl">
        <p className="text-muted-foreground">Missing robot IP or run ID.</p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  const raw = runPayload as Record<string, unknown> | undefined;
  const run = raw?.data != null ? raw.data : raw;
  const runObj =
    run != null && typeof run === 'object' && !Array.isArray(run) ? (run as Record<string, unknown>) : null;
  const protocolFileName =
    protocolNamePayload?.protocolFileName?.trim() ||
    mainProtocolFileNameFromRunData(runObj) ||
    null;
  const runHeadline = protocolFileName ?? runId;

  return (
    <div className="max-w-3xl">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link
          to={`/robot/${encodeURIComponent(ip)}`}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ← Back to robot
        </Link>
        <h1 className="font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
          Run · {orDash(runHeadline)}
        </h1>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading run…</p>}

      {isError && error && (
        <div className="mb-6 rounded-xl border border-error/50 bg-error-muted/50 p-4 text-error">
          <strong>Error:</strong> {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {!isLoading && !isError && runPayload == null && (
        <p className="text-muted-foreground">No run data.</p>
      )}

      {!isLoading && runPayload != null && (
        <>
          {runObj != null && (
            <section className="mb-8">
              <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Summary</h2>
              <div className="rounded-xl border border-border bg-card p-5 shadow-md">
                <div className="space-y-2">
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">Protocol file</span>
                    <span>{orDash(protocolFileName)}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">Run ID</span>
                    <span className="font-mono text-sm">{runId}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">Status</span>
                    <span>{orDash(runObj.status)}</span>
                  </div>
                  {runObj.createdAt != null && (
                    <div className="flex gap-3">
                      <span className="min-w-[6rem] text-sm text-muted-foreground">Created</span>
                      <span>{orDash(runObj.createdAt)}</span>
                    </div>
                  )}
                  {runObj.current != null && (
                    <div className="flex gap-3">
                      <span className="min-w-[6rem] text-sm text-muted-foreground">Current</span>
                      <span>{runObj.current ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="mb-8" aria-label="Display protocol file name">
            <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Display protocol file name</h2>
            <div className="rounded-xl border border-border bg-card p-5 shadow-md">
              <p className="font-mono text-sm break-all text-foreground">{orDash(protocolFileName)}</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">Run (raw)</h2>
            <div className="rounded-xl border border-border bg-card p-5 shadow-md">
              <pre className="data-block max-h-[400px] overflow-auto text-xs" tabIndex={0}>
                {typeof runPayload === 'object' && runPayload !== null
                  ? JSON.stringify(runPayload, null, 2)
                  : String(runPayload)}
              </pre>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
