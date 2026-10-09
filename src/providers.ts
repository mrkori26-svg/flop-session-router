import type { MinerCandidate, RouteRequest } from "./types.js";
export interface MinerCandidateProvider { name: string; candidates(request: RouteRequest): Promise<MinerCandidate[]>; snapshot?(): Promise<MinerCandidate[]>; }
export class StaticCandidateProvider implements MinerCandidateProvider { name="static"; constructor(private readonly values: MinerCandidate[]){} async candidates(){ return structuredClone(this.values); } async snapshot(){return structuredClone(this.values);} }
import { loadFlopTestnetConfig, prepareFlopChannel, testnetReadiness, type FlopTestnetConfig, type FlopChannelIntent } from "./flop-testnet.js";
import { UnavailableFlopBuyerTransport } from "./flop-buyer-upstream.js";
import type { BuyerEnvironment, FlopBuyerTransport } from "./flop-buyer-contract.js";
import type { RouteDecision } from "./types.js";
/** A future official SDK driver supplies both discovery and channel transport; no RPC names are inferred here. */
export interface FlopBuyerNetworkDriver extends MinerCandidateProvider, FlopBuyerTransport {}
export class FlopRuntimeAdapter implements MinerCandidateProvider {
  name="flop-public-runtime";
  private readonly config:FlopTestnetConfig;
  constructor(config:FlopTestnetConfig=loadFlopTestnetConfig({},{}),private readonly driver?:FlopBuyerNetworkDriver){this.config=loadFlopTestnetConfig(config,{});}
  readiness(){return testnetReadiness(this.config);}
  private driverAvailable(environment:BuyerEnvironment):boolean {
    const r=this.driver?.readiness();
    return !!this.config.genesisHash&&!!r&&r.status==="AVAILABLE"&&Array.isArray(r.blockers)&&r.blockers.length===0&&
      r.genesisHash===this.config.genesisHash&&r.environment===environment&&
      (r.kind==="OFFICIAL"||(r.kind==="LOCAL_TEST"&&environment==="DEV"));
  }
  buyerTransport(environment:BuyerEnvironment="DEV"):FlopBuyerTransport {
    const configured=this.config.environment==="public-testnet"?"TESTNET":"DEV";
    return environment===configured&&this.driverAvailable(environment)?this.driver!:new UnavailableFlopBuyerTransport(environment,this.config.genesisHash);
  }
  prepare(decision:RouteDecision,intent:FlopChannelIntent,now:Date=new Date()){return prepareFlopChannel(decision,intent,this.config,now);}
  async snapshot():Promise<MinerCandidate[]>{
    const environment=this.config.environment==="public-testnet"?"TESTNET":"DEV";
    if(!this.driverAvailable(environment))return [];
    return this.driver!.snapshot?this.driver!.snapshot():[];
  }
  async candidates(request?:RouteRequest):Promise<MinerCandidate[]>{
    const environment=this.config.environment==="public-testnet"?"TESTNET":"DEV";
    if(!request||!this.driverAvailable(environment))throw new Error("PUBLIC_RUNTIME_UNAVAILABLE");
    return this.driver!.candidates(request);
  }
}
