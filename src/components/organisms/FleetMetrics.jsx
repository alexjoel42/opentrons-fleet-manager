import React from 'react';
import MetricCard from '../atoms/MetricCard';
import { Activity, AlertTriangle, CheckCircle, Server } from 'lucide-react';

export default function FleetMetrics({ metrics }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <MetricCard
        title="Total Robots"
        value={metrics.totalRobots || 0}
        icon={Server}
      />
      <MetricCard
        title="Online Robots"
        value={metrics.onlineRobots || 0}
        subtitle={`${metrics.offlineRobots || 0} offline`}
        icon={Activity}
      />
      <MetricCard
        title="Active Errors"
        value={metrics.activeErrors || 0}
        icon={AlertTriangle}
        trend={metrics.errorTrend}
      />
      <MetricCard
        title="Successful Runs (24h)"
        value={metrics.successfulRuns || 0}
        icon={CheckCircle}
      />
    </div>
  );
}