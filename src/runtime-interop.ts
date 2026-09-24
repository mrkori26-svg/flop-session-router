import { sha256 } from "./canonical.js";
import type { RouteDecision } from "./types.js";

export const ROUTER_RUNTIME_RECEIPT_SCHEMA = "flop.router-runtime-execution/v1" as const;

export interface RuntimeTestCase<TInput = unknown> { id: string; input: TInput; }

export interface RuntimeTargetExecution {
  startedAt: string;
  finishedAt: string;
  status: "completed" | "failed";
  output: unknown;
  transcript?: unknown;
  railEvidence?: unknown;
  evidenceRefs?: string[];
  reason?: string;
}

export interface RuntimeTarget<TInput = unknown> {
  id: string;
  discover(): Promise<boolean>;
  fingerprint(): Promise<Record<string, string | number | boolean | null>>;
  capabilities(): Promise<string[]>;
  execute(testCase: RuntimeTestCase<TInput>, signal?: AbortSignal): Promise<RuntimeTargetExecution>;
}

export interface RouterRuntimeExecutionReceipt {
  schema: typeof ROUTER_RUNTIME_RECEIPT_SCHEMA;
  receiptId: string;
  observedAt: string;
  router: {
    decisionId: string;
    requestId: string;
    selectedMinerId: string;
    snapshotHash: string;
    configHash: string;
  };
  runtime: {
    targetId: string;
    fingerprint: Record<string, string | number | boolean | null>;
    capabilities: string[];
  };
  testCaseId: string;
  execution: {
    startedAt: string;
    finishedAt: string;
    status: "completed" | "failed";
    outputDigest: string;
    transcriptDigest?: string;
    railEvidenceDigest?: string;
    reason?: string;
  };
  evidenceRefs: string[];
  semanticDigest: string;
}

export async function executeRuntimeTarget<TInput>(
  decision: RouteDecision,
  target: RuntimeTarget<TInput>,
  testCase: RuntimeTestCase<TInput>,
  signal?: AbortSignal,
): Promise<{ execution: RuntimeTargetExecution; receipt: RouterRuntimeExecutionReceipt }> {
  if (decision.status !== "SELECTED" || !decision.selectedMinerId) throw new Error("ROUTER_DECISION_NOT_EXECUTABLE");
  if (!await target.discover()) throw new Error(`RUNTIME_TARGET_UNAVAILABLE_${target.id}`);

  const [fingerprint, capabilities] = await Promise.all([target.fingerprint(), target.capabilities()]);
  const execution = await target.execute(testCase, signal);
  const observedAt = new Date().toISOString();
  const semantic = {
    router: {
      decisionId: decision.decisionId,
      requestId: decision.snapshot.request.requestId,
      selectedMinerId: decision.selectedMinerId,
      snapshotHash: decision.snapshotHash,
      configHash: decision.configHash,
    },
    runtime: { targetId: target.id, fingerprint, capabilities: [...capabilities].sort() },
    testCaseId: testCase.id,
    execution: {
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      status: execution.status,
      outputDigest: sha256(execution.output),
      transcriptDigest: execution.transcript === undefined ? undefined : sha256(execution.transcript),
      railEvidenceDigest: execution.railEvidence === undefined ? undefined : sha256(execution.railEvidence),
      reason: execution.reason,
    },
    evidenceRefs: [...(execution.evidenceRefs ?? [])].sort(),
  };
  const semanticDigest = sha256(semantic);
  const receipt: RouterRuntimeExecutionReceipt = {
    schema: ROUTER_RUNTIME_RECEIPT_SCHEMA,
    receiptId: `runtime_receipt_${semanticDigest.slice(0, 32)}`,
    observedAt,
    ...semantic,
    semanticDigest,
  };
  return { execution, receipt };
}
