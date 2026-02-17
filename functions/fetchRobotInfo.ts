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

        console.log(`[fetchRobotInfo] Starting fetch to ${ip_address}:31950/health`);

        try {
            const healthResponse = await fetch(`http://${ip_address}:31950/health`, {
                method: 'GET',
                headers: { 
                    'Opentrons-Version': '*'
                }
            });

            console.log(`[fetchRobotInfo] Got response: ${healthResponse.status}`);

            if (!healthResponse.ok) {
                console.error(`[fetchRobotInfo] Robot returned status ${healthResponse.status}`);
                return Response.json({ 
                    error: `Robot returned status ${healthResponse.status}`,
                    status: 'offline',
                    details: `HTTP ${healthResponse.status} from ${ip_address}:31950`
                }, { status: 500 });
            }

            const healthData = await healthResponse.json();
            console.log(`[fetchRobotInfo] Robot data:`, healthData);

            return Response.json({
                name: healthData.name || 'Unknown Robot',
                serial_number: healthData.robot_serial || healthData.api_version || 'N/A',
                status: 'online',
                health_data: healthData
            });

        } catch (fetchError) {
            console.error(`[fetchRobotInfo] Error: ${fetchError.message}`);
            return Response.json({ 
                error: 'Cannot connect to robot',
                status: 'offline',
                details: fetchError.message
            }, { status: 500 });
        }

    } catch (error) {
        console.error(`[fetchRobotInfo] Unexpected error: ${error.message}`);
        return Response.json({ 
            error: 'Unexpected error',
            status: 'offline',
            details: error.message
        }, { status: 500 });
    }
});