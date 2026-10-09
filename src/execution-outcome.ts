/** A request may have executed remotely. Retain authorization and reconcile before retrying. */
export class ExecutionOutcomeUnknownError extends Error {
  constructor(reason: "ECONOMIC_EXECUTION_OUTCOME_UNKNOWN" | "ECONOMIC_POST_EXECUTION_RECORDING_FAILED" | "INFERENCE_EXECUTION_OUTCOME_UNKNOWN", options?: ErrorOptions) {
    super(reason, options);
    this.name = "ExecutionOutcomeUnknownError";
  }
}
