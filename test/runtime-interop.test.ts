import assert from "node:assert/strict";
import test from "node:test";
import { executeRuntimeTarget } from "../src/runtime-interop.js";
import type { RouteDecision } from "../src/types.js";

const decision: RouteDecision = {
  decisionId: "decision_test",
  selectedMinerId: "miner-1",
  status: "SELECTED",
  ranking: ["miner-1"],
  configHash: "config",
  snapshotHash: "snapshot",
  snapshot: {
    request: { requestId: "req-1", constraints: { modelId: "m" } },
    candidates: [],
    evaluations: [],
    config: {
      weights: { success: .3, latency: .18, freshness: .12, preflight: .18, assurance: .1, availability: .12, failedAckPenalty: .2, circuitPenalty: 1 },
      circuitFailureThreshold: 3, circuitCooldownMs: 60000, failedAckHalfLifeMs: 86400000,
      preflightTimeoutMs: 2000, preflightConcurrency: 4, preflightMaxBytes: 65536, allowPrivateEndpoints: false,
    },
    routerVersion: "test",
    capturedAt: "2026-09-24T00:00:00.000Z",
  },
};

test("Router emits a deterministic interoperable runtime receipt", async () => {
  const target = {
    id: "external-demo",
    async discover() { return true; },
    async fingerprint() { return { version: "1.0.0", build: "abc" }; },
    async capabilities() { return ["execute", "receipt"]; },
    async execute() {
      return {
        startedAt: "2026-09-24T00:00:01.000Z",
        finishedAt: "2026-09-24T00:00:02.000Z",
        status: "completed" as const,
        output: { ok: true },
        transcript: ["run"],
        railEvidence: { verified: true },
        evidenceRefs: ["urn:test:1"],
      };
    },
  };
  const first = await executeRuntimeTarget(decision, target, { id: "case-1", input: { x: 1 } });
  const second = await executeRuntimeTarget(decision, target, { id: "case-1", input: { x: 1 } });
  assert.equal(first.receipt.schema, "flop.router-runtime-execution/v1");
  assert.equal(first.receipt.runtime.targetId, "external-demo");
  assert.equal(first.receipt.semanticDigest, second.receipt.semanticDigest);
  assert.equal(first.receipt.receiptId, second.receipt.receiptId);
  assert.equal(first.receipt.router.snapshotHash, "snapshot");
});
