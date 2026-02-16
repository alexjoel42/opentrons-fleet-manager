import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, TrendingDown, TrendingUp, Info } from 'lucide-react';

export default function ActionableInsights({ insights = [] }) {
  const getIcon = (type) => {
    switch (type) {
      case 'error': return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'warning': return <Info className="w-4 h-4 text-yellow-400" />;
      case 'success': return <TrendingUp className="w-4 h-4 text-green-400" />;
      default: return <TrendingDown className="w-4 h-4 text-blue-400" />;
    }
  };

  const defaultInsights = [
    { type: 'info', message: 'Fleet monitoring is active', time: 'Just now' },
    { type: 'warning', message: 'Consider running health checks regularly', time: '5 min ago' }
  ];

  const displayInsights = insights.length > 0 ? insights : defaultInsights;

  return (
    <Card className="bg-[#1F2B38] border-[#2A3847] h-full">
      <CardHeader>
        <CardTitle className="text-gray-300 text-sm">Actionable Insights</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[300px] overflow-y-auto">
          {displayInsights.map((insight, index) => (
            <div key={index} className="flex gap-3 text-sm">
              <div className="mt-0.5">{getIcon(insight.type)}</div>
              <div className="flex-1">
                <p className="text-gray-300">{insight.message}</p>
                {insight.time && <p className="text-gray-500 text-xs mt-1">{insight.time}</p>}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}