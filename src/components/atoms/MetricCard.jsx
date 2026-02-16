import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MetricCard({ title, value, subtitle, icon: Icon, trend, dark = false }) {
  return (
    <Card className={`${dark ? 'bg-[#1F2B38] border-[#2A3847] hover:bg-[#253442]' : 'hover:shadow-lg'} transition-all`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className={`text-sm font-medium ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{title}</CardTitle>
        {Icon && <Icon className={`w-4 h-4 ${dark ? 'text-gray-400' : 'text-gray-400'}`} />}
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{value}</div>
        {subtitle && <p className={`text-xs mt-1 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{subtitle}</p>}
        {trend && (
          <div className={`text-sm mt-2 ${trend > 0 ? 'text-red-400' : 'text-[#00D374]'}`}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% from last check
          </div>
        )}
      </CardContent>
    </Card>
  );
}