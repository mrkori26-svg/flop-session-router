import { checkOfficialRuntimeVersion, officialNetworkReadiness } from "./official-flop-discovery.js";

/** Offline readiness only. No calls, signatures, transfers or enrollment. */
export interface OfficialTestnetPins {
  environment: "testnet" | "devnet";
  genesisHash?: string;
  runtimeSpecVersion?: number;
  verifiedOfficialRelease?: boolean;
  verifiedOfficialGenesis?: boolean;
  verifiedOfficialDidWalletContract?: boolean;
  verifiedOfficialSignedRequestContract?: boolean;
  verifiedOfficialSettlementContract?: boolean;
  verifiedOfficialFaucetContract?: boolean;
}
export function evaluateOfficialAgentReadiness(p: OfficialTestnetPins) {
  const blockers: string[] = [];
  const network = officialNetworkReadiness(p.environment);
  if (network.status !== "live") blockers.push("NETWORK_NOT_LIVE");
  if (p.verifiedOfficialRelease !== true) blockers.push("OFFICIAL_RELEASE_UNVERIFIED");
  if (p.verifiedOfficialGenesis !== true || !/^0x[0-9a-fA-F]{64}$/.test(p.genesisHash ?? "")) blockers.push("GENESIS_IDENTITY_UNVERIFIED");
  if (!checkOfficialRuntimeVersion(p.runtimeSpecVersion).compatible) blockers.push("SDK_RUNTIME_INCOMPATIBLE");
  if (p.verifiedOfficialDidWalletContract !== true) blockers.push("DID_WALLET_CONTRACT_UNVERIFIED");
  if (p.verifiedOfficialSignedRequestContract !== true) blockers.push("SIGNED_HTTP_REQUEST_CONTRACT_UNVERIFIED");
  if (p.verifiedOfficialFaucetContract !== true) blockers.push("FAUCET_CONTRACT_UNVERIFIED");
  if (p.verifiedOfficialSettlementContract !== true) blockers.push("SETTLEMENT_CONTRACT_UNVERIFIED");
  return {
    status: blockers.length ? "BLOCKED_BY_UPSTREAM" as const : "SPECIFICATION_PREFLIGHT_READY" as const,
    blockers,
    economicExecutionAllowed: false as const,
    signerOperationEnabled: false as const,
    faucetClaimEnabled: false as const,
    claimBoundary: "READ_ONLY_OFFLINE_PREFLIGHT_NOT_LIVE_OPERATION" as const
  };
}
