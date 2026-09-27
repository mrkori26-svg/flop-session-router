import test from "node:test";
import assert from "node:assert/strict";
import { withEconomicExecutionGate } from "../src/economic-gate.js";

const candidate:any={id:"miner-1"};
const request:any={requestId:"r1",constraints:{modelId:"m1"}};
const signal=new AbortController().signal;

test("economic gate blocks execution before RUN",async()=>{
  let executed=false;
  const wrapped=withEconomicExecutionGate({execute:async()=>{executed=true;return{status:"completed"}}},{
    authorize:async()=>({status:"BLOCKED",reason:"STALE_PRICE"})
  });
  const result=await wrapped.execute(candidate,request,signal);
  assert.equal(executed,false);
  assert.equal(result.status,"failed");
  assert.match(result.reason??"",/STALE_PRICE/);
});

test("failed RUN releases economic authorization",async()=>{
  let released=false;
  const wrapped=withEconomicExecutionGate({execute:async()=>({status:"failed",retryable:true,reason:"runtime_failed"})},{
    authorize:async()=>({status:"AUTHORIZED",authorizationId:"a1",reservationRef:"lock1"}),
    release:async(a,reason)=>{released=a.authorizationId==="a1"&&reason==="runtime_failed";}
  });
  const result=await wrapped.execute(candidate,request,signal);
  assert.equal(result.status,"failed");
  assert.equal(released,true);
});

test("completed RUN does not imply settlement",async()=>{
  let complete=false, released=false;
  const wrapped=withEconomicExecutionGate({execute:async()=>({status:"completed"})},{
    authorize:async()=>({status:"AUTHORIZED",authorizationId:"a2"}),
    markExecutionComplete:async()=>{complete=true;},
    release:async()=>{released=true;}
  });
  const result=await wrapped.execute(candidate,request,signal);
  assert.equal(result.status,"completed");
  assert.equal(complete,true);
  assert.equal(released,false);
});


test("post-RUN recording failure never releases a completed economic authorization",async()=>{
  let releaseCalls=0;
  const wrapped=withEconomicExecutionGate({execute:async()=>({status:"completed"})},{
    authorize:async()=>({status:"AUTHORIZED",authorizationId:"a3",reservationRef:"lock3"}),
    markExecutionComplete:async()=>{throw new Error("journal_unavailable");},
    release:async()=>{releaseCalls++;},
  });
  await assert.rejects(wrapped.execute(candidate,request,signal),/ECONOMIC_POST_EXECUTION_RECORDING_FAILED/);
  assert.equal(releaseCalls,0);
});
