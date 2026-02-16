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
            const demoReport = {
                error: {
                    type: 'TipNotAttachedError',
                    message: 'Tip attachment failure detected on left pipette during aspirate command.',
                    timestamp: new Date().toISOString()
                },
                aiAnalysis: {
                    rootCause: 'Tip box misalignment or insufficient engagement force during tip pickup',
                    severity: 'Medium',
                    affectedComponents: ['Left Pipette', 'Tip Rack']
                },
                troubleshootingSteps: [
                    {
                        step: 1,
                        title: 'Verify Tip Box Placement',
                        description: 'Check that the tip box is properly seated in the deck slot. Ensure it is not tilted or shifted.',
                        priority: 'High'
                    },
                    {
                        step: 2,
                        title: 'Inspect Pipette Tip Cones',
                        description: 'Examine the pipette tip cones for debris, damage, or wear. Clean with lint-free cloth and isopropyl alcohol if needed.',
                        priority: 'High'
                    },
                    {
                        step: 3,
                        title: 'Check Tip Quality',
                        description: 'Verify that you are using the correct tip type and that tips are not damaged or deformed.',
                        priority: 'Medium'
                    },
                    {
                        step: 4,
                        title: 'Calibrate Tip Pickup',
                        description: 'Run tip pickup calibration from the robot settings to optimize the Z-height for tip attachment.',
                        priority: 'Medium'
                    },
                    {
                        step: 5,
                        title: 'Test with New Tip Box',
                        description: 'Try a fresh tip box to rule out manufacturing defects in the current box.',
                        priority: 'Low'
                    }
                ],
                preventiveMeasures: [
                    'Regularly inspect and clean pipette tip cones',
                    'Store tip boxes in original packaging until use',
                    'Run tip pickup calibration monthly or after hardware changes',
                    'Ensure deck surface is level and clean'
                ],
                estimatedResolutionTime: '15-30 minutes',
                confidence: 'High'
            };
            
            return Response.json(demoReport);
        }

        // For real robots, fetch error data and generate AI analysis
        const { data: errorReport } = await base44.functions.invoke('generateErrorReport', {
            ip_address,
            run_id,
            robot_name
        });

        // Use AI to analyze the error
        const analysisPrompt = `You are an expert Opentrons robot technician. Analyze the following error report and provide structured troubleshooting guidance.

Error Report:
${JSON.stringify(errorReport.report, null, 2)}

Provide a JSON response with:
1. Root cause analysis
2. Severity assessment (Low/Medium/High/Critical)
3. Affected components
4. Step-by-step troubleshooting instructions (5-7 steps, ordered by priority)
5. Preventive measures
6. Estimated resolution time
7. Confidence level in the analysis (Low/Medium/High)

Focus on actionable, specific steps that a lab technician can follow.`;

        const aiResponse = await base44.integrations.Core.InvokeLLM({
            prompt: analysisPrompt,
            response_json_schema: {
                type: 'object',
                properties: {
                    rootCause: { type: 'string' },
                    severity: { type: 'string' },
                    affectedComponents: { 
                        type: 'array',
                        items: { type: 'string' }
                    },
                    troubleshootingSteps: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                step: { type: 'number' },
                                title: { type: 'string' },
                                description: { type: 'string' },
                                priority: { type: 'string' }
                            }
                        }
                    },
                    preventiveMeasures: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    estimatedResolutionTime: { type: 'string' },
                    confidence: { type: 'string' }
                }
            }
        });

        return Response.json({
            error: {
                type: errorReport.report.runDetails?.errors?.[0]?.errorType || 'Unknown',
                message: errorReport.report.errorMessage,
                timestamp: errorReport.report.timestamp
            },
            aiAnalysis: aiResponse
        });

    } catch (error) {
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});