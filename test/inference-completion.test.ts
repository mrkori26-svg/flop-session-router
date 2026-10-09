import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {InferenceGateway,OpenAICompatibleWorker,type InferenceWorker} from "../src/inference-gateway.js";

const request={model:"m",messages:[{role:"user" as const,content:"hi"}]};
test("truncated execution neither completes nor re-submits to another provider",async()=>{
  let otherRuns=0;
  const health=async()=>({ok:true,latencyMs:1,checkedAt:new Date().toISOString()});
  const first:InferenceWorker={id:"a",models:["m"],health,async *stream(){yield {text:"partial",done:false};}};
  const second:InferenceWorker={id:"b",models:["m"],health,async *stream(){otherRuns++;yield {text:"second",done:true};}};
  const gateway=new InferenceGateway([first,second]);
  await assert.rejects(gateway.generate(request),/INFERENCE_EXECUTION_OUTCOME_UNKNOWN/);
  assert.equal(otherRuns,0);assert.equal(gateway.metrics().a!.active,0);assert.equal(gateway.metrics().a!.failures,1);
});
for(const scenario of ["complete-crlf","truncated","malformed-content"] as const) {
  test(`HTTP SSE ${scenario}: terminal evidence is required`,async()=>{
    const server=createServer((req,res)=>{
      if(req.url?.endsWith("/models")){res.end('{"data":[]}');return;}
      res.setHeader("content-type","text/event-stream");
      const content=scenario==="malformed-content"?123:"real text";
      res.write(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\r\n\r\n`);
      res.end(scenario==="complete-crlf"?"data: [DONE]\r\n\r\n":"");
    });
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const port=(server.address() as {port:number}).port;
    try {
      const gateway=new InferenceGateway([new OpenAICompatibleWorker({id:"http",baseUrl:`http://127.0.0.1:${port}`,models:["m"]})]);
      if(scenario==="complete-crlf")assert.equal((await gateway.generate(request)).text,"real text");
      else await assert.rejects(gateway.generate(request),/INFERENCE_EXECUTION_OUTCOME_UNKNOWN/);
    } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
}
