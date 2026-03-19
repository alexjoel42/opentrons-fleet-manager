import { useQuery } from '@tanstack/react-query';
import { fetchRobotPipettes } from '../api/robotApi';

export function useRobotPipettes(ip: string | null) {
  return useQuery({
    queryKey: ['robot', ip, 'pipettes'],
    queryFn: () => fetchRobotPipettes(ip!),
    enabled: Boolean(ip),
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 10_000),
  });
}
