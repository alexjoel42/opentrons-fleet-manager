import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Return demo robot health data
        const demoHealth = {
            name: 'Demo Bot',
            api_version: '2.20.0',
            fw_version: 'v2.6.0',
            board_revision: '2.1',
            robot_model: 'OT-3 Standard',
            robot_serial: 'DEMO-FLEX-2024',
            status: 'online'
        };

        return Response.json(demoHealth);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});