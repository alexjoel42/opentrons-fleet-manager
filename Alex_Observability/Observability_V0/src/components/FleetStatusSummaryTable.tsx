import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FLEET_ATTENTION_TABLE_ORDER,
  FLEET_STATUS_TRANSLATION_KEYS,
  FLEET_SUMMARY_TABLE_ORDER,
  fleetAttentionCount,
  type FleetStatusFilter,
  type RobotFleetVisualStatus,
} from '../utils/robotFleetStatus';

function countEmphasisClass(status: RobotFleetVisualStatus, n: number): string {
  if (n === 0) return 'text-muted-foreground';
  switch (status) {
    case 'failed':
    case 'unreachable':
      return 'text-[var(--color-fleet-failed-border)]';
    case 'error':
      return 'text-[var(--color-fleet-error-border)]';
    case 'awaiting-recovery':
      return 'text-[var(--color-fleet-recovery-border)]';
    case 'paused':
      return 'text-[var(--color-fleet-paused-border)]';
    default:
      return 'text-foreground';
  }
}

type Props = {
  /** Count per normalized status (from fleet snapshot). */
  counts: Record<RobotFleetVisualStatus, number>;
  /** Mirrors dashboard “Filter by status” (including `attention`). */
  fleetStatusFilter: FleetStatusFilter;
  onFleetStatusFilter: (f: FleetStatusFilter) => void;
  /** Row click: narrow to one status (e.g. only Failed). */
  onSelectStatus?: (status: RobotFleetVisualStatus) => void;
};

const ATTENTION_SET = new Set<RobotFleetVisualStatus>(FLEET_ATTENTION_TABLE_ORDER);

export function FleetStatusSummaryTable({
  counts,
  fleetStatusFilter,
  onFleetStatusFilter,
  onSelectStatus,
}: Props) {
  const { t } = useTranslation();
  const attentionTotal = fleetAttentionCount(counts);
  const attentionTableOnly = fleetStatusFilter === 'attention';
  const statusesToShow = attentionTableOnly ? FLEET_ATTENTION_TABLE_ORDER : FLEET_SUMMARY_TABLE_ORDER;

  const showAttentionCta = attentionTotal > 0 || fleetStatusFilter === 'attention';

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-normal tracking-tight text-foreground">
            {t('summary.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('summary.descriptionBefore')}{' '}
            <span className="font-medium text-foreground">{t('summary.descriptionEmphasis')}</span>{' '}
            {t('summary.descriptionAfter')}
            {attentionTableOnly && (
              <span className="mt-1 block font-medium text-foreground">
                {t('summary.attentionMatches')}
              </span>
            )}
          </p>
        </div>
        {showAttentionCta && (
          <button
            type="button"
            onClick={() =>
              fleetStatusFilter === 'attention'
                ? onFleetStatusFilter('all')
                : onFleetStatusFilter('attention')
            }
            aria-pressed={fleetStatusFilter === 'attention'}
            className={`max-w-sm rounded-lg border-2 px-3 py-1.5 text-left text-sm font-semibold transition-colors ${
              fleetStatusFilter === 'attention'
                ? 'border-border bg-card text-foreground hover:bg-muted/80'
                : 'border-[var(--color-fleet-failed-border)] bg-[var(--color-fleet-failed-bg)] text-[var(--color-fleet-failed-border)] hover:brightness-[0.98]'
            }`}
          >
            {fleetStatusFilter === 'attention' ? (
              <>{t('summary.showAll')}</>
            ) : (
              <>
                {t('summary.attentionRobots', { count: attentionTotal })}
                <span className="mt-0.5 block text-xs font-normal opacity-90">
                  {t('summary.attentionFocus')}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="fleet-summary-table w-full min-w-[320px] text-left text-sm">
          <caption className="sr-only">{t('summary.caption')}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3">
                {t('common.status')}
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                {t('common.count')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border bg-muted/40">
              <td
                colSpan={2}
                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-foreground"
              >
                {t('summary.checkFirst')}
              </td>
            </tr>
            {statusesToShow.map((status) => {
              const n = counts[status] ?? 0;
              const isAttention = ATTENTION_SET.has(status);
              const interactive = Boolean(onSelectStatus);
              return (
                <Fragment key={status}>
                  {!attentionTableOnly && status === 'running' && (
                    <tr className="border-b border-border bg-muted/30">
                      <td
                        colSpan={2}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {t('summary.normalGroup')}
                      </td>
                    </tr>
                  )}
                  <tr
                    data-fleet-status={status}
                    className={`fleet-summary-row border-b border-border/80 transition-colors last:border-b-0 ${
                      interactive ? 'cursor-pointer hover:brightness-[0.98]' : ''
                    }`}
                    onClick={interactive ? () => onSelectStatus?.(status) : undefined}
                    onKeyDown={
                      interactive
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectStatus?.(status);
                            }
                          }
                        : undefined
                    }
                    tabIndex={interactive ? 0 : undefined}
                    role={interactive ? 'button' : undefined}
                  >
                    <td className="px-4 py-2.5">
                      <span className="fleet-summary-label inline-flex items-center gap-2 font-medium text-foreground">
                        <span
                          className="fleet-legend-swatch rounded-full"
                          data-fleet-status={status}
                          aria-hidden
                        />
                        {t(FLEET_STATUS_TRANSLATION_KEYS[status])}
                      </span>
                      {isAttention && (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground sm:ml-2 sm:inline">
                          {status === 'failed' && t('summary.hintFailed')}
                          {status === 'error' && t('summary.hintError')}
                          {status === 'unreachable' && t('summary.hintUnreachable')}
                          {status === 'awaiting-recovery' && t('summary.hintRecovery')}
                          {status === 'paused' && t('summary.hintPaused')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span
                        className={`inline-block min-w-[2ch] font-semibold ${countEmphasisClass(status, n)}`}
                      >
                        {n}
                      </span>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {onSelectStatus && !attentionTableOnly && (
        <p className="mt-2 text-xs text-muted-foreground">{t('summary.rowHelp')}</p>
      )}
      {onSelectStatus && attentionTableOnly && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('summary.attentionHelp')}
        </p>
      )}
    </div>
  );
}
