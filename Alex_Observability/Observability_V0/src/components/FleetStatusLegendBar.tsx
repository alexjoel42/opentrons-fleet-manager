import {
  FLEET_HEADER_LEGEND_ORDER,
  FLEET_STATUS_LABELS,
  type RobotFleetVisualStatus,
} from '../utils/robotFleetStatus';

type Props = {
  className?: string;
};

/**
 * Color key for the app header — same palette as fleet cards (see `data-fleet-status` in CSS).
 */
export function FleetStatusLegendBar({ className = '' }: Props) {
  return (
    <div
      className={`fleet-status-legend-bar flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 ${className}`}
      aria-label="Fleet status color key"
    >
      {FLEET_HEADER_LEGEND_ORDER.map((s: RobotFleetVisualStatus) => (
        <span
          key={s}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium leading-tight text-muted-foreground"
        >
          <span
            className="fleet-legend-swatch shrink-0 rounded-full"
            data-fleet-status={s}
            aria-hidden
          />
          {FLEET_STATUS_LABELS[s]}
        </span>
      ))}
    </div>
  );
}
