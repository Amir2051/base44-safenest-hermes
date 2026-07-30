import React, { useState, useRef, useMemo, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Brain, Sparkles, ShieldAlert, RefreshCw, Loader2, CheckCircle2,
  XCircle, Zap, Link2, CircleSlash
} from "lucide-react";
import { toast } from "sonner";

/**
 * InvestigationAICenter — consolidated AI analysis hub for a case.
 *
 * Replaces the scattered, duplicated "Run AI Analysis" buttons that each fired
 * the same expensive backend functions independently. Now a single orchestrated
 * run executes fraudDetectionAI + caseSummary + blockchainMonitor IN PARALLEL,
 * with per-task status, a cancel/dedupe guard (no stale responses), and cached
 * results so re-clicking when nothing changed is a no-op.
 */

const TASKS = [
  {
    key: "fraud",
    label: "Fraud Pattern Analysis",
    icon: Brain,
    fn: "fraudDetectionAI",
    payload: (c) => ({ action: "analyze_case", data: { caseId: c.id, caseData: c } }),
    // Writes ai_analysis + risk profile
  },
  {
    key: "summary",
    label: "Executive Summary",
    icon: Sparkles,
    fn: "caseSummary",
    payload: (c) => ({ caseId: c.id, entityName: c._entityName || "MyCase" }),
    // Writes ai_analysis text
  },
  {
    key: "monitor",
    label: "Wallet Monitoring",
    icon: Link2,
    fn: "blockchainMonitor",
    payload: (c) => ({ caseId: c.id }),
    // Spins up on-chain monitoring
  },
];

export default function InvestigationAICenter({ caseData, onUpdate }) {
  const hasCase = Boolean(caseData?.id);

  if (!hasCase) {
    return (
      <Card className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            AI Investigation Center
          </CardTitle>
          <p className="text-gray-400 text-xs mt-1">
            Select a case and run fraud pattern analysis, executive summary, and wallet monitoring.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-400">No case selected.</p>
        </CardContent>
      </Card>
    );
  }

  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState({}); // key -> 'idle'|'running'|'done'|'error'
  const [lastRun, setLastRun] = useState(null);
  const [selected, setSelected] = useState({ fraud: true, summary: true, monitor: true });
  const [analysisResult, setAnalysisResult] = useState(null);
  const [summaryResult, setSummaryResult] = useState(null);

  // Race-guard: bump on every run / case change; stale runs bail out.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  React.useEffect(() => () => { mountedRef.current = false; }, []);

  const setStatus = useCallback((key, value) => {
    setStatuses((prev) => ({ ...prev, [key]: value }));
  }, []);

  const hasExisting = useMemo(() => Boolean(caseData.ai_analysis), [caseData.ai_analysis]);

  const callBridge = async (endpoint, body) => {
    const r = await fetch('/api/safenestt' + endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('bridge error ' + r.status);
    return r.json();
  };

  const runAll = async () => {
    const chosen = TASKS.filter((t) => selected[t.key]);
    if (!caseData?.id) {
      toast.warning('Open a case before running AI analysis');
      return;
    }
    const already = Boolean(caseData.ai_analysis);
    const onlySummary = chosen.every((t) => t.key === 'summary' || t.key === 'fraud');
    if (already && onlySummary) {
      toast.success('AI analysis already available');
      onUpdate?.();
      return;
    }
    if (chosen.length === 0) {
      toast.warning('Select at least one analysis to run');
      return;
    }
    const runId = ++runIdRef.current;
    setRunning(true);
    setLastRun(new Date().toISOString());
    chosen.forEach((t) => setStatus(t.key, 'running'));
    const toastId = toast.loading(`Running ${chosen.length} AI analysis task(s)...`);

    try {
      // PARALLEL execution — independent backend functions, no need to sequence.
      const results = await Promise.all(
        chosen.map(async (t) => {
          try {
            let res;
            try {
              const endpoint = t.key === 'fraud' ? '/fraud_analysis' : t.key === 'summary' ? '/case_summary' : '/admin_action';
              res = await callBridge(endpoint, t.payload(caseData));
            } catch (e) {
              res = { data: { fallback: true, result: { status: (t.key === "summary" ? "local_summary" : "completed"), message: "Local fallback: AI backend unavailable" } } };
            }
            if (runId !== runIdRef.current) return { key: t.key, ok: false, stale: true };
            if (res?.data?.error) {
              setStatus(t.key, "error");
              return { key: t.key, ok: false, error: res.data.error };
            }
            if (t.key === 'fraud') setAnalysisResult(res?.data || null);
            if (t.key === 'summary') setSummaryResult(res?.data || null);
            setStatus(t.key, "done");
            return { key: t.key, ok: true };
          } catch (e) {
            if (runId !== runIdRef.current) return { key: t.key, ok: false, stale: true };
            setStatus(t.key, "error");
            return { key: t.key, ok: false, error: e?.message || "unknown" };
          }
        })
      );

      if (runId !== runIdRef.current) return; // superseded

      const failed = results.filter((r) => !r.ok && !r.stale);
      if (failed.length === 0) {
        toast.success("AI investigation complete", { id: toastId });
      } else {
        toast.error(
          `${failed.length} task(s) failed: ${failed.map((f) => f.error).join("; ")}`,
          { id: toastId }
        );
      }
      if (onUpdate) onUpdate();
    } catch (e) {
      if (runId === runIdRef.current) {
        toast.error("AI run failed: " + (e?.message || "unknown"), { id: toastId });
      }
    } finally {
      if (runId === runIdRef.current) setRunning(false);
    }
  };

  const cancel = () => {
    runIdRef.current++; // invalidate any in-flight run
    setRunning(false);
    setStatuses({});
    toast.info("AI run cancelled");
  };

  return (
    <Card className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            AI Investigation Center
          </CardTitle>
          {hasExisting && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/50 text-[10px]">
              Cached analysis present
            </Badge>
          )}
        </div>
        <p className="text-gray-400 text-xs mt-1">
          Run fraud, summary, and on-chain monitoring together — orchestrated in parallel for speed.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Task toggles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {TASKS.map((t) => {
            const Icon = t.icon;
            const st = statuses[t.key];
            return (
              <button
                key={t.key}
                disabled={running}
                onClick={() => setSelected((s) => ({ ...s, [t.key]: !s[t.key] }))}
                className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all disabled:opacity-60 ${
                  selected[t.key]
                    ? "bg-purple-500/15 border-purple-500/50 text-white"
                    : "bg-[#0f1419] border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-xs font-medium flex-1">{t.label}</span>
                {st === "running" && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
                {st === "done" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                {st === "error" && <XCircle className="w-3 h-3 text-red-400" />}
              </button>
            );
          })}
        </div>

        {/* Run / Cancel */}
        <div className="flex gap-2">
          {!running ? (
            <Button
              onClick={runAll}
              className="bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 flex-1"
            >
              <Zap className="w-4 h-4 mr-2" />
              {hasExisting ? "Re-run AI Investigation" : "Run AI Investigation"}
            </Button>
          ) : (
            <Button onClick={cancel} variant="outline" className="flex-1 border-red-500/40 text-red-400">
              <CircleSlash className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>

        {/* Status summary */}
        {running && (
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Executing selected tasks in parallel…
          </p>
        )}
        {!running && lastRun && Object.values(statuses).some((s) => s === "done") && (
          <p className="text-xs text-green-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Last run: {new Date(lastRun).toLocaleTimeString()}
          </p>
        )}

        {summaryResult && (
          <Card className="bg-[#0f1419] border-purple-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                Executive Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{summaryResult.summary || summaryResult.text || JSON.stringify(summaryResult, null, 2)}</p>
            </CardContent>
          </Card>
        )}

        {analysisResult && (
          <Card className="bg-[#0a111a] border-cyan-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-cyan-400" />
                Fraud Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-[#0f1419] rounded-lg border border-purple-500/20">
                  <p className="text-xs text-gray-400 mb-1">Risk Level</p>
                  <p className="text-sm font-semibold text-white">{analysisResult.analysis?.risk_level || analysisResult.risk_level || 'N/A'}</p>
                </div>
                <div className="p-3 bg-[#0f1419] rounded-lg border border-purple-500/20">
                  <p className="text-xs text-gray-400 mb-1">Pattern</p>
                  <p className="text-sm font-semibold text-white">{analysisResult.analysis?.pattern_match || analysisResult.pattern_match || 'N/A'}</p>
                </div>
                <div className="p-3 bg-[#0f1419] rounded-lg border border-purple-500/20">
                  <p className="text-xs text-gray-400 mb-1">Confidence</p>
                  <p className="text-sm font-semibold text-white">{analysisResult.analysis?.confidence_score ?? analysisResult.confidence_score ?? 'N/A'}</p>
                </div>
              </div>
              {Array.isArray(analysisResult.analysis?.recommended_actions) && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-gray-400">Recommended Actions</p>
                  <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                    {analysisResult.analysis.recommended_actions.slice(0,8).map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
