import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import FleetMetrics from '../components/organisms/FleetMetrics';
import RobotList from '../components/organisms/RobotList';
import AddRobotForm from '../components/organisms/AddRobotForm';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function FleetOperation() {
  const queryClient = useQueryClient();
  const [addingRobot, setAddingRobot] = useState(false);
  const [pollingEnabled, setPollingEnabled] = useState(false);

  // Fetch all robots
  const { data: robots = [], isLoading } = useQuery({
    queryKey: ['robots'],
    queryFn: () => base44.entities.Robot.list('-created_date'),
    refetchInterval: pollingEnabled ? 600000 : false, // 10 minutes
  });

  // Calculate fleet metrics
  const metrics = React.useMemo(() => {
    const totalRobots = robots.length;
    const onlineRobots = robots.filter(r => r.status === 'online').length;
    const offlineRobots = robots.filter(r => r.status === 'offline').length;
    const errorRobots = robots.filter(r => r.status === 'error').length;

    return {
      totalRobots,
      onlineRobots,
      offlineRobots,
      activeErrors: errorRobots,
      successfulRuns: 0, // Will be calculated from polling
    };
  }, [robots]);

  // Add robot mutation
  const addRobotMutation = useMutation({
    mutationFn: async ({ ipAddress, boardName }) => {
      const { data: robotInfo } = await base44.functions.invoke('fetchRobotInfo', { 
        ip_address: ipAddress 
      });

      return base44.entities.Robot.create({
        ip_address: ipAddress,
        name: robotInfo.name,
        serial_number: robotInfo.serial_number,
        status: robotInfo.status,
        board_name: boardName,
        last_health_check: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots'] });
      toast.success('Robot added successfully');
      setAddingRobot(false);
    },
    onError: (error) => {
      toast.error(`Failed to add robot: ${error.message}`);
    }
  });

  // Delete robot mutation
  const deleteRobotMutation = useMutation({
    mutationFn: (robotId) => base44.entities.Robot.delete(robotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots'] });
      toast.success('Robot removed');
    },
    onError: (error) => {
      toast.error(`Failed to remove robot: ${error.message}`);
    }
  });

  // Health check for all robots
  const healthCheckMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        robots.map(async (robot) => {
          const { data } = await base44.functions.invoke('fetchRobotInfo', {
            ip_address: robot.ip_address
          });
          return base44.entities.Robot.update(robot.id, {
            status: data.status,
            last_health_check: new Date().toISOString()
          });
        })
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots'] });
      toast.success('Health check completed');
    }
  });

  const handleAddRobot = (ipAddress, boardName) => {
    addRobotMutation.mutate({ ipAddress, boardName });
  };

  const handleDeleteRobot = (robotId) => {
    if (confirm('Are you sure you want to remove this robot?')) {
      deleteRobotMutation.mutate(robotId);
    }
  };

  const handleViewRobot = (robot) => {
    window.location.href = createPageUrl('RobotDetails') + `?id=${robot.id}`;
  };

  // Enable polling when component mounts
  useEffect(() => {
    setPollingEnabled(true);
    return () => setPollingEnabled(false);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Fleet Operation Dashboard</h1>
            <p className="text-gray-600 mt-1">Monitor and manage your Opentrons robot fleet</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => healthCheckMutation.mutate()}
              disabled={healthCheckMutation.isPending || robots.length === 0}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${healthCheckMutation.isPending ? 'animate-spin' : ''}`} />
              Health Check
            </Button>
            <Button onClick={() => setAddingRobot(!addingRobot)}>
              {addingRobot ? 'Cancel' : 'Add Robot'}
            </Button>
          </div>
        </div>

        <FleetMetrics metrics={metrics} />

        {addingRobot && (
          <div className="mb-6">
            <AddRobotForm
              onAdd={handleAddRobot}
              loading={addRobotMutation.isPending}
            />
          </div>
        )}

        {robots.filter(r => r.status === 'error').length > 0 && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-800 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Active Errors Detected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {robots.filter(r => r.status === 'error').map(robot => (
                  <div key={robot.id} className="flex items-center justify-between bg-white p-3 rounded">
                    <div>
                      <p className="font-medium">{robot.name}</p>
                      <p className="text-sm text-gray-600">{robot.ip_address}</p>
                    </div>
                    <Link to={createPageUrl('RobotDetails') + `?id=${robot.id}`}>
                      <Button size="sm" variant="outline">
                        View Details
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Robot Fleet</CardTitle>
          </CardHeader>
          <CardContent>
            <RobotList
              robots={robots}
              onDeleteRobot={handleDeleteRobot}
              onViewRobot={handleViewRobot}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}