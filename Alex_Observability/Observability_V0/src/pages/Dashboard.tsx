import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRobotList, useFleetSnapshot, useDashboards } from '../hooks';
import { RobotCardView } from '../components/RobotCard';
import { FleetStatusSummaryTable } from '../components/FleetStatusSummaryTable';
import { ImportRobotIps } from '../components/ImportRobotIps';
import { addRobotIp, patchRobotNotes, removeRobotIp, saveDashboards } from '../api/robotApi';
import type { DashboardsResponse, FleetSnapshotResponse } from '../api/robotApi';
import {
  FLEET_FILTER_OPTIONS,
  deriveRobotFleetVisualStatus,
  isRobotFleetAttentionStatus,
  type FleetStatusFilter,
  type RobotFleetVisualStatus,
} from '../utils/robotFleetStatus';
import { orDash } from '../utils/robotFormat';

const ALL_DASHBOARD = 'all';

/** Display name from fleet health for the assignment table (full snapshot loads all IPs). */
function assignTableRobotName(
  ip: string,
  snap: FleetSnapshotResponse | undefined,
  fleetLoading: boolean,
): string {
  const row = snap?.robots[ip];
  const err = snap?.errors[ip];
  if (row?.health != null && typeof row.health === 'object') {
    const name = orDash((row.health as Record<string, unknown>).name);
    if (name !== '—') return name;
  }
  if (err) return 'Unreachable';
  if (fleetLoading && !snap) return 'Loading…';
  return '—';
}

function isDashboardSlug(s: string): boolean {
  if (!s || s.length > 64) return false;
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

export function Dashboard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useRobotList();
  const [newIp, setNewIp] = useState('');
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');
  const [dashboardTab, setDashboardTab] = useState<string>(ALL_DASHBOARD);
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [extraDashboardSlugs, setExtraDashboardSlugs] = useState<string[]>([]);
  const [newSlugInput, setNewSlugInput] = useState('');

  const ips = useMemo(() => data?.ips ?? [], [data?.ips]);
  const notesByIp = data?.notes ?? {};
  const dashQuery = useDashboards(ips.length > 0);
  const dashData = dashQuery.data;

  const slugKeys = useMemo(() => {
    const keys = new Set<string>([...Object.keys(dashData?.dashboards ?? {}), ...extraDashboardSlugs]);
    const ord = [...(dashData?.order ?? [])];
    return [...keys].sort((a, b) => {
      const ia = ord.indexOf(a);
      const ib = ord.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [dashData, extraDashboardSlugs]);

  useEffect(() => {
    if (dashboardTab !== ALL_DASHBOARD && slugKeys.length > 0 && !slugKeys.includes(dashboardTab)) {
      setDashboardTab(ALL_DASHBOARD);
    }
  }, [slugKeys, dashboardTab]);

  useEffect(() => {
    if (!dashData || ips.length === 0) return;
    const inv: Record<string, string> = {};
    for (const ip of ips) inv[ip] = '';
    for (const [slug, list] of Object.entries(dashData.dashboards)) {
      for (const ip of list) {
        if (ips.includes(ip)) inv[ip] = slug;
      }
    }
    setAssignDraft(inv);
    setExtraDashboardSlugs([]);
  }, [dashData, ips]);

  const scopedIps = useMemo(() => {
    if (dashboardTab === ALL_DASHBOARD) return ips;
    return dashData?.dashboards[dashboardTab] ?? [];
  }, [dashboardTab, ips, dashData]);

  /** Always load the full fleet snapshot so assignment rows can show every robot's name from health. */
  const fleetHasRobots = ips.length > 0;

  const fleet = useFleetSnapshot(fleetHasRobots, null);

  const addMutation = useMutation({
    mutationFn: (ip: string) => addRobotIp(ip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      setNewIp('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (ip: string) => removeRobotIp(ip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: ({ ip, text }: { ip: string; text: string }) =>
      patchRobotNotes(ip, text.trim() ? text.trim() : null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
    },
  });

  const saveDashboardsMutation = useMutation({
    mutationFn: (body: DashboardsResponse) => saveDashboards(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const ip = newIp.trim();
    if (!ip) return;
    addMutation.mutate(ip);
  };

  const buildDashboardPayload = useCallback((): DashboardsResponse => {
    const dashboards: Record<string, string[]> = {};
    for (const s of extraDashboardSlugs) {
      if (!dashboards[s]) dashboards[s] = [];
    }
    for (const ip of ips) {
      const slug = assignDraft[ip]?.trim();
      if (!slug) continue;
      if (!dashboards[slug]) dashboards[slug] = [];
      dashboards[slug].push(ip);
    }
    const order = [...(dashData?.order ?? [])];
    for (const s of Object.keys(dashboards)) {
      if (!order.includes(s)) order.push(s);
    }
    for (const s of extraDashboardSlugs) {
      if (!order.includes(s)) order.push(s);
    }
    return { dashboards, order };
  }, [assignDraft, dashData?.order, extraDashboardSlugs, ips]);

  const handleAddSlug = () => {
    const s = newSlugInput.trim();
    if (!isDashboardSlug(s)) return;
    if (slugKeys.includes(s)) return;
    setExtraDashboardSlugs((prev) => (prev.includes(s) ? prev : [...prev, s]));
    setNewSlugInput('');
  };

  const snap = fleet.data;
  const fleetQueryError =
    fleet.isError && fleet.error instanceof Error
      ? fleet.error.message
      : fleet.isError
        ? 'Failed to load fleet data'
        : null;
  const fleetLoading = fleetHasRobots && fleet.isLoading && !snap;
  const fleetFirstLoadFailed = fleetHasRobots && fleet.isError && !snap && ips.length > 0;

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
    [snap, fleetLoading],
  );

  const viewIps = scopedIps;

  const filteredIps = useMemo(() => {
    if (statusFilter === 'all') return viewIps;
    if (statusFilter === 'attention') {
      return viewIps.filter((ip) => isRobotFleetAttentionStatus(statusForIp(ip)));
    }
    return viewIps.filter((ip) => statusForIp(ip) === statusFilter);
  }, [viewIps, statusFilter, statusForIp]);

  const filterCounts = useMemo(() => {
    const m: Partial<Record<FleetStatusFilter, number>> = { all: viewIps.length };
    m.attention = viewIps.filter((ip) => isRobotFleetAttentionStatus(statusForIp(ip))).length;
    for (const opt of FLEET_FILTER_OPTIONS) {
      if (opt.value === 'all' || opt.value === 'attention') continue;
      m[opt.value] = viewIps.filter((ip) => statusForIp(ip) === opt.value).length;
    }
    return m as Record<FleetStatusFilter, number>;
  }, [viewIps, statusForIp]);

  const visualCounts = useMemo((): Record<RobotFleetVisualStatus, number> => {
    const o = {} as Record<RobotFleetVisualStatus, number>;
    for (const opt of FLEET_FILTER_OPTIONS) {
      if (opt.value === 'all' || opt.value === 'attention') continue;
      o[opt.value] = filterCounts[opt.value] ?? 0;
    }
    return o;
  }, [filterCounts]);

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

  const checkouts = snap?.checkouts;

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
          <section className="mb-10" aria-label="Assign robots to dashboards">
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <p className="mb-3 text-sm font-medium text-foreground">Assign robots to dashboards</p>
              <p className="mb-4 text-xs text-muted-foreground">
                Each robot can belong to at most one dashboard (or none). Saving updates everyone using this server.
              </p>
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                  <label htmlFor="new-dash-slug" className="text-xs text-muted-foreground">
                    New dashboard id
                  </label>
                  <input
                    id="new-dash-slug"
                    type="text"
                    value={newSlugInput}
                    onChange={(e) => setNewSlugInput(e.target.value)}
                    placeholder="e.g. dev, qa, abr"
                    className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddSlug}
                  className="h-10 rounded-lg border border-border bg-muted/40 px-4 text-sm font-medium hover:bg-muted"
                >
                  Add dashboard
                </button>
                <button
                  type="button"
                  disabled={saveDashboardsMutation.isPending}
                  onClick={() => saveDashboardsMutation.mutate(buildDashboardPayload())}
                  className="h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-foreground hover:opacity-95 disabled:opacity-60"
                >
                  {saveDashboardsMutation.isPending ? 'Saving…' : 'Save assignments'}
                </button>
              </div>
              {saveDashboardsMutation.isError && (
                <p className="mb-3 text-sm text-error" role="alert">
                  {saveDashboardsMutation.error instanceof Error
                    ? saveDashboardsMutation.error.message
                    : 'Save failed'}
                </p>
              )}
              <div className="max-h-[320px] overflow-auto rounded-md border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 font-medium text-foreground">Robot IP</th>
                      <th className="px-3 py-2 font-medium text-foreground">Robot name</th>
                      <th className="px-3 py-2 font-medium text-foreground">Dashboard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ips.map((ip) => {
                      const robotLabel = assignTableRobotName(ip, snap, fleetLoading);
                      return (
                      <tr key={ip} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs text-foreground">{ip}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-foreground" title={robotLabel}>
                          {robotLabel}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={assignDraft[ip] ?? ''}
                            onChange={(e) =>
                              setAssignDraft((prev) => ({ ...prev, [ip]: e.target.value }))
                            }
                            aria-label={`Dashboard for ${robotLabel !== '—' ? `${robotLabel} ` : ''}${ip}`}
                            className="w-full max-w-[240px] rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">Unassigned</option>
                            {slugKeys.map((slug) => (
                              <option key={slug} value={slug}>
                                {slug}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

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
                {viewIps.length} robot{viewIps.length !== 1 ? 's' : ''} in this view
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

          <section className="mb-6" aria-label="Filter fleet by dashboard">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Filter by dashboard
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDashboardTab(ALL_DASHBOARD)}
                aria-pressed={dashboardTab === ALL_DASHBOARD}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  dashboardTab === ALL_DASHBOARD
                    ? 'border-accent bg-accent/12 text-accent shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:border-accent/35 hover:text-foreground'
                }`}
              >
                All
                <span className="ml-1.5 tabular-nums text-muted-foreground">({ips.length})</span>
              </button>
              {slugKeys.map((slug) => {
                const n = dashData?.dashboards[slug]?.length ?? 0;
                const selected = dashboardTab === slug;
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => setDashboardTab(slug)}
                    aria-pressed={selected}
                    className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? 'border-accent bg-accent/12 text-accent shadow-sm'
                        : 'border-border bg-card text-muted-foreground hover:border-accent/35 hover:text-foreground'
                    }`}
                  >
                    {slug}
                    <span className="ml-1.5 tabular-nums text-muted-foreground">({n})</span>
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
          {dashboardTab !== ALL_DASHBOARD && scopedIps.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-6 py-8 text-center text-muted-foreground">
              No robots in this dashboard yet. Assign IPs above and click Save assignments.
            </p>
          ) : fleetFirstLoadFailed ? (
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
                    enableCheckout
                    checkout={checkouts?.[ip] ?? null}
                    onRemove={() => removeMutation.mutate(ip)}
                    healthData={row?.health ?? undefined}
                    healthLoading={fleetLoading}
                    healthError={false}
                    healthErr={null}
                    fleetError={perIpError ?? null}
                    modulesData={row?.modules ?? null}
                    pipettesData={row?.pipettes ?? null}
                    runsData={row?.runs ?? null}
                    robotNotes={notesByIp[ip] ?? null}
                    onSaveRobotNotes={(text) => saveNotesMutation.mutate({ ip, text })}
                    isSavingRobotNotes={
                      saveNotesMutation.isPending && saveNotesMutation.variables?.ip === ip
                    }
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
