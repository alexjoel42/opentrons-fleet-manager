import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ip_address, run_id, robot_name } = await req.json();

        // Check if this is a demo robot
        if (ip_address === '192.168.1.99') {
            const demoData = {
                runLog: `[2024-01-15 10:23:45] Protocol started: Sample Transfer Protocol
[2024-01-15 10:23:46] Initializing robot systems...
[2024-01-15 10:23:47] Loading protocol file: protocol_v2.py
[2024-01-15 10:23:48] Calibrating pipettes...
[2024-01-15 10:23:50] Left pipette calibrated: p1000_multi_flex
[2024-01-15 10:23:51] Right pipette calibrated: p50_multi_flex
[2024-01-15 10:23:52] Homing gantry system...
[2024-01-15 10:23:55] Gantry homing complete
[2024-01-15 10:23:56] Loading labware definitions...
[2024-01-15 10:23:58] Labware loaded: nest_96_wellplate_100ul_pcr_full_skirt
[2024-01-15 10:23:59] Labware loaded: opentrons_96_tiprack_300ul
[2024-01-15 10:24:00] Starting protocol execution...
[2024-01-15 10:24:01] Command: Move to tip rack A1
[2024-01-15 10:24:02] Command: Pick up tip from A1
[2024-01-15 10:24:03] Command: Move to source plate A1
[2024-01-15 10:24:04] Command: Aspirate 50µL from A1
[2024-01-15 10:24:05] ERROR: TipNotAttachedError - Tip attachment failure detected
[2024-01-15 10:24:05] Error detail: Pressure sensor indicates no tip is attached to left pipette
[2024-01-15 10:24:05] Current position: X=150.2mm, Y=75.3mm, Z=100.5mm
[2024-01-15 10:24:05] Pipette pressure reading: 0.02 kPa (expected: 0.8-1.2 kPa)
[2024-01-15 10:24:06] Stopping protocol execution...
[2024-01-15 10:24:07] Emergency stop triggered
[2024-01-15 10:24:08] Moving to safe position...
[2024-01-15 10:24:10] Protocol terminated with errors`,
                
                protocolFile: `from opentrons import protocol_api

metadata = {
    'protocolName': 'Sample Transfer Protocol',
    'author': 'Lab Technician',
    'description': 'Transfer samples from source to destination plate',
    'apiLevel': '2.13'
}

def run(protocol: protocol_api.ProtocolContext):
    # Load labware
    tiprack = protocol.load_labware('opentrons_96_tiprack_300ul', 1)
    source_plate = protocol.load_labware('nest_96_wellplate_100ul_pcr_full_skirt', 2)
    dest_plate = protocol.load_labware('nest_96_wellplate_100ul_pcr_full_skirt', 3)
    
    # Load pipette
    pipette = protocol.load_instrument('p300_multi_gen2', 'left', tip_racks=[tiprack])
    
    # Transfer samples
    pipette.transfer(
        50,
        source_plate['A1'],
        dest_plate['A1'],
        new_tip='always'
    )`,
                
                hardwareReport: `OPENTRONS FLEX HARDWARE REPORT
Generated: ${new Date().toISOString()}
Robot: ${robot_name}
Serial Number: DEMO-FLEX-2024

PIPETTES:
- Left Mount: p1000_multi_flex (SN: P1KMV2020092301)
- Right Mount: p50_multi_flex (SN: P50MV2020092302)

MODULES:
- Plate Reader: absorbanceReaderV1 (SN: ABR2024010101) - Status: idle
- Heater-Shaker: heaterShakerModuleV1 (SN: HS2024010102) - Status: idle
- Temperature Module: temperatureModuleV2 (SN: TEM2024010103) - Status: idle
- Thermocycler: thermocyclerModuleV2 (SN: TC2024010104) - Status: idle

SUBSYSTEMS:
- Gantry X: OK
- Gantry Y: OK
- Head: OK
- Left Pipette: OK
- Right Pipette: OK`,
                
                robotLogs: `[System] Robot startup at 2024-01-15 09:00:00
[System] Firmware version: v2.6.0
[System] API version: 2.20.0
[Network] Connected to network at 192.168.1.99
[Hardware] Pipette detection: Left=p1000_multi_flex, Right=p50_multi_flex
[Hardware] Module scan complete: 4 modules detected
[System] Ready for operations
[Protocol] Run ${run_id} started at 2024-01-15 10:23:45
[Error] TipNotAttachedError at 2024-01-15 10:24:05
[System] Protocol stopped with error`
            };
            
            return Response.json(demoData);
        }

        // For real robots, fetch all data from API
        const headers = { 
            'Content-Type': 'application/json',
            'Opentrons-Version': '*'
        };
        
        const [runRes, logsRes, protocolRes] = await Promise.all([
            fetch(`http://${ip_address}:31950/runs/${run_id}`, { headers }),
            fetch(`http://${ip_address}:31950/runs/${run_id}/commands`, { headers }),
            fetch(`http://${ip_address}:31950/logs/serial.log`, { headers }).catch(() => null)
        ]);

        const runData = runRes.ok ? await runRes.json() : null;
        const commands = logsRes.ok ? await logsRes.json() : null;
        const systemLogs = logsRes && logsRes.ok ? await logsRes.text() : 'System logs not available';

        // Generate run log from commands
        let runLog = 'Run Log:\n\n';
        if (commands?.data) {
            commands.data.forEach(cmd => {
                const timestamp = new Date(cmd.createdAt).toISOString();
                const status = cmd.error ? 'ERROR' : cmd.status;
                runLog += `[${timestamp}] ${status}: ${cmd.commandType}\n`;
                if (cmd.error) {
                    runLog += `  Error: ${cmd.error.errorType} - ${cmd.error.detail}\n`;
                }
            });
        }

        // Get protocol file
        let protocolFile = 'Protocol file not available';
        if (runData?.data?.protocolId) {
            const protRes = await fetch(`http://${ip_address}:31950/protocols/${runData.data.protocolId}`, { headers });
            if (protRes.ok) {
                const protData = await protRes.json();
                protocolFile = protData.data?.files?.[0]?.content || 'Protocol content not available';
            }
        }

        // Get hardware info
        const hwRes = await fetch(`http://${ip_address}:31950/instruments`, { headers });
        const hardware = hwRes.ok ? await hwRes.json() : {};
        
        let hardwareReport = `OPENTRONS FLEX HARDWARE REPORT\n`;
        hardwareReport += `Generated: ${new Date().toISOString()}\n`;
        hardwareReport += `Robot: ${robot_name}\n\n`;
        hardwareReport += `PIPETTES:\n`;
        if (hardware.left) hardwareReport += `- Left: ${hardware.left.model}\n`;
        if (hardware.right) hardwareReport += `- Right: ${hardware.right.model}\n`;

        return Response.json({
            runLog,
            protocolFile,
            hardwareReport,
            robotLogs: systemLogs
        });

    } catch (error) {
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});