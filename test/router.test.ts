import test from "node:test";import assert from "node:assert/strict";import {mkdtempSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
import {DEFAULT_CONFIG,EphemeralSigner,FlopRuntimeAdapter,RouterRepository,SessionRouter,StaticCandidateProvider,validateSignRequest,type MinerCandidate,type RouteRequest} from "../src/index.js";
const now="2026-09-07T00:00:00.000Z";const candidate=(id:string,extra:Partial<MinerCandidate>={}):MinerCandidate=>({id,identity:{did:`did:test:${id}`},enabled:true,capabilities:[{modelId:"m1",modelHash:"h1",precisions:["fp16"],decodePolicies:["greedy"],assurance:"SOFT",observedAt:now}],telemetry:{successEwma:.9,latencyMsEwma:100,availability:.9,observedAt:now},...extra});
const request:RouteRequest={requestId:"r1",constraints:{modelId:"m1",modelHash:"h1",precision:"fp16",decodePolicy:"greedy"}};
function setup(c:MinerCandidate[]){const dir=mkdtempSync(join(tmpdir(),"router-"));const repo=new RouterRepository(join(dir,"r.db"));return{dir,repo,router:new SessionRouter(new StaticCandidateProvider(c),repo,DEFAULT_CONFIG,()=>new Date(now)),clean(){repo.close();rmSync(dir,{recursive:true,force:true});}};}
test("ineligible never wins and missing metrics are neutral",async()=>{const s=setup([candidate("bad",{capabilities:[]}),candidate("good",{telemetry:undefined})]);try{const d=await s.router.route(request);assert.equal(d.selectedMinerId,"good");assert.equal(d.snapshot.evaluations[0]?.eligible,false);}finally{s.clean();}});
test("ranking and tie break are deterministic and replayable",async()=>{const s=setup([candidate("b"),candidate("a")]);try{const d=await s.router.route(request);assert.deepEqual(d.ranking,["a","b"]);assert.equal(s.router.replay(d.decisionId).status,"REPLAY_MATCH");}finally{s.clean();}});
test("score uses the capability matching the requested model",async()=>{const stale="2025-01-01T00:00:00.000Z";const s=setup([candidate("a",{capabilities:[{modelId:"other",assurance:"UNKNOWN",observedAt:stale},{modelId:"m1",modelHash:"h1",precisions:["fp16"],decodePolicies:["greedy"],assurance:"HARD",observedAt:now}]}),candidate("b")]);try{const d=await s.router.route(request);assert.equal(d.selectedMinerId,"a");assert.ok(d.snapshot.evaluations.find(x=>x.minerId==="a")!.score!.assurance>d.snapshot.evaluations.find(x=>x.minerId==="b")!.score!.assurance);}finally{s.clean();}});
test("no eligible and unavailable public runtime are explicit",async()=>{const a=setup([candidate("x",{enabled:false})]);try{assert.equal((await a.router.route(request)).status,"NO_ELIGIBLE_MINER");}finally{a.clean();}const b=setup([]);try{const router=new SessionRouter(new FlopRuntimeAdapter(),b.repo);assert.equal((await router.route(request)).status,"PUBLIC_RUNTIME_UNAVAILABLE");}finally{b.clean();}});
test("retry bounded and circuit opens",async()=>{const s=setup([candidate("a"),candidate("b"),candidate("c")]);try{const d=await s.router.route({...request,maxAttempts:2});const out=await s.router.execute(d,{execute:async()=>({status:"failed",retryable:true})});assert.equal(out.attempts.length,2);for(let i=0;i<3;i++)await s.router.execute(await s.router.route(request),{execute:async()=>({status:"failed",retryable:false})});assert.equal(s.repo.circuit("a").state,"OPEN");}finally{s.clean();}});
test("typed signing boundary and ephemeral signer",async()=>{assert.throws(()=>validateSignRequest("bad" as any,"session",{}),/INVALID/);assert.throws(()=>validateSignRequest("FLOP_ROUTER_SESSION_V1","session",{x:Infinity}),/NON_CANONICAL/);const r=validateSignRequest("FLOP_ROUTER_DECISION_V1","decision",{id:"d"});assert.ok((await new EphemeralSigner().sign(r)).signature);});
test("maxLatencyMs is a hard constraint",async()=>{const s=setup([candidate("slow",{telemetry:{latencyMsEwma:201}}),candidate("unknown",{telemetry:undefined}),candidate("fast",{telemetry:{latencyMsEwma:50}})]);try{const d=await s.router.route({...request,constraints:{...request.constraints,maxLatencyMs:100}});assert.deepEqual(d.ranking,["fast"]);assert.deepEqual(d.snapshot.evaluations.find(x=>x.minerId==="slow")!.rejectionReasons,["LATENCY_EXCEEDS_MAXIMUM"]);assert.deepEqual(d.snapshot.evaluations.find(x=>x.minerId==="unknown")!.rejectionReasons,["INSUFFICIENT_CAPABILITY_DATA"]);}finally{s.clean();}});
test("session outcome and preflight observations persist",async()=>{const s=setup([candidate("a")]);try{const d=await s.router.route(request);assert.equal(s.repo.preflights(d.decisionId).length,1);const out=await s.router.execute(d,{execute:async()=>({status:"completed"})});assert.deepEqual(s.repo.outcome(d.decisionId),JSON.parse(JSON.stringify(out)));}finally{s.clean();}});


test("replay detects persisted snapshot tampering even when ranking is unchanged",async()=>{
  const s=setup([candidate("a"),candidate("b")]);
  try{
    const d=await s.router.route(request);
    const tampered=structuredClone(d);
    tampered.snapshot.capturedAt="2026-09-07T00:00:01.000Z";
    (s.repo as any).db.prepare("UPDATE decisions SET body=? WHERE id=?").run(JSON.stringify(tampered),d.decisionId);
    assert.equal(s.router.replay(d.decisionId).status,"DECISION_REPLAY_DIVERGENCE");
  }finally{s.clean();}
});

test("timeout with uncertain remote outcome does not automatically fail over",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"router-timeout-"));
  const repo=new RouterRepository(join(dir,"r.db"));
  const router=new SessionRouter(
    new StaticCandidateProvider([candidate("a"),candidate("b")]),
    repo,
    {...DEFAULT_CONFIG,preflightTimeoutMs:20},
    ()=>new Date(now),
  );
  try{
    const d=await router.route({...request,maxAttempts:2});
    let calls=0;
    const out=await router.execute(d,{execute:async()=>{
      calls++;
      await new Promise(resolve=>setTimeout(resolve,60));
      return {status:"completed"};
    }});
    assert.equal(out.status,"timed_out");
    assert.equal(out.attempts.length,1);
    assert.equal(out.attempts[0]?.retryable,false);
    assert.equal(out.attempts[0]?.reason,"EXECUTION_TIMEOUT_OUTCOME_UNKNOWN");
    assert.equal(calls,1);
  }finally{
    repo.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
