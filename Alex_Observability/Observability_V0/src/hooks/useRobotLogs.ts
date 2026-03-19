import { useQuery } from '@tanstack/react-query';
import { fetchRobotLogs } from '../api/robotApi';

export function useRobotLogs(ip: string | null) {
  return useQuery({
    queryKey: ['robot', ip, 'logs'],
    queryFn: () => fetchRobotLogs(ip!),
    enabled: Boolean(ip),
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });
}
