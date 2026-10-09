import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlopRuntimeAdapter, loadFlopTestnetConfig, prepareFlopChannel, DEFAULT_CONFIG,
  SessionRouter, StaticCandidateProvider, RouterRepository, sha256,
  type MinerCandidate, type FlopChannelIntent, type FlopTestnetConfig, type RouteDecision } from "../src/index.js";

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}`;
const now = new Date("2026-10-09T12:00:00Z");
const config = (): FlopTestnetConfig => loadFlopTestnetConfig({environment:"public-testnet",prepareEnabled:true,
  genesisHash:hex(1),agentAccount:hex(2),maxEscrowBaseUnits:"1000000000000000000",maxTransactionFeeBaseUnits:"1000000000000"},{});
const intent = (): FlopChannelIntent => ({measuredRoot:hex(5),decodePolicyHash:hex(6),enclaveKey:hex(7),agentKey:hex(8),escrowBaseUnits:"100000000000000000",channelNonce:"18446744073709551615"});
async function decision(): Promise<RouteDecision> {
  const directory=mkdtempSync(join(tmpdir(),"flop-prepare-"));
  const repository=new RouterRepository(join(directory,"router.db"));
  const miner: MinerCandidate={id:"external-candidate",enabled:true,identity:{account:hex(3)},capabilities:[{modelId:"model",modelHash:hex(4),precisions:["fp16"],assurance:"HARD"}],
    openingOffer:{kind:"SessionOffer",version:2,miner:hex(3),chainGenesis:hex(1),modelHash:hex(4),precision:"fp16",enclaveKey:hex(7),
      minEscrow:{asset:"FLOP",unit:"base-unit",amount:"100000000000000000"},expiresAt:"2026-10-10T12:00:00Z",nonce:"offer-nonce",signature:"unverified-fixture-signature"}};
  try {return await new SessionRouter(new StaticCandidateProvider([miner]),repository,DEFAULT_CONFIG,()=>now).route({requestId:"prepare",constraints:{modelId:"model",modelHash:hex(4),precision:"fp16"}});}
  finally {repository.close();rmSync(directory,{recursive:true,force:true});}
}
function rehash(d:RouteDecision) {d.snapshotHash=sha256(d.snapshot);return d;}

test("readiness defaults closed and adapter retains explicit public runtime unavailability",async()=>{
  const adapter=new FlopRuntimeAdapter();
  assert.equal(adapter.readiness().economicOperationsEnabled,false);
  assert.equal(adapter.readiness().status,"BLOCKED_BY_UPSTREAM");
  assert.ok(adapter.readiness().localBlockers.includes("PREPARATION_DISABLED"));
  await assert.rejects(adapter.candidates(),/PUBLIC_RUNTIME_UNAVAILABLE/);
});
test("configuration rejects economic activation, malformed flags, unknown keys and integer overflow",()=>{
  for(const cfg of [{purchaseEnabled:true},{purchaseEnabled:"false"},{prepareEnabled:"true"},{endpoint:"http://invented"},{environment:"mainnet"},{maxEscrowBaseUnits:(1n<<128n).toString()},{maxEscrowBaseUnits:"01"},{genesisHash:hex(1).slice(2)}]) assert.throws(()=>loadFlopTestnetConfig(cfg,{}));
  assert.throws(()=>loadFlopTestnetConfig({}, {FLOP_TESTNET_PURCHASE_ENABLED:"true"}),/ECONOMIC_OPERATIONS_DISABLED/);
  assert.throws(()=>loadFlopTestnetConfig({purchaseEnabled:true},{FLOP_TESTNET_PURCHASE_ENABLED:"false"}),/ECONOMIC_OPERATIONS_DISABLED/);
  assert.throws(()=>loadFlopTestnetConfig({}, {FLOP_TESTNET_PREPARE_ENABLED:"1"}),/INVALID_PREPARE_FLAG/);
  assert.equal(loadFlopTestnetConfig({prepareEnabled:true},{FLOP_TESTNET_PREPARE_ENABLED:"false"}).prepareEnabled,false);
});
test("preparation binds existing decision without claiming signature, execution or settlement",async()=>{
  const d=await decision();const adapter=new FlopRuntimeAdapter(config());const plan=adapter.prepare(d,intent(),now);
  assert.equal(plan.status,"PREPARED_BLOCKED_UPSTREAM");assert.equal(plan.settlement,"UNVERIFIED");assert.equal(plan.economicOperationsEnabled,false);
  assert.equal(plan.knownOpenChannelFields.miner,hex(3));assert.equal(plan.knownOpenChannelFields.nonce,"18446744073709551615");
  assert.equal(plan.snapshotHash,d.snapshotHash);
  assert.ok(plan.upstreamBlockers.includes("OFFER_SIGNATURE_AND_REGISTRY_ATTESTATION_VERIFIER_UNAVAILABLE"));
  const {preparationHash,...body}=plan;assert.equal(preparationHash,sha256(body));
});
test("disabled preparation, missing budgets and tampered decision fail closed",async()=>{
  const d=await decision();assert.throws(()=>prepareFlopChannel(d,intent(),loadFlopTestnetConfig({},{}),now),/PREPARATION_DISABLED/);
  assert.throws(()=>prepareFlopChannel(d,intent(),loadFlopTestnetConfig({prepareEnabled:true},{}),now),/PINS_AND_BUDGETS/);
  d.snapshot.capturedAt="tampered";assert.throws(()=>prepareFlopChannel(d,intent(),config(),now),/INVALID_ROUTING_DECISION/);
});
test("strict escrow and channel nonce limits retain base-unit precision",async()=>{
  const d=await decision();
  for(const amount of ["99999999999999999","1000000000000000001","1e18","01","-1",(1n<<128n).toString()]) assert.throws(()=>prepareFlopChannel(d,{...intent(),escrowBaseUnits:amount},config(),now));
  for(const nonce of ["18446744073709551616","-1","01"]) assert.throws(()=>prepareFlopChannel(d,{...intent(),channelNonce:nonce},config(),now));
  assert.throws(()=>prepareFlopChannel(d,{...intent(),extra:"ignored"} as any,config(),now),/UNKNOWN_CHANNEL_INTENT_FIELD/);
});
test("offer chain, party, model, enclave, expiry and unsupported terms are bound",async()=>{
  const initial=await decision();
  for(const patch of [{chainGenesis:hex(9)},{miner:hex(9)},{modelHash:hex(9)},{precision:"fp32"},{enclaveKey:hex(9)},
    {expiresAt:now.toISOString()},{expiresAt:"bad"},{signature:""},{forwardTerms:{}},
    {minEscrow:{asset:"FLOP",unit:"token",amount:"1"}},{acceptance:{agent:hex(9)}}]) {
    const d=structuredClone(initial);Object.assign(d.snapshot.candidates[0]!.openingOffer!,patch);rehash(d);
    assert.throws(()=>prepareFlopChannel(d,intent(),config(),now));
  }
});
