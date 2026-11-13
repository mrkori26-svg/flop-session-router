# Research assurance integration — 2026-11-13

These are local engineering controls inspired by the research reviewed on October 23,
October 30, November 6 and November 13. They are NOT implementations or certifications
of those external specifications. A locally successful fixture is not public-chain evidence.

## Operational interfaces

Router: buyer.retainedEvidence(jobId) is an explicit PRIVATE export.
It retains exact JSON proof bytes and their SHA-256 digests, a sanitized job binding,
and separate claim boundaries. It does not export prompts, generated text, private keys,
or signer payloads. Upstream proof objects can themselves contain confidential information;
do not publish the export without review. Missing measured usage is unavailable, not zero.
An export never authorizes spending and never claims rewards.

Lab independent recheck, with expected values held OUTSIDE the supplied capsule:

    npm run build
    npm run research:assurance -- verify --input private-capsule.json --expect trusted-expectations.json --out report.json

Expected keys: requestHash, configHash, payerAccount, genesisHash,
modelId, modelHash, precision, transactionHash.
Use values from the independently approved request and policy, not values copied out of the capsule.
Exit codes: 0 for bounded arithmetic/trace/observation check; 1 failure; 2 partial/unknown/error.
Evidence checks remain PARTIAL until independent execution, settlement and attribution
verifiers establish those properties. A byte digest alone can never do that.

The existing flop-conformance verify --profile router-evidence --input ... CLI/Action
exposes a conservative portable PARTIAL/FAIL result. It does not accept trusted expected
values from inside the untrusted bundle. Existing result schemas include the new profile,
and the previously missing empires-journey and flop-agent profile names.

Additional offline commands through research:assurance:
- usage: JSON array of domain/id/invocation/amount/unit/scope records; amount: null
  means unavailable. Explicit correction target {domain,id}; unsigned integer quantities.
  Deduplicates identical transport records, rejects conflicts and correction cycles/branches,
  applies replacements without adding the original twice. Mixed units fail; unresolved
  subtree overlap remains UNKNOWN. Arithmetic validity does not authenticate measurements.
- migration: {before: [...], after: [...]} paired scenarios containing scenario,
  inputDigest, policyDigest, model, actionDigest and safety (PASS/FAIL/UNKNOWN).
  A changed context cannot establish model compatibility; safety failures fail;
  action drift needs review. PASS covers only supplied scenarios, not statistical robustness.
- gateways: JSON array of actual trials, identified by gateway/model/harness/task.
  Optional benignSuccess, indirectAttackSuccess, latencyMs and tokens.
  Distinct repetitions require distinct task trial IDs. Reports actual denominators,
  separate security/capability/latency/token metrics; missing measurements remain null.
  It does not fabricate published GatewayBench results or certify a gateway.
- lifecycle: array of BuyerState names. Checks the supplied state sequence against the
  existing buyer transition graph. It cannot prove complete sequence coverage or settlement.

## Scope mapped to every research theme

| Theme | Implemented / verified locally | Boundary |
|---|---|---|
| GatewayBench | Separate observed metrics and per-model/harness grouping | No live gateway campaign, attacks or invented measurements |
| SEER reproducibility / AgentProofBench | Exact retained bytes, caller-owned expectations, tamper and changed-binding tests | No claim that a digest proves reality or complete observations |
| Maestro / Pre-QED | Explicit lifecycle graph and regression scenarios; existing crash/retry/cancel/concurrency tests retained | No Lean/Rocq proof or universal sequence-coverage claim |
| Web Bot Auth / DID-HTTP | Existing official signer boundary retained and regression-tested | No experimental replacement of official FLOP signing formats |
| Agent Registrar / evaluation state | Verification without checks rejected; FAIL dominates known contradictions; missing evidence PARTIAL/UNKNOWN | Not a dependency adoption or issuer trust endorsement |
| Mandates and budgets | Existing BEGIN IMMEDIATE budget/nonce reservations characterized by buyer concurrency/restart tests | Cross-provider shared budgets need an official shared accounting contract |
| Verdict Records | Independent consumer rechecks exact bytes and external expectations | Not wire-compatible with the experimental draft; no auto-PASS for copied flags |
| Usage Accounting | Missing vs zero, deduplication, retries, corrections and overlap boundaries | No proof that a reported counter or payment is true |
| CertClaim / model transition | Paired observation gate and required policy/context matching | No statistical model fingerprinting, calibration or cryptographic inference proof |
| ANS | No replacement of canonical DID, discovery or key custody | Adoption awaits an official interoperability need and verified trust roots |
| Attribution / settlement | Known beneficiary mismatch fails even with missing prerequisites; payer/requester/beneficiary remain separate | Reward eligibility and missing external evidence remain UNKNOWN |

## Existing protections preserved

The buyer already reserves budget and channel nonce atomically in SQLite; retains reservations
on uncertain outcomes; durably marks submission and inference dispatch before network effects;
reconciles without resubmission after restart; verifies unsigned and signed binding, quote,
execution and settlement using injected verifier ports; freezes discrepancies and finality loss.
Those tests run offline using explicitly local fixtures, not public purchases.

## Research references

- https://arxiv.org/abs/2610.23449
- https://arxiv.org/abs/2610.23845
- https://arxiv.org/abs/2610.25920
- https://arxiv.org/abs/2610.34634
- https://datatracker.ietf.org/doc/html/draft-ietf-webbotauth-httpsig-protocol-01
- https://docs.agentregistrar.dev/agent-identity/v1/changelog/
- https://www.ietf.org/ietf-ftp/internet-drafts/draft-hulea-wimse-agent-mandate-01.html
- https://datatracker.ietf.org/doc/html/draft-wright-verdict-record-02
- https://datatracker.ietf.org/doc/html/draft-zhang-ioa-usage-accounting-01
- https://arxiv.org/abs/2611.01950
- https://arxiv.org/abs/2611.15207
- https://arxiv.org/abs/2611.10628
- https://ansinfo.ai/

## Freshness and logical invocation identity

Caller policy can also supply asOf (ISO timestamp) and maxAgeMs (nonnegative safe integer).
Missing source timestamp, missing caller clock, future timestamp or expired age remains UNKNOWN;
the checker never substitutes local time or assumes freshness. This bounds the snapshot timestamp,
not the truth or freshness of an external proof.

Usage records may specify dimension (for example input-token or output-token).
Different dimensions cannot be added. Identical measurements for the same domain/invocation/unit/
scope/dimension under another transport record ID are counted once. Different values for the same
invocation remain UNKNOWN pending explicit correction. True retries require a new invocation ID.

## Final verification
Both npm run check commands exited 0 after the final changes.
Router 149/149; Lab 348/348; 0 failures and 0 skipped tests.
Four producer/consumer compatibility and mutation checks passed.
Both package smoke checks and BACKGROUND_RUNTIME_POLICY_PASS passed.
Source hashes and logs: ../artifacts/research-hardening-20261113/.
No commit, push, live transaction or service restart was performed.
Existing unrelated changes were preserved. Compiled CLI/export APIs are available;
already running Node workers need a controlled restart to load changed modules.
Full formal proofs, CertClaim calibration, live gateway benchmarking and ANS adoption
remain outside the implemented local scope and are not claimed complete.
