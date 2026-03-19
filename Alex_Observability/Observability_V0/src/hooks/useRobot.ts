import { useRobotHealth } from './useRobotHealth';
import { useRobotModules } from './useRobotModules';
import { useRobotPipettes } from './useRobotPipettes';

/**
 * Composes per-resource queries for one robot. Use on the detail page.
 */
export function useRobot(ip: string | null) {
  const health = useRobotHealth(ip);
  const modules = useRobotModules(ip);
  const pipettes = useRobotPipettes(ip);

  const isLoading = health.isLoading || modules.isLoading || pipettes.isLoading;
  const isError = health.isError || modules.isError || pipettes.isError;
  const error = health.error ?? modules.error ?? pipettes.error;

  return {
    health,
    modules,
    pipettes,
    isLoading,
    isError,
    error,
    refetch: () => {
      health.refetch();
      modules.refetch();
      pipettes.refetch();
    },
  };
}
