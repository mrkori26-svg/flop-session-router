#!/usr/bin/env node
import { isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { StaticCandidateProvider,FlopRuntimeAdapter } from "./providers.js";
import { RouterRepository } from "./storage.js";
import { SessionRouter } from "./router.js";
import { createRouterServer } from "./server.js";
import { preflightMany } from "./preflight.js";
import { loadFlopTestnetConfig } from "./flop-testnet.js";
import { FlopInferenceBuyer } from "./flop-inference-buyer.js";
import { loadBuyerConfig, validateBuyerRequest } from "./flop-buyer-config.js";
import { UnavailableFlopBuyerSigner, UnavailableFlopBuyerVerifier } from "./flop-buyer-upstream.js";
import { CanonicalFlopBuyerSigner } from "./flop-buyer-signer.js";
import { DEFAULT_CONFIG } from "./types.js";
const args=process.argv.slice(2),command=args[0],value=(flag:string)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};
const db=value("--db")??"router.db";let repo:RouterRepository;
const json=(path:string)=>JSON.parse(readFileSync(path,"utf8"));
const output=(v:unknown)=>process.stdout.write(JSON.stringify(v,null,2)+"\n");
async function main(){
 if(command?.startsWith("buyer-")&&(!value("--db")||!isAbsolute(db)))throw new Error("BUYER_ABSOLUTE_DURABLE_DATABASE_PATH_REQUIRED");
 repo=new RouterRepository(db);
 if(command==="--help"||command==="help")return output({usage:"flop-router <serve|route|inspect|replay|preflight|doctor|testnet-readiness|prepare-inference|buyer-doctor|buyer-models|buyer-enqueue|buyer-inspect|buyer-evidence|buyer-once|buyer-run>"});
 if(command?.startsWith("buyer-")){
  const config=loadBuyerConfig(value("--config")?json(value("--config")!):{});
  const provider=new FlopRuntimeAdapter(loadFlopTestnetConfig({environment:config.environment==="DEV"?"devnet":"public-testnet",genesisHash:config.genesisHash,agentAccount:config.agentAccount},{}));
  const signerDirectory=value("--signer-directory");
  const signer=signerDirectory?new CanonicalFlopBuyerSigner(signerDirectory,value("--python")??"python.exe"):new UnavailableFlopBuyerSigner();
  const buyer=new FlopInferenceBuyer(new SessionRouter(provider,repo),repo,provider.buyerTransport(config.environment),signer,new UnavailableFlopBuyerVerifier(),config);
  if(command==="buyer-doctor"){
   let canonicalSignerStatus:unknown;
   if(signer instanceof CanonicalFlopBuyerSigner){try{canonicalSignerStatus=await signer.status();}catch{canonicalSignerStatus={status:"CANONICAL_SIGNER_UNAVAILABLE"};}}
   return output({...buyer.readiness(),canonicalSignerStatus});
  }
  if(command==="buyer-enqueue"){
   const values=value("--requests")?json(value("--requests")!):[json(value("--request")??"")];
   if(!Array.isArray(values)||values.length<1||values.length>1000)throw new Error("INVALID_BUYER_BATCH");
   const requests=values.map(validateBuyerRequest);return output(requests.map(r=>buyer.enqueue(r)));
  }
  if(command==="buyer-models")return output(await buyer.models());
  if(command==="buyer-inspect")return output(buyer.inspect(args[1]??""));
  if(command==="buyer-evidence")return output(buyer.evidence(args[1]??""));
  if(command==="buyer-once")return output(await buyer.runOnce());
  if(command==="buyer-run"){
   const controller=new AbortController();const stop=()=>controller.abort();process.once("SIGINT",stop);process.once("SIGTERM",stop);
   try{await buyer.run(controller.signal,Number(value("--poll-ms")??1000));}finally{process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);repo.close();}return;
  }
  throw new Error("UNKNOWN_BUYER_COMMAND");
 }
 if(command==="testnet-readiness"||command==="prepare-inference"){
  const config=loadFlopTestnetConfig(value("--config")?json(value("--config")!):{});
  const adapter=new FlopRuntimeAdapter(config);
  if(command==="testnet-readiness")return output(adapter.readiness());
  const decision=repo.decision(value("--decision")??"");
  if(!decision)throw new Error("DECISION_NOT_FOUND");
  return output(adapter.prepare(decision,json(value("--intent")??"")));
 }
 if(command==="route"){const request=json(value("--request")??"");const candidates=value("--candidates")?json(value("--candidates")!):[];return output(await new SessionRouter(new StaticCandidateProvider(candidates),repo).route(request));}
 if(command==="inspect"){const d=repo.decision(args[1]??"");if(!d)throw new Error("DECISION_NOT_FOUND");return output(d);}
 if(command==="replay")return output(new SessionRouter(new StaticCandidateProvider([]),repo).replay(args[1]??""));
 if(command==="preflight"){const candidates=json(value("--candidates")??"");return output(await preflightMany(candidates,DEFAULT_CONFIG));}
 if(command==="doctor")return output({node:process.version,stdinRequired:false,database:db,runtimeAdapter:"PUBLIC_RUNTIME_UNAVAILABLE",signer:"SIGNER_UNAVAILABLE",status:"READY_FOR_LOCAL_USE"});
 if(command==="serve"){const fixtures=value("--candidates");const provider=fixtures?new StaticCandidateProvider(json(fixtures)):new FlopRuntimeAdapter();const server=createRouterServer(new SessionRouter(provider,repo),repo);const host=value("--host")??"127.0.0.1",port=Number(value("--port")??8788);server.listen(port,host,()=>output({listening:`http://${host}:${port}`,runtime:fixtures?"FIXTURE_ONLY":"PUBLIC_RUNTIME_UNAVAILABLE"}));return;}
 throw new Error("usage: flop-router <serve|route|inspect|replay|preflight|doctor|testnet-readiness|prepare-inference|buyer-doctor|buyer-models|buyer-enqueue|buyer-inspect|buyer-evidence|buyer-once|buyer-run>");
}
main().catch(e=>{process.stderr.write(JSON.stringify({error:e instanceof Error?e.message:"failed"})+"\n");process.exitCode=1;});
