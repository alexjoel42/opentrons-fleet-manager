import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function FleetCharts({ runData = [], successRateData = [] }) {
  // Default mock data if no data provided
  const defaultRunData = [
    { name: 'Mon', runs: 12, errors: 2 },
    { name: 'Tue', runs: 19, errors: 1 },
    { name: 'Wed', runs: 15, errors: 3 },
    { name: 'Thu', runs: 22, errors: 1 },
    { name: 'Fri', runs: 18, errors: 2 },
    { name: 'Sat', runs: 8, errors: 0 },
    { name: 'Sun', runs: 5, errors: 0 }
  ];

  const defaultSuccessRate = [
    { name: 'Week 1', rate: 92 },
    { name: 'Week 2', rate: 88 },
    { name: 'Week 3', rate: 95 },
    { name: 'Week 4', rate: 91 }
  ];

  const displayRunData = runData.length > 0 ? runData : defaultRunData;
  const displaySuccessRate = successRateData.length > 0 ? successRateData : defaultSuccessRate;

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