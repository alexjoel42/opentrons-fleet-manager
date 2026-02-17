import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ip_address, run_id } = await req.json();

        if (!ip_address || !run_id) {
            return Response.json({ error: 'IP address and run ID are required' }, { status: 400 });
        }

        // Fetch run details
        const runResponse = await fetch(`http://${ip_address}:31950/runs/${run_id}`, {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                'Opentrons-Version': '3'
            }
        });

        // Fetch run commands for context
        const commandsResponse = await fetch(`http://${ip_address}:31950/runs/${run_id}/commands`, {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                'Opentrons-Version': '3'
            }
        });

        const runData = runResponse.ok ? await runResponse.json() : {};
        const commandsData = commandsResponse.ok ? await commandsResponse.json() : { data: [] };

        // Extract error context (error message with +4/-4 lines)
        const commands = commandsData.data || [];
        const errorCommands = commands.filter(cmd => cmd.error);
        
        const errorContext = errorCommands.map(errorCmd => {
            const errorIndex = commands.findIndex(cmd => cmd.id === errorCmd.id);
            const contextStart = Math.max(0, errorIndex - 4);
            const contextEnd = Math.min(commands.length, errorIndex + 5);
            const contextCommands = commands.slice(contextStart, contextEnd);
            
            return {
                error: errorCmd.error,
                errorIndex: errorIndex,
                context: contextCommands.map((cmd, idx) => ({
                    command: cmd.commandType,
                    status: cmd.status,
                    params: cmd.params,
                    isError: cmd.id === errorCmd.id,
                    lineNumber: contextStart + idx
                }))
            };
        });

        return Response.json({
            run: runData.data || runData,
            errorContext: errorContext
        });

    } catch (error) {
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});