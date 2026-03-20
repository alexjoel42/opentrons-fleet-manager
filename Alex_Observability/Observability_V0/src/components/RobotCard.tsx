import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRobotHealth } from '../hooks/useRobotHealth';
import { useRobotModules } from '../hooks/useRobotModules';
import { useRobotPipettes } from '../hooks/useRobotPipettes';
import { useRobotRuns } from '../hooks/useRobotRuns';
import { useNotifications } from '../lib/NotificationContext';
import { formatPipettes, formatModules, orDash } from '../utils/robotFormat';
import {
  FLEET_STATUS_LABELS,
  deriveRobotFleetVisualStatus,
  rawRobotStatusDiffersFromLabel,
} from '../utils/robotFleetStatus';
import { fetchTroubleshootingZip, type RunsResponse } from '../api/robotApi';

function triggerZipDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
}: RobotCardViewProps) {
  const { addNotification } = useNotifications();
  const [zipPending, setZipPending] = useState(false);
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
        title: 'Run paused',
        message: `A run is paused on this robot.`,
        robotSerial: serial ?? null,
        robotIp: ip,
      });
    }
    if (hasRunError && !lastNotifiedError.current) {
      lastNotifiedError.current = true;
      const firstError = currentRun.errors?.[0];
      const detail = firstError?.detail ?? firstError?.errorType ?? 'Run error';
      addNotification({
        type: 'error',
        title: 'Run error',
        message: `${detail}`,
        robotSerial: serial ?? null,
        robotIp: ip,
      });
    }
  }, [currentRun?.id, isPaused, hasRunError, serial, ip, addNotification]);

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
    message = 'Loading…';
  } else if (healthError && healthErr) {
    message = healthErr instanceof Error ? healthErr.message : 'Error';
  } else if (healthData?.status) {
    message = String(healthData.status);
  }

  const robotName = orDash(healthData?.name);
  const titleText = robotName !== '—' ? `${robotName} · ${ip}` : ip;
  const pipetteLines = pipettesData != null ? formatPipettes(pipettesData) : [];
  const moduleLines = Array.isArray(modulesData) ? formatModules(modulesData) : [];
  const runLabel = currentRun
    ? `Current run: ${currentRun.protocolId ?? currentRun.id ?? '—'} (${currentRun.status ?? '—'})`
    : 'No current run';

  const handleDownloadZip = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (zipPending) return;
    setZipPending(true);
    fetchTroubleshootingZip(ip, currentRun?.id)
      .then((blob) => triggerZipDownload(blob, 'troubleshooting.zip'))
      .finally(() => setZipPending(false));
  };

  const isError = visualStatus === 'unreachable' || visualStatus === 'failed' || visualStatus === 'error';

  return (
    <Link to={`/robot/${encodeURIComponent(ip)}`} className="robot-card-link group block">
      <div
        className="robot-fleet-card relative overflow-hidden rounded-lg border border-border border-l-4 bg-card p-5 shadow-md transition-all duration-200 hover:shadow-md dark:border-border"
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
              aria-label={`Remove robot ${ip}`}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Remove
            </button>
          )}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className="fleet-status-pill"
            data-fleet-status={visualStatus}
            aria-label={`Status: ${FLEET_STATUS_LABELS[visualStatus]}`}
          >
            {FLEET_STATUS_LABELS[visualStatus]}
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
        </div>
        <div className="mb-4">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Run
          </span>
          <span className="block text-sm text-foreground">{runLabel}</span>
          {hasRunError && (
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={zipPending}
              aria-label="Download troubleshooting zip"
              className="mt-2 inline-block rounded-lg border border-accent bg-transparent px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {zipPending ? 'Downloading…' : 'Download troubleshooting zip'}
            </button>
          )}
        </div>
        {pipetteLines.length > 0 && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pipettes
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
              Modules
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
            View details →
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
