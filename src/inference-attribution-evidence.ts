/** Provisional local evidence triage. Never asserts FLOP rewards or protocol settlement. */
export type EvidenceVerdict = "PASS" | "FAIL" | "UNKNOWN";
export interface EconomicAttributionEvidence {
  requestingDid?: string;
  payerAccount?: string;
  creditedAccount?: string;
  expectedCreditedAccount?: string;
  gatewayAccount?: string;
  finalizedSettlementProofVerified?: boolean;
  executionProofVerified?: boolean;
  attributionRuleOfficiallyVerified?: boolean;
}
export interface EvidenceTriage { verdict: EvidenceVerdict; reasons: string[]; eligibleForRewardClaim: false; }
export function triageInferenceAttribution(input: EconomicAttributionEvidence): EvidenceTriage {
  const reasons: string[] = [];
  if (!input.requestingDid) reasons.push("MISSING_REQUESTING_DID");
  if (!input.payerAccount) reasons.push("MISSING_PAYER_ACCOUNT");
  if (!input.creditedAccount) reasons.push("MISSING_CREDITED_ACCOUNT");
  if (!input.expectedCreditedAccount) reasons.push("MISSING_EXPECTED_CREDIT_ACCOUNT");
  if (input.finalizedSettlementProofVerified !== true) reasons.push("SETTLEMENT_UNVERIFIED");
  if (input.executionProofVerified !== true) reasons.push("EXECUTION_UNVERIFIED");
  if (input.attributionRuleOfficiallyVerified !== true) reasons.push("ATTRIBUTION_RULE_UNVERIFIED");
  if (reasons.length) return { verdict:"UNKNOWN", reasons, eligibleForRewardClaim:false };
  if (input.creditedAccount !== input.expectedCreditedAccount)
    return { verdict:"FAIL", reasons:["CREDIT_ACCOUNT_MISMATCH"], eligibleForRewardClaim:false };
  return { verdict:"PASS", reasons:[], eligibleForRewardClaim:false };
}
