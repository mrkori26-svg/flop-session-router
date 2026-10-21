import assert from "node:assert/strict";
import test from "node:test";
import { assessSettlementEvidence } from "../src/settlement-evidence.js";

test("missing audit transcript never earns settled/reward verdict", () => {
  const r = assessSettlementEvidence({outcome:"SETTLED", finalizedOnChainProof:true, transcriptPublished:false, officialRuleForThisCaseVerified:false});
  assert.equal(r.status,"UNKNOWN");
  assert.equal(r.rewardEligibility,"UNKNOWN");
  assert.equal(r.economicExecutionAllowed,false);
  assert.ok(r.reasons.includes("TRANSCRIPT_NOT_PUBLISHED"));
});
test("gateway payer does not imply requester credited", () => {
  const r = assessSettlementEvidence({requestingDid:"did:key:requester", payerAccount:"gateway", creditedAccount:"gateway", outcome:"SETTLED", finalizedOnChainProof:true, transcriptPublished:true, officialRuleForThisCaseVerified:true});
  assert.equal(r.status,"UNKNOWN");
  assert.ok(r.reasons.includes("BENEFICIARY_REGISTRATION_UNVERIFIED"));
  assert.ok(r.reasons.includes("UNLOCK_NOT_PROVEN"));
});
test("refunded and pending settlements do not count as settled", () => {
  for(const outcome of ["REFUNDED","REJECTED","SLASHED","PENDING"] as const) {
    const r=assessSettlementEvidence({outcome, finalizedOnChainProof:true,transcriptPublished:true,officialRuleForThisCaseVerified:true,requestingDid:"did:key:a",payerAccount:"a",creditedAccount:"a",beneficiaryRegistrationVerified:true,unlockCreditProofVerified:true});
    assert.equal(r.status,"UNKNOWN");
    assert.ok(r.reasons.includes("NOT_SETTLED"));
  }
});
test("complete evidence never asserts airdrop eligibility or enables spending", () => {
  const r=assessSettlementEvidence({outcome:"SETTLED",finalizedOnChainProof:true,transcriptPublished:true,officialRuleForThisCaseVerified:true,requestingDid:"did:key:a",payerAccount:"a",creditedAccount:"a",beneficiaryRegistrationVerified:true,unlockCreditProofVerified:true});
  assert.equal(r.status,"PASS");
  assert.equal(r.rewardEligibility,"UNKNOWN");
  assert.equal(r.economicExecutionAllowed,false);
});
test("proven transcript fraud under verified rule fails", () => {
  const r=assessSettlementEvidence({transcriptFraudProven:true, officialRuleForThisCaseVerified:true});
  assert.equal(r.status,"FAIL");
});
