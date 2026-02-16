import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MetricCard({ title, value, subtitle, icon: Icon, trend }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        {trend && (
          <div className={`text-sm mt-2 ${trend > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% from last check
          </div>
        )}
      </CardContent>
    </Card>
  );
}