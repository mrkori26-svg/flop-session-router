import { createHash } from "node:crypto";
import type { BuyerJob } from "./flop-buyer-contract.js";

export interface RetainedArtifact { id: string; sha256: string; bytesBase64: string; }
export interface ResearchEvidence {
  schema: "flop.research-evidence/v1";
  jobId: string;
  artifacts: RetainedArtifact[];
  claims: { execution: "UNKNOWN" | "SUPPLIER_ASSERTION"; settlement: "UNKNOWN" | "SUPPLIER_ASSERTION" };
  coverage: "UNESTABLISHED";
  usage: { inputTokens: { status: "UNAVAILABLE"; value: null }; outputTokens: { status: "UNAVAILABLE"; value: null } };
  economicExecutionAllowed: false;
  limitations: string[];
}
/** Explicit private export. Retains proof values; never includes keys, signer payloads,
 * prompts, or generated text. JSON bytes are hashed exactly, not claimed as RFC8785.
 * The caller must protect this export: upstream proof objects can contain private data. */
export function buildResearchEvidence(job: BuyerJob): ResearchEvidence {
  const artifacts: RetainedArtifact[] = [];
  const retain = (id: string, value: unknown) => {
    if (value === undefined) return;
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    artifacts.push({ id, sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex"), bytesBase64: bytes.toString("base64") });
  };
  const o = job.observation;
  retain("job", {
    jobId: job.id, state: job.state, version: job.version, observedAt: job.updatedAt, requestHash: job.requestHash,
    configHash: job.configHash, reservedBaseUnits: job.reservedBaseUnits, chargedBaseUnits: job.chargedBaseUnits,
    payerAccount: job.binding?.agentAccount, genesisHash: job.binding?.genesisHash,
    modelId: job.request?.constraints.modelId, modelHash: job.request?.constraints.modelHash,
    precision: job.request?.constraints.precision, transactionHash: job.signed?.transactionHash ?? o?.transactionHash,
    finalizedBlockHash: o?.finalizedBlockHash, channelId: job.channelId,
    requestingDid: null, creditedAccount: null,
    resultDigest: o?.result === undefined ? null : "sha256:" + createHash("sha256").update(o.result).digest("hex")
  });
  retain("execution-proof", o?.executionProof);
  retain("settlement-proof", o?.settlementProof);
  return {
    schema: "flop.research-evidence/v1", jobId: job.id, artifacts,
    claims: {
      execution: job.state === "SETTLED" && o?.executionProof !== undefined ? "SUPPLIER_ASSERTION" : "UNKNOWN",
      settlement: job.state === "SETTLED" && o?.settlementProof !== undefined ? "SUPPLIER_ASSERTION" : "UNKNOWN"
    },
    coverage: "UNESTABLISHED",
    usage: { inputTokens: { status: "UNAVAILABLE", value: null }, outputTokens: { status: "UNAVAILABLE", value: null } },
    economicExecutionAllowed: false,
    limitations: ["Digests bind retained bytes, not their truth or complete observation.",
      "Independent execution and chain verifiers must recheck the retained proofs.",
      "Requester and credit beneficiary are not inferred from the payer.",
      "Quote token estimates are not measured usage.", "This export grants no spending or rewards."]
  };
}
