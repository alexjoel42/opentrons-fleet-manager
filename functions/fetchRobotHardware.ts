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
            const { data: demoHardware } = await base44.functions.invoke('fetchDemoRobotHardware');
            return Response.json(demoHardware);
        }

        if (!ip_address) {
            return Response.json({ error: 'IP address is required' }, { status: 400 });
        }

        // Fetch instruments (pipettes)
        const instrumentsResponse = await fetch(`http://${ip_address}:31950/instruments`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        // Fetch modules
        const modulesResponse = await fetch(`http://${ip_address}:31950/modules`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        // Fetch subsystems for hardware status
        const subsystemsResponse = await fetch(`http://${ip_address}:31950/subsystems`, {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                'Opentrons-Version': '3'
            }
        });

        const instruments = instrumentsResponse.ok ? await instrumentsResponse.json() : { left: null, right: null };
        const modules = modulesResponse.ok ? await modulesResponse.json() : { data: [] };
        const subsystems = subsystemsResponse.ok ? await subsystemsResponse.json() : {};

        return Response.json({
            pipettes: instruments,
            modules: modules.data || modules.modules || [],
            subsystems: subsystems,
            gripper: instruments.gripper || null
        });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            pipettes: { left: null, right: null },
            modules: [],
            subsystems: {}
        }, { status: 500 });
    }
});