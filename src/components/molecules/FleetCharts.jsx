import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function FleetCharts({ runData = [], successRateData = [] }) {
  // Only display if data is provided
  const hasData = runData.length > 0 || successRateData.length > 0;
  
  if (!hasData) {
    return null;
  }

  const displayRunData = runData;
  const displaySuccessRate = successRateData;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="bg-[#1F2B38] border-[#2A3847]">
        <CardHeader>
          <CardTitle className="text-gray-300 text-sm">Run & Error Count</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={displayRunData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A3847" />
              <XAxis dataKey="name" stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#16212D', border: 'none', borderRadius: '8px', color: '#F3F4F6' }}
              />
              <Bar dataKey="runs" fill="#006EFF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="errors" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-[#1F2B38] border-[#2A3847]">
        <CardHeader>
          <CardTitle className="text-gray-300 text-sm">Success Rate Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={displaySuccessRate}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A3847" />
              <XAxis dataKey="name" stroke="#9CA3AF" style={{ fontSize: '12px' }} />
              <YAxis stroke="#9CA3AF" style={{ fontSize: '12px' }} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#16212D', border: 'none', borderRadius: '8px', color: '#F3F4F6' }}
              />
              <Line type="monotone" dataKey="rate" stroke="#00D374" strokeWidth={2} dot={{ fill: '#00D374' }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}