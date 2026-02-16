import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ip_address } = await req.json();

        // Check if this is a demo robot
        if (ip_address === '192.168.1.99') {
            const { data: demoInfo } = await base44.functions.invoke('fetchDemoRobotInfo');
            return Response.json(demoInfo);
        }

        if (!ip_address) {
            return Response.json({ error: 'IP address is required' }, { status: 400 });
        }

        // Fetch robot health information
        const healthResponse = await fetch(`http://${ip_address}:31950/health`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!healthResponse.ok) {
            return Response.json({ 
                error: 'Failed to connect to robot',
                status: 'offline' 
            }, { status: 500 });
        }

        const healthData = await healthResponse.json();

        return Response.json({
            name: healthData.name || 'Unknown Robot',
            serial_number: healthData.robot_serial || healthData.api_version || 'N/A',
            status: 'online',
            health_data: healthData
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            status: 'offline'
        }, { status: 500 });
    }
});