import type { InferenceRequest } from "./inference-gateway.js";
import type { RouteConstraints, RouteDecision } from "./types.js";
import type { FlopChannelIntent, FlopOpenChannelKnownFields } from "./flop-testnet.js";

export type BuyerEnvironment = "DEV" | "TESTNET" | "MAINNET";
export type BuyerState = "QUEUED" | "BLOCKED" | "PREPARING" | "RESERVED" | "SIGNING" | "SIGNED" | "SUBMITTING" | "PENDING" | "EXECUTING" | "VERIFYING" | "OUTCOME_UNKNOWN" | "SETTLED" | "REJECTED" | "FINALITY_LOST";
export interface BuyerRequest { idempotencyKey: string; inference: InferenceRequest; constraints: RouteConstraints; maxCostBaseUnits: string; }
export interface BuyerConfig {
  enabled: boolean; environment: BuyerEnvironment; allowedEnvironments: BuyerEnvironment[];
  genesisHash?: string; agentAccount?: string; executionAuthorizationId?: string;
  maxTotalSpendBaseUnits?: string; maxSessionEscrowBaseUnits?: string; maxTransactionFeeBaseUnits?: string;
  controlledMinerAccounts: string[]; maxConcurrent: number; maxLatencyMs: number;
  networkTimeoutMs: number; leaseMs: number; maxAttempts: number; circuitFailureThreshold: number; circuitCooldownMs: number;
}
/** Application ports, NOT RPC methods, wire schemas or claims of published SDK bindings. */
export interface BuyerNetworkReadiness {
  status: "AVAILABLE" | "BLOCKED_BY_UPSTREAM"; kind: "OFFICIAL" | "LOCAL_TEST";
  environment: BuyerEnvironment; genesisHash?: string; blockers: string[];
}
export interface BuyerNetworkContext {
  genesisHash: string; agentAccount: string; accountNonce: number; nextChannelNonce: string;
  totalBalanceBaseUnits: string; spendableBalanceBaseUnits: string; existentialDepositBaseUnits: string;
  finalizedBlockHash: string; proof: unknown;
}
export interface BuyerQuote {
  intent: FlopChannelIntent; feeCapBaseUnits: string; maximumLatencyMs: number; expiresAt: string; proof: unknown;
}
export interface BuyerUnsignedTransaction {
  signingPayloadBase64: string; callBytesBase64: string; bindingHash: string;
}
export interface BuyerSignedTransaction { bytesBase64: string; transactionHash: string; signerAccount: string; signature: string; }
export type BuyerObservation = {
  phase: "PENDING" | "ACCEPTED" | "EXECUTING" | "SETTLED" | "REJECTED" | "UNKNOWN" | "FINALITY_LOST";
  transactionHash: string; finalizedBlockHash?: string; result?: string;
  paidBaseUnits?: string; transactionFeeBaseUnits?: string; totalBalanceBaseUnits?: string;
  channelId?: string; acceptanceProof?: unknown; executionProof?: unknown; settlementProof?: unknown; evidenceRefs?: string[];
};
export interface BuyerBinding {
  environment: BuyerEnvironment; authorizationId: string;
  openChannel: FlopOpenChannelKnownFields; precision: string; maximumLatencyMs: number; settlementMode: "COOPERATIVE";
  genesisHash: string; agentAccount: string; accountNonce: number; channelNonce: string;
  requestHash: string; preparationHash: string; escrowBaseUnits: string; feeCapBaseUnits: string;
}
export interface FlopBuyerTransport {
  readiness(): BuyerNetworkReadiness;
  context(signal: AbortSignal): Promise<BuyerNetworkContext>;
  quote(decision: RouteDecision, request: BuyerRequest, signal: AbortSignal): Promise<BuyerQuote>;
  build(binding: BuyerBinding, decision: RouteDecision, request: BuyerRequest, quote: BuyerQuote, signal: AbortSignal): Promise<BuyerUnsignedTransaction>;
  submit(transaction: BuyerSignedTransaction, signal: AbortSignal): Promise<{transactionHash: string}>;
  /** Dispatch the bound goal after verified opening; the SDK driver owns attested exchanges and restricted per-turn/receipt signing. */
  execute(job: BuyerJob, signal: AbortSignal): Promise<{executionRef: string}>;
  observe(job: BuyerJob, signal: AbortSignal): Promise<BuyerObservation>;
}
export interface FlopBuyerSigner {
  readiness(): { available: boolean; blocker?: string };
  sign(transaction: BuyerUnsignedTransaction, binding: BuyerBinding, signal: AbortSignal): Promise<BuyerSignedTransaction>;
}
/** Implementations must verify authoritative bytes, chain identity and proofs, never trust observation flags alone. */
export interface FlopBuyerVerifier {
  context(context: BuyerNetworkContext, signal: AbortSignal): Promise<boolean>;
  quote(quote: BuyerQuote, decision: RouteDecision, request: BuyerRequest, signal: AbortSignal): Promise<{valid: boolean; independentProvider: boolean}>;
  unsigned(transaction: BuyerUnsignedTransaction, binding: BuyerBinding, request: BuyerRequest, signal: AbortSignal): Promise<boolean>;
  signed(transaction: BuyerSignedTransaction, unsigned: BuyerUnsignedTransaction, binding: BuyerBinding, signal: AbortSignal): Promise<boolean>;
  acceptance(observation: BuyerObservation, job: BuyerJob, signal: AbortSignal): Promise<boolean>;
  execution(observation: BuyerObservation, job: BuyerJob, signal: AbortSignal): Promise<boolean>;
  settlement(observation: BuyerObservation, job: BuyerJob, signal: AbortSignal): Promise<boolean>;
}
export interface BuyerJob {
  id: string; scope: string; requestHash: string; configHash: string; request: BuyerRequest; state: BuyerState;
  version: number; attempts: number; createdAt: string; updatedAt: string; reason?: string;
  decisionId?: string; binding?: BuyerBinding; context?: BuyerNetworkContext; quote?: BuyerQuote;
  unsigned?: BuyerUnsignedTransaction; signed?: BuyerSignedTransaction; observation?: BuyerObservation;
  reservedBaseUnits: string; chargedBaseUnits: string;
  submittedAt?: string; executionDeadlineAt?: string; executionStartedAt?: string; executionRef?: string; channelId?: string;
}
