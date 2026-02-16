import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function HardwareItem({ type, model, serialNumber, mount, status }) {
  return (
    <Card className="bg-gray-50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm">{type}</h4>
              {mount && <Badge variant="outline" className="text-xs">{mount}</Badge>}
            </div>
            <p className="text-sm text-gray-600 mt-1">{model || 'No model info'}</p>
            <p className="text-xs text-gray-500 mt-1">SN: {serialNumber || 'N/A'}</p>
          </div>
          {status && (
            <Badge className={status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
              {status}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}