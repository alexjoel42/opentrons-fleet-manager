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
            const { data: demoRuns } = await base44.functions.invoke('fetchDemoRunHistory');
            return Response.json(demoRuns);
        }

        if (!ip_address) {
            return Response.json({ error: 'IP address is required' }, { status: 400 });
        }

        // Fetch runs
        const runsResponse = await fetch(`http://${ip_address}:31950/runs`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!runsResponse.ok) {
            return Response.json({ error: 'Failed to fetch runs' }, { status: 500 });
        }

        const runsData = await runsResponse.json();
        const runs = runsData.data || [];

        // Process runs to add status and error info
        const processedRuns = runs.map(run => {
            const hasError = run.status === 'failed' || run.status === 'stopped' || 
                           (run.errors && run.errors.length > 0);
            
            return {
                id: run.id,
                status: hasError ? 'error' : 'success',
                createdAt: run.createdAt,
                completedAt: run.completedAt,
                protocolId: run.protocolId,
                errors: run.errors || [],
                runStatus: run.status
            };
        });

        return Response.json({ runs: processedRuns });

    } catch (error) {
        return Response.json({ 
            error: error.message,
            runs: []
        }, { status: 500 });
    }
});