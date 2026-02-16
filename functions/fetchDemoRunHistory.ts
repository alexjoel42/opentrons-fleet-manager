import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Return demo run history
        const now = new Date();
        const demoRuns = [
            {
                id: 'demo-run-1',
                protocolId: 'demo-protocol-1',
                status: 'succeeded',
                createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 1.5 * 60 * 60 * 1000).toISOString(),
                current: false
            },
            {
                id: 'demo-run-2',
                protocolId: 'demo-protocol-2',
                status: 'succeeded',
                createdAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
                current: false
            },
            {
                id: 'demo-run-3',
                protocolId: 'demo-protocol-3',
                status: 'failed',
                createdAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 23 * 60 * 60 * 1000).toISOString(),
                current: false,
                errors: [
                    {
                        id: 'demo-error-1',
                        errorType: 'TipNotAttachedError',
                        createdAt: new Date(now - 23.5 * 60 * 60 * 1000).toISOString(),
                        detail: 'Demo: Tip not properly attached to pipette'
                    }
                ]
            },
            {
                id: 'demo-run-4',
                protocolId: 'demo-protocol-1',
                status: 'succeeded',
                createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 47 * 60 * 60 * 1000).toISOString(),
                current: false
            },
            {
                id: 'demo-run-5',
                protocolId: 'demo-protocol-2',
                status: 'succeeded',
                createdAt: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 71 * 60 * 60 * 1000).toISOString(),
                current: false
            }
        ];

        return Response.json({ data: demoRuns });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});