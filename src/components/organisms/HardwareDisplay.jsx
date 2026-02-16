import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import HardwareItem from '../molecules/HardwareItem';
import { Loader2 } from 'lucide-react';

export default function HardwareDisplay({ hardware, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3">Pipettes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hardware?.pipettes?.left ? (
            <HardwareItem
              type="Pipette"
              model={hardware.pipettes.left.model}
              serialNumber={hardware.pipettes.left.serialNumber}
              mount="Left"
            />
          ) : (
            <Card className="bg-gray-50">
              <CardContent className="p-4 text-center text-gray-500">
                No pipette attached
              </CardContent>
            </Card>
          )}
          {hardware?.pipettes?.right ? (
            <HardwareItem
              type="Pipette"
              model={hardware.pipettes.right.model}
              serialNumber={hardware.pipettes.right.serialNumber}
              mount="Right"
            />
          ) : (
            <Card className="bg-gray-50">
              <CardContent className="p-4 text-center text-gray-500">
                No pipette attached
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {hardware?.gripper && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Gripper</h3>
          <HardwareItem
            type="Gripper"
            model={hardware.gripper.model}
            serialNumber={hardware.gripper.serialNumber}
          />
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-3">Modules</h3>
        {hardware?.modules && hardware.modules.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hardware.modules.map((module, idx) => (
              <HardwareItem
                key={idx}
                type={module.moduleType || 'Module'}
                model={module.moduleModel}
                serialNumber={module.serialNumber}
                status={module.status}
              />
            ))}
          </div>
        ) : (
          <Card className="bg-gray-50">
            <CardContent className="p-4 text-center text-gray-500">
              No modules attached
            </CardContent>
          </Card>
        )}
      </div>

      {hardware?.subsystems && Object.keys(hardware.subsystems).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Subsystem Status</h3>
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(hardware.subsystems).map(([key, value]) => {
                  const status = typeof value === 'object' ? (value.ok ? 'ok' : 'error') : value;
                  return (
                    <div key={key} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-sm font-medium">{key}</span>
                      <span className={`text-xs px-2 py-1 rounded ${
                        status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}