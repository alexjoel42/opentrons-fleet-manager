import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import HardwareDisplay from '../components/organisms/HardwareDisplay';
import RunHistoryList from '../components/organisms/RunHistoryList';
import StatusBadge from '../components/atoms/StatusBadge';
import { ArrowLeft, RefreshCw, Download } from 'lucide-react';
import { createPageUrl } from './utils';

export default function RobotDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const robotId = urlParams.get('id');

  const [hardware, setHardware] = useState(null);
  const [runs, setRuns] = useState([]);
  const [errorContexts, setErrorContexts] = useState({});
  const [loadingHardware, setLoadingHardware] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // Fetch robot details
  const { data: robot, isLoading } = useQuery({
    queryKey: ['robot', robotId],
    queryFn: () => base44.entities.Robot.filter({ id: robotId }).then(res => res[0]),
    enabled: !!robotId,
  });

  // Fetch hardware
  const fetchHardware = async () => {
    if (!robot) return;
    setLoadingHardware(true);
    try {
      const { data } = await base44.functions.invoke('fetchRobotHardware', {
        ip_address: robot.ip_address
      });
      setHardware(data);
    } catch (error) {
      toast.error('Failed to fetch hardware information');
    } finally {
      setLoadingHardware(false);
    }
  };

  // Fetch run history
  const fetchRunHistory = async () => {
    if (!robot) return;
    setLoadingRuns(true);
    try {
      const { data: runsData } = await base44.functions.invoke('fetchRunHistory', {
        ip_address: robot.ip_address
      });
      setRuns(runsData.runs || []);

      // Fetch error contexts for failed runs
      const errorRuns = (runsData.runs || []).filter(run => run.status === 'error');
      const contexts = {};
      
      await Promise.all(
        errorRuns.map(async (run) => {
          try {
            const { data: detailsData } = await base44.functions.invoke('fetchRunDetails', {
              ip_address: robot.ip_address,
              run_id: run.id
            });
            contexts[run.id] = detailsData.errorContext;
          } catch (error) {
            console.error(`Failed to fetch details for run ${run.id}`);
          }
        })
      );
      
      setErrorContexts(contexts);
    } catch (error) {
      toast.error('Failed to fetch run history');
    } finally {
      setLoadingRuns(false);
    }
  };

  // Generate error report
  const generateReport = async (run) => {
    try {
      toast.info('Generating error report...');
      const { data } = await base44.functions.invoke('generateErrorReport', {
        ip_address: robot.ip_address,
        run_id: run.id,
        robot_name: robot.name
      });

      // Create and download report
      const reportContent = JSON.stringify(data.report, null, 2);
      const blob = new Blob([reportContent], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error-report-${robot.name}-${run.id.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      toast.success('Error report downloaded');
    } catch (error) {
      toast.error('Failed to generate error report');
    }
  };

  useEffect(() => {
    if (robot) {
      fetchHardware();
    }
  }, [robot]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600">Loading robot details...</p>
        </div>
      </div>
    );
  }

  if (!robot) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Robot not found</p>
          <Button className="mt-4" onClick={() => window.location.href = createPageUrl('FleetOperation')}>
            Back to Fleet
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => window.location.href = createPageUrl('FleetOperation')}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Fleet
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{robot.name}</h1>
              <p className="text-gray-600 mt-1">{robot.ip_address}</p>
              {robot.serial_number && (
                <p className="text-sm text-gray-500 mt-1">SN: {robot.serial_number}</p>
              )}
            </div>
            <StatusBadge status={robot.status} />
          </div>
        </div>

        <Tabs defaultValue="hardware" className="space-y-6">
          <TabsList>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
            <TabsTrigger value="runs">Run History</TabsTrigger>
          </TabsList>

          <TabsContent value="hardware">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Hardware Configuration</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchHardware}
                  disabled={loadingHardware}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loadingHardware ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                <HardwareDisplay hardware={hardware} loading={loadingHardware} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Run History</CardTitle>
                <Button
                  onClick={fetchRunHistory}
                  disabled={loadingRuns}
                >
                  {loadingRuns ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Get Run History'
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                <RunHistoryList
                  runs={runs}
                  errorContexts={errorContexts}
                  onGenerateReport={generateReport}
                  loading={loadingRuns}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}