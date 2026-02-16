import React from 'react';
import RunHistoryItem from '../molecules/RunHistoryItem';
import { Loader2 } from 'lucide-react';

export default function RunHistoryList({ runs, errorContexts, onGenerateReport, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>No run history available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <RunHistoryItem
          key={run.id}
          run={run}
          errorContext={errorContexts?.[run.id]}
          onGenerateReport={onGenerateReport}
        />
      ))}
    </div>
  );
}