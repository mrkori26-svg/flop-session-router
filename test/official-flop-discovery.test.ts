import test from "node:test";
import assert from "node:assert/strict";
import { FlopPublicCatalog, checkOfficialRuntimeVersion, officialNetworkReadiness } from "../src/official-flop-discovery.js";

test("official SDK runtime compatibility is exact, not min-max range", () => {
  assert.equal(checkOfficialRuntimeVersion(1013000).compatible, true);
  assert.equal(checkOfficialRuntimeVersion(1014000).compatible, true);
  assert.equal(checkOfficialRuntimeVersion(1013500).compatible, false);
  assert.equal(checkOfficialRuntimeVersion(1014001).compatible, true);
  assert.equal(checkOfficialRuntimeVersion(1014002).compatible, true);
  assert.equal(checkOfficialRuntimeVersion(1014003).compatible, true);
  assert.equal(checkOfficialRuntimeVersion(1014003).source, "@flop-labs/sdk@0.4.0");
  assert.equal(checkOfficialRuntimeVersion(1014006).compatible, false);
  assert.equal(checkOfficialRuntimeVersion(1014011).compatible, true);
  assert.equal(checkOfficialRuntimeVersion("1014000").compatible, false);
});

test("official testnet remains planned and cannot activate spending", () => {
  const publicTestnet = officialNetworkReadiness("testnet");
  assert.equal(publicTestnet.status, "planned");
  assert.equal(publicTestnet.economicOperationsEnabled, false);
});

test("public catalog uses official client but cannot mint candidates, quotes, or verified settlement", async () => {
  const calls: string[] = [];
  const mockedFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    const model = { id:"m", object:"model", created:1, owned_by:"test", name:"model", canonical_slug:"m", context_length:1024, architecture:{input_modalities:["text"],output_modalities:["text"],modality:"text->text"}, default_parameters:null, links:{details:"/api/v1/models/m"}, per_request_limits:{prompt_tokens:100,completion_tokens:100}, pricing:{prompt:"1",completion:"1",input_cache_read:"0"}, supported_parameters:["max_tokens"], supported_voices:null, top_provider:{context_length:1024,max_completion_tokens:100,is_moderated:false}, "x-flop":{price_sources:[{miner_address:"5fake",version:"chain:1",source:"devnet-nominal",effective_at:"2026-10-19T12:00:00Z",expires_at:"2026-10-19T12:01:00Z"}]} };
    const body = url.endsWith("/models") ? { object:"list",data:[model],total_count:1,links:{next:null} } : {data:model};
    return new Response(JSON.stringify(body), {status:200,headers:{"content-type":"application/json"}});
  };
  const client = new FlopPublicCatalog({fetch:mockedFetch});
  const catalog = await client.list();
  assert.equal(catalog.economicEligibility, "UNVERIFIED");
  assert.equal(catalog.verified, "GATEWAY_CONTRACT_ONLY");
  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0]?.nominalPriceSourceCount, 1);
  assert.equal("candidates" in catalog, false);
  const model = await client.getModel("m");
  assert.equal(model.economicEligibility,"UNVERIFIED");
  assert.equal(calls.length,2);
});
