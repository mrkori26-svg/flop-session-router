import { ExecutionOutcomeUnknownError } from "./execution-outcome.js";
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
      let result;
      try {
        result = await executor.execute(candidate, request, signal);
      } catch (error) {
        throw new ExecutionOutcomeUnknownError("ECONOMIC_EXECUTION_OUTCOME_UNKNOWN", { cause: error });
      }
      if (result.status === "completed") {
        try {
          await gate.markExecutionComplete?.(authorization);
        } catch (error) {
          throw new ExecutionOutcomeUnknownError("ECONOMIC_POST_EXECUTION_RECORDING_FAILED", { cause: error });
        }
        return result;
      }
      await gate.release?.(authorization, result.reason ?? "execution_failed");
      return result;
    },
  };
}
