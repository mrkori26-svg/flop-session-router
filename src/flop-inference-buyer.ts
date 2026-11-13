import { randomUUID } from "node:crypto";
import { buildResearchEvidence } from "./research-evidence.js";
import { assessSettlementEvidence } from "./settlement-evidence.js";
import { sha256 } from "./canonical.js";
import { loadBuyerConfig, validateBuyerRequest, buyerAmount, buyerHex } from "./flop-buyer-config.js";
import { loadFlopTestnetConfig, prepareFlopChannel } from "./flop-testnet.js";
import type { RouterRepository } from "./storage.js";
import type { SessionRouter } from "./router.js";
import type { BuyerConfig, BuyerJob, BuyerRequest, BuyerBinding, FlopBuyerTransport, FlopBuyerSigner, FlopBuyerVerifier, BuyerObservation } from "./flop-buyer-contract.js";

class BuyerFault extends Error {constructor(readonly code:string,readonly retryable=false){super(code);}}
const beforeSubmission=new Set(["PREPARING","RESERVED","SIGNING","SIGNED"]);
const permanentStoreErrors=new Set(["BUYER_BUDGET_EXCEEDED","BUYER_ACCOUNT_FROZEN","CHANNEL_NONCE_EXHAUSTED","BUYER_BINDING_MISSING","BUYER_LEDGER_DISCREPANCY","BUYER_NONCE_LEDGER_DISCREPANCY","BUYER_AUDIT_CHAIN_INVALID","BUYER_JOB_AUDIT_MISMATCH"]);
const pending=new Set(["SUBMITTING","PENDING","EXECUTING","VERIFYING","OUTCOME_UNKNOWN"]);
function base64(value:unknown){if(typeof value!=="string"||!value.length||value.length>128*1024||Buffer.from(value,"base64").toString("base64")!==value)throw new BuyerFault("INVALID_TRANSACTION_BYTES");}

export class FlopInferenceBuyer {
  readonly config:BuyerConfig;
  readonly scope:string;
  private readonly executionPolicyHash:string;
  constructor(private readonly router:SessionRouter,private readonly repository:RouterRepository,
    private readonly transport:FlopBuyerTransport,private readonly signer:FlopBuyerSigner,private readonly verifier:FlopBuyerVerifier,
    config:unknown={},private readonly clock=()=>new Date()) {
    const loaded=loadBuyerConfig(config);Object.freeze(loaded.allowedEnvironments);Object.freeze(loaded.controlledMinerAccounts);this.config=Object.freeze(loaded);
    const {enabled: _enabled,maxConcurrent: _concurrency,networkTimeoutMs: _timeout,leaseMs: _lease,maxAttempts: _attempts,circuitFailureThreshold: _threshold,circuitCooldownMs: _cooldown,...financialPolicy}=this.config;
    this.executionPolicyHash=sha256(financialPolicy);
    this.scope=sha256({environment:this.config.environment,genesisHash:this.config.genesisHash??null,agentAccount:this.config.agentAccount??null});
    repository.buyer.ensureScope(this.scope);
  }
  readiness(){
    const network=this.transport.readiness(),signer=this.signer.readiness(),audit=this.repository.buyer.audit(this.scope),account=this.repository.buyer.account(this.scope);
    const transportBound=network.status==="AVAILABLE"&&Array.isArray(network.blockers)&&network.blockers.length===0&&network.environment===this.config.environment&&network.genesisHash===this.config.genesisHash&&
      (network.kind==="OFFICIAL"||(network.kind==="LOCAL_TEST"&&this.config.environment==="DEV"));
    const policyBlockers=[!this.config.enabled&&"ECONOMIC_SUBMISSION_DISABLED",this.config.environment==="MAINNET"&&"MAINNET_SPENDING_PROHIBITED",!transportBound&&"TRANSPORT_BLOCKED_OR_MISMATCHED",
      signer.available!==true&&"CANONICAL_SIGNER_FLOP_OPERATION_UNAVAILABLE",audit.frozen&&"BUYER_ACCOUNT_FROZEN",!!audit.inFlightJobId&&"ACCOUNT_LANE_BUSY",
      account.open_until>this.clock().getTime()&&"NETWORK_CIRCUIT_OPEN",(!this.config.maxTotalSpendBaseUnits||BigInt(audit.spentBaseUnits)+BigInt(audit.reservedBaseUnits)>=BigInt(this.config.maxTotalSpendBaseUnits))&&"BUDGET_UNAVAILABLE"].filter(Boolean);
    return {enabled:this.config.enabled,environment:this.config.environment,economicSubmissionAvailable:policyBlockers.length===0,policyBlockers,network,signer,audit};
  }
  async models(signal:AbortSignal=new AbortController().signal){
    if(this.transport.readiness().status!=="AVAILABLE")return {status:"BLOCKED_BY_UPSTREAM" as const,models:[]};
    this.checkNetwork(false);const discovered=await this.call(()=>this.router.miners(),signal);
    return {status:"OBSERVED_NOT_ATTESTED" as const,models:discovered.miners.filter(m=>m.enabled).flatMap(m=>m.capabilities.map(c=>({minerId:m.id,modelId:c.modelId,modelHash:c.modelHash,precisions:c.precisions??[],assurance:c.assurance,provenance:c.provenance})))};
  }
  enqueue(value:unknown):BuyerJob {
    const request=validateBuyerRequest(value),now=this.clock().toISOString();
    return this.repository.buyer.enqueue({id:sha256({scope:this.scope,idempotencyKey:request.idempotencyKey}),scope:this.scope,requestHash:sha256(request),configHash:this.executionPolicyHash,request,
      state:"QUEUED",version:0,attempts:0,createdAt:now,updatedAt:now,reservedBaseUnits:"0",chargedBaseUnits:"0"});
  }
  inspect(id:string){const job=this.repository.buyer.job(id);if(job&&job.scope!==this.scope)throw new Error("BUYER_SCOPE_MISMATCH");return job;}
  /** Explicit private export for independent offline Lab recheck; not an economic operation. */
  retainedEvidence(id:string){const job=this.inspect(id);return job?buildResearchEvidence(job):undefined;}
  evidence(id:string){const job=this.inspect(id);if(!job)return undefined;return {schema:"flop-router/buyer-evidence/v1",jobId:job.id,requestHash:job.requestHash,decisionId:job.decisionId,
    state:job.state,verificationBoundary:this.transport.readiness().kind==="LOCAL_TEST"?"LOCAL_TEST_LOGIC_ONLY":"CONFIGURED_EXTERNAL_VERIFIER",
    executionProofDigest:job.observation?.executionProof===undefined?undefined:sha256(job.observation.executionProof),
    settlementProofDigest:job.observation?.settlementProof===undefined?undefined:sha256(job.observation.settlementProof),
    transactionHash:job.signed?.transactionHash,finalizedBlockHash:job.observation?.finalizedBlockHash,evidenceRefs:job.observation?.evidenceRefs??[],
    chargedBaseUnits:job.chargedBaseUnits,audit:this.repository.buyer.audit(this.scope),
    // This is a separate provisional attribution verdict, not an authorization or confirmed reward.
    attributionAssessment:assessSettlementEvidence({
      requestingDid:undefined,
      payerAccount:job.binding?.agentAccount,
      creditedAccount:undefined,
      finalizedOnChainProof:job.state==="SETTLED"&&!!job.observation?.finalizedBlockHash,
      outcome:job.state==="SETTLED"?"SETTLED":"PENDING",
      transcriptPublished:undefined,
      beneficiaryRegistrationVerified:false,
      unlockCreditProofVerified:false,
      officialRuleForThisCaseVerified:false
    })};}
  private async call<T>(fn:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal):Promise<T> {
    const ctl=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    if(signal.aborted)throw new BuyerFault("CONTROLLER_ABORTED",true);
    let abort:()=>void=()=>{};
    try{return await Promise.race([fn(AbortSignal.any([signal,ctl.signal])),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{ctl.abort();reject(new BuyerFault("NETWORK_TIMEOUT",true));},this.config.networkTimeoutMs);
      abort=()=>{ctl.abort();reject(new BuyerFault("CONTROLLER_ABORTED",true));};signal.addEventListener("abort",abort,{once:true});
    })]);}finally{if(timer)clearTimeout(timer);signal.removeEventListener("abort",abort);}
  }
  private checkNetwork(spending:boolean) {
    const n=this.transport.readiness();if(n.status!=="AVAILABLE"||!Array.isArray(n.blockers)||n.blockers.length>0||!["OFFICIAL","LOCAL_TEST"].includes(n.kind))throw new BuyerFault("UPSTREAM_INTERFACE_UNAVAILABLE");
    if(n.environment!==this.config.environment||n.genesisHash!==this.config.genesisHash||(n.kind==="LOCAL_TEST"&&this.config.environment!=="DEV"))throw new BuyerFault("NETWORK_BINDING_MISMATCH");
    if(spending&&(!this.config.enabled||this.config.environment==="MAINNET"||!this.config.allowedEnvironments.includes(this.config.environment)))throw new BuyerFault("ECONOMIC_SUBMISSION_DISABLED");
  }
  async runOnce(signal:AbortSignal=new AbortController().signal):Promise<BuyerJob[]> {
    const store=this.repository.buyer;store.audit(this.scope);
    if(store.account(this.scope).open_until>this.clock().getTime())return [];
    const all=store.jobs(this.scope);const results:BuyerJob[]=[];
    // Recheck previously finalized settlements before authorizing any new spend.
    for(const j of all.filter(j=>j.state==="SETTLED")){
      if(signal.aborted)break;const owner=randomUUID();const claimed=store.claim(j.id,owner,this.config.leaseMs);if(!claimed)continue;
      try{results.push(await this.advance(claimed,owner,signal));}finally{store.releaseClaim(j.id,owner);}
    }
    const jobs=all.filter(j=>j.state!=="SETTLED"&&j.state!=="REJECTED"&&j.state!=="FINALITY_LOST");
    // Pending reservations always precede new purchases. Bounded workers, one durable account lane.
    jobs.sort((a,b)=>Number(!pending.has(a.state))-Number(!pending.has(b.state)));
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(this.config.maxConcurrent,jobs.length)},async()=>{
      while(cursor<jobs.length&&!signal.aborted){const j=jobs[cursor++]!;const owner=randomUUID();const claimed=store.claim(j.id,owner,this.config.leaseMs);if(!claimed)continue;
        try{results.push(await this.advance(claimed,owner,signal));}finally{store.releaseClaim(j.id,owner);}
      }
    }));return results;
  }
  async run(signal:AbortSignal,pollMs=1000):Promise<void> {
    if(!Number.isSafeInteger(pollMs)||pollMs<100||pollMs>60000)throw new Error("INVALID_BUYER_POLL_INTERVAL");
    while(!signal.aborted){await this.runOnce(signal);if(signal.aborted)break;await new Promise<void>(resolve=>{
      const finish=()=>{clearTimeout(timer);signal.removeEventListener("abort",finish);resolve();};const timer=setTimeout(finish,pollMs);signal.addEventListener("abort",finish,{once:true});
    });}
  }
  private async advance(initial:BuyerJob,owner:string,signal:AbortSignal):Promise<BuyerJob> {
    const store=this.repository.buyer;let job=initial;
    try {
      if(pending.has(job.state)||job.state==="SETTLED")return await this.reconcile(job,owner,signal);
      if(beforeSubmission.has(job.state))job=store.releaseBeforeSubmission(job.id,owner,"QUEUED","RECOVERED_BEFORE_SUBMISSION");
      if(!this.config.enabled)return job.state==="BLOCKED"&&job.reason==="ECONOMIC_SUBMISSION_DISABLED"?job:store.transition(job.id,owner,"BLOCKED",{},"ECONOMIC_SUBMISSION_DISABLED");
      if(job.configHash!==this.executionPolicyHash)return store.transition(job.id,owner,"BLOCKED",{},"EXECUTION_CONFIGURATION_CHANGED");
      this.checkNetwork(true);
      if(this.signer.readiness().available!==true)return store.transition(job.id,owner,"BLOCKED",{},"CANONICAL_SIGNER_FLOP_OPERATION_UNAVAILABLE");
      if(store.account(this.scope).frozen)return store.transition(job.id,owner,"BLOCKED",{},"BUYER_ACCOUNT_FROZEN");
      if(store.account(this.scope).lane&&store.account(this.scope).lane!==job.id)return job;
      job=store.transition(job.id,owner,"PREPARING",{attempts:job.attempts+1},"PREPARATION_STARTED");
      if(!store.acquirePlanningLane(job.id,owner))return store.releaseBeforeSubmission(job.id,owner,"QUEUED","ACCOUNT_LANE_BUSY");
      const context=await this.call(s=>this.transport.context(s),signal);
      buyerHex(context.genesisHash,"GENESIS");buyerHex(context.agentAccount,"AGENT_ACCOUNT");buyerHex(context.finalizedBlockHash,"FINALIZED_BLOCK");
      if(context.genesisHash!==this.config.genesisHash||context.agentAccount!==this.config.agentAccount||!Number.isSafeInteger(context.accountNonce)||context.accountNonce<0||context.accountNonce>0xffffffff)throw new BuyerFault("CONTEXT_BINDING_MISMATCH");
      buyerAmount(context.totalBalanceBaseUnits,"TOTAL_BALANCE");buyerAmount(context.spendableBalanceBaseUnits,"SPENDABLE_BALANCE");buyerAmount(context.existentialDepositBaseUnits,"EXISTENTIAL_DEPOSIT");
      buyerAmount(context.nextChannelNonce,"CHANNEL_NONCE");if(BigInt(context.nextChannelNonce)>=(1n<<64n)||BigInt(context.spendableBalanceBaseUnits)>BigInt(context.totalBalanceBaseUnits))throw new BuyerFault("CONTEXT_BALANCE_OR_NONCE_INVALID");
      if(context.proof===undefined||await this.call(s=>this.verifier.context(context,s),signal)!==true)throw new BuyerFault("CONTEXT_PROOF_INVALID");
      const latency=Math.min(job.request.constraints.maxLatencyMs??this.config.maxLatencyMs,this.config.maxLatencyMs);
      const decision=await this.call(()=>this.router.route({requestId:job.id,constraints:{...job.request.constraints,maxLatencyMs:latency}}),signal);
      if(decision.status==="PUBLIC_RUNTIME_UNAVAILABLE")throw new BuyerFault("UPSTREAM_INTERFACE_UNAVAILABLE");
      if(decision.status!=="SELECTED")throw new BuyerFault("NO_ELIGIBLE_EXTERNAL_MINER");
      const miner=decision.snapshot.candidates.find(m=>m.id===decision.selectedMinerId)!;
      buyerHex(miner.identity.account,"MINER_ACCOUNT");
      if(miner.identity.account===this.config.agentAccount||this.config.controlledMinerAccounts.includes(miner.identity.account!))throw new BuyerFault("CONTROLLED_PROVIDER_PROHIBITED");
      const quote=await this.call(s=>this.transport.quote(decision,job.request,s),signal);
      const escrow=buyerAmount(quote.intent.escrowBaseUnits,"ESCROW",true),fee=buyerAmount(quote.feeCapBaseUnits,"TRANSACTION_FEE_CAP");
      if(!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=this.clock().getTime()||!Number.isSafeInteger(quote.maximumLatencyMs)||quote.maximumLatencyMs<1||quote.maximumLatencyMs>latency)throw new BuyerFault("QUOTE_EXPIRY_OR_LATENCY_INVALID");
      const cost=BigInt(escrow)+BigInt(fee);if(cost>=(1n<<128n)||cost>BigInt(job.request.maxCostBaseUnits)||BigInt(escrow)>BigInt(this.config.maxSessionEscrowBaseUnits!)||BigInt(fee)>BigInt(this.config.maxTransactionFeeBaseUnits!))throw new BuyerFault("SESSION_COST_LIMIT_EXCEEDED");
      if(BigInt(context.spendableBalanceBaseUnits)<cost+BigInt(context.existentialDepositBaseUnits))throw new BuyerFault("INSUFFICIENT_VERIFIED_BALANCE");
      const verified=await this.call(s=>this.verifier.quote(quote,decision,job.request,s),signal);
      if(quote.proof===undefined||verified.valid!==true||verified.independentProvider!==true)throw new BuyerFault("QUOTE_OR_PROVIDER_INDEPENDENCE_UNVERIFIED");
      const prepConfig=loadFlopTestnetConfig({environment:this.config.environment==="DEV"?"devnet":"public-testnet",prepareEnabled:true,
        genesisHash:this.config.genesisHash,agentAccount:this.config.agentAccount,maxEscrowBaseUnits:this.config.maxSessionEscrowBaseUnits,maxTransactionFeeBaseUnits:this.config.maxTransactionFeeBaseUnits},{});
      let preparation:ReturnType<typeof prepareFlopChannel>;
      try{preparation=prepareFlopChannel(decision,{...quote.intent,channelNonce:context.nextChannelNonce},prepConfig,this.clock());}catch{throw new BuyerFault("OPENING_OFFER_BINDING_INVALID");}
      const binding:BuyerBinding={environment:this.config.environment,authorizationId:this.config.executionAuthorizationId!,openChannel:preparation.knownOpenChannelFields,precision:job.request.constraints.precision!,maximumLatencyMs:quote.maximumLatencyMs,settlementMode:"COOPERATIVE",genesisHash:context.genesisHash,agentAccount:context.agentAccount,accountNonce:context.accountNonce,channelNonce:context.nextChannelNonce,
        requestHash:job.requestHash,preparationHash:preparation.preparationHash,escrowBaseUnits:escrow,feeCapBaseUnits:fee};
      job=store.transition(job.id,owner,"PREPARING",{decisionId:decision.decisionId,context,quote,binding},"VALIDATED_QUOTE_AND_CHAIN_CONTEXT");
      const reserved=store.reserve(job.id,owner,cost.toString(),this.config.maxTotalSpendBaseUnits!,context.nextChannelNonce);
      if(!reserved)return store.releaseBeforeSubmission(job.id,owner,"QUEUED","ACCOUNT_LANE_BUSY");
      job=reserved;
      preparation=prepareFlopChannel(decision,{...quote.intent,channelNonce:job.binding!.channelNonce},prepConfig,this.clock());
      job=store.transition(job.id,owner,"SIGNING",{binding:{...job.binding!,preparationHash:preparation.preparationHash,openChannel:preparation.knownOpenChannelFields}},"BUILDING_BOUND_TRANSACTION");
      const unsigned=await this.call(s=>this.transport.build(job.binding!,decision,job.request,quote,s),signal);
      base64(unsigned.signingPayloadBase64);base64(unsigned.callBytesBase64);
      if(unsigned.bindingHash!==sha256(job.binding)||await this.call(s=>this.verifier.unsigned(unsigned,job.binding!,job.request,s),signal)!==true)throw new BuyerFault("UNSIGNED_TRANSACTION_BINDING_INVALID");
      const signed=await this.call(s=>this.signer.sign(unsigned,job.binding!,s),signal);
      base64(signed.bytesBase64);buyerHex(signed.transactionHash,"TRANSACTION_HASH");
      if(signed.signerAccount!==this.config.agentAccount||typeof signed.signature!=="string"||!signed.signature.length||signed.signature.length>4096||await this.call(s=>this.verifier.signed(signed,unsigned,job.binding!,s),signal)!==true)throw new BuyerFault("INVALID_TRANSACTION_SIGNATURE");
      job=store.transition(job.id,owner,"SIGNED",{unsigned,signed},"SIGNATURE_AND_CALL_VERIFIED");
      this.checkNetwork(true);store.audit(this.scope);
      if(store.account(this.scope).frozen||store.account(this.scope).lane!==job.id)throw new BuyerFault("BUYER_ACCOUNT_FROZEN_OR_LANE_LOST");
      if(Date.parse(quote.expiresAt)<=this.clock().getTime()||Date.parse(miner.openingOffer!.expiresAt!)<=this.clock().getTime())throw new BuyerFault("QUOTE_EXPIRED_BEFORE_SUBMISSION");
      // Durably mark the point of no safe automatic retry BEFORE crossing the network boundary.
      job=store.transition(job.id,owner,"SUBMITTING",{submittedAt:this.clock().toISOString(),executionDeadlineAt:new Date(this.clock().getTime()+latency).toISOString()},"ECONOMIC_SUBMISSION_COMMITTED");
      const ack=await this.call(s=>this.transport.submit(signed,s),signal);
      if(ack.transactionHash!==signed.transactionHash)throw new BuyerFault("SUBMISSION_ACK_MISMATCH");
      job=store.transition(job.id,owner,"PENDING",{},"SUBMISSION_ACKNOWLEDGED");
      return await this.reconcile(job,owner,signal);
    } catch(error) {
      job=store.job(job.id)!;
      if(error instanceof Error&&error.message==="BUYER_LEASE_LOST")return job;
      const permanent=error instanceof Error&&permanentStoreErrors.has(error.message);
      const code=error instanceof BuyerFault?error.code:permanent?(error as Error).message:"BUYER_BOUNDARY_OR_NETWORK_FAILURE";
      if(pending.has(job.state)){
        store.networkFailure(this.scope,this.config.circuitFailureThreshold,this.config.circuitCooldownMs);
        return store.transition(job.id,owner,"OUTCOME_UNKNOWN",{},code);
      }
      if(job.state==="SETTLED"){store.freeze(this.scope);return store.transition(job.id,owner,"SETTLED",{},"FINALITY_RECHECK_UNAVAILABLE");}
      if(beforeSubmission.has(job.state)){
        const retry=(error instanceof BuyerFault?error.retryable:!permanent&&!(error instanceof Error&&error.message.startsWith("INVALID_")))&&job.attempts<this.config.maxAttempts;
        if(retry)store.networkFailure(this.scope,this.config.circuitFailureThreshold,this.config.circuitCooldownMs);
        return store.releaseBeforeSubmission(job.id,owner,retry?"QUEUED":"REJECTED",code);
      }
      return job.state==="BLOCKED"&&job.reason===code?job:store.transition(job.id,owner,"BLOCKED",{},code);
    }
  }
  private async reconcile(job:BuyerJob,owner:string,signal:AbortSignal):Promise<BuyerJob> {
    const store=this.repository.buyer;this.checkNetwork(false);
    if(!job.signed||!job.binding||!job.context)throw new BuyerFault("PENDING_BINDING_MISSING");
    const observation=await this.call(s=>this.transport.observe(job,s),signal);
    if(observation.transactionHash!==job.signed.transactionHash)throw new BuyerFault("OBSERVATION_TRANSACTION_MISMATCH");
    if(observation.phase==="FINALITY_LOST"){
      store.freeze(this.scope);
      return store.transition(job.id,owner,job.state==="SETTLED"?"FINALITY_LOST":"OUTCOME_UNKNOWN",{observation},"FINALITY_LOST");
    }
    if(job.state==="SETTLED"){
      if(observation.phase!=="SETTLED"||observation.finalizedBlockHash!==job.observation?.finalizedBlockHash||observation.paidBaseUnits!==job.observation?.paidBaseUnits||observation.transactionFeeBaseUnits!==job.observation?.transactionFeeBaseUnits||observation.totalBalanceBaseUnits!==job.observation?.totalBalanceBaseUnits||observation.result!==job.observation?.result||await this.call(s=>this.verifier.settlement(observation,job,s),signal)!==true){
        store.freeze(this.scope);return store.transition(job.id,owner,"FINALITY_LOST",{observation},"FINALIZED_SETTLEMENT_NO_LONGER_VERIFIABLE");
      }return job;
    }
    if(observation.phase==="ACCEPTED"){
      if(job.executionDeadlineAt&&this.clock().getTime()>=Date.parse(job.executionDeadlineAt))return store.transition(job.id,owner,"OUTCOME_UNKNOWN",{observation},"SESSION_LATENCY_LIMIT_EXCEEDED");
      buyerHex(observation.channelId,"CHANNEL_ID");
      if(observation.acceptanceProof===undefined||await this.call(s=>this.verifier.acceptance(observation,job,s),signal)!==true)throw new BuyerFault("CHANNEL_ACCEPTANCE_PROOF_INVALID");
      if(job.channelId&&job.channelId!==observation.channelId)throw new BuyerFault("CHANNEL_ID_CHANGED");
      if(job.executionStartedAt)return store.transition(job.id,owner,"EXECUTING",{observation},"INFERENCE_ALREADY_DISPATCHED_RECONCILE_ONLY");
      this.checkNetwork(true);
      if(store.account(this.scope).frozen)throw new BuyerFault("BUYER_ACCOUNT_FROZEN");
      job=store.transition(job.id,owner,"EXECUTING",{observation,channelId:observation.channelId,executionStartedAt:this.clock().toISOString()},"INFERENCE_DISPATCH_COMMITTED");
      const executed=await this.call(s=>this.transport.execute(job,s),signal);
      if(typeof executed.executionRef!=="string"||!executed.executionRef.length||executed.executionRef.length>2048)throw new BuyerFault("INVALID_INFERENCE_EXECUTION_REFERENCE");
      return store.transition(job.id,owner,"EXECUTING",{executionRef:executed.executionRef},"INFERENCE_DISPATCH_ACKNOWLEDGED");
    }
    if(observation.phase==="UNKNOWN")return store.transition(job.id,owner,"OUTCOME_UNKNOWN",{observation},"EXTERNAL_OUTCOME_UNKNOWN");
    if(observation.phase==="PENDING"||observation.phase==="EXECUTING"){
      if(job.executionDeadlineAt&&this.clock().getTime()>=Date.parse(job.executionDeadlineAt))return store.transition(job.id,owner,"OUTCOME_UNKNOWN",{observation},"SESSION_LATENCY_LIMIT_EXCEEDED");
      return store.transition(job.id,owner,observation.phase,{observation},"EXTERNAL_PROGRESS_OBSERVED");
    }
    if(!["SETTLED","REJECTED"].includes(observation.phase))throw new BuyerFault("INVALID_EXTERNAL_PHASE");
    job=store.transition(job.id,owner,"VERIFYING",{observation},"VERIFYING_EXTERNAL_TERMINAL_PROOFS");
    buyerHex(observation.finalizedBlockHash,"FINALIZED_BLOCK");
    const paid=buyerAmount(observation.paidBaseUnits,"PAYABLE"),fee=buyerAmount(observation.transactionFeeBaseUnits,"PAID_TRANSACTION_FEES"),balance=buyerAmount(observation.totalBalanceBaseUnits,"FINAL_BALANCE");
    if(observation.settlementProof===undefined||await this.call(s=>this.verifier.settlement(observation,job,s),signal)!==true)throw new BuyerFault("SETTLEMENT_PROOF_INVALID");
    if(observation.phase==="SETTLED"){
      if(typeof observation.result!=="string"||Buffer.byteLength(observation.result)>1024*1024||observation.executionProof===undefined||await this.call(s=>this.verifier.execution(observation,job,s),signal)!==true)throw new BuyerFault("EXECUTION_PROOF_INVALID");
      if(paid!==job.binding!.escrowBaseUnits)throw new BuyerFault("COOPERATIVE_PAYMENT_MISMATCH");
    }else if(paid!=="0")throw new BuyerFault("REJECTED_PAYMENT_AMBIGUOUS");
    const charge=BigInt(paid)+BigInt(fee);
    if(BigInt(fee)>BigInt(job.binding!.feeCapBaseUnits)||charge>BigInt(job.reservedBaseUnits)||BigInt(job.context!.totalBalanceBaseUnits)-charge!==BigInt(balance)){
      store.freeze(this.scope);throw new BuyerFault("EXTERNAL_BALANCE_OR_FEE_DISCREPANCY");
    }
    if(!Array.isArray(observation.evidenceRefs)||!observation.evidenceRefs.length||observation.evidenceRefs.some(v=>typeof v!=="string"||!v.length||v.length>2048))throw new BuyerFault("EXTERNAL_EVIDENCE_REFS_REQUIRED");
    return store.finish(job.id,owner,observation,charge.toString(),observation.phase as "SETTLED"|"REJECTED");
  }
}
