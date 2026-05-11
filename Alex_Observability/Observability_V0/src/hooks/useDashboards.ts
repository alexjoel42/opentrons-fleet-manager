import { useQuery } from '@tanstack/react-query';
import { fetchDashboards } from '../api/robotApi';

/** Named dashboard membership (shared JSON on the fleet server). */
export function useDashboards(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboards'],
    queryFn: fetchDashboards,
    enabled,
    staleTime: 30_000,
  });
}
