import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, AlertCircle, Download } from 'lucide-react';
import StatusBadge from '../atoms/StatusBadge';
import { format } from 'date-fns';

export default function RunHistoryItem({ run, errorContext, onGenerateReport }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={run.status === 'error' ? 'border-red-200' : 'border-green-200'}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="p-0 h-6 w-6"
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm">Run {run.id.slice(0, 8)}</p>
                <StatusBadge status={run.status} />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {run.createdAt ? format(new Date(run.createdAt), 'MMM dd, yyyy HH:mm') : 'Unknown date'}
              </p>
            </div>
          </div>
          {run.status === 'error' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGenerateReport(run)}
              className="text-blue-600 hover:text-blue-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Get Resolution Info
            </Button>
          )}
        </div>

        {expanded && errorContext && errorContext.length > 0 && (
          <div className="mt-4 pl-9">
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-800">Error Context</p>
                  {errorContext.map((ctx, idx) => (
                    <div key={idx} className="mt-3">
                      <p className="text-sm text-red-700 font-medium mb-2">
                        {ctx.error?.detail || 'Unknown error'}
                      </p>
                      <div className="bg-white rounded border border-red-200 p-2 text-xs font-mono">
                        {ctx.context?.map((cmd, cmdIdx) => (
                          <div 
                            key={cmdIdx}
                            className={`py-1 ${cmd.isError ? 'bg-red-100 text-red-900 font-bold' : 'text-gray-700'}`}
                          >
                            <span className="text-gray-400 mr-2">{cmd.lineNumber}:</span>
                            {cmd.command} - {cmd.status}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}