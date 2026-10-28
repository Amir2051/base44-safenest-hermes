/**
 * useHermesInvestigation — Hook for starting Hermes investigations from SafeNestT
 *
 * Provides a safe, authorized way for the frontend to initiate investigations
 * via the server-side Base44 function bridge.
 *
 * Uses base44.functions.invoke() which:
 * - Routes through the Base44 backend (works in dev AND production)
 * - Automatically attaches auth cookies
 * - Supports both entity-style (dot notation) and function-style (string) invocation
 *
 * Usage:
 *   const { startInvestigation, status, health, error } = useHermesInvestigation();
 *   await startInvestigation({ caseId, targetType, targetValue, investigationType });
 */

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isCustomBackendEnabled, startCustomHermesInvestigation, getCustomHermesStatus, checkCustomHermesHealth } from "@/lib/customEntityApi";

// lazy-load base44 to avoid build issues when SDK is not available
async function getBase44() {
  // Try SDK import first
  if (typeof window !== "undefined" && window.base44) {
    return window.base44;
  }
  // Try dynamic import of compat layer
  try {
    const compat = await import("@base44/vite-plugin/compat/functions.cjs");
    if (compat && typeof compat.invoke === "function") {
      return compat;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Hermes bridge function name in Base44 */
const HERMES_FUNCTION = "hermesStart";

/**
 * Start an investigation for a case.
 *
 * @param params
 * @param params.caseId          - The case to investigate (must be owned by user or admin)
 * @param params.targetType      - Type of target: "domain", "wallet", "email", "ip", etc.
 * @param params.targetValue     - The target value to investigate
 * @param params.investigationType - Investigation type (default "web")
 * @returns Promise resolving to the Hermes result (always returns immediately with QUEUED;
 *          the Hermes engine runs the pipeline asynchronously; poll getHermesStatus for completion)
 */
export async function startHermesInvestigation({
  caseId,
  targetType = "domain",
  targetValue,
  investigationType = "web",
  entityType = "MyCase",
}) {
  if (!caseId) throw new Error("caseId is required");
  if (!targetValue) throw new Error("targetValue is required");

  if (isCustomBackendEnabled()) {
    try {
      return await startCustomHermesInvestigation({ caseId, entityType, targetType, targetValue, investigationType });
    } catch (e) {
      const message = e?.message || String(e);
      if (message.includes("401") || message.includes("Unauthorized") || message.includes("unauth")) throw new Error("You must be logged in to start an investigation");
      if (message.includes("403") || message.includes("access") || message.includes("forbidden")) throw new Error("You do not have access to start an investigation for this case");
      if (message.includes("503") || message.includes("not configured") || message.includes("unavailable")) throw new Error("Investigation engine is not configured or reachable. Please contact your administrator.");
      if (message.includes("502") || message.includes("server error")) throw new Error("Investigation engine returned an error. Please try again.");
      throw new Error(message);
    }
  }

  const b44 = await getBase44();
  if (!b44) {
    throw new Error(
      "Hermes integration unavailable: Base44 SDK not loaded. " +
      "The application may not be running in a Base44 environment."
    );
  }

  try {
    // Use function-style invocation which is supported in both compat and SDK
    if (typeof b44.functions?.invoke === "function") {
      const result = await b44.functions.invoke(HERMES_FUNCTION, {
        case_id: caseId,
        target_type: targetType,
        target_value: targetValue,
        investigation_type: investigationType,
      });
      return result;
    }

    if (typeof b44[HERMES_FUNCTION] === "function") {
      const result = await b44[HERMES_FUNCTION]({
        case_id: caseId,
        target_type: targetType,
        target_value: targetValue,
        investigation_type: investigationType,
      });
      return result;
    }

    throw new Error("Hermes function not found in Base44 SDK");
  } catch (e) {
    const message = e?.message || String(e);
    if (message.includes("401") || message.includes("Unauthorized") || message.includes("unauth")) {
      throw new Error("You must be logged in to start an investigation");
    }
    if (message.includes("403") || message.includes("access") || message.includes("forbidden")) {
      throw new Error("You do not have access to start an investigation for this case");
    }
    if (message.includes("503") || message.includes("not configured") || message.includes("unavailable")) {
      throw new Error("Investigation engine is not configured. Please contact your administrator.");
    }
    if (message.includes("502") || message.includes("server error")) {
      throw new Error("Investigation engine returned an error. Please try again.");
    }
    throw new Error(message);
  }
}

/**
 * Get the status of a Hermes investigation.
 */
export async function getHermesStatus(investigationId) {
  if (!investigationId) throw new Error("investigationId is required");
  if (isCustomBackendEnabled()) return getCustomHermesStatus(investigationId);

  const b44 = await getBase44();
  if (!b44) {
    throw new Error("Base44 SDK not available");
  }

  try {
    if (typeof b44.functions?.invoke === "function") {
      const result = await b44.functions.invoke(HERMES_FUNCTION, {
        _action: "status",
        id: investigationId,
      });
      return result;
    }
    if (typeof b44[HERMES_FUNCTION] === "function") {
      const result = await b44[HERMES_FUNCTION]({
        _action: "status",
        id: investigationId,
      });
      return result;
    }
    throw new Error("Hermes function not found");
  } catch (e) {
    const message = e?.message || String(e);
    if (message.includes("404")) {
      throw new Error("Investigation not found");
    }
    throw new Error(message);
  }
}

/**
 * Check Hermes engine health.
 */
export async function checkHermesHealth() {
  if (isCustomBackendEnabled()) return checkCustomHermesHealth();
  const b44 = await getBase44();
  if (!b44) {
    return { status: "unavailable", detail: "Base44 SDK not available" };
  }

  try {
    if (typeof b44.functions?.invoke === "function") {
      const result = await b44.functions.invoke(HERMES_FUNCTION, { _action: "health" });
      return result || { status: "unknown" };
    }
    if (typeof b44[HERMES_FUNCTION] === "function") {
      const result = await b44[HERMES_FUNCTION]({ _action: "health" });
      return result || { status: "unknown" };
    }
    return { status: "unavailable", detail: "Hermes function not found" };
  } catch (e) {
    return { status: "unavailable", error: String(e) };
  }
}

/**
 * React hook for Hermes investigations.
 *
 * @returns
 *   - startInvestigation: async function to start an investigation
 *   - getStatus: async function to get investigation status
 *   - health: current health check result (from query cache)
 *   - error: last error (for UI feedback)
 *   - isLoading: whether a request is in flight
 */
export function useHermesInvestigation() {
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const startInvestigation = useCallback(
    async (params) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await startHermesInvestigation(params);
        return result;
      } catch (e) {
        setError(e.message || String(e));
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getStatus = useCallback(
    async (investigationId) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getHermesStatus(investigationId);
        return result;
      } catch (e) {
        setError(e.message || String(e));
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Health check via React Query (cached, refetched on window focus)
  const healthQuery = useQuery({
    queryKey: ["hermes-health"],
    queryFn: checkHermesHealth,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
    retry: 1,
  });

  return {
    startInvestigation,
    getStatus,
    health: healthQuery.data,
    healthStatus: healthQuery.isLoading ? "checking" : healthQuery.data?.status || "unknown",
    healthAvailable: healthQuery.data?.status === "ok",
    error,
    isLoading,
  };
}

/**
 * Hook to poll investigation status until completion.
 *
 * @param investigationId - The Hermes investigation ID
 * @param intervalMs      - Polling interval (default 3000ms)
 * @param maxPolls        - Maximum polls before giving up (default 120 = 60 seconds)
 * @returns A promise that resolves when the investigation reaches a terminal state
 */
export function usePollInvestigationStatus(
  investigationId,
  intervalMs = 3000,
  maxPolls = 120
) {
  const poll = useCallback(async () => {
    let polls = 0;
    while (polls < maxPolls) {
      await new Promise((r) => setTimeout(r, intervalMs));
      polls++;
      try {
        const status = await getHermesStatus(investigationId);
        const s = status.status || "";
        const normalized = String(s).toUpperCase().replace(/[\s-]+/g, "_");
        if ([
          "COMPLETED", "COMPLETE", "DONE", "SUCCESS", "SUCCEEDED", "FINISHED", "OK",
          "COMPLETED_WITH_ERRORS", "COMPLETED_WITH_WARNINGS", "COMPLETED_WITH_FAILURES",
          "PARTIAL_SUCCESS", "PARTIALLY_COMPLETED", "PARTIAL_FAILURE", "PARTIALLY_FAILED",
          "FAILED", "ERROR", "ERRORED", "FAILED_WITH_RESULTS", "CANCELLED", "CANCELED",
          "ABORTED", "EXPIRED", "TIMEOUT", "TIMED_OUT", "UNKNOWN",
        ].includes(normalized)) {
          return status;
        }
      } catch (e) {
        return { status: "ERROR", error: e.message, investigation_id: investigationId };
      }
    }
    return {
      status: "TIMEOUT",
      error: { code: "poll_timeout", message: "Investigation did not complete in time" },
      investigation_id: investigationId,
    };
  }, [investigationId, intervalMs, maxPolls]);

  return { poll };
}
