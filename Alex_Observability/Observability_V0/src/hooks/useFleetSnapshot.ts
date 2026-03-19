import { useQuery } from '@tanstack/react-query';
import { fetchFleetSnapshot } from '../api/robotApi';

const STALE_MS = 10_000;
const REFETCH_MS = 20_000;

/** Single batched poll for all robots (health, modules, pipettes, runs). Use on Dashboard instead of per-card queries. */
export function useFleetSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: ['fleet', 'snapshot'],
    queryFn: fetchFleetSnapshot,
    enabled,
    staleTime: STALE_MS,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : REFETCH_MS),
  });
}
