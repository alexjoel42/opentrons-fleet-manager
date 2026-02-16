import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ReactMarkdown from 'react-markdown';

export default function Instructions() {
  const markdown = `# Opentrons Fleet Management Dashboard - Setup Instructions

## Overview
This is a fleet management dashboard for monitoring and managing Opentrons robots across your lab. It provides real-time status monitoring, hardware configuration tracking, run history analysis, and comprehensive error reporting.

## Prerequisites
- Base44 account and project
- Access to Opentrons robot(s) on your network
- Robot(s) must be accessible via HTTP on their IP addresses

## Architecture

### Entities
- **Robot**: Stores robot information including IP address, name, serial number, status, board name, and last health check timestamp

### Backend Functions
1. **fetchRobotInfo**: Retrieves basic health information from a robot's \`/health\` endpoint
2. **fetchRobotHardware**: Gets detailed hardware configuration (pipettes, modules, subsystems)
3. **fetchRunHistory**: Retrieves the list of protocol runs from a robot
4. **fetchRunDetails**: Gets detailed information about a specific run including error context
5. **generateErrorReport**: Creates a comprehensive error report for failed runs

### Frontend Components

#### Pages
- **FleetOperation**: Main dashboard showing all robots and fleet metrics
- **RobotDetails**: Detailed view of a single robot with hardware and run history tabs

#### Component Structure (Atomic Design)
- **Atoms**: StatusBadge, MetricCard
- **Molecules**: RobotCard, HardwareItem, RunHistoryItem, FleetHealthScore, FleetStatusBreakdown, ActionableInsights, FleetCharts
- **Organisms**: RobotList, FleetMetrics, AddRobotForm, HardwareDisplay, RunHistoryList

## Setup Steps

### 1. Clone/Deploy the Application
This application is built on Base44, so it should be ready to run once deployed.

### 2. Add Your First Robot
1. Navigate to the Fleet Operation Dashboard
2. Click "Add Robot"
3. Enter the robot's IP address (e.g., \`192.168.1.100\`)
4. Optionally, specify a board/location name (e.g., "Lab A")
5. Click "Add Robot" - the system will automatically fetch robot details from the Opentrons API

### 3. Understanding Robot Status
- **Online (Green)**: Robot is connected and responsive
- **Offline (Gray)**: Robot is not reachable on the network
- **Error (Red)**: Robot is reachable but has reported errors

### 4. Monitoring Features

#### Fleet Health Score
A 0-100 score calculated based on:
- Percentage of online robots (80% weight)
- Inverse percentage of error robots (20% weight)

#### Live Status Breakdown
Real-time count of robots in each state:
- Available
- Running
- Not Connected
- Issues

#### Actionable Insights
Contextual alerts and recommendations based on fleet status

#### Charts
- Run & Error Count: Weekly view of protocol runs and errors
- Success Rate Trend: Historical success rate over time

### 5. Robot Details View
Click "View Details" on any robot to see:
- **Hardware Tab**: Current pipette configuration, modules, gripper, and subsystem status
- **Run History Tab**: List of recent protocol runs with error details and resolution info

### 6. Error Reporting
For failed runs:
1. Navigate to the robot's Run History tab
2. Click "Get Run History" to load recent runs
3. For any errored run, click "Get Resolution Info"
4. System generates a comprehensive JSON report including:
   - Robot health data
   - Hardware configuration
   - Complete run logs
   - Error context with surrounding protocol commands
   - Module information
   - Protocol details

## API Endpoints Used

The application connects to the following Opentrons HTTP API endpoints on each robot:

- \`GET /health\` - Robot health status
- \`GET /instruments\` - Pipette and gripper information
- \`GET /modules\` - Module configuration
- \`GET /subsystems\` - Subsystem status
- \`GET /runs\` - List of protocol runs
- \`GET /runs/:runId\` - Specific run details
- \`GET /runs/:runId/commands\` - Protocol commands for a run
- \`GET /protocols/:protocolId\` - Protocol metadata

## Customization

### Adding Custom Metrics
Edit \`pages/FleetOperation.js\` and modify the \`metrics\` calculation in the \`useMemo\` hook.

### Adjusting Health Check Interval
In \`pages/FleetOperation.js\`, change the \`refetchInterval\` value (currently 600000ms = 10 minutes).

### Modifying Health Score Algorithm
Edit the health score calculation in \`pages/FleetOperation.js\`.

### Theme Customization
The dashboard uses a dark theme with Tailwind CSS. Main colors:
- Background: \`bg-gray-950\`
- Cards: \`bg-gray-900\` with \`border-gray-700\`
- Text: \`text-white\` / \`text-gray-300\` / \`text-gray-400\`
- Primary actions: \`bg-blue-600\`

## Troubleshooting

### Robot Shows as Offline
1. Verify the robot is powered on
2. Check network connectivity - can you ping the IP address?
3. Ensure the robot's HTTP API is enabled
4. Try accessing \`http://<robot-ip>/health\` in a browser

### Cannot Fetch Hardware or Run History
1. Ensure the robot is showing as "Online"
2. Check that your Base44 app can make outbound HTTP requests
3. Verify the robot's API endpoints are accessible

### Health Check Takes Too Long
The health check runs for all robots in parallel. If you have many robots or network latency:
1. Consider reducing the number of robots
2. Adjust timeout values in the backend functions
3. Implement batching for large fleets

## Maintenance

### Regular Tasks
- Run health checks periodically (button or automatic polling)
- Review error reports for robots in error state
- Monitor the fleet health score trend
- Clean up old run history data if needed

### Data Management
Currently, robot data is stored in the Base44 database. Run history and error logs are fetched on-demand from robots and not persisted.

## Support
For issues with:
- **Base44 Platform**: Contact Base44 support
- **Opentrons Robots**: Refer to Opentrons documentation or support
- **This Application**: Review the code comments and component structure

## Future Enhancements
Consider implementing:
- Email/SMS alerts for critical errors
- Automated health checks via scheduled tasks
- Run success rate trending with stored historical data
- Inventory tracking for consumables
- Multi-user access with role-based permissions
- Export functionality for reports (CSV, PDF)
`;

  return (
    <div className="min-h-screen bg-[#16212D] p-6">
      <div className="max-w-5xl mx-auto">
        <Card className="bg-[#1F2B38] border-[#2A3847]">
          <CardHeader>
            <CardTitle className="text-2xl text-white">Setup Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactMarkdown 
              className="prose prose-invert prose-sm max-w-none
                [&>h1]:text-2xl [&>h1]:font-bold [&>h1]:text-white [&>h1]:mb-4 [&>h1]:mt-6
                [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:text-gray-200 [&>h2]:mb-3 [&>h2]:mt-5 [&>h2]:border-b [&>h2]:border-gray-700 [&>h2]:pb-2
                [&>h3]:text-lg [&>h3]:font-medium [&>h3]:text-gray-300 [&>h3]:mb-2 [&>h3]:mt-4
                [&>p]:text-gray-400 [&>p]:mb-4 [&>p]:leading-relaxed
                [&>ul]:text-gray-400 [&>ul]:mb-4 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:space-y-2
                [&>ol]:text-gray-400 [&>ol]:mb-4 [&>ol]:list-decimal [&>ol]:pl-6 [&>ol]:space-y-2
                [&>li]:leading-relaxed
                [&>code]:bg-gray-800 [&>code]:text-blue-400 [&>code]:px-1.5 [&>code]:py-0.5 [&>code]:rounded [&>code]:text-sm
                [&>pre]:bg-gray-800 [&>pre]:p-4 [&>pre]:rounded-lg [&>pre]:overflow-x-auto [&>pre]:mb-4
                [&>pre>code]:bg-transparent [&>pre>code]:p-0
                [&>strong]:text-gray-200 [&>strong]:font-semibold
                [&>a]:text-blue-400 [&>a]:underline [&>a]:hover:text-blue-300"
            >
              {markdown}
            </ReactMarkdown>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}