import type { DatabaseSync } from "node:sqlite";
import { buyerAmount } from "./flop-buyer-config.js";
import { sha256 } from "./canonical.js";
import type { BuyerJob, BuyerState } from "./flop-buyer-contract.js";

const edges:Record<BuyerState,BuyerState[]>={
  QUEUED:["PREPARING","BLOCKED","REJECTED"],BLOCKED:["PREPARING","BLOCKED","REJECTED"],
  PREPARING:["PREPARING","RESERVED","QUEUED","BLOCKED","REJECTED"],RESERVED:["SIGNING","QUEUED","REJECTED"],
  SIGNING:["SIGNED","QUEUED","REJECTED"],SIGNED:["SUBMITTING","QUEUED","REJECTED"],
  SUBMITTING:["PENDING","EXECUTING","VERIFYING","OUTCOME_UNKNOWN"],PENDING:["PENDING","EXECUTING","VERIFYING","OUTCOME_UNKNOWN"],
  EXECUTING:["EXECUTING","PENDING","VERIFYING","OUTCOME_UNKNOWN"],VERIFYING:["VERIFYING","PENDING","EXECUTING","SETTLED","REJECTED","OUTCOME_UNKNOWN"],
  OUTCOME_UNKNOWN:["OUTCOME_UNKNOWN","PENDING","EXECUTING","VERIFYING"],SETTLED:["SETTLED","FINALITY_LOST"],REJECTED:[],FINALITY_LOST:[]};
type Account={scope:string;reserved:string;spent:string;next_channel_nonce:string;lane:string|null;frozen:number;failures:number;open_until:number};
export class FlopBuyerStore {
  constructor(private readonly db:DatabaseSync,private readonly clock=()=>new Date()) {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS buyer_jobs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS buyer_accounts(scope TEXT PRIMARY KEY,reserved TEXT NOT NULL,spent TEXT NOT NULL,next_channel_nonce TEXT NOT NULL,lane TEXT,frozen INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,open_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS buyer_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,body TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS buyer_jobs_scope_state ON buyer_jobs(scope,state);`);
  }
  private transaction<T>(fn:()=>T):T {this.db.exec("BEGIN IMMEDIATE");try{const v=fn();this.db.exec("COMMIT");return v;}catch(e){this.db.exec("ROLLBACK");throw e;}}
  ensureScope(scope:string){this.db.prepare("INSERT OR IGNORE INTO buyer_accounts(scope,reserved,spent,next_channel_nonce) VALUES(?,?,?,?)").run(scope,"0","0","0");}
  private event(job:BuyerJob,reason:string) {
    const previous=this.db.prepare("SELECT digest FROM buyer_events ORDER BY seq DESC LIMIT 1").get() as {digest:string}|undefined;
    const body={jobId:job.id,scope:job.scope,state:job.state,version:job.version,requestHash:job.requestHash,jobDigest:sha256(job),reason,at:this.clock().toISOString(),reservedBaseUnits:job.reservedBaseUnits,chargedBaseUnits:job.chargedBaseUnits,channelNonce:job.binding?.channelNonce??null,accountNonce:job.binding?.accountNonce??null,previous:previous?.digest??null};
    this.db.prepare("INSERT INTO buyer_events(body,digest) VALUES(?,?)").run(JSON.stringify(body),sha256(body));
  }
  private decode(row:{body:string;body_hash:string}):BuyerJob {const body=JSON.parse(row.body) as BuyerJob;if(sha256(body)!==row.body_hash)throw new Error("BUYER_LOCAL_INTEGRITY_FAILED");return body;}
  job(id:string):BuyerJob|undefined {const row=this.db.prepare("SELECT body,body_hash FROM buyer_jobs WHERE id=?").get(id) as {body:string;body_hash:string}|undefined;return row?this.decode(row):undefined;}
  jobs(scope:string):BuyerJob[]{return(this.db.prepare("SELECT body,body_hash FROM buyer_jobs WHERE scope=? ORDER BY rowid").all(scope) as {body:string;body_hash:string}[]).map(row=>this.decode(row));}
  enqueue(job:BuyerJob):BuyerJob{return this.transaction(()=>{
    const old=this.job(job.id);if(old){if(old.requestHash!==job.requestHash)throw new Error("IDEMPOTENCY_CONFLICT");return old;}
    this.db.prepare("INSERT INTO buyer_jobs(id,scope,state,version,body,body_hash) VALUES(?,?,?,?,?,?)").run(job.id,job.scope,job.state,job.version,JSON.stringify(job),sha256(job));
    this.db.prepare("INSERT OR IGNORE INTO buyer_accounts(scope,reserved,spent,next_channel_nonce) VALUES(?,?,?,?)").run(job.scope,"0","0","0");
    this.event(job,"ENQUEUED");return job;
  });}
  claim(id:string,owner:string,leaseMs:number):BuyerJob|undefined {
    const now=this.clock().getTime();const r=this.db.prepare("UPDATE buyer_jobs SET owner=?,lease_until=? WHERE id=? AND (owner IS NULL OR lease_until<=?)").run(owner,now+leaseMs,id,now);
    return r.changes?this.job(id):undefined;
  }
  private owned(id:string,owner:string):BuyerJob {
    const row=this.db.prepare("SELECT body,body_hash,owner,lease_until FROM buyer_jobs WHERE id=?").get(id) as {body:string;body_hash:string;owner:string;lease_until:number}|undefined;
    if(!row||row.owner!==owner||row.lease_until<=this.clock().getTime())throw new Error("BUYER_LEASE_LOST");return this.decode(row);
  }
  releaseClaim(id:string,owner:string){this.db.prepare("UPDATE buyer_jobs SET owner=NULL,lease_until=0 WHERE id=? AND owner=?").run(id,owner);}
  private write(job:BuyerJob,owner:string,next:BuyerState,patch:Partial<BuyerJob>,reason:string):BuyerJob {
    if(!edges[job.state].includes(next))throw new Error(`INVALID_BUYER_TRANSITION:${job.state}:${next}`);
    const updated={...job,...patch,id:job.id,scope:job.scope,requestHash:job.requestHash,request:job.request,state:next,reason,version:job.version+1,updatedAt:this.clock().toISOString()};
    const r=this.db.prepare("UPDATE buyer_jobs SET state=?,version=?,body=?,body_hash=? WHERE id=? AND version=? AND owner=?").run(next,updated.version,JSON.stringify(updated),sha256(updated),job.id,job.version,owner);
    if(!r.changes)throw new Error("BUYER_LEASE_LOST");this.event(updated,reason);return updated;
  }
  transition(id:string,owner:string,next:BuyerState,patch:Partial<BuyerJob>={},reason:string=next):BuyerJob{return this.transaction(()=>this.write(this.owned(id,owner),owner,next,patch,reason));}
  account(scope:string):Account {const a=this.db.prepare("SELECT * FROM buyer_accounts WHERE scope=?").get(scope) as Account|undefined;if(!a)throw new Error("BUYER_ACCOUNT_MISSING");return a;}
  acquirePlanningLane(id:string,owner:string):boolean{return this.transaction(()=>{
    const job=this.owned(id,owner),a=this.account(job.scope);this.assertLedger(job.scope);
    if(job.state!=="PREPARING")throw new Error("INVALID_PLANNING_LANE_STATE");
    if(a.frozen)throw new Error("BUYER_ACCOUNT_FROZEN");if(a.lane&&a.lane!==id)return false;
    this.db.prepare("UPDATE buyer_accounts SET lane=? WHERE scope=?").run(id,job.scope);this.event(job,"ACCOUNT_PLANNING_LANE_ACQUIRED");return true;
  });}
  reserve(id:string,owner:string,amount:string,budget:string,externalChannelNonce:string):BuyerJob|undefined{return this.transaction(()=>{
    buyerAmount(amount,"RESERVATION",true);buyerAmount(budget,"CUMULATIVE_BUDGET",true);buyerAmount(externalChannelNonce,"CHANNEL_NONCE");
    const job=this.owned(id,owner),a=this.account(job.scope);
    this.assertLedger(job.scope);
    if(a.frozen)throw new Error("BUYER_ACCOUNT_FROZEN");if(a.lane&&a.lane!==id)return undefined;
    if(BigInt(a.reserved)+BigInt(a.spent)+BigInt(amount)>BigInt(budget))throw new Error("BUYER_BUDGET_EXCEEDED");
    const nonce=BigInt(a.next_channel_nonce)>BigInt(externalChannelNonce)?BigInt(a.next_channel_nonce):BigInt(externalChannelNonce);
    if(nonce>=(1n<<64n))throw new Error("CHANNEL_NONCE_EXHAUSTED");
    if(!job.binding)throw new Error("BUYER_BINDING_MISSING");
    this.db.prepare("UPDATE buyer_accounts SET reserved=?,next_channel_nonce=?,lane=? WHERE scope=?").run((BigInt(a.reserved)+BigInt(amount)).toString(),(nonce+1n).toString(),id,job.scope);
    return this.write(job,owner,"RESERVED",{reservedBaseUnits:amount,binding:{...job.binding,channelNonce:nonce.toString(),openChannel:{...job.binding.openChannel,nonce:nonce.toString()}}},"BUDGET_AND_NONCE_RESERVED");
  });}
  releaseBeforeSubmission(id:string,owner:string,next:"QUEUED"|"REJECTED",reason:string):BuyerJob{return this.transaction(()=>{
    const job=this.owned(id,owner);if(!["PREPARING","RESERVED","SIGNING","SIGNED"].includes(job.state))throw new Error("UNSAFE_RESERVATION_RELEASE");
    const a=this.account(job.scope);this.assertLedger(job.scope);
    if(BigInt(job.reservedBaseUnits)>0n&&a.lane!==id)throw new Error("BUYER_LANE_MISMATCH");
    this.db.prepare("UPDATE buyer_accounts SET reserved=?,lane=CASE WHEN lane=? THEN NULL ELSE lane END WHERE scope=?").run((BigInt(a.reserved)-BigInt(job.reservedBaseUnits)).toString(),id,job.scope);
    return this.write(job,owner,next,{reservedBaseUnits:"0",binding:undefined,context:undefined,quote:undefined,unsigned:undefined,signed:undefined},reason);
  });}
  finish(id:string,owner:string,observation:NonNullable<BuyerJob["observation"]>,charge:string,next:"SETTLED"|"REJECTED"):BuyerJob{return this.transaction(()=>{
    const job=this.owned(id,owner),a=this.account(job.scope);this.assertLedger(job.scope);
    if(job.state!=="VERIFYING"||a.lane!==id||BigInt(charge)>BigInt(job.reservedBaseUnits)||BigInt(charge)<0n)throw new Error("BUYER_SETTLEMENT_ACCOUNTING_MISMATCH");
    this.db.prepare("UPDATE buyer_accounts SET reserved=?,spent=?,lane=NULL,failures=0,open_until=0 WHERE scope=?").run((BigInt(a.reserved)-BigInt(job.reservedBaseUnits)).toString(),(BigInt(a.spent)+BigInt(charge)).toString(),job.scope);
    return this.write(job,owner,next,{observation,reservedBaseUnits:"0",chargedBaseUnits:charge},"EXTERNAL_TERMINAL_EVIDENCE_VERIFIED");
  });}
  freeze(scope:string){this.db.prepare("UPDATE buyer_accounts SET frozen=1 WHERE scope=?").run(scope);}
  networkFailure(scope:string,threshold:number,cooldownMs:number){const a=this.account(scope);this.db.prepare("UPDATE buyer_accounts SET failures=?,open_until=? WHERE scope=?").run(a.failures+1,a.failures+1>=threshold?this.clock().getTime()+cooldownMs:0,scope);}
  private assertLedger(scope:string){const jobs=this.jobs(scope),a=this.account(scope);const reserved=jobs.reduce((s,j)=>s+BigInt(j.reservedBaseUnits),0n),spent=jobs.reduce((s,j)=>s+BigInt(j.chargedBaseUnits),0n),held=jobs.filter(j=>BigInt(j.reservedBaseUnits)>0n);if(reserved!==BigInt(a.reserved)||spent!==BigInt(a.spent)||held.length>1||(held.length===1?a.lane!==held[0]!.id:!!a.lane&&!jobs.some(j=>j.id===a.lane&&j.state==="PREPARING"&&j.reservedBaseUnits==="0")))throw new Error("BUYER_LEDGER_DISCREPANCY");}
  audit(scope:string){
    this.assertLedger(scope);const rows=this.db.prepare("SELECT body,digest FROM buyer_events ORDER BY seq").all() as {body:string;digest:string}[];let previous:string|null=null;
    const latest=new Map<string,string>();let next=0n;for(const row of rows){const body=JSON.parse(row.body);if(body.previous!==previous||sha256(body)!==row.digest)throw new Error("BUYER_AUDIT_CHAIN_INVALID");previous=row.digest;if(body.scope===scope)latest.set(body.jobId,body.jobDigest);if(body.scope===scope&&body.reason==="BUDGET_AND_NONCE_RESERVED")next=BigInt(body.channelNonce)+1n;}
    for(const job of this.jobs(scope))if(latest.get(job.id)!==sha256(job))throw new Error("BUYER_JOB_AUDIT_MISMATCH");
    const a=this.account(scope);if(BigInt(a.next_channel_nonce)!==next)throw new Error("BUYER_NONCE_LEDGER_DISCREPANCY");return {scope,reservedBaseUnits:a.reserved,spentBaseUnits:a.spent,frozen:!!a.frozen,inFlightJobId:a.lane,auditHead:previous,eventCount:rows.length};
  }
}
