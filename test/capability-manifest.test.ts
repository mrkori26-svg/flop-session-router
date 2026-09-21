import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, RouterRepository, SessionRouter, StaticCandidateProvider, type MinerCandidate, type RouteRequest } from "../src/index.js";

const now = "2026-09-21T00:00:00.000Z";
function candidate(manifest?: MinerCandidate["capabilityManifest"]): MinerCandidate {
  return {
    id: "miner-a", identity: { did: "did:test:miner-a" }, enabled: true,
    capabilities: [{ modelId: "m1", assurance: "SOFT", observedAt: now }],
    capabilityManifest: manifest,
  };
}
function setup(value: MinerCandidate) {
  const dir = mkdtempSync(join(tmpdir(), "router-cap-manifest-"));
  const repo = new RouterRepository(join(dir, "router.db"));
  const router = new SessionRouter(new StaticCandidateProvider([value]), repo, DEFAULT_CONFIG, () => new Date(now));
  return { router, repo, clean: () => { repo.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const request: RouteRequest = { requestId: "r-cap", constraints: { modelId: "m1", requiredProtocolCapabilities: ["direct-rail-f1"] } };

test("required protocol capability fails closed when manifest is missing", async () => {
  const s = setup(candidate());
  try {
    const decision = await s.router.route(request);
    assert.equal(decision.status, "NO_ELIGIBLE_MINER");
    assert.deepEqual(decision.snapshot.evaluations[0]?.rejectionReasons, ["PROTOCOL_CAPABILITY_UNKNOWN"]);
  } finally { s.clean(); }
});

test("observed compatible manifest gates eligibility but does not alter score", async () => {
  const manifest = { schema: "flop.capability-manifest/v1" as const, identity: "did:test:miner-a", implementation: "reference-f1", version: "1", capabilities: ["direct-rail-f1"], evidence: [], availability: { status: "OBSERVED" as const, observedAt: now } };
  const s = setup(candidate(manifest));
  try {
    const decision = await s.router.route(request);
    assert.equal(decision.status, "SELECTED");
    assert.equal(decision.selectedMinerId, "miner-a");
    assert.deepEqual(decision.snapshot.evaluations[0]?.rejectionReasons, []);
  } finally { s.clean(); }
});

test("observed manifest missing required capability is incompatible", async () => {
  const manifest = { schema: "flop.capability-manifest/v1" as const, identity: "did:test:miner-a", implementation: "other", version: "1", capabilities: ["tclk/1"], evidence: [], availability: { status: "OBSERVED" as const, observedAt: now } };
  const s = setup(candidate(manifest));
  try {
    const decision = await s.router.route(request);
    assert.deepEqual(decision.snapshot.evaluations[0]?.rejectionReasons, ["PROTOCOL_CAPABILITY_UNSUPPORTED"]);
  } finally { s.clean(); }
});
