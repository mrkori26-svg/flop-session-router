export type AssuranceTier = "SOFT" | "HARD" | "UNKNOWN";
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export type OutcomeState = "selected" | "attempted" | "acknowledged" | "active" | "completed" | "failed" | "timed_out" | "cancelled" | "runtime_unavailable";

export interface EvidenceProvenance { source: string; sourceVersion?: string; evidenceRef?: string; verificationState?: "ASSERTED" | "OBSERVED" | "CRYPTOGRAPHICALLY_VERIFIED" | "INDEPENDENTLY_VERIFIED" | "ECONOMICALLY_VERIFIED" | "INVALID" | "CONTRADICTORY" | "UNKNOWN"; coverage?: "COMPLETE" | "PARTIAL" | "TRUNCATED" | "RETENTION_GAP" | "UNKNOWN"; observedAt?: string; eventTime?: string; }

export interface CapabilityManifestEvidence { kind: string; ref: string; digest?: string; }
export interface CapabilityManifest { schema: "flop.capability-manifest/v1"; identity: string; implementation: string; version: string; capabilities: string[]; evidence: CapabilityManifestEvidence[]; availability: { status: "OBSERVED" | "UNAVAILABLE" | "UNKNOWN"; observedAt: string }; }
export interface ModelCapability { modelId: string; modelHash?: string; precisions?: string[]; decodePolicies?: string[]; assurance: AssuranceTier; observedAt?: string; provenance?: EvidenceProvenance; }
export interface MinerEndpoint { url: string; protocol: string; }

/**
 * Opaque identity for the assumptions that make two prices economically comparable.
 * Routers only compare prices when asset, unit and comparisonProfile all match exactly.
 * The profile does not invent a FLOP quote schema; it is supplied by the authoritative
 * discovery/quote source and stays fail-closed when absent.
 */
export interface PriceQuote { amount: string; asset: string; unit: string; comparisonProfile?: string; provenance?: EvidenceProvenance; }
export interface PriceConstraint { amount: string; asset: string; unit: string; comparisonProfile?: string; }

/**
 * Local metadata projection of the canonical opening-offer boundary described by FLOP.
 * This type is deliberately separate from PriceQuote and is not a wire encoder/signer.
 * In particular minEscrow is a floor, capacityHint is advisory, and neither is used as
 * a substitute for an accepted payment or a reproducible comparison quote.
 */
export interface OpeningOfferMetadata {
  kind: "StandingOffer" | "SessionOffer";
  version: 1 | 2;
  miner?: string;
  chainGenesis?: string;
  modelHash?: string;
  precision?: string;
  enclaveKey?: string;
  minEscrow?: { amount: string; asset: string; unit: string };
  slaBounds?: Record<string, unknown>;
  capacityHint?: unknown;
  expiresAt?: string;
  nonce?: string;
  signature?: string;
  forwardTerms?: Record<string, unknown>;
  acceptance?: {
    agent?: string;
    measuredRoot?: string;
    decodePolicyHash?: string;
    receiptKey?: string;
    actualEscrow?: { amount: string; asset: string; unit: string };
    settlementClass?: string;
  };
  provenance?: EvidenceProvenance;
}

export interface MinerCandidate { id: string; identity: { account?: string; did?: string }; endpoint?: MinerEndpoint; capabilities: ModelCapability[]; capabilityManifest?: CapabilityManifest; enabled: boolean; telemetry?: { successEwma?: number; latencyMsEwma?: number; availability?: number; observedAt?: string; provenance?: EvidenceProvenance }; price?: PriceQuote; openingOffer?: OpeningOfferMetadata; }
export interface RouteConstraints { modelId: string; modelHash?: string; precision?: string; decodePolicy?: string; requiredProtocolCapabilities?: string[]; minimumAssurance?: AssuranceTier; maxLatencyMs?: number; maximumPrice?: PriceConstraint; capabilityMaxAgeMs?: number; }
export interface RouteRequest { requestId: string; constraints: RouteConstraints; preflight?: boolean; maxAttempts?: number; }
export interface PreflightResult { minerId: string; status: "PASS" | "FAIL" | "SKIPPED"; latencyMs?: number; checkedAt: string; reason?: string; }
export interface ScoreBreakdown { success: number; latency: number; freshness: number; preflight: number; assurance: number; availability: number; failedAckPenalty: number; circuitPenalty: number; total: number; }
export interface CandidateEvaluation { minerId: string; eligible: boolean; rejectionReasons: string[]; score?: ScoreBreakdown; preflight: PreflightResult; }
export interface RouterConfig { weights: Omit<ScoreBreakdown, "total">; circuitFailureThreshold: number; circuitCooldownMs: number; failedAckHalfLifeMs: number; preflightTimeoutMs: number; preflightConcurrency: number; preflightMaxBytes: number; allowPrivateEndpoints: boolean; }
export interface RouterSnapshot { request: RouteRequest; candidates: MinerCandidate[]; evaluations: CandidateEvaluation[]; config: RouterConfig; routerVersion: string; capturedAt: string; }
export interface RouteDecision { decisionId: string; selectedMinerId?: string; status: "SELECTED" | "NO_ELIGIBLE_MINER" | "PUBLIC_RUNTIME_UNAVAILABLE"; ranking: string[]; snapshot: RouterSnapshot; configHash: string; snapshotHash: string; }
export interface FailedAckObservation { id: string; minerId: string; source: string; observedAt: string; channelRef?: string; block?: string; confidence?: string; finality?: string; evidence?: EvidenceProvenance; }
export interface SessionAttempt { id: string; decisionId: string; minerId: string; attempt: number; startedAt: string; completedAt?: string; outcome: OutcomeState; retryable?: boolean; reason?: string; }
export interface SessionOutcome { decisionId: string; status: OutcomeState; attempts: SessionAttempt[]; selectedMinerId?: string; }

export const DEFAULT_CONFIG: RouterConfig = {
  weights: { success: .30, latency: .18, freshness: .12, preflight: .18, assurance: .10, availability: .12, failedAckPenalty: .20, circuitPenalty: 1 },
  circuitFailureThreshold: 3, circuitCooldownMs: 60_000, failedAckHalfLifeMs: 86_400_000,
  preflightTimeoutMs: 2_000, preflightConcurrency: 4, preflightMaxBytes: 64 * 1024, allowPrivateEndpoints: false
};
