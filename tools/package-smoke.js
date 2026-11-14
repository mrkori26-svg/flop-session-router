import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root=fileURLToPath(new URL("..",import.meta.url));
const temp=mkdtempSync(join(tmpdir(),"flop-router-package-"));
const run=(command,args,cwd=temp)=>{const windowsNpm=process.platform==="win32"&&command==="npm",executable=windowsNpm?(process.env.ComSpec??"cmd.exe"):command,actualArgs=windowsNpm?["/d","/s","/c","npm",...args]:args;const r=spawnSync(executable,actualArgs,{cwd,encoding:"utf8",timeout:120_000});if(r.status!==0)throw new Error(`${command} ${args.join(" ")} failed: ${r.error?.message??r.stderr}`);return r.stdout;};
try{
 const packed=JSON.parse(run("npm",["pack",root,"--json","--pack-destination",temp],root));
 const tgz=join(temp,packed[0].filename);
 writeFileSync(join(temp,"package.json"),'{"private":true,"type":"module"}\n');
 run("npm",["install",tgz,"--ignore-scripts","--no-audit","--no-fund","--cache",join(temp,"fresh-npm-cache")]);
 const cli=join(temp,"node_modules","@flop-tools","session-router","dist","src","cli.js");
 JSON.parse(run(process.execPath,[cli,"--help"]));
 JSON.parse(run(process.execPath,[cli,"doctor","--db",join(temp,"doctor.db")]));
 const request=join(temp,"request.json"),candidates=join(temp,"candidates.json");
 writeFileSync(request,JSON.stringify({requestId:"smoke",constraints:{modelId:"demo"}}));
 writeFileSync(candidates,JSON.stringify([{id:"winner",identity:{},enabled:true,capabilities:[{modelId:"demo",assurance:"SOFT"}]}]));
 const decision=JSON.parse(run(process.execPath,[cli,"route","--request",request,"--candidates",candidates,"--db",join(temp,"route.db")]));
 if(decision.selectedMinerId!=="winner")throw new Error("package route smoke did not select fixture winner");
 process.stdout.write("package smoke passed (fresh npm cache)\n");
}finally{rmSync(temp,{recursive:true,force:true});}