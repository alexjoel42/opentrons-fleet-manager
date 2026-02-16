import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Clock, Lightbulb, Wrench } from 'lucide-react';

export default function TroubleshootingPanel({ report }) {
  if (!report) return null;

  const getSeverityColor = (severity) => {
    const colors = {
      Low: 'bg-blue-100 text-blue-800',
      Medium: 'bg-yellow-100 text-yellow-800',
      High: 'bg-orange-100 text-orange-800',
      Critical: 'bg-red-100 text-red-800'
    };
    return colors[severity] || 'bg-gray-100 text-gray-800';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      High: 'border-l-red-500',
      Medium: 'border-l-yellow-500',
      Low: 'border-l-blue-500'
    };
    return colors[priority] || 'border-l-gray-500';
  };

  return (
    <div className="space-y-4">
      <Card className="bg-[#1F2B38] border-[#2A3847]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-gray-300 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-400" />
              Error Analysis
            </CardTitle>
            <Badge className={getSeverityColor(report.aiAnalysis.severity)}>
              {report.aiAnalysis.severity} Severity
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-gray-400 mb-1">Error Type</p>
            <p className="text-white font-medium">{report.error.type}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400 mb-1">Root Cause</p>
            <p className="text-gray-300">{report.aiAnalysis.rootCause}</p>
          </div>
          <div>
            <p className="text-sm text-gray-400 mb-1">Affected Components</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {report.aiAnalysis.affectedComponents.map((component, idx) => (
                <Badge key={idx} variant="outline" className="bg-[#16212D] border-[#2A3847] text-gray-300">
                  {component}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#1F2B38] border-[#2A3847]">
        <CardHeader>
          <CardTitle className="text-gray-300 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[#006EFF]" />
            Troubleshooting Steps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {report.troubleshootingSteps.map((step) => (
            <div
              key={step.step}
              className={`border-l-4 ${getPriorityColor(step.priority)} bg-[#16212D] p-4 rounded-r`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-[#006EFF] rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {step.step}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-white">{step.title}</h4>
                    <Badge variant="outline" className="bg-[#1F2B38] border-[#2A3847] text-gray-400 text-xs">
                      {step.priority} Priority
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-400">{step.description}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-[#1F2B38] border-[#2A3847]">
          <CardHeader>
            <CardTitle className="text-gray-300 flex items-center gap-2 text-base">
              <Lightbulb className="w-5 h-5 text-yellow-400" />
              Preventive Measures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {report.preventiveMeasures.map((measure, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-gray-400">
                  <CheckCircle2 className="w-4 h-4 text-[#00D374] mt-0.5 flex-shrink-0" />
                  <span>{measure}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-[#1F2B38] border-[#2A3847]">
          <CardHeader>
            <CardTitle className="text-gray-300 flex items-center gap-2 text-base">
              <Clock className="w-5 h-5 text-[#006EFF]" />
              Resolution Time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-2xl font-bold text-white">{report.estimatedResolutionTime}</p>
              <p className="text-sm text-gray-400 mt-1">Estimated time to resolve</p>
            </div>
            <div className="pt-3 border-t border-[#2A3847]">
              <p className="text-sm text-gray-400">AI Confidence</p>
              <Badge className="mt-1 bg-[#006EFF] text-white">{report.confidence}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}