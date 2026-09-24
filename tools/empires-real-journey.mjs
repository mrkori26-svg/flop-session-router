import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  EmpiresRuntimeTarget,
  RouterRepository,
  SessionRouter,
  StaticCandidateProvider,
  executeRuntimeTarget,
} from "../dist/src/index.js";

const STACK = String.raw`C:\Users\acost\flop stack`;
const EMP = String.raw`C:\Users\acost\Documents\Codex\2026-09-12\build-a-new-repository-named-flop\flop-empires`;
const OUT = join(STACK, "runtime", "empires-journeys");
mkdirSync(OUT, { recursive: true });
const requestId = "recovery-join-e01-1789665460";
const observedAt = new Date().toISOString();

const provider = new StaticCandidateProvider([{
  id: "flop-empires-season0",
  identity: { did: "did:key:z6MkkvjnHUEz5qmMHXZJiTg8BFSjm3KVqZtueNUMdp1FqMpx" },
  enabled: true,
  capabilities: [{
    modelId: "empire.join",
    assurance: "HARD",
    observedAt,
    provenance: {
      source: "http://127.0.0.1:8878/api/interop/capabilities",
      verificationState: "OBSERVED",
      coverage: "COMPLETE",
      observedAt,
    },
  }],
  telemetry: { successEwma: 1, availability: 1, observedAt },
}]);

const repo = new RouterRepository(join(OUT, "real-join-router.db"));
const router = new SessionRouter(provider, repo);
const decision = await router.route({
  requestId,
  constraints: { modelId: "empire.join", minimumAssurance: "HARD" },
  preflight: false,
  maxAttempts: 1,
});
if (decision.status !== "SELECTED") throw new Error("EMPIRES_ROUTE_NOT_SELECTED");

const executor = async () => {
  const startedAt = new Date().toISOString();
  const retryStdout = execFileSync("python", [join(STACK, "_real_empires_idempotent_retry.py")], {
    encoding: "utf8",
  });
  execFileSync("python", [join(STACK, "_prepare_real_empires_evidence.py")], {
    cwd: EMP, encoding: "utf8",
  });
  const native = JSON.parse(readFileSync(join(OUT, "real-join-native.json"), "utf8"));
  if (!native.replay?.match) throw new Error("EMPIRES_REPLAY_NOT_VERIFIED");
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: "completed",
    output: native.receipt,
    transcript: {
      transport: native.transport,
      replay: native.replay,
      retryLog: retryStdout.trim().split(/\r?\n/).slice(-1)[0],
    },
    evidenceRefs: [`technocore:${native.transport.record_id}`],
  };
};

const target = new EmpiresRuntimeTarget("http://127.0.0.1:8878", executor);
const { execution, receipt } = await executeRuntimeTarget(
  decision,
  target,
  { id: "empires-real-join-idempotent-v1", input: {
    capability: "empire.join",
    requestId,
  }},
);
const artifact = { decision, execution, receipt };
writeFileSync(join(OUT, "real-join-router-runtime.json"), JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify({
  decisionId: decision.decisionId,
  selected: decision.selectedMinerId,
  runtimeReceiptId: receipt.receiptId,
  evidenceRefs: receipt.evidenceRefs,
  executionStatus: execution.status,
}));
repo.close();
