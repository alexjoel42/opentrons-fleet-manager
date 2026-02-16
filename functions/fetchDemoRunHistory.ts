import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Return demo run history with sample logs
        const now = new Date();
        const demoRuns = [
            {
                id: 'demo-run-1',
                protocolId: 'demo-protocol-1',
                status: 'succeeded',
                createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 1.5 * 60 * 60 * 1000).toISOString(),
                current: false,
                actions: [
                    {
                        actionType: 'setup',
                        createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString()
                    },
                    {
                        actionType: 'aspirate',
                        createdAt: new Date(now - 1.9 * 60 * 60 * 1000).toISOString(),
                        params: { volume: 50, wellName: 'A1' }
                    },
                    {
                        actionType: 'dispense',
                        createdAt: new Date(now - 1.8 * 60 * 60 * 1000).toISOString(),
                        params: { volume: 50, wellName: 'B1' }
                    },
                    {
                        actionType: 'complete',
                        createdAt: new Date(now - 1.5 * 60 * 60 * 1000).toISOString()
                    }
                ]
            },
            {
                id: 'demo-run-2',
                protocolId: 'demo-protocol-2',
                status: 'failed',
                createdAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
                completedAt: new Date(now - 23.5 * 60 * 60 * 1000).toISOString(),
                current: false,
                errors: [
                    {
                        id: 'demo-error-1',
                        errorType: 'TipNotAttachedError',
                        createdAt: new Date(now - 23.7 * 60 * 60 * 1000).toISOString(),
                        detail: 'Tip attachment failure detected on left pipette during aspirate command. Please check tip box alignment and ensure tips are properly seated.'
                    }
                ],
                actions: [
                    {
                        actionType: 'setup',
                        createdAt: new Date(now - 24 * 60 * 60 * 1000).toISOString()
                    },
                    {
                        actionType: 'pickUpTip',
                        createdAt: new Date(now - 23.8 * 60 * 60 * 1000).toISOString(),
                        params: { wellName: 'A1' }
                    },
                    {
                        actionType: 'aspirate',
                        createdAt: new Date(now - 23.7 * 60 * 60 * 1000).toISOString(),
                        params: { volume: 100, wellName: 'A1' },
                        error: 'TipNotAttachedError'
                    }
                ]
            }
        ];

        return Response.json({ runs: demoRuns });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});