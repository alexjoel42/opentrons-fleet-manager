import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/authContext';
import { fetchCloudRobot, isStale, lastSeenLabel } from '../api/cloudApi';

export function CloudRobotDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { data: robot, isLoading, isError, error } = useQuery({
    queryKey: ['cloud', 'robot', id, token],
    queryFn: () => fetchCloudRobot(token!, id!),
    enabled: !!token && !!id,
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
  const displayName = robot.name || robot.robot_serial || robot.ip_last_seen || robot.id;

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
        <h1 className="font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
          {displayName}
          {(robot.robot_serial || robot.ip_last_seen) && (
            <span className="font-sans font-normal text-muted-foreground">
              {' '}
              · {[robot.robot_serial, robot.ip_last_seen].filter(Boolean).join(' · ')}
            </span>
          )}
        </h1>
        <div className={`ml-auto text-sm ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          Last updated {label}
          {stale && (
            <p className="mt-1" role="status">
              Robot data may be outdated
            </p>
          )}
        </div>
      </div>

      {robot.health && (
        <section className="mb-8 rounded-xl border border-border bg-card p-5 shadow-md">
          <h2 className="font-display text-lg font-normal text-foreground">Health</h2>
          <pre className="mt-3 overflow-auto rounded-lg bg-muted/50 p-4 text-xs text-foreground">
            {JSON.stringify(robot.health, null, 2)}
          </pre>
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
