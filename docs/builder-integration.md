# Builder integration

The Router is designed to compose with other FLOP/Technocore tools without absorbing their responsibilities.

## Integration contract

A builder integration should provide `MinerCandidate[]` with as much provenance as it can justify. The Router then applies its own deterministic eligibility, score, preflight, failover and persistence rules.

Do not convert missing evidence into perfect telemetry or hard assurance.

## Technocore / DID builders

Useful exchange:

- DID and mailbox identity as candidate identity metadata;
- signed reachability observations as provenance;
- explicit observation timestamps and coverage;
- no private keys, passphrases or signer custody transferred to Router.

## TCLK builders

Useful exchange:

- contract/session references and signed evidence refs;
- explicit asset/unit semantics for quotes;
- no claim that a valid transcript proves value settlement;
- no local reinterpretation of TCLK normative state.

## Inference/miner builders

Useful exchange:

- model ID/hash;
- supported precisions/decode policies;
- endpoint/protocol;
- bounded latency/success observations;
- price amount + asset + unit;
- evidence provenance.

## Conformance Lab

Use the independent Conformance Lab to verify exported evidence rather than coupling conformance policy into Router core.

A high-value collaboration is a small public adapter plus a deterministic fixture and CI test. It should be possible for either project to reproduce the boundary without access to secrets or a funded runtime.

## Verified downstream integration: OpenAgentSearch

OpenAgentSearch maintains an external `MinerCandidateProvider` for this Router at:

- repository: `djd39448/openagentsearch`
- integration path: `integrations/flop-session-router/`
- verified integration commit: `b0b05e76d086eb4c1f9d2a2502afc16802d12804`
- Router pin used by that integration: `dba6525554c4ea5965ef6dd23e93194736aa0ef3`
- independent Router-side reproduction: Actions run `35452319915`

The Router-side reproduction ran the downstream project's own one-command journey and independently verified J1-J7: bound/known-DID admission, unknown-DID exclusion, exact provenance-only mutation, `REPLAY_MATCH`, provider-scoped snapshots, fail-closed empty and throw paths, burst exclude/annotate behavior without upgrading assurance, and fixture-only requests.

This is registered as a verified downstream integration. It is not evidence that OpenAgentSearch identifies real miners, provides price/telemetry/assurance, or proves FLOP runtime compatibility.

### Placement decision: keep the adapter downstream

The OpenAgentSearch adapter remains downstream rather than being copied into Router core.

Reasons:

- `MinerCandidateProvider` already supplies the generic extension boundary required by the integration.
- The adapter contains OpenAgentSearch-specific HTTP transport, response validation, cache policy, concurrency, DID syntax, burst policy and ledger failure semantics.
- Copying those details in-tree would make Router responsible for an external service contract and create duplicate maintenance/security review.
- The downstream implementation already compiles against the Router's real built types and pins the Router by full SHA in CI.
- Router can independently reproduce the integration without owning its service-specific logic.

An in-tree adapter becomes preferable only if OpenAgentSearch exposes a stable, general-purpose discovery contract that multiple Router consumers need, or if Router must guarantee that provider's lifecycle/API compatibility as part of its own release surface. Until then, the supported pattern is: external provider implementation + pinned CI + a Router docs pointer + independent reproduction evidence.

## Upstream contribution rule

When a real mismatch is found, reduce it to the smallest reproducible boundary and send that evidence to the project that owns the behavior. Avoid generic promotion, duplicated issues, or claims of adoption before the downstream maintainer independently runs or merges the integration.

## Runtime capability manifests

The Router accepts an optional `flop.capability-manifest/v1` on each candidate. Requests may set `requiredProtocolCapabilities` to make those capabilities a hard eligibility boundary before scoring.

Semantics are deliberately narrow:

- missing or non-`OBSERVED` manifest -> `PROTOCOL_CAPABILITY_UNKNOWN`;
- observed manifest missing a required capability -> `PROTOCOL_CAPABILITY_UNSUPPORTED`;
- observed compatible manifest -> candidate proceeds through the existing model, price, preflight, circuit and scoring rules;
- manifest evidence does not increase assurance, telemetry, reputation, or score.

The Conformance Lab Runtime Observatory can emit this manifest as a sidecar to a runtime evidence bundle. Consumers should keep liveness, compatibility, verification, and long-term reliability as separate facts.
