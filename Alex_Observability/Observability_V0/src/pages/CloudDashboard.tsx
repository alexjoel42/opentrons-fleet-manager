import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/authContext';
import { fetchCloudRobots, fetchLabs, isStale, lastSeenLabel, type CloudRobotSummary } from '../api/cloudApi';
import { CloudRobotPollTargets } from '../components/CloudRobotPollTargets';

function RobotCloudCard({ robot }: { robot: CloudRobotSummary }) {
  const stale = isStale(robot.last_seen_at);
  const label = lastSeenLabel(robot.last_seen_at);
  const displayName = robot.name || robot.robot_serial || robot.ip_last_seen || robot.id;

  return (
    <Link
      to={`/robot/cloud/${robot.id}`}
      className={`block rounded-xl border p-5 shadow-md transition-all hover:shadow-lg ${
        stale ? 'border-amber-500/50 bg-amber-500/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-normal tracking-tight text-foreground">
            {displayName}
          </h2>
          {(robot.robot_serial || robot.ip_last_seen) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {[robot.robot_serial, robot.ip_last_seen].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="text-right text-sm">
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
      {robot.health?.status != null && robot.health.status !== '' ? (
        <p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">
          Status: {String(robot.health.status)}
        </p>
      ) : null}
    </Link>
  );
}

export function CloudDashboard() {
  const { token } = useAuth();
  const { data: labs, isLoading: labsLoading } = useQuery({
    queryKey: ['cloud', 'labs', token],
    queryFn: () => fetchLabs(token!),
    enabled: !!token,
  });
  const { data: robots, isLoading: robotsLoading } = useQuery({
    queryKey: ['cloud', 'robots', token],
    queryFn: () => fetchCloudRobots(token!),
    enabled: !!token,
  });

  const isLoading = labsLoading || robotsLoading;

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Loading labs and robots…</p>
      </div>
    );
  }

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
          Configure robot addresses below; the relay agent loads them from the cloud. Telemetry may be a few seconds old.
        </p>
      </div>

      {token ? <CloudRobotPollTargets token={token} /> : null}

      {labs && labs.length > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {labs.length} lab{labs.length !== 1 ? 's' : ''}
        </p>
      )}

      {robots && robots.length === 0 ? (
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
