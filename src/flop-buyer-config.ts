import type { BuyerConfig, BuyerRequest } from "./flop-buyer-contract.js";
export function buyerObject(v: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k=>!keys.includes(k))) throw new Error(`INVALID_${name}`);
  return v as Record<string, unknown>;
}
export function buyerAmount(v: unknown, name: string, positive=false): string {
  if(typeof v!=="string" || !/^(0|[1-9][0-9]{0,38})$/.test(v) || BigInt(v)>=(1n<<128n) || (positive && v==="0")) throw new Error(`INVALID_${name}`);
  return v;
}
export function buyerHex(v: unknown, name: string): string {
  if(typeof v!=="string" || !/^0x[0-9a-f]{64}$/.test(v))throw new Error(`INVALID_${name}`);return v;
}
function integer(v: unknown, fallback:number, max:number, name:string, min=1):number {
  const n=v??fallback;if(typeof n!=="number"||!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`INVALID_${name}`);return n;
}
export function loadBuyerConfig(input:unknown={}):BuyerConfig {
  const c=buyerObject(input,["enabled","environment","allowedEnvironments","genesisHash","agentAccount","executionAuthorizationId","maxTotalSpendBaseUnits","maxSessionEscrowBaseUnits","maxTransactionFeeBaseUnits","controlledMinerAccounts","maxConcurrent","maxLatencyMs","networkTimeoutMs","leaseMs","maxAttempts","circuitFailureThreshold","circuitCooldownMs"],"BUYER_CONFIG");
  if(c.enabled!==undefined&&typeof c.enabled!=="boolean")throw new Error("INVALID_BUYER_ENABLED");
  const enabled=c.enabled===true,environment=c.environment??"DEV";
  if(!["DEV","TESTNET","MAINNET"].includes(environment as string))throw new Error("INVALID_BUYER_ENVIRONMENT");
  const allowed=c.allowedEnvironments??["DEV"];
  if(!Array.isArray(allowed)||!allowed.length||allowed.some(x=>!["DEV","TESTNET","MAINNET"].includes(x)))throw new Error("INVALID_ALLOWED_ENVIRONMENTS");
  if(enabled&&environment==="MAINNET")throw new Error("MAINNET_SPENDING_PROHIBITED");
  if(enabled&&!allowed.includes(environment))throw new Error("ENVIRONMENT_NOT_AUTHORIZED");
  const hash=(key:string)=>c[key]===undefined?undefined:buyerHex(c[key],key.toUpperCase());
  const amount=(key:string)=>c[key]===undefined?undefined:buyerAmount(c[key],key.toUpperCase(),true);
  const controlled=c.controlledMinerAccounts??[];
  if(!Array.isArray(controlled)||controlled.length>1000)throw new Error("INVALID_CONTROLLED_MINERS");
  const auth=c.executionAuthorizationId;
  if(auth!==undefined&&(typeof auth!=="string"||! /^[A-Za-z0-9._:-]{1,128}$/.test(auth)))throw new Error("INVALID_EXECUTION_AUTHORIZATION");
  const config:BuyerConfig={enabled,environment:environment as BuyerConfig["environment"],allowedEnvironments:[...allowed],
    genesisHash:hash("genesisHash"),agentAccount:hash("agentAccount"),executionAuthorizationId:auth as string|undefined,
    maxTotalSpendBaseUnits:amount("maxTotalSpendBaseUnits"),maxSessionEscrowBaseUnits:amount("maxSessionEscrowBaseUnits"),maxTransactionFeeBaseUnits:amount("maxTransactionFeeBaseUnits"),
    controlledMinerAccounts:controlled.map(x=>buyerHex(x,"CONTROLLED_MINER")),maxConcurrent:integer(c.maxConcurrent,1,16,"CONCURRENCY"),
    maxLatencyMs:integer(c.maxLatencyMs,30000,3600000,"LATENCY"),networkTimeoutMs:integer(c.networkTimeoutMs,10000,60000,"NETWORK_TIMEOUT"),
    leaseMs:integer(c.leaseMs,120000,3600000,"LEASE"),maxAttempts:integer(c.maxAttempts,3,10,"ATTEMPTS"),
    circuitFailureThreshold:integer(c.circuitFailureThreshold,3,100,"CIRCUIT_THRESHOLD"),circuitCooldownMs:integer(c.circuitCooldownMs,60000,3600000,"CIRCUIT_COOLDOWN")};
  if(config.leaseMs<config.networkTimeoutMs*8)throw new Error("LEASE_TOO_SHORT");
  if(enabled&&(!config.genesisHash||!config.agentAccount||!config.executionAuthorizationId||!config.maxTotalSpendBaseUnits||!config.maxSessionEscrowBaseUnits||!config.maxTransactionFeeBaseUnits))throw new Error("BUYER_PINS_BUDGET_AND_AUTHORIZATION_REQUIRED");
  return structuredClone(config);
}
export function validateBuyerRequest(input:unknown):BuyerRequest {
  const r=buyerObject(input,["idempotencyKey","inference","constraints","maxCostBaseUnits"],"BUYER_REQUEST");
  if(typeof r.idempotencyKey!=="string"||! /^[A-Za-z0-9._:-]{1,128}$/.test(r.idempotencyKey))throw new Error("INVALID_IDEMPOTENCY_KEY");
  const i=buyerObject(r.inference,["model","messages","temperature","maxTokens"],"INFERENCE_OBJECTIVE");
  if(typeof i.model!=="string"||!i.model.length||i.model.length>256||!Array.isArray(i.messages)||!i.messages.length||i.messages.length>128)throw new Error("INVALID_INFERENCE_OBJECTIVE");
  let bytes=0;for(const value of i.messages){const m=buyerObject(value,["role","content"],"INFERENCE_MESSAGE");if(!["system","user","assistant"].includes(m.role as string)||typeof m.content!=="string")throw new Error("INVALID_INFERENCE_MESSAGE");bytes+=Buffer.byteLength(m.content);}
  if(bytes>1024*1024)throw new Error("INFERENCE_OBJECTIVE_TOO_LARGE");
  integer(i.maxTokens,0,1048576,"MAX_OUTPUT_TOKENS");
  if(i.temperature!==undefined&&(typeof i.temperature!=="number"||!Number.isFinite(i.temperature)||i.temperature<0||i.temperature>2))throw new Error("INVALID_TEMPERATURE");
  const c=buyerObject(r.constraints,["modelId","modelHash","precision","decodePolicy","minimumAssurance","maxLatencyMs","maximumPrice","capabilityMaxAgeMs","requiredProtocolCapabilities"],"BUYER_CONSTRAINTS");
  if(c.modelId!==i.model||typeof c.precision!=="string"||!c.precision.length||c.precision.length>64)throw new Error("INFERENCE_CONSTRAINT_MISMATCH");
  buyerHex(c.modelHash,"MODEL_HASH");integer(c.maxLatencyMs,30000,3600000,"REQUEST_LATENCY");
  if(c.minimumAssurance!==undefined&&!["SOFT","HARD"].includes(c.minimumAssurance as string))throw new Error("INVALID_ASSURANCE");
  if(c.decodePolicy!==undefined&&(typeof c.decodePolicy!=="string"||!c.decodePolicy.length||c.decodePolicy.length>128))throw new Error("INVALID_DECODE_POLICY");
  if(c.capabilityMaxAgeMs!==undefined)integer(c.capabilityMaxAgeMs,1,86400000,"CAPABILITY_AGE");
  if(c.maximumPrice!==undefined){const p=buyerObject(c.maximumPrice,["amount","asset","unit","comparisonProfile"],"PRICE_CONSTRAINT");buyerAmount(p.amount,"PRICE",true);for(const k of ["asset","unit","comparisonProfile"])if(typeof p[k]!=="string"||!(p[k] as string).length||(p[k] as string).length>256)throw new Error("INVALID_PRICE_PROFILE");}
  if(c.requiredProtocolCapabilities!==undefined){if(!Array.isArray(c.requiredProtocolCapabilities)||c.requiredProtocolCapabilities.length>64)throw new Error("INVALID_PROTOCOL_CAPABILITIES");for(const v of c.requiredProtocolCapabilities){const p=buyerObject(v,["id","version","minimumAssurance"],"PROTOCOL_CAPABILITY");if(typeof p.id!=="string"||!p.id.length||p.id.length>128|| (p.version!==undefined&&(typeof p.version!=="string"||p.version.length>128))||(p.minimumAssurance!==undefined&&!["UNKNOWN","SOFT","HARD"].includes(p.minimumAssurance as string)))throw new Error("INVALID_PROTOCOL_CAPABILITY");}}
  buyerAmount(r.maxCostBaseUnits,"REQUEST_COST",true);
  return structuredClone(r) as unknown as BuyerRequest;
}
