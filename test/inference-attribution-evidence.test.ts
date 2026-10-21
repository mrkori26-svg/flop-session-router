import test from "node:test";
import assert from "node:assert/strict";
import {triageInferenceAttribution} from "../src/inference-attribution-evidence.js";
const base={requestingDid:"did:example:agent",payerAccount:"payer",creditedAccount:"agent",expectedCreditedAccount:"agent",gatewayAccount:"gateway",finalizedSettlementProofVerified:true,executionProofVerified:true,attributionRuleOfficiallyVerified:true};
test("missing chain finality is UNKNOWN, never PASS",()=>{assert.deepEqual(triageInferenceAttribution({...base,finalizedSettlementProofVerified:false}).verdict,"UNKNOWN");});
test("missing gateway attribution rule is UNKNOWN",()=>{assert.equal(triageInferenceAttribution({...base,attributionRuleOfficiallyVerified:false}).verdict,"UNKNOWN");});
test("incomplete principal identity is UNKNOWN",()=>{assert.equal(triageInferenceAttribution({...base,requestingDid:undefined}).verdict,"UNKNOWN");});
test("verified misattribution is FAIL",()=>{assert.equal(triageInferenceAttribution({...base,creditedAccount:"gateway"}).verdict,"FAIL");});
test("complete evidence passes only local triage, never grants reward eligibility",()=>{assert.deepEqual(triageInferenceAttribution(base),{verdict:"PASS",reasons:[],eligibleForRewardClaim:false});});
