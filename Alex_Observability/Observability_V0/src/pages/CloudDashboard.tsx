import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/authContext';
import { fetchCloudRobots, fetchLabs, isStale, lastSeenLabel, type CloudRobotSummary } from '../api/cloudApi';
import { CloudAgentCredentials } from '../components/CloudAgentCredentials';
import { CloudRobotPollTargets } from '../components/CloudRobotPollTargets';
import { CloudSetupAccordion } from '../components/CloudSetupAccordion';
import { FleetStatusSummaryTable } from '../components/FleetStatusSummaryTable';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';
import {
  FLEET_FILTER_OPTIONS,
  FLEET_STATUS_LABELS,
  isRobotFleetAttentionStatus,
  type FleetStatusFilter,
  type RobotFleetVisualStatus,
} from '../utils/robotFleetStatus';
import {
  cloudRobotCardSubtitle,
  cloudRobotCardTitle,
  cloudRobotFleetVisualStatus,
  telemetryApiVersion,
  telemetryLastFailedRunInfo,
  telemetryLatestRunSummary,
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
  const visualStatus = cloudRobotFleetVisualStatus(robot);
  const runLine = telemetryLatestRunSummary(robot.runs);
  const lastFailedInfo = telemetryLastFailedRunInfo(robot.runs);
  const lastFailedViewIp = robot.ip_last_seen?.trim() ?? '';
  const softwareVersion = telemetryApiVersion(health);

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
          {softwareVersion ? (
            <span className="text-xs text-muted-foreground" title="Robot software version (health.api_version)">
              Software: {softwareVersion}
            </span>
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
        {lastFailedInfo ? (
          <div className="mt-2 rounded-lg border border-border/90 bg-muted/25 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fleet-failed-border)]">
                  Last failed
                </p>
                <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">
                  {lastFailedInfo.displayName}
                </p>
                {lastFailedInfo.timestampLabel ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{lastFailedInfo.timestampLabel}</p>
                ) : null}
                {lastFailedInfo.errorMessage ? (
                  <p
                    className="mt-1.5 text-xs leading-snug text-[var(--color-fleet-failed-border)]"
                    title={lastFailedInfo.errorDetailFull ?? lastFailedInfo.errorMessage}
                  >
                    {lastFailedInfo.errorMessage}
                  </p>
                ) : null}
              </div>
              {lastFailedViewIp ? (
                <Link
                  to={`/robot/${encodeURIComponent(lastFailedViewIp)}/runs/${encodeURIComponent(lastFailedInfo.runId)}`}
                  className="shrink-0 rounded-lg border border-accent/35 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
        {(robot.notes?.trim() || (robot.run_note_count ?? 0) > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Notes</span>
            {robot.notes?.trim() ? ' · robot' : ''}
            {(robot.run_note_count ?? 0) > 0
              ? ` · ${robot.run_note_count} run${robot.run_note_count === 1 ? '' : 's'}`
              : ''}
          </p>
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
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');

  const robotsQuery = useQuery({
    queryKey: ['cloud', 'robots', token],
    queryFn: () => fetchCloudRobots(token!),
    enabled: !!token,
    staleTime: UI_POLL_INTERVAL_MS,
    refetchInterval: (q) => (q.state.status === 'error' ? false : UI_POLL_INTERVAL_MS),
  });

  const labsQuery = useQuery({
    queryKey: ['cloud', 'labs', token],
    queryFn: () => fetchLabs(token!),
    enabled: !!token,
  });

  const robotsError = robotsQuery.error ? errMessage(robotsQuery.error) : null;
  const robots = robotsQuery.data ?? [];

  const robotsLoading = robotsQuery.isLoading && !robotsQuery.isError;

  const statusForRobot = useCallback((r: CloudRobotSummary) => cloudRobotFleetVisualStatus(r), []);

  const filteredRobots = useMemo(() => {
    if (statusFilter === 'all') return robots;
    if (statusFilter === 'attention') {
      return robots.filter((r) => isRobotFleetAttentionStatus(statusForRobot(r)));
    }
    return robots.filter((r) => statusForRobot(r) === statusFilter);
  }, [robots, statusFilter, statusForRobot]);

  const filterCounts = useMemo(() => {
    const m: Partial<Record<FleetStatusFilter, number>> = { all: robots.length };
    m.attention = robots.filter((r) => isRobotFleetAttentionStatus(statusForRobot(r))).length;
    for (const opt of FLEET_FILTER_OPTIONS) {
      if (opt.value === 'all' || opt.value === 'attention') continue;
      m[opt.value] = robots.filter((r) => statusForRobot(r) === opt.value).length;
    }
    return m as Record<FleetStatusFilter, number>;
  }, [robots, statusForRobot]);

  useEffect(() => {
    if (statusFilter === 'attention' && (filterCounts.attention ?? 0) === 0) {
      setStatusFilter('all');
    }
  }, [statusFilter, filterCounts.attention]);

  const visualCounts = useMemo((): Record<RobotFleetVisualStatus, number> => {
    const o = {} as Record<RobotFleetVisualStatus, number>;
    for (const opt of FLEET_FILTER_OPTIONS) {
      if (opt.value === 'all' || opt.value === 'attention') continue;
      o[opt.value] = filterCounts[opt.value] ?? 0;
    }
    return o;
  }, [filterCounts]);

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
          <strong className="font-medium text-foreground">Relay agent credentials</strong> and{' '}
          <strong className="font-medium text-foreground">Robot addresses</strong> start open; use the headers to
          collapse either section when you want more room for the fleet. The relay agent loads robot addresses from the
          cloud. UI and agent default to about a minute
          between updates to keep API usage low (override with{' '}
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

      {token ? (
        <CloudSetupAccordion title="Relay agent credentials">
          <CloudAgentCredentials token={token} embedded />
        </CloudSetupAccordion>
      ) : null}
      {token && (labsQuery.data?.length ?? 0) > 0 ? (
        <CloudSetupAccordion title="Robot addresses (relay agent)">
          <CloudRobotPollTargets token={token} embedded />
        </CloudSetupAccordion>
      ) : null}

      {robotsLoading ? (
        <p className="rounded-xl border border-border bg-muted/30 px-6 py-8 text-center text-muted-foreground">
          Loading robots…
        </p>
      ) : robotsError ? null : robots.length === 0 ? (
        <p className="rounded-xl border border-border bg-muted/30 px-6 py-8 text-center text-muted-foreground">
          No robots yet. Run the relay agent in your lab to see robots here.
        </p>
      ) : (
        <>
          <FleetStatusSummaryTable
            counts={visualCounts}
            fleetStatusFilter={statusFilter}
            onFleetStatusFilter={setStatusFilter}
            onSelectStatus={(s) => setStatusFilter(s)}
          />

          <div className="relative mb-8 overflow-hidden rounded-lg bg-gradient-to-r from-accent to-accent-secondary px-6 py-5 text-white shadow-accent">
            <div className="relative">
              <span className="font-mono text-xs uppercase tracking-[0.15em] text-white/90">
                Fleet at a glance
              </span>
              <p className="mt-1 font-display text-2xl font-normal tracking-tight">
                {robots.length} robot{robots.length !== 1 ? 's' : ''} in cloud
                {statusFilter !== 'all' && (
                  <span className="ml-2 text-lg font-normal text-white/90">
                    · {filteredRobots.length} shown
                    {statusFilter === 'attention' ? ' need attention' : ''}
                  </span>
                )}
              </p>
            </div>
          </div>

          <section className="mb-6" aria-label="Filter fleet by status">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Filter by status
            </p>
            <div className="flex flex-wrap gap-2">
              {FLEET_FILTER_OPTIONS.map((opt) => {
                const count = filterCounts[opt.value] ?? 0;
                const selected = statusFilter === opt.value;
                const attentionPill = opt.value === 'attention';
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    aria-pressed={selected}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? attentionPill
                          ? 'border-[var(--color-fleet-failed-border)] bg-[var(--color-fleet-failed-bg)] text-[var(--color-fleet-failed-border)] shadow-sm'
                          : 'border-accent bg-accent/12 text-accent shadow-sm'
                        : 'border-border bg-card text-muted-foreground hover:border-accent/35 hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                    <span
                      className={`ml-1.5 tabular-nums ${selected ? 'text-accent/90' : 'text-muted-foreground'}`}
                    >
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {filteredRobots.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-6 py-8 text-center text-muted-foreground">
              No robots match this filter. Choose another status or clear the filter.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRobots.map((robot) => (
                <RobotCloudCard key={robot.id} robot={robot} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
