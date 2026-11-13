import { FlopClient } from "@flop-labs/client";
import { FLOP_NETWORK_PROFILES, SUPPORTED_SPEC_VERSIONS } from "@flop-labs/sdk";

/** Authoritative published SDK versions, not a guessed interval or local eligibility rule. */
export function checkOfficialRuntimeVersion(specVersion: unknown) {
  const qualified = [...SUPPORTED_SPEC_VERSIONS];
  return { compatible: typeof specVersion === "number" && Number.isInteger(specVersion) && qualified.includes(specVersion),
    qualifiedSpecVersions: qualified, source: "@flop-labs/sdk@0.4.0" };
}

export interface FlopPublicCatalogOptions {
  fetch?: typeof globalThis.fetch;
  baseURL?: string;
}

/**
 * Read-only public gateway discovery. Gateway model offers and prices are
 * observations, NOT authenticated miner offers or economic authorizations.
 * Never returns MinerCandidate or enables FlopRuntimeAdapter buyerTransport.
 */
export class FlopPublicCatalog {
  private readonly client: FlopClient;
  constructor(options: FlopPublicCatalogOptions = {}) {
    this.client = new FlopClient(options);
  }
  async list(signal?: AbortSignal) {
    const result = await this.client.listModels({ signal });
    return {
      source: "@flop-labs/client@0.2.1",
      verified: "GATEWAY_CONTRACT_ONLY" as const,
      economicEligibility: "UNVERIFIED" as const,
      models: result.data.map(model => {
        const extension = (model["x-flop"] ?? {}) as Record<string, unknown>;
        return {
          id: model.id,
          name: model.name,
          modelHash: typeof extension.model_hash === "string" ? extension.model_hash : undefined,
          nominalPriceSourceCount: Array.isArray(extension.price_sources) ? extension.price_sources.length : 0,
        };
      }),
      totalCount: result.total_count,
    };
  }
  async getModel(modelId: string, signal?: AbortSignal) {
    const detail = await this.client.getModel(modelId, { signal });
    return { source: "@flop-labs/client@0.2.1", verified: "GATEWAY_CONTRACT_ONLY" as const,
      economicEligibility: "UNVERIFIED" as const, detail: detail.data };
  }
}

/** Public-testnet remains planned in the official package; no silent devnet fallback. */
export function officialNetworkReadiness(network: "devnet" | "testnet") {
  const profile = FLOP_NETWORK_PROFILES[network];
  return { network, status: profile.status, rpc: profile.rpc, gateway: profile.gateway,
    economicOperationsEnabled: false, sdkQualifiedRuntimeSpecVersions: [...SUPPORTED_SPEC_VERSIONS] };
}
