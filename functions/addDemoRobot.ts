import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Check if demo robot already exists
        const existingDemoRobots = await base44.entities.Robot.filter({ 
            name: 'Demo Bot' 
        });

        if (existingDemoRobots.length > 0) {
            return Response.json({ 
                success: false, 
                message: 'Demo robot already exists',
                robot: existingDemoRobots[0]
            });
        }

        // Create demo robot with realistic Opentrons Flex data
        const demoRobot = await base44.entities.Robot.create({
            name: 'Demo Bot',
            ip_address: '192.168.1.99',
            serial_number: 'DEMO-FLEX-2024',
            status: 'online',
            board_name: 'Demo Bot',
            last_health_check: new Date().toISOString()
        });

        return Response.json({ 
            success: true, 
            robot: demoRobot 
        });
    } catch (error) {
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});