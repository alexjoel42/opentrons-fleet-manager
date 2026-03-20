import { useQuery } from '@tanstack/react-query';
import { fetchFleetSnapshot } from '../api/robotApi';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';

/** Single batched poll for all robots (health, modules, pipettes, runs). Use on Dashboard instead of per-card queries. */
export function useFleetSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: ['fleet', 'snapshot'],
    queryFn: fetchFleetSnapshot,
    enabled,
    staleTime: UI_POLL_INTERVAL_MS,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : UI_POLL_INTERVAL_MS),
  });
}
