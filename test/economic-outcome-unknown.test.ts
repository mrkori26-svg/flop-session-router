import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {SessionRouter,RouterRepository,StaticCandidateProvider,withEconomicExecutionGate,type MinerCandidate} from "../src/index.js";

for(const failure of ["execution_throw","completion_recording"] as const) {
  test(`${failure}: uncertain economic outcome retains authorization and forbids provider failover`,async()=>{
    const directory=mkdtempSync(join(tmpdir(),"economic-unknown-"));const repo=new RouterRepository(join(directory,"r.db"));
    const miners:MinerCandidate[]=["a","b"].map(id=>({id,enabled:true,identity:{},capabilities:[{modelId:"m",assurance:"SOFT"}]}));
    const router=new SessionRouter(new StaticCandidateProvider(miners),repo);
    let runs=0,releases=0,authorizations=0;
    const executor=withEconomicExecutionGate({execute:async()=>{runs++;if(failure==="execution_throw")throw new Error("remote_disconnect_sensitive_body");return {status:"completed"};}},{
      authorize:async()=>{authorizations++;return {status:"AUTHORIZED",authorizationId:"reservation"};},
      markExecutionComplete:async()=>{throw new Error("journal_down_sensitive_body");},release:async()=>{releases++;},
    });
    try {
      const d=await router.route({requestId:"r",constraints:{modelId:"m"},maxAttempts:2});
      const outcome=await router.execute(d,executor);
      assert.equal(outcome.status,"outcome_unknown");assert.equal(outcome.attempts.length,1);assert.equal(outcome.attempts[0]!.retryable,false);
      assert.equal(runs,1);assert.equal(releases,0);assert.equal(authorizations,1);
      assert.doesNotMatch(JSON.stringify(outcome),/sensitive_body/);
      assert.equal(repo.outcome(d.decisionId)?.status,"outcome_unknown");
      assert.deepEqual(await router.execute(d,executor),JSON.parse(JSON.stringify(outcome)));
      assert.equal(runs,1);assert.equal(authorizations,1);
    }finally{repo.close();rmSync(directory,{recursive:true,force:true});}
  });
}
