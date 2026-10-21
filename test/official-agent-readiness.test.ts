import test from "node:test";
import assert from "node:assert/strict";
import {evaluateOfficialAgentReadiness} from "../src/official-agent-readiness.js";
test("unpublished testnet contracts and missing pins fail closed",()=>{
 const r=evaluateOfficialAgentReadiness({environment:"testnet"});
 assert.equal(r.status,"BLOCKED_BY_UPSTREAM");
 assert.equal(r.economicExecutionAllowed,false);
 assert.equal(r.signerOperationEnabled,false);
 assert.ok(r.blockers.includes("SIGNED_HTTP_REQUEST_CONTRACT_UNVERIFIED"));
});
test("even externally asserted pins do not authorize economic operations",()=>{
 const r=evaluateOfficialAgentReadiness({environment:"testnet",genesisHash:"0x"+"a".repeat(64),runtimeSpecVersion:1014000,verifiedOfficialRelease:true,verifiedOfficialGenesis:true,verifiedOfficialDidWalletContract:true,verifiedOfficialSignedRequestContract:true,verifiedOfficialFaucetContract:true,verifiedOfficialSettlementContract:true});
 assert.equal(r.economicExecutionAllowed,false);
 assert.equal(r.signerOperationEnabled,false);
 assert.equal(r.faucetClaimEnabled,false);
});
test("devnet must not silently substitute for testnet",()=>{
 const r=evaluateOfficialAgentReadiness({environment:"devnet"});
 assert.equal(r.economicExecutionAllowed,false);
 assert.ok(r.blockers.includes("OFFICIAL_RELEASE_UNVERIFIED"));
});
