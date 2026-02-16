import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Return demo robot hardware configuration
        const demoHardware = {
            pipettes: {
                left: {
                    model: 'p1000_multi_flex',
                    serialNumber: 'P1KMV2020092301',
                    id: 'demo-left-pipette'
                },
                right: {
                    model: 'p50_multi_flex',
                    serialNumber: 'P50MV2020092302',
                    id: 'demo-right-pipette'
                }
            },
            modules: [
                {
                    moduleType: 'Plate Reader',
                    moduleModel: 'absorbanceReaderV1',
                    serialNumber: 'ABR2024010101',
                    status: 'idle',
                    id: 'demo-plate-reader'
                },
                {
                    moduleType: 'Heater-Shaker',
                    moduleModel: 'heaterShakerModuleV1',
                    serialNumber: 'HS2024010102',
                    status: 'idle',
                    id: 'demo-heater-shaker'
                },
                {
                    moduleType: 'Temperature Module',
                    moduleModel: 'temperatureModuleV2',
                    serialNumber: 'TEM2024010103',
                    status: 'idle',
                    id: 'demo-temp-module'
                },
                {
                    moduleType: 'Thermocycler',
                    moduleModel: 'thermocyclerModuleV2',
                    serialNumber: 'TC2024010104',
                    status: 'idle',
                    id: 'demo-thermocycler'
                }
            ],
            subsystems: {
                gantry_x: 'ok',
                gantry_y: 'ok',
                head: 'ok',
                pipette_left: 'ok',
                pipette_right: 'ok'
            }
        };

        return Response.json(demoHardware);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});