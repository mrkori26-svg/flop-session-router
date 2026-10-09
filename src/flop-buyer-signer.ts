import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join,resolve } from "node:path";
import { UnavailableFlopBuyerSigner } from "./flop-buyer-upstream.js";

export function validateCanonicalSignerStatus(input:unknown):{did:string;provider:string;version:string} {
  const r=input as Record<string,unknown>|null;
  if(!r||Object.keys(r).some(k=>!["ok","signer_available","did","provider","version"].includes(k))||r.ok!==true||r.signer_available!==true||typeof r.did!=="string"||! /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{45}$/.test(r.did)||r.provider!=="windows_dpapi_current_user"||r.version!=="1")throw new Error("CANONICAL_SIGNER_STATUS_INVALID");
  return {did:r.did,provider:r.provider,version:r.version};
}
/** Read-only integration with the existing DPAPI/SID-authenticated pipe client; no private key crosses this boundary. */
export class CanonicalFlopBuyerSigner extends UnavailableFlopBuyerSigner {
  private readonly directory:string;
  constructor(directory:string,private readonly pythonExecutable="python.exe"){
    super();this.directory=resolve(directory);
    if(!existsSync(join(this.directory,"signer_service.py")))throw new Error("CANONICAL_SIGNER_CLIENT_NOT_FOUND");
  }
  async status(signal:AbortSignal=new AbortController().signal):Promise<{did:string;provider:string;version:string}>{
    if(signal.aborted)throw new Error("CANONICAL_SIGNER_STATUS_ABORTED");
    return new Promise((accept,reject)=>{
      const code=["import sys,json", "sys.path.insert(0,sys.argv[1])", "import signer_service,secure_signer",
        "secret=secure_signer.load_protected(secure_signer.IPC_AUTH_PATH)", "try:",
        "    if len(secret)!=32: raise RuntimeError('IPC_AUTH_INVALID')",
        "    print(json.dumps(signer_service.request({'operation':'status'},authkey=bytes(secret))))",
        "finally:", "    secret[:]=bytes(len(secret))"].join("\n");
      const child=spawn(this.pythonExecutable,["-c",code,this.directory],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
      let output="",finished=false;
      const done=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener("abort",abort);if(error){child.kill();reject(error);}else{try{accept(validateCanonicalSignerStatus(JSON.parse(output)));}catch{reject(new Error("CANONICAL_SIGNER_STATUS_INVALID"));}}};
      const abort=()=>done(new Error("CANONICAL_SIGNER_STATUS_ABORTED"));
      const timer=setTimeout(()=>done(new Error("CANONICAL_SIGNER_STATUS_TIMEOUT")),3000);
      signal.addEventListener("abort",abort,{once:true});
      child.stdout.on("data",data=>{output+=data.toString("utf8");if(Buffer.byteLength(output)>8192)done(new Error("CANONICAL_SIGNER_STATUS_TOO_LARGE"));});
      child.stderr.on("data",()=>{}); // Do not log native errors or sensitive custody diagnostics.
      child.on("error",()=>done(new Error("CANONICAL_SIGNER_CLIENT_UNAVAILABLE")));
      child.on("close",status=>done(status===0?undefined:new Error("CANONICAL_SIGNER_UNAVAILABLE")));
    });
  }
}
