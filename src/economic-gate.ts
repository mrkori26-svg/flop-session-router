import type { MinerCandidate, RouteRequest } from "./types.js";
import type { SessionExecutor } from "./router.js";

export type EconomicAuthorization =
  | { status: "AUTHORIZED"; authorizationId: string; reservationRef?: string; evidenceRef?: string }
  | { status: "BLOCKED"; reason: string };

export interface EconomicExecutionGate {
  authorize(candidate: MinerCandidate, request: RouteRequest, signal: AbortSignal): Promise<EconomicAuthorization>;
  release?(authorization: Extract<EconomicAuthorization,{status:"AUTHORIZED"}>, reason: string): Promise<void>;
  markExecutionComplete?(authorization: Extract<EconomicAuthorization,{status:"AUTHORIZED"}>): Promise<void>;
}

export function withEconomicExecutionGate(executor: SessionExecutor, gate: EconomicExecutionGate): SessionExecutor {
  return {
    async execute(candidate, request, signal) {
      const authorization = await gate.authorize(candidate, request, signal);
      if (authorization.status === "BLOCKED") {
        return { status: "failed", retryable: true, reason: `ECONOMIC_GATE_BLOCKED:${authorization.reason}` };
      }
      try {
        const result = await executor.execute(candidate, request, signal);
        if (result.status === "completed") {
          await gate.markExecutionComplete?.(authorization);
          return result;
        }
        await gate.release?.(authorization, result.reason ?? "execution_failed");
        return result;
      } catch (error) {
        await gate.release?.(authorization, error instanceof Error ? error.message : "execution_error");
        throw error;
      }
    },
  };
}
