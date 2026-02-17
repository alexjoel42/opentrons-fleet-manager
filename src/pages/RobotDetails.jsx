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
import { ArrowLeft, RefreshCw, Download, FileDown } from 'lucide-react';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { createPageUrl } from '@/utils';
import { fetchRobotHardware, fetchRobotRuns } from '../components/lib/opentrons-api';

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
      const data = await fetchRobotHardware(robot.ip_address);
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
      const { runs: runsData } = await fetchRobotRuns(robot.ip_address);
      setRuns(runsData || []);
    } catch (error) {
      toast.error('Failed to fetch run history');
    } finally {
      setLoadingRuns(false);
    }
  };

  // Download hardware report as image
  const downloadHardwareReport = async () => {
    try {
      toast.info('Generating hardware report...');
      const element = document.getElementById('hardware-display');
      if (!element) {
        toast.error('Hardware data not loaded');
        return;
      }

      const canvas = await html2canvas(element, {
        backgroundColor: '#16212D',
        scale: 2
      });
      
      canvas.toBlob((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hardware-report-${robot.name}-${new Date().toISOString().split('T')[0]}.png`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        toast.success('Hardware report downloaded');
      });
    } catch (error) {
      toast.error('Failed to generate hardware report');
    }
  };

  // Generate troubleshooting ZIP
  const generateTroubleshootingZip = async (run) => {
    try {
      toast.info('Generating troubleshooting package...');
      const { data } = await base44.functions.invoke('generateTroubleshootingZip', {
        ip_address: robot.ip_address,
        run_id: run.id,
        robot_name: robot.name
      });

      // Create ZIP file
      const zip = new JSZip();
      zip.file('run_log.txt', data.runLog);
      zip.file('protocol.py', data.protocolFile);
      zip.file('hardware_report.txt', data.hardwareReport);
      zip.file('robot_logs.txt', data.robotLogs);

      // Generate and download ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `troubleshooting-${robot.name}-${run.id.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      toast.success('Troubleshooting package downloaded');
    } catch (error) {
      toast.error('Failed to generate troubleshooting package');
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
          </TabsList>

          <TabsContent value="hardware">
            <Card className="bg-[#1F2B38] border-[#2A3847]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-gray-300">Hardware Configuration</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-[#1F2B38] border-[#2A3847] text-gray-300 hover:bg-[#2A3847]"
                    onClick={downloadHardwareReport}
                    disabled={!hardware}
                  >
                    <FileDown className="w-4 h-4 mr-2" />
                    Download Report
                  </Button>
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
                </div>
              </CardHeader>
              <CardContent id="hardware-display">
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
                  onGenerateReport={generateTroubleshootingZip}
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