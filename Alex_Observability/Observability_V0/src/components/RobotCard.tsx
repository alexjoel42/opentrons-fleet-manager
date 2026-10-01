import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRobotHealth } from '../hooks/useRobotHealth';
import { useRobotModules } from '../hooks/useRobotModules';
import { useRobotPipettes } from '../hooks/useRobotPipettes';
import { useRobotRuns } from '../hooks/useRobotRuns';
import { useNotifications } from '../lib/NotificationContext';
import { formatPipettes, formatModules, orDash } from '../utils/robotFormat';
import { telemetryApiVersion, telemetryLastFailedRunInfo } from '../utils/telemetryHealth';
import {
  FLEET_STATUS_TRANSLATION_KEYS,
  deriveRobotFleetVisualStatus,
  rawRobotStatusDiffersFromLabel,
} from '../utils/robotFleetStatus';
import {
  checkoutRobot,
  createRobotFleetErrorTicket,
  defaultNotesOperatorName,
  fetchTroubleshootingZip,
  getRunDisplayName,
  releaseRobotCheckout,
  type RobotCheckoutInfo,
  type RunsResponse,
} from '../api/robotApi';

function triggerZipDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stopCardLink(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

/** Keyed by `ip` + server notes so local draft resets when saved notes load from the API (no sync effect). */
function RobotNotesEditor({
  ip,
  robotNotes,
  onSaveRobotNotes,
  isSavingRobotNotes,
}: {
  ip: string;
  robotNotes?: string | null;
  onSaveRobotNotes: (text: string) => void;
  isSavingRobotNotes?: boolean;
}) {
  const { t } = useTranslation();
  const [notesDraft, setNotesDraft] = useState(robotNotes ?? '');
  return (
    <div
      className="mb-4"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('card.notes')}
      </span>
      <textarea
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        rows={3}
        aria-label={t('card.notesAria', { ip })}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={t('card.notesPlaceholder')}
      />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const t = notesDraft.trim();
          onSaveRobotNotes(t);
        }}
        disabled={isSavingRobotNotes}
        className="mt-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
      >
        {isSavingRobotNotes ? t('common.saving') : t('card.saveNotes')}
      </button>
    </div>
  );
}

export interface RobotCardViewProps {
  ip: string;
  onRemove?: () => void;
  healthData: Record<string, unknown> | undefined | null;
  healthLoading: boolean;
  healthError: boolean;
  healthErr: Error | null;
  /** Snapshot / fleet-level error for this IP (e.g. unreachable). */
  fleetError?: string | null;
  modulesData: Array<Record<string, unknown>> | undefined | null;
  pipettesData: unknown;
  runsData: RunsResponse | null | undefined;
  /** Local fleet dashboard notes (from `GET /api/robots`); editable when `onSaveRobotNotes` is set. */
  robotNotes?: string | null;
  onSaveRobotNotes?: (text: string) => void;
  isSavingRobotNotes?: boolean;
  /** Shared cooperative checkout (fleet server). */
  checkout?: RobotCheckoutInfo | null;
  /** Show sign-in / sign-out controls (Dashboard fleet cards). */
  enableCheckout?: boolean;
}

/** Presentational fleet card; used by Dashboard with snapshot data or by RobotCard with live hooks. */
export function RobotCardView({
  ip,
  onRemove,
  healthData,
  healthLoading,
  healthError,
  healthErr,
  fleetError,
  modulesData,
  pipettesData,
  runsData,
  robotNotes,
  onSaveRobotNotes,
  isSavingRobotNotes,
  checkout,
  enableCheckout = false,
}: RobotCardViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { addNotification } = useNotifications();
  const [zipPending, setZipPending] = useState(false);
  const [operatorName, setOperatorName] = useState(defaultNotesOperatorName);
  const lastNotifiedRunId = useRef<string | null>(null);
  const lastNotifiedPaused = useRef(false);
  const lastNotifiedError = useRef(false);

  const runsList = Array.isArray(runsData?.data) ? runsData.data : [];
  const currentRun = runsList.find((r) => r.current);
  const hasRunError = currentRun?.errors && currentRun.errors.length > 0;
  const runStatus = (currentRun?.status ?? '').toLowerCase();
  const isPaused = runStatus === 'paused';

  const serial =
    healthData?.serial_number != null
      ? String(healthData.serial_number)
      : healthData?.robot_serial != null
        ? String(healthData.robot_serial)
        : null;

  useEffect(() => {
    if (!currentRun?.id) {
      lastNotifiedRunId.current = null;
      lastNotifiedPaused.current = false;
      lastNotifiedError.current = false;
      return;
    }
    const runId = currentRun.id;
    if (lastNotifiedRunId.current !== runId) {
      lastNotifiedRunId.current = runId;
      lastNotifiedPaused.current = false;
      lastNotifiedError.current = false;
    }
    if (isPaused && !lastNotifiedPaused.current) {
      lastNotifiedPaused.current = true;
      addNotification({
        type: 'paused',
        title: t('card.runPausedTitle'),
        message: t('card.runPausedMessage'),
        robotSerial: serial ?? null,
        robotIp: ip,
      });
    }
    if (hasRunError && !lastNotifiedError.current) {
      lastNotifiedError.current = true;
      const firstError = currentRun.errors?.[0];
      const detail = firstError?.detail ?? firstError?.errorType ?? t('card.runError');
      addNotification({
        type: 'error',
        title: t('card.runError'),
        message: `${detail}`,
        robotSerial: serial ?? null,
        robotIp: ip,
      });
    }
  }, [currentRun, isPaused, hasRunError, serial, ip, addNotification, t]);

  const visualStatus = deriveRobotFleetVisualStatus({
    fleetError: fleetError ?? null,
    healthLoading,
    healthError,
    healthData: healthData ?? null,
    runsData: runsData ?? null,
  });

  let message = '';
  if (fleetError) {
    message = fleetError;
  } else if (healthLoading && !healthData) {
    message = t('common.loading');
  } else if (healthError && healthErr) {
    message = healthErr instanceof Error ? healthErr.message : t('common.error');
  } else if (healthData?.status) {
    message = String(healthData.status);
  }

  const robotName = orDash(healthData?.name);
  const titleText = robotName !== '—' ? `${robotName} · ${ip}` : ip;
  const softwareVersion = telemetryApiVersion(healthData ?? null);
  const lastFailedInfo = telemetryLastFailedRunInfo(runsData ?? null, t('common.unknownProtocol'));
  const pipetteLines = pipettesData != null ? formatPipettes(pipettesData) : [];
  const moduleLines = Array.isArray(modulesData) ? formatModules(modulesData) : [];

  const handleDownloadZip = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (zipPending) return;
    setZipPending(true);
    fetchTroubleshootingZip(ip, currentRun?.id)
      .then((blob) => triggerZipDownload(blob, 'troubleshooting.zip'))
      .finally(() => setZipPending(false));
  };

  const checkoutMutation = useMutation({
    mutationFn: () => {
      const operator = operatorName.trim();
      if (!operator) throw new Error(t('card.enterName'));
      return checkoutRobot(ip, operator);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: () => releaseRobotCheckout(ip),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
    },
  });

  const ticketMutation = useMutation({
    mutationFn: () => {
      if (!currentRun?.id) throw new Error(t('card.noRunToAttach'));
      return createRobotFleetErrorTicket(ip, currentRun.id);
    },
  });

  const isError = visualStatus === 'unreachable' || visualStatus === 'failed' || visualStatus === 'error';
  const isUnreachable = visualStatus === 'unreachable';

  return (
    <Link
      to={`/robot/${encodeURIComponent(ip)}`}
      className="robot-card-link group block min-w-0"
      onClick={(e) => {
        const sel = window.getSelection();
        if (sel?.toString()) e.preventDefault();
      }}
    >
      <div
        className="robot-fleet-card relative min-w-0 overflow-x-auto overflow-y-visible rounded-lg border border-border border-l-4 bg-card p-5 shadow-md transition-all duration-200 hover:shadow-md dark:border-border"
        data-fleet-status={visualStatus}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <span className="font-sans text-sm font-semibold tracking-tight text-foreground">
            {titleText}
            {serial != null && (
              <span className="font-normal text-muted-foreground"> · {serial}</span>
            )}
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }}
              aria-label={t('card.removeAria', { ip })}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('common.remove')}
            </button>
          )}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className="fleet-status-pill"
            data-fleet-status={visualStatus}
            aria-label={t('card.statusAria', { status: t(FLEET_STATUS_TRANSLATION_KEYS[visualStatus]) })}
          >
            {t(FLEET_STATUS_TRANSLATION_KEYS[visualStatus])}
          </span>
          {message &&
            !fleetError &&
            visualStatus !== 'loading' &&
            rawRobotStatusDiffersFromLabel(message, visualStatus) && (
              <span className="text-sm text-muted-foreground">{message}</span>
            )}
          {fleetError && (
            <p className="text-sm text-error" role="status">
              {message}
            </p>
          )}
          {healthError && healthErr && !fleetError && (
            <p className="text-sm text-error" role="status">
              {message}
            </p>
          )}
          {softwareVersion ? (
            <span className="text-xs text-muted-foreground" title={t('card.softwareTitle')}>
              {t('card.software', { version: softwareVersion })}
            </span>
          ) : null}
        </div>
        {enableCheckout && (
          <div
            className="mb-4 rounded-lg border border-border bg-muted/25 p-3"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('card.session')}
            </span>
            {checkout ? (
              <div className="space-y-2">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{t('card.signedIn')}</span> {checkout.operator}
                </p>
                <p className="text-xs text-muted-foreground">{t('card.since', { date: checkout.since })}</p>
                <button
                  type="button"
                  disabled={releaseMutation.isPending}
                  onClick={() => releaseMutation.mutate()}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60"
                >
                  {releaseMutation.isPending ? t('card.signingOut') : t('card.signOut')}
                </button>
                {releaseMutation.isError && (
                  <p className="text-xs text-error" role="alert">
                    {releaseMutation.error instanceof Error ? releaseMutation.error.message : t('card.releaseFailed')}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor={`operator-${ip}`} className="sr-only">
                  {t('card.yourName')}
                </label>
                <input
                  id={`operator-${ip}`}
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder={t('card.yourName')}
                  autoComplete="name"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  disabled={checkoutMutation.isPending}
                  onClick={() => checkoutMutation.mutate()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-95 disabled:opacity-60"
                >
                  {checkoutMutation.isPending ? t('card.signingIn') : t('card.signIn')}
                </button>
                {checkoutMutation.isError && (
                  <p className="text-xs text-error" role="alert">
                    {checkoutMutation.error instanceof Error
                      ? checkoutMutation.error.message
                      : t('card.signInFailed')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="mb-4">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('common.run')}
          </span>
          {currentRun ? (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm text-foreground">
                <span className="text-muted-foreground">{t('card.current')} </span>
                {getRunDisplayName(currentRun, t('common.unknownProtocol'))}
                <span className="text-muted-foreground"> ({currentRun.status ?? '—'})</span>
              </p>
              <Link
                to={`/robot/${encodeURIComponent(ip)}/runs/${encodeURIComponent(currentRun.id)}`}
                className="shrink-0 rounded-lg border border-accent/35 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                {t('common.view')}
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('card.noCurrentRun')}</p>
          )}
          {lastFailedInfo ? (
            <div className="mt-3 rounded-lg border border-border/90 bg-muted/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fleet-failed-border)]">
                    {t('card.lastFailed')}
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
                <Link
                  to={`/robot/${encodeURIComponent(ip)}/runs/${encodeURIComponent(lastFailedInfo.runId)}`}
                  className="shrink-0 rounded-lg border border-accent/35 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t('common.view')}
                </Link>
              </div>
            </div>
          ) : null}
          {(hasRunError || currentRun?.id) && (
            <div
              className="mt-2 flex flex-wrap gap-2"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={stopCardLink}
            >
              {hasRunError && (
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={zipPending}
                  aria-label={t('common.downloadTroubleshootingZip')}
                  className="inline-block rounded-lg border border-accent bg-transparent px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  {zipPending ? t('common.downloading') : t('common.downloadTroubleshootingZip')}
                </button>
              )}
              {currentRun?.id && (
                <button
                  type="button"
                  onClick={() => ticketMutation.mutate()}
                  disabled={ticketMutation.isPending || isUnreachable}
                  className="inline-block rounded-lg border border-accent bg-transparent px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  {ticketMutation.isPending ? t('common.creatingTicket') : t('common.makeJiraTicket')}
                </button>
              )}
            </div>
          )}
          {ticketMutation.isError && (
            <p className="mt-2 text-xs text-error" role="alert" onClick={stopCardLink}>
              {ticketMutation.error instanceof Error
                ? ticketMutation.error.message
                : t('common.ticketCreationFailed')}
            </p>
          )}
          {ticketMutation.isSuccess ? (
            <p className="mt-2 text-xs text-muted-foreground" role="status" onClick={stopCardLink}>
              <a
                href={ticketMutation.data.issue_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent underline"
                onClick={stopCardLink}
              >
                {ticketMutation.data.issue_key}
              </a>
            </p>
          ) : null}
        </div>
        {onSaveRobotNotes != null && (
          <RobotNotesEditor
            key={`${ip}-${robotNotes ?? ''}`}
            ip={ip}
            robotNotes={robotNotes}
            onSaveRobotNotes={onSaveRobotNotes}
            isSavingRobotNotes={isSavingRobotNotes}
          />
        )}
        {pipetteLines.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('robotDetail.pipettes')}
            </span>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {pipetteLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {moduleLines.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('robotDetail.modules')}
            </span>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {moduleLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {isError && (
          <span className="mt-2 inline-block text-sm font-medium text-accent group-hover:underline">
            {t('card.viewDetails')}
          </span>
        )}
      </div>
    </Link>
  );
}

interface RobotCardProps {
  ip: string;
  onRemove?: () => void;
}

/** Per-robot polling (legacy path). Prefer fleet snapshot on Dashboard via `RobotCardView`. */
export function RobotCard({ ip, onRemove }: RobotCardProps) {
  const health = useRobotHealth(ip);
  const modules = useRobotModules(ip);
  const pipettes = useRobotPipettes(ip);
  const runs = useRobotRuns(ip);

  const { data: healthData, isLoading: healthLoading, isError: healthError, error: healthErr } = health;
  const { data: modulesData } = modules;
  const { data: pipettesData } = pipettes;

  return (
    <RobotCardView
      ip={ip}
      onRemove={onRemove}
      healthData={healthData}
      healthLoading={healthLoading}
      healthError={healthError}
      healthErr={healthErr instanceof Error ? healthErr : null}
      modulesData={modulesData}
      pipettesData={pipettesData}
      runsData={runs.data}
    />
  );
}
