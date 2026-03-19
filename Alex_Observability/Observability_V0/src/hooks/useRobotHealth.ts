import { useQuery } from '@tanstack/react-query';
import { fetchRobotHealth } from '../api/robotApi';

const HEALTH_REFETCH_MS = 10_000;

export function useRobotHealth(ip: string | null) {
  return useQuery({
    queryKey: ['robot', ip, 'health'],
    queryFn: () => fetchRobotHealth(ip!),
    enabled: Boolean(ip),
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => (query.state.status === 'error' ? false : HEALTH_REFETCH_MS),
  });
}
