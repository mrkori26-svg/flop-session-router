import { sha256 } from "./canonical.js";
import type { RouteDecision } from "./types.js";

/** Pinned public draft, NOT a deployed runtime ABI. */
export const FLOP_SPEC = Object.freeze({
  repository: "https://github.com/flop-labs/yellowpaper",
  commit: "3c97bbc8d6ba68cf2ea003ab88bc154aafdf105e",
  version: "0.5.0-draft",
  liveSpecification: "https://flop.finance/intro/yellowpaper/",
  liveSpecificationHtmlSha256: "1be81b373ec7f257d8f67b8d47189e8d6e71768e6fc5f4d568a7eb6676ea738b",
  checkedAt: "2026-10-09T19:09:18Z",
});
export interface FlopTestnetConfig {
  environment: "local" | "devnet" | "public-testnet";
  prepareEnabled: boolean;
  purchaseEnabled: false;
  genesisHash?: string;
  agentAccount?: string;
  maxEscrowBaseUnits?: string;
  maxTransactionFeeBaseUnits?: string;
}
function fail(reason: string): never { throw new Error(reason); }
function record(value: unknown, keys: string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`INVALID_${name}`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) fail(`UNKNOWN_${name}_FIELD`);
  return result;
}
function hex32(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) fail(`INVALID_${name}`);
  return value as string;
}
function unsigned(value: unknown, bits: number, name: string, positive = false): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 39) fail(`INVALID_${name}`);
  const n = BigInt(value as string);
  if (n >= 1n << BigInt(bits) || (positive && n === 0n)) fail(`INVALID_${name}`);
  return value as string;
}
function booleanFlag(value: unknown, name: string): boolean {
  if (value !== true && value !== false) fail(`INVALID_${name}`);
  return value as boolean;
}
function envFlag(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false") fail(`INVALID_${name}`);
  return value === "true";
}
/** File configuration, with explicit environment overrides; no keys or endpoint guesses. */
export function loadFlopTestnetConfig(value: unknown = {}, env: NodeJS.ProcessEnv = process.env): FlopTestnetConfig {
  const file = record(value, ["environment", "prepareEnabled", "purchaseEnabled", "genesisHash", "agentAccount", "maxEscrowBaseUnits", "maxTransactionFeeBaseUnits"], "TESTNET_CONFIG");
  const environment = env.FLOP_TESTNET_ENVIRONMENT ?? file.environment ?? "local";
  if (!["local", "devnet", "public-testnet"].includes(environment as string)) fail("INVALID_TESTNET_ENVIRONMENT");
  // Reject purchase activation in either source, including a contradictory override.
  if (file.purchaseEnabled !== undefined && booleanFlag(file.purchaseEnabled, "PURCHASE_FLAG")) fail("ECONOMIC_OPERATIONS_DISABLED");
  if (envFlag(env.FLOP_TESTNET_PURCHASE_ENABLED, "PURCHASE_FLAG")) fail("ECONOMIC_OPERATIONS_DISABLED");
  const prepareEnabled = envFlag(env.FLOP_TESTNET_PREPARE_ENABLED, "PREPARE_FLAG")
    ?? (file.prepareEnabled === undefined ? false : booleanFlag(file.prepareEnabled, "PREPARE_FLAG"));
  const optionalHex = (key: string, override: string | undefined) => {
    const v = override ?? file[key]; return v === undefined ? undefined : hex32(v, key.toUpperCase());
  };
  const optionalAmount = (key: string, override: string | undefined) => {
    const v = override ?? file[key]; return v === undefined ? undefined : unsigned(v, 128, key.toUpperCase(), true);
  };
  return Object.freeze({ environment: environment as FlopTestnetConfig["environment"], prepareEnabled, purchaseEnabled: false,
    genesisHash: optionalHex("genesisHash", env.FLOP_TESTNET_GENESIS_HASH),
    agentAccount: optionalHex("agentAccount", env.FLOP_TESTNET_AGENT_ACCOUNT),
    maxEscrowBaseUnits: optionalAmount("maxEscrowBaseUnits", env.FLOP_TESTNET_MAX_ESCROW_BASE_UNITS),
    maxTransactionFeeBaseUnits: optionalAmount("maxTransactionFeeBaseUnits", env.FLOP_TESTNET_MAX_TRANSACTION_FEE_BASE_UNITS),
  });
}
export const FLOP_UPSTREAM_BLOCKERS = Object.freeze([
  "PUBLIC_TESTNET_ACCESS_AND_BUYER_ELIGIBILITY_UNVERIFIED",
  "OFFICIAL_RPC_GENESIS_AND_RUNTIME_METADATA_UNAVAILABLE",
  "CANONICAL_QUOTE_DISCOVERY_CONTRACT_E55_PLANNED",
  "OFFER_SIGNATURE_AND_REGISTRY_ATTESTATION_VERIFIER_UNAVAILABLE",
  "SLA_PRECISION_AND_SETTLEMENT_CLASS_RUNTIME_BINDINGS_UNAVAILABLE",
  "CANONICAL_SIGNER_HAS_NO_RESTRICTED_FLOP_EXTRINSIC_OPERATION",
  "FINALIZED_CHAIN_AND_EXECUTION_EVIDENCE_VERIFIER_NOT_CONNECTED",
]);
export function testnetReadiness(config: FlopTestnetConfig) {
  // Revalidate callers using the exported TS interface (including untyped JS consumers).
  config = loadFlopTestnetConfig(config, {});
  return { status: "BLOCKED_BY_UPSTREAM" as const, specification: FLOP_SPEC, config,
    economicOperationsEnabled: false, upstreamBlockers: [...FLOP_UPSTREAM_BLOCKERS],
    localBlockers: [!config.prepareEnabled && "PREPARATION_DISABLED", !config.genesisHash && "GENESIS_PIN_REQUIRED",
      !config.agentAccount && "AGENT_ACCOUNT_PIN_REQUIRED", !config.maxEscrowBaseUnits && "ESCROW_BUDGET_REQUIRED",
      !config.maxTransactionFeeBaseUnits && "TRANSACTION_FEE_BUDGET_REQUIRED"].filter(Boolean),
  };
}

/** Known scalar parameters in Appendix G.1. SLA and runtime enums remain deliberately unencoded. */
export interface FlopOpenChannelKnownFields {
  miner: string; model_hash: string; measured_root: string; decode_policy_hash: string;
  enclave_key: string; agent_key: string; escrow: string; nonce: string;
}
export interface FlopChannelIntent {
  measuredRoot: string; decodePolicyHash: string; enclaveKey: string; agentKey: string;
  escrowBaseUnits: string; channelNonce: string;
}
export function prepareFlopChannel(decision: RouteDecision, value: FlopChannelIntent, config: FlopTestnetConfig, now = new Date()) {
  config = loadFlopTestnetConfig(config, {});
  if (!config.prepareEnabled) fail("TESTNET_PREPARATION_DISABLED");
  if (!config.genesisHash || !config.agentAccount || !config.maxEscrowBaseUnits || !config.maxTransactionFeeBaseUnits) fail("TESTNET_PINS_AND_BUDGETS_REQUIRED");
  if (!Number.isFinite(now.getTime())) fail("INVALID_PREPARATION_TIME");
  if (decision.status !== "SELECTED" || decision.ranking[0] !== decision.selectedMinerId ||
      sha256(decision.snapshot) !== decision.snapshotHash || sha256(decision.snapshot.config) !== decision.configHash) fail("INVALID_ROUTING_DECISION");
  const candidate = decision.snapshot.candidates.find(item => item.id === decision.selectedMinerId);
  if (!candidate?.enabled || !decision.snapshot.evaluations.find(item => item.minerId === candidate.id)?.eligible) fail("INELIGIBLE_ROUTING_DECISION");
  const intent = record(value, ["measuredRoot", "decodePolicyHash", "enclaveKey", "agentKey", "escrowBaseUnits", "channelNonce"], "CHANNEL_INTENT");
  const offer = candidate.openingOffer;
  if (!offer || !["StandingOffer", "SessionOffer"].includes(offer.kind) || ![1, 2].includes(offer.version)) fail("OPENING_OFFER_REQUIRED");
  const miner = hex32(offer.miner, "MINER_ACCOUNT");
  if (miner !== candidate.identity.account || offer.chainGenesis !== config.genesisHash) fail("OFFER_CHAIN_OR_MINER_MISMATCH");
  const modelHash = hex32(offer.modelHash, "MODEL_HASH");
  const requested = decision.snapshot.request.constraints;
  if (!requested.modelHash || modelHash !== requested.modelHash || !requested.precision || offer.precision !== requested.precision) fail("OFFER_MODEL_OR_PRECISION_MISMATCH");
  if (!candidate.capabilities.some(cap => cap.modelId === requested.modelId && cap.modelHash === modelHash && cap.precisions?.includes(requested.precision!))) fail("OFFER_CAPABILITY_MISMATCH");
  if (!offer.expiresAt || !Number.isFinite(Date.parse(offer.expiresAt)) || Date.parse(offer.expiresAt) <= now.getTime()) fail("OFFER_EXPIRED_OR_INVALID");
  // OpeningOfferMetadata is a local projection. Signature/nonce are kept, never declared verified.
  if (typeof offer.signature !== "string" || !offer.signature.length || offer.signature.length > 4096 || typeof offer.nonce !== "string" || !offer.nonce.length || offer.nonce.length > 256) fail("OFFER_SIGNATURE_AND_NONCE_REQUIRED");
  if (offer.forwardTerms !== undefined) fail("FORWARD_TERMS_UNSUPPORTED");
  if (offer.minEscrow?.asset !== "FLOP" || offer.minEscrow.unit !== "base-unit") fail("OFFER_BASE_UNIT_ESCROW_REQUIRED");
  const floor = unsigned(offer.minEscrow.amount, 128, "MINIMUM_ESCROW", true);
  const escrow = unsigned(intent.escrowBaseUnits, 128, "ESCROW", true);
  if (BigInt(escrow) < BigInt(floor) || BigInt(escrow) > BigInt(config.maxEscrowBaseUnits!)) fail("ESCROW_OUTSIDE_BUDGET_OR_OFFER");
  const enclaveKey = hex32(intent.enclaveKey, "ENCLAVE_KEY");
  if (offer.enclaveKey !== enclaveKey) fail("OFFER_ENCLAVE_KEY_MISMATCH");
  const fields: FlopOpenChannelKnownFields = { miner, model_hash: modelHash,
    measured_root: hex32(intent.measuredRoot, "MEASURED_ROOT"), decode_policy_hash: hex32(intent.decodePolicyHash, "DECODE_POLICY_HASH"),
    enclave_key: enclaveKey, agent_key: hex32(intent.agentKey, "AGENT_RECEIPT_KEY"), escrow,
    nonce: unsigned(intent.channelNonce, 64, "CHANNEL_NONCE"),
  };
  const accepted = offer.acceptance;
  if (accepted && (accepted.agent !== config.agentAccount || accepted.measuredRoot !== fields.measured_root || accepted.decodePolicyHash !== fields.decode_policy_hash || accepted.receiptKey !== fields.agent_key || accepted.actualEscrow?.asset !== "FLOP" || accepted.actualEscrow.unit !== "base-unit" || accepted.actualEscrow.amount !== escrow)) fail("OFFER_ACCEPTANCE_MISMATCH");
  const plan = { schema: "flop-router/channel-preparation/v1", status: "PREPARED_BLOCKED_UPSTREAM", specification: FLOP_SPEC,
    environment: config.environment, genesisHash: config.genesisHash, agentAccount: config.agentAccount,
    decisionId: decision.decisionId, snapshotHash: decision.snapshotHash, preparedAt: now.toISOString(),
    knownOpenChannelFields: fields, requestedPrecision: requested.precision,
    offerBindingHash: sha256(offer), maxTransactionFeeBaseUnits: config.maxTransactionFeeBaseUnits,
    economicSemantics: "COOPERATIVE_ESCROW_IS_FULL_RESERVED_CAPACITY_PRICE", economicOperationsEnabled: false,
    settlement: "UNVERIFIED", upstreamBlockers: [...FLOP_UPSTREAM_BLOCKERS],
  } as const;
  // A local audit digest, deliberately NOT the Blake2 channel id or a transaction payload.
  return { ...plan, preparationHash: sha256(plan) };
}
