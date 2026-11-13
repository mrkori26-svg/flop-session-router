import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchEvidence } from "../src/research-evidence.js";
test("retained evidence preserves exact bytes without claiming external verification",()=>{
 const e=buildResearchEvidence({id:"job",state:"OUTCOME_UNKNOWN",requestHash:"request",configHash:"policy",reservedBaseUnits:"110",chargedBaseUnits:"0",version:2,observation:{phase:"UNKNOWN",transactionHash:"tx",executionProof:{counter:0}}} as any);
 assert.equal(e.schema,"flop.research-evidence/v1");
 assert.equal(e.claims.settlement,"UNKNOWN");
 assert.equal(e.claims.execution,"UNKNOWN");
 assert.equal(e.usage.inputTokens.status,"UNAVAILABLE");
 assert.equal(e.usage.inputTokens.value,null);
 assert.equal(JSON.parse(Buffer.from(e.artifacts[0]!.bytesBase64,"base64").toString()).requestHash,"request");
 assert.equal(e.artifacts.some(a=>Buffer.from(a.bytesBase64,"base64").toString().includes("signingPayloadBase64")),false);
});
test("local settled evidence never grants cryptographic verification or complete coverage",()=>{
 const e=buildResearchEvidence({id:"job",state:"SETTLED",requestHash:"request",configHash:"policy",reservedBaseUnits:"0",chargedBaseUnits:"103",version:9,observation:{phase:"SETTLED",transactionHash:"tx",paidBaseUnits:"100",transactionFeeBaseUnits:"3",executionProof:"local",settlementProof:"local"}} as any);
 assert.equal(e.claims.settlement,"SUPPLIER_ASSERTION");
 assert.equal(e.coverage,"UNESTABLISHED");
 assert.equal(e.economicExecutionAllowed,false);
 assert.equal(e.artifacts.filter(a=>a.id.endsWith("proof")).length,2);
});
