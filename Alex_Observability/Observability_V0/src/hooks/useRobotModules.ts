import { useQuery } from '@tanstack/react-query';
import { fetchRobotModules } from '../api/robotApi';
import { UI_POLL_INTERVAL_MS } from '../lib/queryPollMs';

export function useRobotModules(ip: string | null) {
  return useQuery({
    queryKey: ['robot', ip, 'modules'],
    queryFn: () => fetchRobotModules(ip!),
    enabled: Boolean(ip),
    staleTime: UI_POLL_INTERVAL_MS,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : UI_POLL_INTERVAL_MS),
  });
}
