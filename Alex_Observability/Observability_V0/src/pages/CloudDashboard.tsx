import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/authContext';
import { fetchCloudRobots, isStale, lastSeenLabel, type CloudRobotSummary } from '../api/cloudApi';
import { CloudAgentCredentials } from '../components/CloudAgentCredentials';
import { CloudRobotPollTargets } from '../components/CloudRobotPollTargets';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';
import { FLEET_STATUS_LABELS, deriveRobotFleetVisualStatus } from '../utils/robotFleetStatus';
import {
  cloudRobotCardSubtitle,
  cloudRobotCardTitle,
  coerceRunsForFleetStatus,
  telemetryLatestRunSummary,
  telemetryStatus,
} from '../utils/telemetryHealth';

function RobotCloudCard({ robot }: { robot: CloudRobotSummary }) {
  const stale = isStale(robot.last_seen_at);
  const label = lastSeenLabel(robot.last_seen_at);
  const health = robot.health && typeof robot.health === 'object' ? robot.health : null;
  const title = cloudRobotCardTitle({
    id: robot.id,
    name: robot.name,
    robot_serial: robot.robot_serial,
    ip_last_seen: robot.ip_last_seen,
    health,
  });
  const subtitle = cloudRobotCardSubtitle(title, {
    robot_serial: robot.robot_serial,
    ip_last_seen: robot.ip_last_seen,
    health,
  });
  const runsCoerced = coerceRunsForFleetStatus(robot.runs);
  const visualStatus = deriveRobotFleetVisualStatus({
    fleetError: null,
    healthLoading: false,
    healthError: false,
    healthData: health,
    runsData: runsCoerced ?? undefined,
  });
  const runLine = telemetryLatestRunSummary(robot.runs);
  const healthStatusLine = telemetryStatus(health);

  return (
    <Link to={`/robot/cloud/${robot.id}`} className="robot-card-link group block">
      <div
        className={`robot-fleet-card relative overflow-hidden rounded-xl border border-border border-l-4 bg-card p-5 shadow-md transition-all duration-200 hover:shadow-lg dark:border-border ${
          stale ? 'ring-1 ring-amber-500/40' : ''
        }`}
        data-fleet-status={visualStatus}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-normal tracking-tight text-foreground">{title}</h2>
            {subtitle ? (
              <p className="mt-1 truncate text-sm text-muted-foreground" title={subtitle}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-right text-sm">
            <span className={stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
              Last updated {label}
            </span>
            {stale && (
              <p className="mt-1 text-amber-600 dark:text-amber-400" role="status">
                Robot data may be outdated
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="fleet-status-pill"
            data-fleet-status={visualStatus}
            aria-label={`Status: ${FLEET_STATUS_LABELS[visualStatus]}`}
          >
            {FLEET_STATUS_LABELS[visualStatus]}
          </span>
          {healthStatusLine ? (
            <span className="text-xs text-muted-foreground">API: {healthStatusLine}</span>
          ) : null}
        </div>
        {runLine ? (
          <p className="mt-2 text-sm text-foreground">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Runs </span>
            {runLine}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No run list in last telemetry.</p>
        )}
      </div>
    </Link>
  );
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CloudDashboard() {
  const { token } = useAuth();
  const robotsQuery = useQuery({
    queryKey: ['cloud', 'robots', token],
    queryFn: () => fetchCloudRobots(token!),
    enabled: !!token,
    staleTime: UI_POLL_INTERVAL_MS,
    refetchInterval: (q) => (q.state.status === 'error' ? false : UI_POLL_INTERVAL_MS),
  });

  const robotsError = robotsQuery.error ? errMessage(robotsQuery.error) : null;
  const robots = robotsQuery.data;

  const robotsLoading = robotsQuery.isLoading && !robotsQuery.isError;

  return (
    <div>
      <div className="mb-8">
        <div className="section-label mb-4">
          <span className="section-label-dot" aria-hidden />
          <span>Cloud fleet</span>
        </div>
        <h1 className="font-display text-3xl font-normal tracking-tight text-foreground md:text-4xl">
          Robot <span className="gradient-text">fleet</span>
        </h1>
        <p className="mt-2 text-muted-foreground">
          Configure robot addresses below; the relay agent loads them from the cloud. UI and agent default to about a
          minute between updates to keep API usage low (override with{' '}
          <code className="rounded bg-muted px-1 text-xs">ROBOT_POLL_INTERVAL_SECONDS</code> /{' '}
          <code className="rounded bg-muted px-1 text-xs">VITE_POLL_INTERVAL_MS</code>).
        </p>
      </div>

      {robotsError ? (
        <div
          className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-foreground"
          role="status"
        >
          <p className="font-medium">Could not load robot list</p>
          <p className="mt-1 text-muted-foreground">{robotsError}</p>
        </div>
      ) : null}

      {token ? <CloudAgentCredentials token={token} /> : null}
      {token ? <CloudRobotPollTargets token={token} /> : null}

      {robotsLoading ? (
        <p className="rounded-xl border border-border bg-muted/30 px-6 py-8 text-center text-muted-foreground">
          Loading robots…
        </p>
      ) : robotsError ? null : robots && robots.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted/30 px-6 py-8 text-center text-muted-foreground">
          No robots yet. Run the relay agent in your lab to see robots here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {robots?.map((robot) => (
            <RobotCloudCard key={robot.id} robot={robot} />
          ))}
        </div>
      )}
    </div>
  );
}
