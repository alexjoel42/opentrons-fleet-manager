import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function FleetHealthScore({ score, totalRobots, onlineRobots, errorRobots }) {
  const percentage = totalRobots > 0 ? Math.round((score / 100) * 100) : 0;
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-gray-300 text-sm">Fleet Health Score</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center">
        <div className="relative w-48 h-48">
          <svg className="transform -rotate-90 w-48 h-48">
            <circle
              cx="96"
              cy="96"
              r={radius}
              stroke="currentColor"
              strokeWidth="12"
              fill="transparent"
              className="text-gray-700"
            />
            <circle
              cx="96"
              cy="96"
              r={radius}
              stroke="currentColor"
              strokeWidth="12"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={`${
                score >= 80 ? 'text-green-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500'
              } transition-all duration-1000`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-bold text-white">{percentage}</span>
            <span className="text-gray-400 text-sm mt-1">Health Score</span>
          </div>
        </div>
      </CardContent>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-2xl font-bold text-green-400">{onlineRobots}</div>
            <div className="text-xs text-gray-400">Online</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-400">{totalRobots - onlineRobots - errorRobots}</div>
            <div className="text-xs text-gray-400">Offline</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-400">{errorRobots}</div>
            <div className="text-xs text-gray-400">Errors</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}