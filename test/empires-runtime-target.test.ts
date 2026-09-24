import assert from "node:assert/strict";
import test from "node:test";
import { EmpiresRuntimeTarget } from "../src/empires-runtime-target.js";

const fakeFetch = async (url: string): Promise<Response> => {
  const path = new URL(url).pathname;
  if (path.endsWith("/capabilities")) {
    return new Response(JSON.stringify({
      schema:"flop.runtime-capabilities.v1",
      runtime_id:"flop-empires-season0",
      capabilities:[
        {id:"empire.recon",status:"available"},
        {id:"empire.raid",status:"simulation_only"},
      ],
    }), {status:200});
  }
  return new Response(JSON.stringify({
    schema:"flop.runtime-fingerprint.v1",
    runtime_id:"flop-empires-season0",
    fingerprint:{product:"flop-empires",revision:"abc"},
  }), {status:200});
};

test("Empires runtime target discovers capabilities and delegates execution", async () => {
  const target = new EmpiresRuntimeTarget("http://127.0.0.1:8876", async (input) => ({
    startedAt:"2026-09-24T20:00:00.000Z",
    finishedAt:"2026-09-24T20:00:01.000Z",
    status:"completed",
    output:{requestId:input.requestId},
    evidenceRefs:["empires-native:req-1"],
  }), fakeFetch);
  assert.equal(await target.discover(), true);
  assert.deepEqual(await target.capabilities(), ["empire.raid","empire.recon"]);
  const fp = await target.fingerprint();
  assert.equal(fp.product, "flop-empires");
  const run = await target.execute({id:"j1",input:{capability:"empire.recon",requestId:"req-1"}});
  assert.deepEqual(run.output,{requestId:"req-1"});
});


test("Empires HTTP executor posts signed action and waits for native receipt", async () => {
  let receiptReads = 0;
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if (path === "/api/action") {
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string,string>)["cookie"], "session=abc");
      return new Response(JSON.stringify({ok:true}), {status:200});
    }
    if (path === "/api/receipt/req-2") {
      receiptReads += 1;
      if (receiptReads === 1) return new Response(JSON.stringify({status:"NOT_SEEN"}), {status:404});
      return new Response(JSON.stringify({status:"ACCEPTED_BY_REFEREE",receipt:{request_id:"req-2"}}), {status:200});
    }
    return new Response("{}", {status:404});
  };
  const { createEmpiresHttpExecutor } = await import("../src/empires-runtime-target.js");
  const execute = createEmpiresHttpExecutor(
    "http://127.0.0.1:8876", () => "session=abc", fetcher, 2, 0,
  );
  const result = await execute({
    capability:"empire.recon", requestId:"req-2",
    signedEnvelope:{did:"did:key:test",sig:"sig",nonce:"1",text:"{}"},
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.evidenceRefs, ["empires-native-receipt:req-2"]);
});
