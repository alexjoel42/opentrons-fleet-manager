import { useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  fetchRobotRun,
  fetchRobotRunProtocolFileName,
  fetchRobotRuns,
  mainProtocolFileNameFromRunData,
} from '../api/robotApi';
import type { RunListItem } from '../api/robotApi';
import { orDash } from '../utils/robotFormat';
import {
  averageSuccessfulRunWallClock,
  firstRunErrorLine,
  formatRunDurationMs,
  runWallClockDurationMs,
} from '../utils/runMetadata';

/**
 * Get run by ID (Opentrons GET /runs/{runId}). Shows protocol file name, status, and full run payload.
 */
export function RunDetail() {
  const { t } = useTranslation();
  const { ip, runId } = useParams<{ ip: string; runId: string }>();
  const navigate = useNavigate();
  const { data: runPayload, isLoading, isError, error } = useQuery({
    queryKey: ['robot', ip, 'runs', runId],
    queryFn: () => (ip && runId ? fetchRobotRun(ip, runId) : Promise.reject(new Error(t('runDetail.missing')))),
    enabled: Boolean(ip && runId),
  });
  const { data: protocolNamePayload } = useQuery({
    queryKey: ['robot', ip, 'runs', runId, 'protocol-name'],
    queryFn: () =>
      ip && runId
        ? fetchRobotRunProtocolFileName(ip, runId)
        : Promise.reject(new Error(t('runDetail.missing'))),
    enabled: Boolean(ip && runId),
  });

  const { data: runsListPayload, isLoading: runsListLoading } = useQuery({
    queryKey: ['robot', ip, 'runs'],
    queryFn: () => (ip ? fetchRobotRuns(ip) : Promise.reject(new Error(t('robotDetail.missingIp')))),
    enabled: Boolean(ip),
  });

  const raw = runPayload as Record<string, unknown> | undefined;
  const run = raw?.data != null ? raw.data : raw;
  const runObj =
    run != null && typeof run === 'object' && !Array.isArray(run) ? (run as Record<string, unknown>) : null;
  const protocolFileName =
    protocolNamePayload?.protocolFileName?.trim() ||
    mainProtocolFileNameFromRunData(runObj) ||
    null;
  const runHeadline = protocolFileName ?? runId ?? '';

  const runForMeta: RunListItem | null =
    runObj != null && runId
      ? ({
          id: runId,
          startedAt: typeof runObj.startedAt === 'string' ? runObj.startedAt : undefined,
          completedAt: typeof runObj.completedAt === 'string' ? runObj.completedAt : undefined,
          status: typeof runObj.status === 'string' ? runObj.status : undefined,
          errors: Array.isArray(runObj.errors) ? (runObj.errors as RunListItem['errors']) : undefined,
          ok: typeof runObj.ok === 'boolean' ? runObj.ok : undefined,
          hasEverEnteredErrorRecovery:
            typeof runObj.hasEverEnteredErrorRecovery === 'boolean'
              ? runObj.hasEverEnteredErrorRecovery
              : undefined,
        } satisfies RunListItem)
      : null;
  const wallMs = runForMeta ? runWallClockDurationMs(runForMeta) : null;
  const errLine = runForMeta ? firstRunErrorLine(runForMeta) : null;

  const robotSuccessfulRunAvg = useMemo(() => {
    const raw = runsListPayload?.data;
    if (!Array.isArray(raw)) return null;
    const deduped = (raw as RunListItem[]).filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
    return averageSuccessfulRunWallClock(deduped);
  }, [runsListPayload]);

  if (!ip || !runId) {
    return (
      <div className="max-w-3xl">
        <p className="text-muted-foreground">{t('runDetail.missing')}</p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('common.backToDashboard')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link
          to={`/robot/${encodeURIComponent(ip)}`}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('runDetail.backToRobot')}
        </Link>
        <h1 className="font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
          {t('runDetail.title', { name: orDash(runHeadline) })}
        </h1>
      </div>

      {isLoading && <p className="text-muted-foreground">{t('runDetail.loading')}</p>}

      {isError && error && (
        <div className="mb-6 rounded-xl border border-error/50 bg-error-muted/50 p-4 text-error">
          <strong>{t('common.errorLabel')}</strong> {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {!isLoading && !isError && runPayload == null && (
        <p className="text-muted-foreground">{t('runDetail.noData')}</p>
      )}

      {!isLoading && runPayload != null && (
        <>
          {runObj != null && (
            <section className="mb-8">
              <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">{t('robotDetail.summary')}</h2>
              <div className="rounded-xl border border-border bg-card p-5 shadow-md">
                <div className="space-y-2">
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">{t('runDetail.protocolFile')}</span>
                    <span>{orDash(protocolFileName)}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">{t('runDetail.runId')}</span>
                    <span className="font-mono text-sm">{runId}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">{t('common.status')}</span>
                    <span>{orDash(runObj.status)}</span>
                  </div>
                  {runObj.createdAt != null && (
                    <div className="flex gap-3">
                      <span className="min-w-[6rem] text-sm text-muted-foreground">{t('runDetail.created')}</span>
                      <span>{orDash(runObj.createdAt)}</span>
                    </div>
                  )}
                  {runObj.startedAt != null && (
                    <div className="flex gap-3">
                      <span className="min-w-[6rem] text-sm text-muted-foreground">{t('runDetail.started')}</span>
                      <span>{orDash(runObj.startedAt)}</span>
                    </div>
                  )}
                  {runObj.completedAt != null && (
                    <div className="flex gap-3">
                      <span className="min-w-[6rem] text-sm text-muted-foreground">{t('runDetail.completed')}</span>
                      <span>{orDash(runObj.completedAt)}</span>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">{t('runDetail.duration')}</span>
                    <span>
                      {wallMs != null
                        ? formatRunDurationMs(wallMs)
                        : t('runDetail.missingDuration')}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[6rem] text-sm text-muted-foreground">
                      {t('runDetail.averageSuccessfulRun')}
                    </span>
                    <span>
                      {runsListLoading && !runsListPayload
                        ? '…'
                        : robotSuccessfulRunAvg
                          ? t('robotDetail.averageWithCount', {
                              duration: formatRunDurationMs(robotSuccessfulRunAvg.averageMs),
                              count: robotSuccessfulRunAvg.count,
                            })
                          : '—'}
                    </span>
                  </div>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {t('runDetail.durationHelp')}
                  </p>
                  {errLine ? (
                    <div className="rounded-lg border border-error/40 bg-error-muted/30 px-3 py-2 text-sm text-error">
                      <span className="font-semibold">{t('common.errorLabel')} </span>
                      {errLine}
                    </div>
                  ) : null}
                  {runObj.current != null && (
                    <div className="flex gap-3">
                      <span className="min-w-[6rem] text-sm text-muted-foreground">{t('common.current')}</span>
                      <span>{runObj.current ? t('common.yes') : t('common.no')}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="mb-8" aria-label={t('runDetail.displayProtocol')}>
            <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">
              {t('runDetail.displayProtocol')}
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 shadow-md">
              <p className="font-mono text-sm break-all text-foreground">{orDash(protocolFileName)}</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 font-sans text-lg font-semibold text-foreground">{t('runDetail.rawRun')}</h2>
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
