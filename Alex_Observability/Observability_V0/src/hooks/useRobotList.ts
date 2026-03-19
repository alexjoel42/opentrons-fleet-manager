import { useQuery } from '@tanstack/react-query';
import { fetchRobotList } from '../api/robotApi';

export function useRobotList() {
  return useQuery({
    queryKey: ['robots', 'list'],
    queryFn: fetchRobotList,
  });
}
