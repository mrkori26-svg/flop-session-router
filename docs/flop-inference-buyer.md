# Durable FLOP inference buyer

This is the existing Session Router's buyer controller, not another router or signer. Economic calls default off. The shipped FLOP adapter explicitly reports BLOCKED_BY_UPSTREAM: there is no simulated production fallback and no invented RPC, ABI or chain event.

## Operating surfaces

All buyer CLI commands require `--db` with an absolute path to a durable runtime/state database outside the source checkout. Keep ONE database authority per account/network. Do not delete, copy to another live path, or replace the database to recover an uncertain purchase; doing that discards its idempotency and budget authority. Back up SQLite correctly (including WAL) while it is open.

```
flop-router buyer-doctor --config examples/flop-buyer.disabled.json --db <absolute-runtime-db>
flop-router buyer-models --config <config> --db <absolute-runtime-db>
flop-router buyer-enqueue --config <config> --requests <request-array.json> --db <absolute-runtime-db>
flop-router buyer-once --config <config> --db <absolute-runtime-db>
flop-router buyer-run --config <config> --db <absolute-runtime-db> --poll-ms 1000
flop-router buyer-inspect <job-id> --config <config> --db <absolute-runtime-db>
flop-router buyer-evidence <job-id> --config <config> --db <absolute-runtime-db>
```

The loop drains an explicitly supplied goal queue without prompting for every inference and stops on SIGINT/SIGTERM. It creates no terminal or service. For Windows supervision, use the stack's existing hidden-launch policy; do not register another competing daemon. No daemon is installed or enabled by this change.

Each request has `idempotencyKey`, existing `InferenceRequest` (`model`, bounded `messages`, required `maxTokens`, optional `temperature`), existing `RouteConstraints` (`modelId`, pinned `modelHash`, `precision`, latency and optional comparable-price/capability constraints), and `maxCostBaseUnits`. `modelId` must equal the objective's model. Supply model/measurement bindings from the official registry and attested provider; no placeholder model is treated as available.

## Explicit authorization and policy

`loadBuyerConfig` rejects unknown fields and ambiguous values. `enabled` defaults false; environments are DEV, TESTNET, MAINNET. An enabled controller requires the environment in `allowedEnvironments`, pinned 32-byte hex `genesisHash`/`agentAccount`, an explicit non-secret `executionAuthorizationId`, and positive u128 decimal `maxTotalSpendBaseUnits`, `maxSessionEscrowBaseUnits`, `maxTransactionFeeBaseUnits`. The authorization reference records operator intent; it is not an upstream admission credential. MAINNET spending is prohibited even when it appears in the allowed list.

Also configure `controlledMinerAccounts`, `maxConcurrent` (1–16), `maxLatencyMs`, `networkTimeoutMs` (≤60 seconds), `leaseMs` (at least eight network timeouts), `maxAttempts`, `circuitFailureThreshold`, `circuitCooldownMs`. Values are canonical decimal base-unit strings, never floats. Scope is environment + genesis + account; changing the authorization reference does NOT reset cumulative spend. Lowering a budget does not free pending funds. Queued goals record the financial policy; toggling enabled or changing worker/timeout controls does not require reauthorizing each goal. Changing the financial policy or authorization reference blocks previously queued goals until explicitly reviewed; pending submissions always remain eligible for read-only reconciliation.

Economic availability requires a correctly bound AVAILABLE transport, no readiness blockers, and a supported custody operation. LOCAL_TEST drivers are rejected outside DEV. The CLI ships neither that local driver nor an available production driver: it remains blocked even if a config enables the controller.

## Durable lifecycle and safety

RouterRepository owns the existing SQLite connection, with buyer tables, WAL, FULL synchronous durability, atomic account reservation and leased/fenced workers. Requests are deduplicated by scope and idempotency key; changed content under the same key fails. Budget combines all pending reservations and finalized charges. Accounting, job integrity, nonce allocation and a chained audit journal are checked before work.

Workers may process queued requests concurrently, but the account's planning/submission lane is acquired BEFORE reading balance and account nonce and stays held until externally verified terminal disposition. This deliberately serializes economic sessions on one account; `maxConcurrent` does not permit overlapping financial nonces. Account nonce is validated as u32; durable channel nonce is u64 and never reused, including after abandoned pre-submit preparation.

```
QUEUED/BLOCKED → PREPARING → RESERVED → SIGNING → SIGNED
             → SUBMITTING → PENDING/EXECUTING → VERIFYING → SETTLED/REJECTED
                                ↘ OUTCOME_UNKNOWN ↗
SETTLED → FINALITY_LOST (freeze)
```

SUBMITTING is committed before network submission. A crash, timeout or connectivity loss from that point retains the reservation and triggers read-only reconciliation; it NEVER blindly resubmits. A separate durable executionStartedAt marker precedes provider inference dispatch after verified acceptance, preventing duplicate goals across restarts. Unknown dispatches are reconciled, not resent. Recovery before SUBMITTING can release a LOCAL reservation and prepare anew: no network escrow was opened yet. Retries of pre-submit reads are bounded; circuit cooldowns stop repeated failures. Pending observations past the latency deadline become uncertain; the account stays locked while reconciliation continues.

Settlement requires an independently configured protocol verifier, finalized inclusion block, valid execution proof/result, valid settlement proof, transaction binding, full cooperative escrow payable, bounded fees and an exact account-balance delta. Incoming transfers, external spending or ambiguous balances require reconciliation rather than guessing. Rejection releases escrow budget only when externally verified terminal evidence proves zero payment and binds any charged fee. This implementation supports the cooperative reserved-capacity path; force-open, unilateral settlement, top-ups and disputes stay in the upstream transport boundary until their actual bindings can be integrated.

Previously settled jobs are checked before new spending. Reported finality loss or changed finalized settlement freezes the account; spent entries are retained. A transient failure to recheck does not fabricate a reorg, but freezes new spending conservatively. There is intentionally no automatic unfreeze or operator “release unknown” bypass; resolution of frozen contradictory accounting requires authoritative evidence and a reviewed recovery implementation.

## Signer and external interfaces

`CanonicalFlopBuyerSigner.status()` invokes the EXISTING Python authenticated AF_PIPE client in a hidden, bounded child. It loads only the existing protected IPC authentication token, does not provision it, preserves CurrentUser DPAPI/SID authentication and never loads/exports the signing seed. Missing custody or malformed status fails closed. Optional CLI diagnosis: `--signer-directory <canonical-directory> --python <python-executable>`.

The canonical service currently has no restricted FLOP extrinsic operation. `sign()` therefore fails closed; a Technocore room signature, EphemeralSigner or HTTP signer is not a fallback. Add the narrowly scoped custody operation only against the published signing payload/domain and decoded call/budget bindings, without changing key custody.

`FlopBuyerTransport` and `FlopBuyerVerifier` are APPLICATION PORTS, not official RPC methods or wire schemas. The former isolates discovery/quote, SDK byte construction, opening submission, verified acceptance, one-time inference dispatch and observation; execute must carry the persisted goal and own the attested per-turn exchanges/final receipt using restricted canonical custody. Those SDK exchanges/signing bindings remain blocked upstream, not implemented by invented endpoints. Context/quote/build/observe are read-only or pure; only submit and execute cross side-effect boundaries; the latter must verify authoritative chain/offer/unsigned/signed/execution/settlement bytes and proofs, not flags or self-generated hashes. `FlopRuntimeAdapter(config, sdkDriver)` can accept a bound driver providing existing candidate discovery and transport together; `buyerTransport()` rejects cross-environment/genesis drivers. No official SDK driver or cryptographic chain verifier is asserted here.

The controller reuses `prepareFlopChannel`, Router decisions and eligibility. That helper's PREPARED_BLOCKED_UPSTREAM audit digest is not a channel id, encoded extrinsic or verified quote. The binding exposes the expected known open-channel fields, precision, maximum latency, cooperative policy, environment and authorization reference to both signer and verifier; an opaque hash alone is insufficient. The future SDK driver must bind the full request, actual SLA/precision/settlement-class runtime types, account and channel nonce, call and fee caps. It must verify its decoding and return the protocol's actual transaction hash. Observation `finalizedBlockHash` refers to the settlement's immutable inclusion block, not a changing best/finalized tip. Evidence retains proof digests/references for the existing receipt/EvidenceBundle pipeline; those hashes alone are not official execution or settlement evidence.

Sources checked from this PC on 2026-10-09: [public draft](https://github.com/flop-labs/yellowpaper/blob/3c97bbc8d6ba68cf2ea003ab88bc154aafdf105e/yellowpaper.md), [normative site](https://flop.finance/intro/yellowpaper/), [testnet](https://flop.finance/testnet/). E.55 remains PLANNED; Appendix G lists logical channel operations without public runtime metadata/SDK access. The private engineering repo returns 404 for this account. Onboarding is announced for testnet opening, not verified as available to this wallet. Co-signed receipts alone are not execution proof; finality is BABE/AlephBFT, and cooperative escrow is the full capacity price, not unused-token refunds.

Local tests use an explicitly LOCAL_TEST driver, local JSON bytes/proof markers and test-only Ed25519 keys. They verify controller logic and invalid-signature rejection; they are not FLOP sessions, official encodings or chain proof validation. These fixtures live only in tests, outside the production package exports.
