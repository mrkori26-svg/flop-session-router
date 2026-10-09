import { FLOP_UPSTREAM_BLOCKERS } from "./flop-testnet.js";
import type { BuyerEnvironment, BuyerBinding, BuyerUnsignedTransaction, FlopBuyerTransport, FlopBuyerVerifier, FlopBuyerSigner } from "./flop-buyer-contract.js";

/** Production default. No mock rail, inferred endpoint, SDK ABI or economic fallback. */
export class UnavailableFlopBuyerTransport implements FlopBuyerTransport {
  constructor(private readonly environment:BuyerEnvironment="DEV",private readonly genesisHash?:string){}
  readiness(){return {status:"BLOCKED_BY_UPSTREAM" as const,kind:"OFFICIAL" as const,environment:this.environment,genesisHash:this.genesisHash,blockers:[...FLOP_UPSTREAM_BLOCKERS]};}
  private unavailable():never{throw new Error("OFFICIAL_FLOP_BUYER_INTERFACE_UNAVAILABLE");}
  async context():Promise<never>{return this.unavailable();}
  async quote():Promise<never>{return this.unavailable();}
  async build():Promise<never>{return this.unavailable();}
  async submit():Promise<never>{return this.unavailable();}
  async execute():Promise<never>{return this.unavailable();}
  async observe():Promise<never>{return this.unavailable();}
}
export class UnavailableFlopBuyerVerifier implements FlopBuyerVerifier {
  async context(){return false;}async quote(){return {valid:false,independentProvider:false};}
  async unsigned(){return false;}async signed(){return false;}async acceptance(){return false;}async execution(){return false;}async settlement(){return false;}
}
export class UnavailableFlopBuyerSigner implements FlopBuyerSigner {
  readiness(){return {available:false,blocker:"CANONICAL_SIGNER_FLOP_OPERATION_UNAVAILABLE"};}
  async sign(_transaction:BuyerUnsignedTransaction,_binding:BuyerBinding):Promise<never>{throw new Error("CANONICAL_SIGNER_FLOP_OPERATION_UNAVAILABLE");}
}
