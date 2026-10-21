/** Conservative local triage for draft FLOP settlement rules (2026-10-20).
 * Does not certify protocol settlement or airdrop eligibility.
 */
export type SettlementEvidenceStatus = "PASS" | "FAIL" | "UNKNOWN";
export type SettlementOutcome = "SETTLED" | "REJECTED" | "REFUNDED" | "SLASHED" | "PENDING";
export interface SettlementEvidence {
  finalizedOnChainProof?: boolean;
  transcriptPublished?: boolean;
  transcriptFraudProven?: boolean;
  outcome?: SettlementOutcome;
  officialRuleForThisCaseVerified?: boolean;
  payerAccount?: string;
  requestingDid?: string;
  creditedAccount?: string;
  beneficiaryRegistrationVerified?: boolean;
  unlockCreditProofVerified?: boolean;
}
export interface SettlementAssessment {
  status: SettlementEvidenceStatus;
  reasons: string[];
  rewardEligibility: "UNKNOWN";
  economicExecutionAllowed: false;
}
export function assessSettlementEvidence(e: SettlementEvidence): SettlementAssessment {
  const reasons: string[] = [];
  if (!e.requestingDid) reasons.push("REQUESTER_UNKNOWN");
  if (!e.payerAccount) reasons.push("PAYER_UNKNOWN");
  if (!e.creditedAccount) reasons.push("CREDITED_ACCOUNT_UNKNOWN");
  if (e.finalizedOnChainProof !== true) reasons.push("FINALITY_UNVERIFIED");
  if (e.beneficiaryRegistrationVerified !== true) reasons.push("BENEFICIARY_REGISTRATION_UNVERIFIED");
  if (e.unlockCreditProofVerified !== true) reasons.push("UNLOCK_NOT_PROVEN");
  if (e.officialRuleForThisCaseVerified !== true) reasons.push("OFFICIAL_CASE_RULE_UNVERIFIED");
  if (e.transcriptPublished !== true) reasons.push("TRANSCRIPT_NOT_PUBLISHED");
  if (e.outcome !== "SETTLED") reasons.push("NOT_SETTLED");
  if (e.transcriptFraudProven === true) reasons.push("TRANSCRIPT_FRAUD_PROVEN");
  const definitiveFailure = e.transcriptFraudProven === true && e.officialRuleForThisCaseVerified === true;
  return {
    status: definitiveFailure ? "FAIL" : reasons.length ? "UNKNOWN" : "PASS",
    reasons,
    rewardEligibility: "UNKNOWN",
    economicExecutionAllowed: false
  };
}
