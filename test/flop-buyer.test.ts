import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,verify,createHash} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {FlopRuntimeAdapter,loadFlopTestnetConfig,FlopInferenceBuyer,RouterRepository,SessionRouter,StaticCandidateProvider,DEFAULT_CONFIG,sha256,
  loadBuyerConfig,validateBuyerRequest,UnavailableFlopBuyerTransport,UnavailableFlopBuyerSigner,UnavailableFlopBuyerVerifier,
  CanonicalFlopBuyerSigner,validateCanonicalSignerStatus,
  type BuyerConfig,type BuyerRequest,type BuyerJob,type BuyerBinding,type BuyerQuote,type BuyerUnsignedTransaction,type BuyerSignedTransaction,
  type FlopBuyerTransport,type FlopBuyerSigner,type FlopBuyerVerifier,type MinerCandidate,type BuyerObservation} from "../src/index.js";

// LOCAL TEST fixtures only: JSON bytes and local proof markers are not FLOP wire formats or chain proofs.
const hex=(n:number)=>`0x${n.toString(16).padStart(2,"0").repeat(32)}`;
const config=(patch:Partial<BuyerConfig>={}):BuyerConfig=>loadBuyerConfig({enabled:true,environment:"DEV",allowedEnvironments:["DEV"],genesisHash:hex(1),agentAccount:hex(2),executionAuthorizationId:"local-test-authorized",
  maxTotalSpendBaseUnits:"1000",maxSessionEscrowBaseUnits:"200",maxTransactionFeeBaseUnits:"10",maxLatencyMs:1000,networkTimeoutMs:20,leaseMs:1000,...patch});
const request=(key="one"):BuyerRequest=>({idempotencyKey:key,inference:{model:"m",messages:[{role:"user",content:"goal"}],maxTokens:32},constraints:{modelId:"m",modelHash:hex(4),precision:"fp16",minimumAssurance:"HARD",maxLatencyMs:1000},maxCostBaseUnits:"110"});
const keys=generateKeyPairSync("ed25519");
class LocalNetwork implements FlopBuyerTransport {
  submits=0;observes=0;executions=0;executionTimeout=false;contextCalls=0;balance=100000n;nonce=0;phase:BuyerObservation["phase"]="SETTLED";disconnect=false;submitTimeout=false;contextOffline=false;
  invalidExecution=false;invalidSettlement=false;balanceMismatch=false;invalidUnsigned=false;independent=true;private charged=new Set<string>();
  readiness(){return {status:"AVAILABLE" as const,kind:"LOCAL_TEST" as const,environment:"DEV" as const,genesisHash:hex(1),blockers:[]};}
  async context(){this.contextCalls++;if(this.contextOffline)throw new Error("network secret MUST_NOT_LOG");return {genesisHash:hex(1),agentAccount:hex(2),accountNonce:this.nonce,nextChannelNonce:"0",totalBalanceBaseUnits:this.balance.toString(),spendableBalanceBaseUnits:this.balance.toString(),existentialDepositBaseUnits:"1",finalizedBlockHash:hex(90),proof:"local-context"};}
  async quote():Promise<BuyerQuote>{return {intent:{measuredRoot:hex(5),decodePolicyHash:hex(6),enclaveKey:hex(7),agentKey:hex(8),escrowBaseUnits:"100",channelNonce:"0"},feeCapBaseUnits:"10",maximumLatencyMs:100,expiresAt:"2099-01-01T00:00:00Z",proof:"local-quote"};}
  async build(binding:BuyerBinding):Promise<BuyerUnsignedTransaction>{const bytes=Buffer.from(JSON.stringify(binding)).toString("base64");return {callBytesBase64:bytes,signingPayloadBase64:bytes,bindingHash:this.invalidUnsigned?"tampered":sha256(binding)};}
  async submit(tx:BuyerSignedTransaction){this.submits++;this.nonce++;if(this.submitTimeout)return new Promise<{transactionHash:string}>(()=>{});return {transactionHash:tx.transactionHash};}
  async execute(){this.executions++;if(this.executionTimeout)return new Promise<{executionRef:string}>(()=>{});this.phase="SETTLED";return {executionRef:"local-test:execution"};}
  async observe(job:BuyerJob):Promise<BuyerObservation>{
    this.observes++;if(this.disconnect)throw new Error("network secret MUST_NOT_LOG");
    const paid=this.phase==="REJECTED"?0n:100n,fee=3n;
    const balance=BigInt(job.context!.totalBalanceBaseUnits)-paid-fee;
    if(["SETTLED","REJECTED"].includes(this.phase)&&!this.charged.has(job.id)){this.balance=balance;this.charged.add(job.id);}
    return {phase:this.phase,channelId:hex(92),acceptanceProof:"local-acceptance",transactionHash:job.signed!.transactionHash,finalizedBlockHash:hex(91),result:"local-test-output",paidBaseUnits:paid.toString(),transactionFeeBaseUnits:fee.toString(),totalBalanceBaseUnits:this.balanceMismatch?"1":balance.toString(),
      executionProof:this.invalidExecution?"bad":"local-execution",settlementProof:this.invalidSettlement?"bad":"local-settlement",evidenceRefs:["local-test:proof-not-external"]};
  }
}
class LocalSigner implements FlopBuyerSigner {
  calls=0;invalid=false;
  readiness(){return {available:true};}
  async sign(unsigned:BuyerUnsignedTransaction,binding:BuyerBinding):Promise<BuyerSignedTransaction>{
    this.calls++;const payload=Buffer.from(unsigned.signingPayloadBase64,"base64"),signature=sign(null,payload,keys.privateKey);
    const bytes=Buffer.concat([payload,signature]);return {bytesBase64:bytes.toString("base64"),transactionHash:`0x${createHash("sha256").update(bytes).digest("hex")}`,signerAccount:binding.agentAccount,signature:(this.invalid?Buffer.alloc(64):signature).toString("base64")};
  }
}
function localVerifier(network:LocalNetwork):FlopBuyerVerifier{return {
  context:async c=>c.proof==="local-context",quote:async q=>({valid:q.proof==="local-quote",independentProvider:network.independent}),
  unsigned:async(u,b)=>u.bindingHash===sha256(b)&&JSON.stringify(JSON.parse(Buffer.from(u.signingPayloadBase64,"base64").toString()))===JSON.stringify(b),
  signed:async(t,u)=>verify(null,Buffer.from(u.signingPayloadBase64,"base64"),keys.publicKey,Buffer.from(t.signature,"base64")),
  acceptance:async o=>o.acceptanceProof==="local-acceptance",execution:async o=>o.executionProof==="local-execution",settlement:async o=>o.settlementProof==="local-settlement",
};}
function setup(patch:Partial<BuyerConfig>={}){
  const dir=mkdtempSync(join(tmpdir(),"buyer-local-test-")),db=join(dir,"router.db");let milliseconds=Date.parse("2026-10-09T20:00:00Z");const clock=()=>new Date(milliseconds);
  let repo=new RouterRepository(db,clock);const network=new LocalNetwork(),signer=new LocalSigner(),cfg=config(patch);
  const miner:MinerCandidate={id:"external",identity:{account:hex(3)},enabled:true,capabilities:[{modelId:"m",modelHash:hex(4),precisions:["fp16"],assurance:"HARD"}],telemetry:{latencyMsEwma:10},
    openingOffer:{kind:"SessionOffer",version:2,miner:hex(3),chainGenesis:hex(1),modelHash:hex(4),precision:"fp16",enclaveKey:hex(7),minEscrow:{asset:"FLOP",unit:"base-unit",amount:"100"},expiresAt:"2099-01-01T00:00:00Z",nonce:"offer",signature:"local-unverified-opening-metadata"}};
  const make=()=>new FlopInferenceBuyer(new SessionRouter(new StaticCandidateProvider([miner]),repo,DEFAULT_CONFIG,clock),repo,network,signer,localVerifier(network),cfg,clock);
  let buyer=make();return {dir,db,network,signer,miner,cfg,get repo(){return repo;},get buyer(){return buyer;},advance(ms:number){milliseconds+=ms;},restart(){repo.close();repo=new RouterRepository(db,clock);buyer=make();},clean(){repo.close();rmSync(dir,{recursive:true,force:true});}};
}

test("LOCAL TEST valid request traverses signed submission and separately verified execution/settlement",async()=>{
  const s=setup();try{const j=s.buyer.enqueue(request());await s.buyer.runOnce();const done=s.buyer.inspect(j.id)!;assert.equal(done.state,"SETTLED");assert.equal(done.chargedBaseUnits,"103");assert.equal(s.network.submits,1);assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"0");assert.equal(s.buyer.evidence(j.id)?.verificationBoundary,"LOCAL_TEST_LOGIC_ONLY");assert.equal(done.binding?.accountNonce,0);}finally{s.clean();}
});
test("LOCAL TEST malformed request rejected before persistence; duplicate/conflicting idempotency keys",async()=>{
  const s=setup();try{assert.throws(()=>s.buyer.enqueue({...request(),maxCostBaseUnits:"1e3"}),/INVALID/);assert.throws(()=>validateBuyerRequest({...request(),inference:{...request().inference,maxTokens:undefined}}),/INVALID/);
    const a=s.buyer.enqueue(request());assert.equal(s.buyer.enqueue(request()).id,a.id);assert.throws(()=>s.buyer.enqueue({...request(),maxCostBaseUnits:"111"}),/IDEMPOTENCY_CONFLICT/);
    await Promise.all([s.buyer.runOnce(),s.buyer.runOnce()]);await s.buyer.runOnce();assert.equal(s.network.submits,1);
  }finally{s.clean();}
});
test("LOCAL TEST invalid cryptographic signature never submitted and local reservation released",async()=>{
  const s=setup();try{s.signer.invalid=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.reason,"INVALID_TRANSACTION_SIGNATURE");assert.equal(s.network.submits,0);assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"0");}finally{s.clean();}
});
test("LOCAL TEST unsigned parameter mismatch rejected before signing",async()=>{
  const s=setup();try{s.network.invalidUnsigned=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"REJECTED");assert.equal(s.signer.calls,0);assert.equal(s.network.submits,0);}finally{s.clean();}
});
test("LOCAL TEST submission timeout retains budget; restart reconciles without resubmission",async()=>{
  const s=setup();try{s.network.submitTimeout=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"OUTCOME_UNKNOWN");assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"110");s.restart();s.network.submitTimeout=false;await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");assert.equal(s.network.submits,1);}finally{s.clean();}
});
test("LOCAL TEST crash marker before submit is reconciled, never guessed or blindly resent",async()=>{
  const s=setup();try{const j=s.buyer.enqueue(request()),owner="crashed-process";
    const store=s.repo.buyer;store.claim(j.id,owner,1000);const context=await s.network.context(),quote=await s.network.quote();
    const binding:BuyerBinding={environment:"DEV",authorizationId:"local-test-authorized",openChannel:{miner:hex(3),model_hash:hex(4),measured_root:hex(5),decode_policy_hash:hex(6),enclave_key:hex(7),agent_key:hex(8),escrow:"100",nonce:"0"},precision:"fp16",maximumLatencyMs:100,settlementMode:"COOPERATIVE",genesisHash:hex(1),agentAccount:hex(2),accountNonce:0,channelNonce:"0",requestHash:j.requestHash,preparationHash:sha256({localTest:true}),escrowBaseUnits:"100",feeCapBaseUnits:"10"};
    store.transition(j.id,owner,"PREPARING",{context,quote,binding});
    const reserved=store.reserve(j.id,owner,"110","1000","0")!;
    store.transition(j.id,owner,"SIGNING");const unsigned=await s.network.build(reserved.binding!),signed=await s.signer.sign(unsigned,reserved.binding!);
    store.transition(j.id,owner,"SIGNED",{unsigned,signed});store.transition(j.id,owner,"SUBMITTING");
    // Network received it; process disappeared before recording the acknowledgement.
    await s.network.submit(signed);
    s.restart();s.advance(1100);s.network.phase="SETTLED";await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");assert.equal(s.network.submits,1);
  }finally{s.clean();}
});
test("LOCAL TEST connectivity loss after submission retains spend reservation and conceals raw errors",async()=>{
  const s=setup();try{s.network.disconnect=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"OUTCOME_UNKNOWN");assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"110");assert.doesNotMatch(s.buyer.inspect(j.id)?.reason??"",/secret|MUST_NOT_LOG/);s.network.disconnect=false;await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");assert.equal(s.network.submits,1);}finally{s.clean();}
});
for(const condition of ["invalidExecution","invalidSettlement","balanceMismatch"] as const){
  test(`LOCAL TEST ${condition} cannot become settled or release funds`,async()=>{
    const s=setup();try{s.network[condition]=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"OUTCOME_UNKNOWN");assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"110");assert.equal(s.repo.buyer.audit(s.buyer.scope).spentBaseUnits,"0");if(condition==="balanceMismatch")assert.equal(s.repo.buyer.audit(s.buyer.scope).frozen,true);}finally{s.clean();}
  });
}
test("LOCAL TEST externally rejected transaction charges only verified fee",async()=>{
  const s=setup();try{s.network.phase="REJECTED";const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"REJECTED");assert.equal(s.buyer.inspect(j.id)?.chargedBaseUnits,"3");assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"0");}finally{s.clean();}
});
test("LOCAL TEST finality loss after settlement freezes account before any new spend",async()=>{
  const s=setup({maxConcurrent:2});try{const a=s.buyer.enqueue(request());await s.buyer.runOnce();const b=s.buyer.enqueue(request("next"));s.network.phase="FINALITY_LOST";await s.buyer.runOnce();assert.equal(s.buyer.inspect(a.id)?.state,"FINALITY_LOST");assert.equal(s.buyer.inspect(b.id)?.state,"BLOCKED");assert.equal(s.repo.buyer.audit(s.buyer.scope).frozen,true);assert.equal(s.network.submits,1);assert.equal(s.repo.buyer.audit(s.buyer.scope).spentBaseUnits,"103");}finally{s.clean();}
});
test("LOCAL TEST pending latency deadline becomes uncertain, not a safe automatic retry",async()=>{
  const s=setup();try{s.network.phase="EXECUTING";const j=s.buyer.enqueue(request());await s.buyer.runOnce();s.advance(1100);await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.reason,"SESSION_LATENCY_LIMIT_EXCEEDED");assert.equal(s.network.submits,1);assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"110");}finally{s.clean();}
});
test("LOCAL TEST cumulative budget persists across restart and cannot be reset by authorization rotation",async()=>{
  const s=setup({maxTotalSpendBaseUnits:"150"});try{s.buyer.enqueue(request());await s.buyer.runOnce();s.restart();const j=s.buyer.enqueue(request("over-budget"));await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"REJECTED");assert.equal(s.network.submits,1);assert.equal(s.repo.buyer.audit(s.buyer.scope).spentBaseUnits,"103");
    const cfg={...s.cfg,executionAuthorizationId:"rotated"};const another=new FlopInferenceBuyer(new SessionRouter(new StaticCandidateProvider([s.miner]),s.repo),s.repo,s.network,s.signer,localVerifier(s.network),cfg);assert.equal(another.scope,s.buyer.scope);assert.equal(another.readiness().audit.spentBaseUnits,"103");
  }finally{s.clean();}
});
test("LOCAL TEST concurrent requests serialize economic nonce lane while pending holds it",async()=>{
  const s=setup({maxConcurrent:3});try{s.network.phase="PENDING";const a=s.buyer.enqueue(request("a")),b=s.buyer.enqueue(request("b")),c=s.buyer.enqueue(request("c"));await s.buyer.runOnce();assert.equal(s.network.submits,1);assert.equal(s.network.contextCalls,1);s.network.phase="SETTLED";for(let i=0;i<3;i++)await s.buyer.runOnce();assert.equal(s.network.submits,3);const jobs=[a,b,c].map(j=>s.buyer.inspect(j.id)!);assert.deepEqual(jobs.map(j=>j.binding!.accountNonce).sort(),[0,1,2]);assert.deepEqual(jobs.map(j=>j.binding!.channelNonce).sort(),["0","1","2"]);}finally{s.clean();}
});
test("LOCAL TEST pre-submit connectivity retries are bounded and circuit pauses further work",async()=>{
  const s=setup({circuitFailureThreshold:1,circuitCooldownMs:1000,maxAttempts:2});try{s.network.contextOffline=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"QUEUED");assert.deepEqual(await s.buyer.runOnce(),[]);s.advance(1100);await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"REJECTED");assert.equal(s.network.submits,0);}finally{s.clean();}
});
test("LOCAL TEST known controlled provider and unverified independence are rejected",async()=>{
  for(const owned of [true,false]){const s=setup(owned?{controlledMinerAccounts:[hex(3)]}:{});try{s.network.independent=false;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"REJECTED");assert.equal(s.network.submits,0);}finally{s.clean();}}
});
test("LOCAL TEST disabled config and unpublished production adapter cannot spend",async()=>{
  const s=setup();try{const buyer=new FlopInferenceBuyer(new SessionRouter(new StaticCandidateProvider([s.miner]),s.repo),s.repo,new UnavailableFlopBuyerTransport("DEV",hex(1)),new UnavailableFlopBuyerSigner(),new UnavailableFlopBuyerVerifier(),s.cfg);
    const j=buyer.enqueue(request());await buyer.runOnce();assert.equal(buyer.inspect(j.id)?.state,"BLOCKED");assert.equal(buyer.readiness().economicSubmissionAvailable,false);assert.equal(s.network.submits,0);
    assert.throws(()=>loadBuyerConfig({...s.cfg,environment:"MAINNET",allowedEnvironments:["MAINNET"]}),/MAINNET_SPENDING_PROHIBITED/);
    assert.throws(()=>loadBuyerConfig({...s.cfg,executionAuthorizationId:undefined}),/REQUIRED/);
    assert.throws(()=>loadBuyerConfig({...s.cfg,enabled:"true"}),/INVALID/);
    const disabled=new FlopInferenceBuyer(new SessionRouter(new StaticCandidateProvider([s.miner]),s.repo),s.repo,s.network,s.signer,localVerifier(s.network),{...s.cfg,enabled:false});
    const d=disabled.enqueue(request("disabled"));await disabled.runOnce();assert.equal(disabled.inspect(d.id)?.reason,"ECONOMIC_SUBMISSION_DISABLED");
  }finally{s.clean();}
});
test("LOCAL TEST ledger or audit tampering fails closed before network calls",async()=>{
  for(const what of ["ledger","audit","nonce"]){const s=setup();try{s.buyer.enqueue(request());const db=new DatabaseSync(s.db);
    if(what==="ledger")db.prepare("UPDATE buyer_accounts SET spent='1' WHERE scope=?").run(s.buyer.scope);
    else if(what==="nonce")db.prepare("UPDATE buyer_accounts SET next_channel_nonce='4' WHERE scope=?").run(s.buyer.scope);
    else db.exec("UPDATE buyer_events SET digest='tampered'");db.close();
    await assert.rejects(s.buyer.runOnce(),/DISCREPANCY|AUDIT_CHAIN_INVALID/);assert.equal(s.network.submits,0);
  }finally{s.clean();}}
});
test("LOCAL TEST no custody fallback and malformed signer status rejected",async()=>{
  assert.throws(()=>validateCanonicalSignerStatus({ok:true,signer_available:true,did:"not-a-DID"}),/INVALID/);
  assert.throws(()=>new CanonicalFlopBuyerSigner(join(tmpdir(),"missing-buyer-signer")),/NOT_FOUND/);
  const signer=new UnavailableFlopBuyerSigner();assert.equal(signer.readiness().available,false);await assert.rejects(signer.sign({} as any,{} as any),/FLOP_OPERATION_UNAVAILABLE/);
});

test("LOCAL TEST SDK injection shares existing discovery and refuses cross-network bindings",async()=>{
  const s=setup();try{
    const driver=Object.assign(s.network,{name:"local-test-only",candidates:async()=>[s.miner],snapshot:async()=>[s.miner]});
    const adapter=new FlopRuntimeAdapter(loadFlopTestnetConfig({environment:"devnet",genesisHash:hex(1),agentAccount:hex(2)},{}),driver);
    assert.equal(adapter.buyerTransport("DEV"),driver);assert.equal(adapter.buyerTransport("TESTNET").readiness().status,"BLOCKED_BY_UPSTREAM");
    const buyer=new FlopInferenceBuyer(new SessionRouter(adapter,s.repo),s.repo,adapter.buyerTransport("DEV"),s.signer,localVerifier(s.network),s.cfg);
    assert.equal((await buyer.models()).models[0]?.modelHash,hex(4));
    const wrong=new FlopRuntimeAdapter(loadFlopTestnetConfig({environment:"devnet",genesisHash:hex(9)},{}),driver);
    await assert.rejects(wrong.candidates({requestId:"r",constraints:{modelId:"m"}}),/PUBLIC_RUNTIME_UNAVAILABLE/);
  }finally{s.clean();}
});
test("LOCAL TEST a truthy nonboolean signature-verifier result fails closed",async()=>{
  const s=setup();try{const verifier=localVerifier(s.network);verifier.signed=async()=>"true" as any;
    const buyer=new FlopInferenceBuyer(new SessionRouter(new StaticCandidateProvider([s.miner]),s.repo),s.repo,s.network,s.signer,verifier,s.cfg);
    const j=buyer.enqueue(request());await buyer.runOnce();assert.equal(buyer.inspect(j.id)?.reason,"INVALID_TRANSACTION_SIGNATURE");assert.equal(s.network.submits,0);
  }finally{s.clean();}
});
test("LOCAL TEST loss of connectivity while rechecking finality is not fabricated as a reorg",async()=>{
  const s=setup();try{const j=s.buyer.enqueue(request());await s.buyer.runOnce();s.network.disconnect=true;await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");assert.equal(s.buyer.inspect(j.id)?.reason,"FINALITY_RECHECK_UNAVAILABLE");assert.equal(s.repo.buyer.audit(s.buyer.scope).frozen,true);assert.equal(s.buyer.readiness().economicSubmissionAvailable,false);
  }finally{s.clean();}
});
test("LOCAL TEST cancellation stops the unattended controller with no submission",async()=>{
  const s=setup();try{const ctl=new AbortController();ctl.abort();await s.buyer.run(ctl.signal,100);assert.equal(s.network.submits,0);}finally{s.clean();}
});

test("LOCAL TEST explicit activation drains an approved queued goal without per-request reauthorization",async()=>{
  const s=setup();try{
    const disabled=new FlopInferenceBuyer(new SessionRouter(new StaticCandidateProvider([s.miner]),s.repo),s.repo,s.network,s.signer,localVerifier(s.network),{...s.cfg,enabled:false});
    const j=disabled.enqueue(request());await disabled.runOnce();assert.equal(disabled.inspect(j.id)?.state,"BLOCKED");
    await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");assert.equal(s.network.submits,1);
  }finally{s.clean();}
});

test("LOCAL TEST verified channel acceptance dispatches the bound inference goal once",async()=>{
  const s=setup();try{s.network.phase="ACCEPTED";const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.network.executions,1);assert.equal(s.buyer.inspect(j.id)?.state,"EXECUTING");await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");assert.equal(s.network.executions,1);}finally{s.clean();}
});
test("LOCAL TEST uncertain inference dispatch is never repeated after restart",async()=>{
  const s=setup();try{s.network.phase="ACCEPTED";s.network.executionTimeout=true;const j=s.buyer.enqueue(request());await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"OUTCOME_UNKNOWN");s.restart();await s.buyer.runOnce();assert.equal(s.network.executions,1);assert.equal(s.network.submits,1);s.network.phase="SETTLED";await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.state,"SETTLED");}finally{s.clean();}
});

test("LOCAL TEST delayed acceptance never dispatches inference past the latency limit",async()=>{
  const s=setup();try{s.network.phase="PENDING";const j=s.buyer.enqueue(request());await s.buyer.runOnce();s.advance(1100);s.network.phase="ACCEPTED";await s.buyer.runOnce();assert.equal(s.buyer.inspect(j.id)?.reason,"SESSION_LATENCY_LIMIT_EXCEEDED");assert.equal(s.network.executions,0);assert.equal(s.network.submits,1);assert.equal(s.repo.buyer.audit(s.buyer.scope).reservedBaseUnits,"110");}finally{s.clean();}
});
