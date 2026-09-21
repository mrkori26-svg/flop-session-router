import type {
  AssuranceTier,
  EvidenceProvenance,
  MinerCandidate,
  ProtocolCapability,
  RouteRequest,
} from "./types.js";
import type { MinerCandidateProvider } from "./providers.js";

export interface CapabilityAnnouncement {
  schema: "flop.agent-capabilities.v1";
  id: string;
  did?: string;
  account?: string;
  runtime?: string;
  runtimeVersion?: string;
  available: boolean;
  observedAt?: string;
  capabilities: Array<{
    id: string;
    version: string;
    assurance?: AssuranceTier;
    provenance?: EvidenceProvenance;
  }>;
  provenance?: EvidenceProvenance;
}

export interface CapabilityDiscoverySource {
  load(request: RouteRequest): Promise<CapabilityAnnouncement[]>;
}

export interface CapabilityDiscoveryBinding {
  sourceId: string;
  candidate: MinerCandidate;
}

function validAnnouncement(value: CapabilityAnnouncement): boolean {
  if (value.schema !== "flop.agent-capabilities.v1") return false;
  if (!value.id || typeof value.available !== "boolean") return false;
  if (value.observedAt && !Number.isFinite(Date.parse(value.observedAt))) return false;
  if (!Array.isArray(value.capabilities)) return false;
  return value.capabilities.every((cap) =>
    Boolean(cap.id) &&
    Boolean(cap.version) &&
    (!cap.assurance || ["UNKNOWN","SOFT","HARD"].includes(cap.assurance)),
  );
}

export class CapabilityDiscoveryCandidateProvider implements MinerCandidateProvider {
  readonly name = "capability-discovery";
  private last: MinerCandidate[] = [];

  constructor(
    private readonly source: CapabilityDiscoverySource,
    private readonly bindings: CapabilityDiscoveryBinding[],
  ) {}

  async candidates(request: RouteRequest): Promise<MinerCandidate[]> {
    const announcements = await this.source.load(request);
    const byId = new Map(
      announcements
        .filter(validAnnouncement)
        .map((announcement) => [announcement.id, announcement]),
    );

    const out: MinerCandidate[] = [];
    for (const binding of this.bindings) {
      const announcement = byId.get(binding.sourceId);
      if (!announcement || !announcement.available) continue;

      const expectedDid = binding.candidate.identity.did;
      const expectedAccount = binding.candidate.identity.account;
      if (expectedDid && announcement.did && expectedDid !== announcement.did) continue;
      if (expectedAccount && announcement.account && expectedAccount !== announcement.account) continue;

      const protocolCapabilities: ProtocolCapability[] = announcement.capabilities.map((cap) => ({
        id: cap.id,
        version: cap.version,
        assurance: cap.assurance ?? "UNKNOWN",
        ...(announcement.observedAt ? { observedAt: announcement.observedAt } : {}),
        ...(cap.provenance ? { provenance: structuredClone(cap.provenance) } : {}),
      }));

      out.push({
        ...structuredClone(binding.candidate),
        protocolCapabilities,
        discovery: {
          sourceId: announcement.id,
          ...(announcement.runtime ? { runtime: announcement.runtime } : {}),
          ...(announcement.runtimeVersion ? { runtimeVersion: announcement.runtimeVersion } : {}),
          available: announcement.available,
          ...(announcement.observedAt ? { observedAt: announcement.observedAt } : {}),
          ...(announcement.provenance ? { provenance: structuredClone(announcement.provenance) } : {}),
        },
      });
    }
    this.last = structuredClone(out);
    return out;
  }

  async snapshot(): Promise<MinerCandidate[]> {
    return structuredClone(this.last);
  }
}
