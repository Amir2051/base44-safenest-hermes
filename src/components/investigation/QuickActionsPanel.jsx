import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Zap, AlertTriangle, Send, Eye, FileText, ArrowUpCircle,
  RefreshCw, Shield, Link2
} from "lucide-react";
import { toast } from "sonner";

export default function QuickActionsPanel({ caseData, onUpdate, onOpenResponse, onOpenTracking }) {
  const activeCase = caseData;
  const caseId = activeCase?.id;
  const entityName = activeCase?._entityName || activeCase?.entity_name || 'MyCase';
  const [loading, setLoading] = useState(false);
  const [lastResults, setLastResults] = useState(null);
  // Race-guard: ignore stale responses if the user clicks again or the case changes.
  const runIdRef = useRef(0);

  const handleEscalate = async () => {
    setLoading(true);
    try {
      await base44.functions.invoke('caseManagement', {
        action: 'update',
        data: {
          id: caseData.id,
          entityName: caseData._entityName || 'MyCase',
          updates: {
            priority: 'critical',
            status: 'investigating',
            last_activity: new Date().toISOString()
          }
        }
      });

      // Timeline event is logged automatically by caseManagement backend function

      toast.success("Case escalated to Critical");
      if (onUpdate) onUpdate();
    } catch (e) {
      toast.error("Failed to escalate case");
    }
    setLoading(false);
  };

  const handleRunAnalysis = async () => {
    if (!caseId) {
      toast.error('Open a case before running analysis');
      return;
    }
    const runId = ++runIdRef.current;
    setLoading(true);
    const toastId = toast.loading('Running full analysis...');
    try {
      const tasks = [];
      if (!activeCase?.ai_analysis) {
        tasks.push(
          fetch('/api/safenestt/case_summary', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ case_id: caseId, entity_name: entityName }),
          })
            .then(r => r.json())
            .catch((e) => ({ data: { error: e?.message || 'case_summary_failed' } }))
        );
      }
      tasks.push(
        fetch('/api/safenestt/fraud_analysis', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ case_id: caseId }),
        })
          .then(r => r.json())
          .catch((e) => ({ data: { error: e?.message || 'blockchain_monitor_failed' } }))
      );

      const results = await Promise.all(tasks);
      if (runId !== runIdRef.current) return;

      const failed = results.find((r) => r && r.data && r.data.error);
      if (failed) throw new Error(failed.data.error);

      setLastResults(results);
      toast.success(activeCase?.ai_analysis ? 'Wallet monitoring refreshed' : 'Analysis complete', { id: toastId });
      onUpdate?.();
    } catch (e) {
      if (runId === runIdRef.current) {
        toast.error('Analysis failed: ' + (e?.message || 'unknown error'), { id: toastId });
      }
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
  };

  return (
    <Card className="bg-[#0f1419] border-cyan-500/20 mb-4">
      <CardHeader className="py-3 border-b border-cyan-500/10">
        <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {lastResults && (
          <div className="col-span-full p-3 bg-[#0f1419] rounded-lg border border-green-500/20 text-xs text-gray-300 space-y-1">
            <p className="text-gray-400 font-semibold">Latest analysis output:</p>
            {lastResults.map((r, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">Result {idx + 1}: {r?.data?.success ? 'success' : 'no explicit success flag'}</span>
                <pre className="whitespace-pre-wrap text-[11px] text-gray-200">{JSON.stringify(r?.data || {}, null, 2).slice(0, 1200)}</pre>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenResponse}
            className="bg-[#1a2332] border-cyan-500/20 hover:bg-cyan-500/10 text-cyan-400 flex flex-col items-center h-auto py-2 gap-1"
          >
            <Send className="w-4 h-4" />
            <span className="text-[10px]">Deploy Response</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenTracking}
            className="bg-[#1a2332] border-purple-500/20 hover:bg-purple-500/10 text-purple-400 flex flex-col items-center h-auto py-2 gap-1"
          >
            <Eye className="w-4 h-4" />
            <span className="text-[10px]">Monitor Wallet</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRunAnalysis}
            disabled={loading}
            className="bg-[#1a2332] border-blue-500/20 hover:bg-blue-500/10 text-blue-400 flex flex-col items-center h-auto py-2 gap-1"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-[10px]">Full Analysis</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleEscalate}
            disabled={loading || caseData.priority === 'critical'}
            className="bg-[#1a2332] border-red-500/20 hover:bg-red-500/10 text-red-400 flex flex-col items-center h-auto py-2 gap-1"
          >
            <ArrowUpCircle className="w-4 h-4" />
            <span className="text-[10px]">Escalate Case</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
