import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/authContext';
import { fetchCloudRobot, isStale, lastSeenLabel } from '../api/cloudApi';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';
import { orDash } from '../utils/robotFormat';
import {
  cloudRobotCardSubtitle,
  cloudRobotCardTitle,
  telemetryHealthLooksSparse,
  telemetryRobotName,
  telemetrySerial,
  telemetryStatus,
} from '../utils/telemetryHealth';

export function CloudRobotDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { data: robot, isLoading, isError, error } = useQuery({
    queryKey: ['cloud', 'robot', id, token],
    queryFn: () => fetchCloudRobot(token!, id!),
    enabled: !!token && !!id,
    staleTime: UI_POLL_INTERVAL_MS,
    refetchInterval: (q) => (q.state.status === 'error' ? false : UI_POLL_INTERVAL_MS),
  });

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

  const stale = isStale(robot.last_seen_at);
  const label = lastSeenLabel(robot.last_seen_at);
  const health = robot.health && typeof robot.health === 'object' ? robot.health : null;
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
              {health.api_version != null && String(health.api_version).trim() ? (
                <span>
                  <strong className="text-muted-foreground">API:</strong> {String(health.api_version)}
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

      {robot.runs != null && (
        <section className="mb-8 rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="font-display text-lg font-normal text-foreground">Runs</h2>
          <pre className="mt-3 overflow-auto rounded-lg bg-muted/50 p-4 text-xs text-foreground max-h-96">
            {JSON.stringify(robot.runs, null, 2)}
          </pre>
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
