import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Loader2 } from 'lucide-react';

export default function AddRobotForm({ onAdd, loading }) {
  const [ipAddress, setIpAddress] = useState('');
  const [boardName, setBoardName] = useState('Main Lab');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (ipAddress) {
      onAdd(ipAddress, boardName);
      setIpAddress('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Add New Robot</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ipAddress">Robot IP Address</Label>
            <Input
              id="ipAddress"
              value={ipAddress}
              onChange={(e) => setIpAddress(e.target.value)}
              placeholder="192.168.1.100"
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="boardName">Board Name</Label>
            <Input
              id="boardName"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              placeholder="Main Lab"
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading || !ipAddress}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding Robot...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Add Robot
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}