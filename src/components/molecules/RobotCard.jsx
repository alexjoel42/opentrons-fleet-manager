import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatusBadge from '../atoms/StatusBadge';
import { Trash2, ExternalLink } from 'lucide-react';

export default function RobotCard({ robot, onDelete, onView }) {
  return (
    <Card className="bg-gray-800 border-gray-700 hover:bg-gray-750 transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg text-white">{robot.name}</CardTitle>
            <p className="text-sm text-gray-400 mt-1">{robot.ip_address}</p>
          </div>
          <StatusBadge status={robot.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="flex-1 bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
            onClick={() => onView(robot)}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View Details
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => onDelete(robot.id)}
            className="bg-red-900 hover:bg-red-800 border-red-800 text-red-300"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}