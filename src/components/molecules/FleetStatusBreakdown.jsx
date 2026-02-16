import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Circle } from 'lucide-react';

export default function FleetStatusBreakdown({ robots = [] }) {
  const statusCounts = {
    available: robots.filter(r => r.status === 'online' && !r.is_running).length,
    running: robots.filter(r => r.status === 'online' && r.is_running).length,
    offline: robots.filter(r => r.status === 'offline').length,
    error: robots.filter(r => r.status === 'error').length
  };

  const statusConfig = [
    { label: 'Available', count: statusCounts.available, color: 'text-green-400', bgColor: 'bg-green-500/10' },
    { label: 'Running', count: statusCounts.running, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
    { label: 'Not Connected', count: statusCounts.offline, color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
    { label: 'Issues', count: statusCounts.error, color: 'text-red-400', bgColor: 'bg-red-500/10' }
  ];

  return (
    <Card className="bg-gray-900 border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-300 text-sm">Instrument Live Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {statusConfig.map((status, index) => (
            <div key={index} className={`flex items-center justify-between p-3 rounded-lg ${status.bgColor}`}>
              <div className="flex items-center gap-2">
                <Circle className={`w-2 h-2 fill-current ${status.color}`} />
                <span className="text-gray-300 text-sm">{status.label}</span>
              </div>
              <span className={`text-lg font-bold ${status.color}`}>{status.count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}