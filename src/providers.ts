import type { MinerCandidate, RouteRequest } from "./types.js";
export interface MinerCandidateProvider { name: string; candidates(request: RouteRequest): Promise<MinerCandidate[]>; snapshot?(): Promise<MinerCandidate[]>; }
export class StaticCandidateProvider implements MinerCandidateProvider { name="static"; constructor(private readonly values: MinerCandidate[]){} async candidates(){ return structuredClone(this.values); } async snapshot(){return structuredClone(this.values);} }
import { loadFlopTestnetConfig, prepareFlopChannel, testnetReadiness, type FlopTestnetConfig, type FlopChannelIntent } from "./flop-testnet.js";
import type { RouteDecision } from "./types.js";
export class FlopRuntimeAdapter implements MinerCandidateProvider { name="flop-public-runtime"; constructor(private readonly config: FlopTestnetConfig=loadFlopTestnetConfig({},{})){} readiness(){return testnetReadiness(this.config);} prepare(decision:RouteDecision,intent:FlopChannelIntent,now:Date=new Date()){return prepareFlopChannel(decision,intent,this.config,now);} async candidates():Promise<MinerCandidate[]>{ throw new Error("PUBLIC_RUNTIME_UNAVAILABLE"); } }
