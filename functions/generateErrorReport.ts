import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ip_address, run_id, robot_name } = await req.json();

        if (!ip_address) {
            return Response.json({ error: 'IP address is required' }, { status: 400 });
        }

        // Fetch all necessary data
        const [healthRes, hardwareRes, runRes, logsRes] = await Promise.all([
            fetch(`http://${ip_address}:31950/health`),
            fetch(`http://${ip_address}:31950/instruments`),
            run_id ? fetch(`http://${ip_address}:31950/runs/${run_id}`) : null,
            fetch(`http://${ip_address}:31950/logs/serial.log`).catch(() => null)
        ].filter(Boolean));

        const health = healthRes.ok ? await healthRes.json() : {};
        const hardware = hardwareRes.ok ? await hardwareRes.json() : {};
        const runData = runRes && runRes.ok ? await runRes.json() : null;
        const logs = logsRes && logsRes.ok ? await logsRes.text() : 'Logs not available';

        // Fetch modules
        const modulesRes = await fetch(`http://${ip_address}:31950/modules`);
        const modules = modulesRes.ok ? await modulesRes.json() : { data: [] };

        // Get protocol file if available
        let protocolContent = null;
        if (runData && runData.data?.protocolId) {
            const protocolRes = await fetch(`http://${ip_address}:31950/protocols/${runData.data.protocolId}`);
            if (protocolRes.ok) {
                protocolContent = await protocolRes.json();
            }
        }

        // Build comprehensive report
        const report = {
            robotName: robot_name || health.name || 'Unknown',
            errorMessage: runData?.data?.errors?.[0]?.detail || 'No error details available',
            timestamp: new Date().toISOString(),
            robotInfo: {
                serialNumber: health.robot_serial || 'N/A',
                apiVersion: health.api_version || 'N/A',
                firmwareVersion: health.fw_version || 'N/A'
            },
            pipettes: {
                left: hardware.left ? {
                    model: hardware.left.model,
                    serialNumber: hardware.left.serialNumber || 'N/A'
                } : null,
                right: hardware.right ? {
                    model: hardware.right.model,
                    serialNumber: hardware.right.serialNumber || 'N/A'
                } : null
            },
            modules: (modules.data || []).map(mod => ({
                type: mod.moduleType,
                model: mod.moduleModel,
                serialNumber: mod.serialNumber || 'N/A',
                status: mod.status
            })),
            gripper: hardware.gripper ? {
                model: hardware.gripper.model,
                serialNumber: hardware.gripper.serialNumber || 'N/A'
            } : null,
            runDetails: runData?.data || null,
            logs: logs,
            protocol: protocolContent
        };

        return Response.json({ report });

    } catch (error) {
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});