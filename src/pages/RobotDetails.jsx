import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import HardwareDisplay from '../components/organisms/HardwareDisplay';
import RunHistoryList from '../components/organisms/RunHistoryList';
import TroubleshootingPanel from '../components/organisms/TroubleshootingPanel';
import StatusBadge from '../components/atoms/StatusBadge';
import { ArrowLeft, RefreshCw, Download, Wrench } from 'lucide-react';
import { createPageUrl } from '@/utils';

export default function RobotDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const robotId = urlParams.get('id');

  const [hardware, setHardware] = useState(null);
  const [runs, setRuns] = useState([]);
  const [errorContexts, setErrorContexts] = useState({});
  const [troubleshootingReport, setTroubleshootingReport] = useState(null);
  const [loadingHardware, setLoadingHardware] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingTroubleshooting, setLoadingTroubleshooting] = useState(false);

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

  // Generate troubleshooting report
  const generateTroubleshooting = async (run) => {
    try {
      setLoadingTroubleshooting(true);
      toast.info('Analyzing error and generating troubleshooting steps...');
      const { data } = await base44.functions.invoke('generateTroubleshootingReport', {
        ip_address: robot.ip_address,
        run_id: run.id,
        robot_name: robot.name
      });

      setTroubleshootingReport(data);
      toast.success('Troubleshooting analysis complete');
    } catch (error) {
      toast.error('Failed to generate troubleshooting report');
    } finally {
      setLoadingTroubleshooting(false);
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
    <div className="min-h-screen bg-[#16212D] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <Button
            variant="ghost"
            className="mb-4 text-gray-300 hover:bg-[#1F2B38] hover:text-white"
            onClick={() => window.location.href = createPageUrl('FleetOperation')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Fleet
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">{robot.name}</h1>
              <p className="text-gray-400 mt-1">{robot.ip_address}</p>
              {robot.serial_number && (
                <p className="text-sm text-gray-500 mt-1">SN: {robot.serial_number}</p>
              )}
            </div>
            <StatusBadge status={robot.status} />
          </div>
        </div>

        <Tabs defaultValue="hardware" className="space-y-6">
          <TabsList className="bg-[#1F2B38] border-[#2A3847]">
            <TabsTrigger value="hardware" className="data-[state=active]:bg-[#006EFF] data-[state=active]:text-white text-gray-400">Hardware</TabsTrigger>
            <TabsTrigger value="runs" className="data-[state=active]:bg-[#006EFF] data-[state=active]:text-white text-gray-400">Run History</TabsTrigger>
            <TabsTrigger value="troubleshooting" className="data-[state=active]:bg-[#006EFF] data-[state=active]:text-white text-gray-400">
              <Wrench className="w-4 h-4 mr-2" />
              Troubleshooting
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hardware">
            <Card className="bg-[#1F2B38] border-[#2A3847]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-gray-300">Hardware Configuration</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-[#1F2B38] border-[#2A3847] text-gray-300 hover:bg-[#2A3847]"
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
            <Card className="bg-[#1F2B38] border-[#2A3847]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-gray-300">Run History</CardTitle>
                <Button
                  className="bg-[#006EFF] hover:bg-[#0055CC] text-white"
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
                  onGenerateReport={generateTroubleshooting}
                  loading={loadingRuns}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="troubleshooting">
            <Card className="bg-[#1F2B38] border-[#2A3847]">
              <CardHeader>
                <CardTitle className="text-gray-300">AI-Powered Troubleshooting</CardTitle>
                <p className="text-sm text-gray-400 mt-2">
                  Click "Get Resolution Info" on a failed run to generate detailed troubleshooting guidance
                </p>
              </CardHeader>
              <CardContent>
                {loadingTroubleshooting ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="w-8 h-8 animate-spin text-[#006EFF] mb-3" />
                    <p className="text-gray-400">Analyzing error and generating recommendations...</p>
                  </div>
                ) : troubleshootingReport ? (
                  <TroubleshootingPanel report={troubleshootingReport} />
                ) : (
                  <div className="text-center py-12">
                    <Wrench className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">No troubleshooting report generated yet</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Go to Run History and click "Get Resolution Info" on a failed run
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          </Tabs>
      </div>
    </div>
  );
}