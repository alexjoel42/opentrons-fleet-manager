import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRobotList, useFleetSnapshot } from '../hooks';
import { RobotCardView } from '../components/RobotCard';
import { FleetStatusSummaryTable } from '../components/FleetStatusSummaryTable';
import { ImportRobotIps } from '../components/ImportRobotIps';
import { addRobotIp, removeRobotIp } from '../api/robotApi';
import {
  FLEET_FILTER_OPTIONS,
  deriveRobotFleetVisualStatus,
  isRobotFleetAttentionStatus,
  type FleetStatusFilter,
  type RobotFleetVisualStatus,
} from '../utils/robotFleetStatus';

export function Dashboard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useRobotList();
  const [newIp, setNewIp] = useState('');
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');

  const ips = data?.ips ?? [];
  const fleet = useFleetSnapshot(ips.length > 0);

  const addMutation = useMutation({
    mutationFn: (ip: string) => addRobotIp(ip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      setNewIp('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (ip: string) => removeRobotIp(ip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const ip = newIp.trim();
    if (!ip) return;
    addMutation.mutate(ip);
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Loading robot list…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center">
        <p className="text-error">Failed to load robots: {error instanceof Error ? error.message : 'Unknown error'}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          <Link to="/" className="text-accent hover:underline">
            Configure robot IP addresses
          </Link>{' '}
          first, and ensure the backend is running (<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">make run-backend</code>).
        </p>
      </div>
    );
  }

  const snap = fleet.data;
  const fleetQueryError =
    fleet.isError && fleet.error instanceof Error
      ? fleet.error.message
      : fleet.isError
        ? 'Failed to load fleet data'
        : null;
  const fleetLoading = fleet.isLoading && !snap;
  const fleetFirstLoadFailed = fleet.isError && !snap && ips.length > 0;

  const statusForIp = useCallback(
    (ip: string) => {
      const row = snap?.robots[ip];
      const perIpError = snap?.errors[ip];
      return deriveRobotFleetVisualStatus({
        fleetError: perIpError ?? null,
        healthLoading: fleetLoading,
        healthError: false,
        healthData: row?.health ?? undefined,
        runsData: row?.runs ?? null,
      });
    },
    [snap, fleetLoading]
  );

  const filteredIps = useMemo(() => {
    if (statusFilter === 'all') return ips;
    if (statusFilter === 'attention') {
      return ips.filter((ip) => isRobotFleetAttentionStatus(statusForIp(ip)));
    }
    return ips.filter((ip) => statusForIp(ip) === statusFilter);
  }, [ips, statusFilter, statusForIp]);

  const filterCounts = useMemo(() => {
    const m: Partial<Record<FleetStatusFilter, number>> = { all: ips.length };
    m.attention = ips.filter((ip) => isRobotFleetAttentionStatus(statusForIp(ip))).length;
    for (const opt of FLEET_FILTER_OPTIONS) {
      if (opt.value === 'all' || opt.value === 'attention') continue;
      m[opt.value] = ips.filter((ip) => statusForIp(ip) === opt.value).length;
    }
    return m as Record<FleetStatusFilter, number>;
  }, [ips, statusForIp]);

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
          <span>Fleet</span>
        </div>
        <h1 className="font-display text-3xl font-normal tracking-tight text-foreground md:text-4xl">
          Robot <span className="gradient-text">fleet</span>
        </h1>
        <p className="mt-2 text-muted-foreground">
          <Link to="/" className="text-accent font-medium hover:underline">
            Add or change robot IPs
          </Link>
        </p>
        <div className="mt-3 h-1 w-16 rounded-full bg-accent/80" aria-hidden />
      </div>

      <section className="mb-10" aria-label="Add robot IP">
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-accent/25 bg-card p-5 shadow-md ring-1 ring-accent/10"
        >
          <input
            type="text"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            placeholder="Robot IP (e.g. 192.0.2.10, ::1, or localhost)"
            aria-label="Robot IP address"
            className="h-12 min-w-[180px] flex-1 rounded-lg border-2 border-accent/20 bg-white px-4 text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30 focus:ring-offset-2 focus:ring-offset-background"
          />
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="inline-flex h-12 items-center justify-center rounded-[200px] bg-accent px-6 font-semibold text-[13px] leading-4 text-accent-foreground shadow-sm transition-all duration-200 hover:opacity-95 active:scale-[0.98] disabled:opacity-70"
          >
            {addMutation.isPending ? 'Adding…' : 'Add robot'}
          </button>
          {addMutation.isError && (
            <span className="w-full text-sm text-error sm:w-auto">
              {addMutation.error instanceof Error ? addMutation.error.message : 'Add failed'}
            </span>
          )}
        </form>
      </section>

      <section className="mb-10" aria-label="Import robot IP addresses">
        <ImportRobotIps variant="dashboard" />
      </section>

      {ips.length === 0 ? (
        <p className="rounded-lg border-2 border-accent/20 bg-card px-6 py-8 text-center text-muted-foreground">
          No robots added yet. Enter an IP above to add a robot on your network.
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
                {ips.length} robot{ips.length !== 1 ? 's' : ''} connected
                {statusFilter !== 'all' && (
                  <span className="ml-2 text-lg font-normal text-white/90">
                    · {filteredIps.length} shown
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

          {fleetQueryError && snap && (
            <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200" role="status">
              Fleet refresh failed (showing last known data): {fleetQueryError}
            </p>
          )}
          {fleetFirstLoadFailed ? (
            <p className="rounded-lg border border-error/40 bg-error-muted/20 px-4 py-6 text-center text-error" role="alert">
              {fleetQueryError}
            </p>
          ) : filteredIps.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-6 py-8 text-center text-muted-foreground">
              No robots match this filter. Choose another status or clear the filter.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredIps.map((ip) => {
                const row = snap?.robots[ip];
                const perIpError = snap?.errors[ip];
                return (
                  <RobotCardView
                    key={ip}
                    ip={ip}
                    onRemove={() => removeMutation.mutate(ip)}
                    healthData={row?.health ?? undefined}
                    healthLoading={fleetLoading}
                    healthError={false}
                    healthErr={null}
                    fleetError={perIpError ?? null}
                    modulesData={row?.modules ?? null}
                    pipettesData={row?.pipettes ?? null}
                    runsData={row?.runs ?? null}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
