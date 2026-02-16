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
            gripper: {
                model: 'gripper_v1',
                serialNumber: 'GRP2020092301',
                id: 'demo-gripper'
            },
            modules: [
                {
                    moduleType: 'temperatureModuleType',
                    model: 'temperatureModuleV2',
                    serialNumber: 'TEM2020092301',
                    status: 'ok',
                    id: 'demo-temp-module'
                },
                {
                    moduleType: 'magneticModuleType',
                    model: 'magneticModuleV2',
                    serialNumber: 'MAG2020092302',
                    status: 'ok',
                    id: 'demo-mag-module'
                },
                {
                    moduleType: 'heaterShakerModuleType',
                    model: 'heaterShakerModuleV1',
                    serialNumber: 'HS2020092303',
                    status: 'ok',
                    id: 'demo-hs-module'
                }
            ],
            subsystems: {
                gantry_x: { ok: true, current_fw_version: 10 },
                gantry_y: { ok: true, current_fw_version: 10 },
                head: { ok: true, current_fw_version: 10 },
                gripper: { ok: true, current_fw_version: 10 },
                pipette_left: { ok: true, current_fw_version: 10 },
                pipette_right: { ok: true, current_fw_version: 10 }
            }
        };

        return Response.json(demoHardware);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});