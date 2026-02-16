import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Circle } from 'lucide-react';

export default function StatusBadge({ status }) {
  const statusConfig = {
    online: { color: 'bg-green-100 text-green-800 border-green-300', label: 'Online' },
    offline: { color: 'bg-gray-100 text-gray-800 border-gray-300', label: 'Offline' },
    error: { color: 'bg-red-100 text-red-800 border-red-300', label: 'Error' },
    success: { color: 'bg-green-100 text-green-800 border-green-300', label: 'Success' }
  };

  const config = statusConfig[status] || statusConfig.offline;

  return (
    <Badge className={`${config.color} border flex items-center gap-1`}>
      <Circle className="w-2 h-2 fill-current" />
      {config.label}
    </Badge>
  );
}