import { useQuery } from '@tanstack/react-query';
import { fetchRobotRuns } from '../api/robotApi';

const RUNS_REFETCH_MS = 15_000;

export function useRobotRuns(ip: string | null) {
  return useQuery({
    queryKey: ['robot', ip, 'runs'],
    queryFn: () => fetchRobotRuns(ip!),
    enabled: Boolean(ip),
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : RUNS_REFETCH_MS),
  });
}
