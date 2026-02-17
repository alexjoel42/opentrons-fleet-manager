// Utility functions for Opentrons robot API calls

export async function fetchRobotHealth(ipAddress) {
  try {
    const response = await fetch(`http://${ipAddress}:31950/health`, {
      method: 'GET',
      headers: { 
        'Opentrons-Version': '*'
      }
    });

    if (!response.ok) {
      throw new Error(`Robot returned status ${response.status}`);
    }

    const data = await response.json();
    return {
      name: data.name || 'Unknown Robot',
      serial_number: data.robot_serial || data.api_version || 'N/A',
      status: 'online',
      health_data: data
    };
  } catch (error) {
    throw new Error(`Cannot connect to robot: ${error.message}`);
  }
}

export async function fetchRobotHardware(ipAddress) {
  try {
    const [instrumentsRes, modulesRes, subsystemsRes] = await Promise.all([
      fetch(`http://${ipAddress}:31950/instruments`, {
        headers: { 'Opentrons-Version': '*' }
      }),
      fetch(`http://${ipAddress}:31950/modules`, {
        headers: { 'Opentrons-Version': '*' }
      }),
      fetch(`http://${ipAddress}:31950/subsystems/updates/current`, {
        headers: { 'Opentrons-Version': '*' }
      })
    ]);

    const [instruments, modules, subsystems] = await Promise.all([
      instrumentsRes.json(),
      modulesRes.json(),
      subsystemsRes.json()
    ]);

    return {
      pipettes: {
        left: instruments.left || null,
        right: instruments.right || null
      },
      modules: modules.data || [],
      subsystems: subsystems.subsystems || {},
      gripper: instruments.gripper || null
    };
  } catch (error) {
    throw new Error(`Failed to fetch hardware: ${error.message}`);
  }
}

export async function fetchRobotRuns(ipAddress) {
  try {
    const response = await fetch(`http://${ipAddress}:31950/runs`, {
      headers: { 'Opentrons-Version': '*' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch runs: ${response.status}`);
    }

    const data = await response.json();
    const runs = (data.data || []).map(run => ({
      ...run,
      status: run.status === 'succeeded' ? 'success' : 
              (run.status === 'failed' || run.errors?.length > 0) ? 'error' : 
              run.status
    }));

    return { runs };
  } catch (error) {
    throw new Error(`Failed to fetch run history: ${error.message}`);
  }
}