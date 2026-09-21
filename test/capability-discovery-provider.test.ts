import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CapabilityDiscoveryCandidateProvider,
  DEFAULT_CONFIG,
  RouterRepository,
  SessionRouter,
  type MinerCandidate,
  type RouteRequest,
} from "../src/index.js";

const candidate: MinerCandidate = {
  id: "miner-a",
  identity: { did: "did:test:a" },
  enabled: true,
  capabilities: [{ modelId: "m1", assurance: "SOFT", observedAt: "2026-09-21T00:00:00Z" }],
};

const announcement = {
  schema: "flop.agent-capabilities.v1" as const,
  id: "source-a",
  did: "did:test:a",
  runtime: "example-runtime",
  runtimeVersion: "1.2.3",
  available: true,
  observedAt: "2026-09-21T00:00:00Z",
  capabilities: [
    {
      id: "direct-rail-f1",
      version: "1",
      assurance: "SOFT" as const,
      provenance: {
        source: "https://example.test/capabilities",
        verificationState: "OBSERVED" as const,
      },
    },
  ],
  provenance: {
    source: "https://example.test/agent",
    verificationState: "OBSERVED" as const,
  },
};

test("capability discovery preserves version evidence and availability without upgrading assurance", async () => {
  const provider = new CapabilityDiscoveryCandidateProvider(
    { load: async () => [announcement] },
    [{ sourceId: "source-a", candidate }],
  );
  const request: RouteRequest = {
    requestId: "r1",
    constraints: {
      modelId: "m1",
      requiredProtocolCapabilities: [{ id: "direct-rail-f1", version: "1" }],
    },
  };
  const values = await provider.candidates(request);
  assert.equal(values.length, 1);
  assert.equal(values[0]!.discovery?.runtimeVersion, "1.2.3");
  assert.equal(values[0]!.protocolCapabilities?.[0]?.id, "direct-rail-f1");
  assert.equal(values[0]!.protocolCapabilities?.[0]?.assurance, "SOFT");
});

test("offline or identity-mismatched announcements cannot become candidates", async () => {
  const provider = new CapabilityDiscoveryCandidateProvider(
    { load: async () => [
      { ...announcement, available: false },
      { ...announcement, id: "source-b", did: "did:test:wrong" },
    ] },
    [
      { sourceId: "source-a", candidate },
      { sourceId: "source-b", candidate },
    ],
  );
  assert.deepEqual(await provider.candidates({ requestId: "r1", constraints: { modelId: "m1" } }), []);
});

test("router rejects missing and version-mismatched protocol capability before ranking", async () => {
  const dir = mkdtempSync(join(tmpdir(), "router-cap-"));
  const repo = new RouterRepository(join(dir, "r.db"));
  try {
    const provider = new CapabilityDiscoveryCandidateProvider(
      { load: async () => [announcement] },
      [{ sourceId: "source-a", candidate }],
    );
    const router = new SessionRouter(provider, repo, DEFAULT_CONFIG, () => new Date("2026-09-21T00:00:00Z"));
    const mismatch = await router.route({
      requestId: "r2",
      constraints: {
        modelId: "m1",
        requiredProtocolCapabilities: [{ id: "direct-rail-f1", version: "2" }],
      },
    });
    assert.equal(mismatch.status, "NO_ELIGIBLE_MINER");
    assert.ok(mismatch.snapshot.evaluations[0]!.rejectionReasons.includes("PROTOCOL_CAPABILITY_VERSION_MISMATCH"));

    const missing = await router.route({
      requestId: "r3",
      constraints: {
        modelId: "m1",
        requiredProtocolCapabilities: [{ id: "tclk/2", version: "1" }],
      },
    });
    assert.ok(missing.snapshot.evaluations[0]!.rejectionReasons.includes("PROTOCOL_CAPABILITY_MISSING"));
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
