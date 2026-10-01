import { useTranslation } from 'react-i18next';
import type { ArchivedRun, RunArchiveResponse } from '../api/robotApi';
import i18n from '../i18n';
import { deriveRunListItemFleetStatus, FLEET_STATUS_TRANSLATION_KEYS } from '../utils/robotFleetStatus';
import { formatNoteTimestamp } from '../utils/robotFormat';
import { formatRunDurationMs, formatRunLabel, runDateIso } from '../utils/runMetadata';

type ArchiveOutcome = 'successful' | 'failed' | 'stalled';

type OutcomeCounts = Record<ArchiveOutcome, number>;

type ProtocolGroup = {
  key: string;
  name: string;
  runs: ArchivedRun[];
  counts: OutcomeCounts;
};

type MonthGroup = {
  key: string;
  label: string;
  protocols: ProtocolGroup[];
  runCount: number;
};

type YearGroup = {
  key: string;
  label: string;
  months: MonthGroup[];
  runCount: number;
};

const EMPTY_COUNTS: OutcomeCounts = { successful: 0, failed: 0, stalled: 0 };

function archivedRunDateIso(run: ArchivedRun): string | null {
  return runDateIso({ startedAt: run.started_at, createdAt: run.created_at }) ?? run.first_archived_at;
}

function archivedRunVisual(run: ArchivedRun) {
  return deriveRunListItemFleetStatus({
    id: run.run_id,
    status: run.status ?? undefined,
    errors: run.errors,
  });
}

function archiveOutcome(run: ArchivedRun): ArchiveOutcome {
  const visual = archivedRunVisual(run);
  if (visual === 'succeeded') return 'successful';
  if (visual === 'failed' || visual === 'error') return 'failed';
  return 'stalled';
}

function protocolName(run: ArchivedRun): string {
  return run.protocol_file_name?.trim() || i18n.t('common.unknownProtocol');
}

function compareNewestKey(a: string, b: string): number {
  if (a === 'unknown') return 1;
  if (b === 'unknown') return -1;
  return b.localeCompare(a);
}

function bump(counts: OutcomeCounts, outcome: ArchiveOutcome) {
  counts[outcome] += 1;
}

/** All-time counts, one row per protocol. */
function protocolStats(runs: ArchivedRun[]): ProtocolGroup[] {
  const groups = new Map<string, ProtocolGroup>();
  for (const run of runs) {
    const name = protocolName(run);
    let group = groups.get(name);
    if (!group) {
      group = { key: name, name, runs: [], counts: { ...EMPTY_COUNTS } };
      groups.set(name, group);
    }
    group.runs.push(run);
    bump(group.counts, archiveOutcome(run));
  }
  return [...groups.values()].sort((a, b) => {
    const byCount = b.runs.length - a.runs.length;
    if (byCount !== 0) return byCount;
    if (a.name === i18n.t('common.unknownProtocol')) return 1;
    if (b.name === i18n.t('common.unknownProtocol')) return -1;
    return a.name.localeCompare(b.name);
  });
}

/** Year, then month, then protocol. Newest year and month first. */
function groupByYear(runs: ArchivedRun[]): YearGroup[] {
  const years = new Map<string, YearGroup>();
  const ms = (r: ArchivedRun) => Date.parse(archivedRunDateIso(r) ?? '') || 0;
  for (const run of [...runs].sort((a, b) => ms(b) - ms(a))) {
    const iso = archivedRunDateIso(run);
    const d = iso ? new Date(iso) : null;
    const valid = d != null && !Number.isNaN(d.getTime());
    const yearKey = valid ? String(d.getFullYear()) : 'unknown';
    const monthKey = valid ? `${yearKey}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'unknown';
    let year = years.get(yearKey);
    if (!year) {
      year = { key: yearKey, label: valid ? yearKey : i18n.t('common.unknownDate'), months: [], runCount: 0 };
      years.set(yearKey, year);
    }
    let month = year.months.find((m) => m.key === monthKey);
    if (!month) {
      month = {
        key: monthKey,
        label: valid
          ? d.toLocaleString(i18n.resolvedLanguage, { month: 'long' })
          : i18n.t('common.unknownDate'),
        protocols: [],
        runCount: 0,
      };
      year.months.push(month);
    }
    const name = protocolName(run);
    let protocol = month.protocols.find((p) => p.key === name);
    if (!protocol) {
      protocol = { key: name, name, runs: [], counts: { ...EMPTY_COUNTS } };
      month.protocols.push(protocol);
    }
    protocol.runs.push(run);
    bump(protocol.counts, archiveOutcome(run));
    month.runCount += 1;
    year.runCount += 1;
  }
  for (const year of years.values()) {
    year.months.sort((a, b) => compareNewestKey(a.key, b.key));
    for (const month of year.months) {
      month.protocols.sort((a, b) => {
        if (a.name === i18n.t('common.unknownProtocol')) return 1;
        if (b.name === i18n.t('common.unknownProtocol')) return -1;
        return a.name.localeCompare(b.name);
      });
    }
  }
  return [...years.values()].sort((a, b) => compareNewestKey(a.key, b.key));
}

function OutcomeStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="text-center" title={hint}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function ProtocolStatBlock({ protocols }: { protocols: ProtocolGroup[] }) {
  const { t } = useTranslation();
  return (
    <div className={`grid gap-3 border-b border-border p-5 ${protocols.length > 1 ? 'sm:grid-cols-2' : ''}`}>
      {protocols.map((protocol) => (
        <div key={protocol.key} className="rounded-xl border border-border bg-background px-4 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('archive.protocol')}
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-foreground">{protocol.name}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <OutcomeStat label={t('archive.successful')} value={protocol.counts.successful} tone="text-success" />
            <OutcomeStat label={t('status.failed')} value={protocol.counts.failed} tone="text-error" />
            <OutcomeStat
              label={t('archive.stalled')}
              value={protocol.counts.stalled}
              tone="text-foreground"
              hint={t('archive.stalledHint')}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ArchivedRunRow({ run }: { run: ArchivedRun }) {
  const { t } = useTranslation();
  const visual = archivedRunVisual(run);
  return (
    <li
      className="robot-fleet-card rounded-xl border border-border border-l-4 bg-card p-4 shadow-sm"
      data-fleet-status={visual}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="fleet-status-pill text-xs" data-fleet-status={visual} title={run.status ?? '—'}>
          {t(FLEET_STATUS_TRANSLATION_KEYS[visual])}
        </span>
      </div>
      <h4 className="mt-2 font-sans text-sm font-semibold leading-snug text-foreground">
        {formatRunLabel(run.protocol_file_name, archivedRunDateIso(run))}
      </h4>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('robotDetail.duration')}{' '}
        <span className="font-medium text-foreground">
          {run.duration_ms != null ? formatRunDurationMs(run.duration_ms) : '—'}
        </span>
      </p>
      {run.errors.map((e, i) => (
        <p
          key={i}
          className="mt-2 rounded-lg border border-error/40 bg-error-muted/30 px-3 py-2 text-xs text-error"
        >
          <span className="font-semibold">
            {t('archive.errorCode', { code: e.errorCode ? ` ${e.errorCode}` : '' })}{' '}
          </span>
          {e.detail ?? e.errorType ?? t('common.unknownError')}
        </p>
      ))}
      {run.inline_note ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('robotDetail.quickNote')}{' '}
          </span>
          {run.inline_note}
        </p>
      ) : null}
      {run.detail_note ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t('robotDetail.runNotes')}{' '}
          </span>
          {run.detail_note}
        </p>
      ) : null}
      <p className="mt-2 font-mono text-[11px] text-muted-foreground break-all" title={t('runDetail.runId')}>
        {run.run_id}
      </p>
    </li>
  );
}

export function RunArchiveSection({
  data,
  isLoading,
  isError,
}: {
  data: RunArchiveResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  const stats = protocolStats(data?.runs ?? []);
  const years = groupByYear(data?.runs ?? []);
  const lastArchived = formatNoteTimestamp(data?.last_archived_at);

  return (
    <div className="mb-8">
      <div className="mb-4">
        <h3 className="font-display text-lg font-normal tracking-tight text-foreground">{t('archive.title')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('archive.description')}
          {lastArchived ? ` ${t('archive.lastArchived', { date: lastArchived })}` : ''}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card shadow-md">
        {isLoading && !data && <p className="p-6 text-muted-foreground">{t('archive.loading')}</p>}
        {isError && <p className="p-6 text-error">{t('archive.failedLoading')}</p>}
        {data && years.length === 0 && (
          <p className="p-6 text-muted-foreground">{t('archive.empty')}</p>
        )}
        {stats.length > 0 && <ProtocolStatBlock protocols={stats} />}
        {years.length > 0 && (
          <div className="divide-y divide-border">
            {years.map((year, yearIndex) => (
              <details key={year.key} className="group" open={yearIndex === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2 font-semibold text-foreground">
                    <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                    {year.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('common.runCount', { count: year.runCount })}
                  </span>
                </summary>
                <div className="divide-y divide-border border-t border-border">
                  {year.months.map((month, monthIndex) => (
                    <details key={month.key} className="group/month" open={yearIndex === 0 && monthIndex === 0}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 pr-5 pl-10 marker:hidden [&::-webkit-details-marker]:hidden">
                        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className="text-muted-foreground transition-transform group-open/month:rotate-90">›</span>
                          {month.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t('common.runCount', { count: month.runCount })}
                        </span>
                      </summary>
                      <div className="divide-y divide-border border-t border-border">
                        {month.protocols.map((protocol) => (
                          <details key={protocol.key} className="group/protocol">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 pr-5 pl-16 marker:hidden [&::-webkit-details-marker]:hidden">
                              <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                                <span className="text-muted-foreground transition-transform group-open/protocol:rotate-90">›</span>
                                <span className="truncate">{protocol.name}</span>
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                <span className="text-success">
                                  {t('archive.successfulCount', { count: protocol.counts.successful })}
                                </span>
                                {' · '}
                                <span className="text-error">
                                  {t('archive.failedCount', { count: protocol.counts.failed })}
                                </span>
                                {' · '}
                                <span title={t('archive.stalledHint')}>
                                  {t('archive.stalledCount', { count: protocol.counts.stalled })}
                                </span>
                              </span>
                            </summary>
                            <ul className="space-y-3 pt-1 pr-5 pb-5 pl-16">
                              {protocol.runs.map((run) => (
                                <ArchivedRunRow key={run.run_id} run={run} />
                              ))}
                            </ul>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
