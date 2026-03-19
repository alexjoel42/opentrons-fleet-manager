import { useQuery } from '@tanstack/react-query';
import { fetchRobotModules } from '../api/robotApi';

export function useRobotModules(ip: string | null) {
  return useQuery({
    queryKey: ['robot', ip, 'modules'],
    queryFn: () => fetchRobotModules(ip!),
    enabled: Boolean(ip),
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 10_000),
  });
}
