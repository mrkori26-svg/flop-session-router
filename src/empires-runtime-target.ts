import type { RuntimeTarget, RuntimeTargetExecution, RuntimeTestCase } from "./runtime-interop.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface EmpiresActionInput {
  capability: string;
  requestId: string;
  signedEnvelope?: Record<string, unknown>;
  simulation?: boolean;
}
export type EmpiresExecutor = (
  input: EmpiresActionInput,
  signal?: AbortSignal,
) => Promise<RuntimeTargetExecution>;

export class EmpiresRuntimeTarget implements RuntimeTarget<EmpiresActionInput> {
  readonly id = "flop-empires-season0";
  constructor(
    private readonly baseUrl: string,
    private readonly executor: EmpiresExecutor,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private async get(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(new URL(path, this.baseUrl).toString(), {
      method: "GET", redirect: "error",
    });
    if (!response.ok) throw new Error(`EMPIRES_HTTP_${response.status}`);
    const value = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("EMPIRES_INVALID_JSON");
    }
    return value as Record<string, unknown>;
  }

  async discover(): Promise<boolean> {
    try {
      const caps = await this.get("/api/interop/capabilities");
      return caps.schema === "flop.runtime-capabilities.v1"
        && caps.runtime_id === this.id;
    } catch {
      return false;
    }
  }

  async fingerprint(): Promise<Record<string, string | number | boolean | null>> {
    const value = await this.get("/api/interop/fingerprint");
    if (value.schema !== "flop.runtime-fingerprint.v1" || value.runtime_id !== this.id) {
      throw new Error("EMPIRES_FINGERPRINT_SCHEMA_MISMATCH");
    }
    const fp = value.fingerprint;
    if (fp === null || typeof fp !== "object" || Array.isArray(fp)) {
      throw new Error("EMPIRES_FINGERPRINT_INVALID");
    }
    return fp as Record<string, string | number | boolean | null>;
  }
  async capabilities(): Promise<string[]> {
    const value = await this.get("/api/interop/capabilities");
    if (!Array.isArray(value.capabilities)) throw new Error("EMPIRES_CAPABILITIES_INVALID");
    return value.capabilities.flatMap((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) return [];
      const item = row as Record<string, unknown>;
      if (typeof item.id !== "string") return [];
      if (item.status !== "available" && item.status !== "simulation_only") return [];
      return [item.id];
    }).sort();
  }

  async execute(
    testCase: RuntimeTestCase<EmpiresActionInput>,
    signal?: AbortSignal,
  ): Promise<RuntimeTargetExecution> {
    const capabilities = await this.capabilities();
    if (!capabilities.includes(testCase.input.capability)) {
      throw new Error("EMPIRES_CAPABILITY_UNAVAILABLE");
    }
    return this.executor(testCase.input, signal);
  }
}


export function createEmpiresHttpExecutor(
  baseUrl: string,
  sessionCookie: () => string,
  fetcher: FetchLike = fetch,
  pollAttempts = 20,
  pollDelayMs = 250,
): EmpiresExecutor {
  if (!Number.isInteger(pollAttempts) || pollAttempts < 1 || pollAttempts > 100) {
    throw new Error("EMPIRES_INVALID_POLL_ATTEMPTS");
  }
  return async (input, signal) => {
    const startedAt = new Date().toISOString();
    if (!input.signedEnvelope) {
      return {
        startedAt, finishedAt: new Date().toISOString(), status: "failed",
        output: { requestId: input.requestId }, reason: "EMPIRES_SIGNED_ENVELOPE_REQUIRED",
      };
    }
    const cookie = sessionCookie();
    if (!cookie) throw new Error("EMPIRES_SESSION_REQUIRED");
    const actionResponse = await fetcher(new URL("/api/action", baseUrl).toString(), {
      method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", "cookie": cookie },
      body: JSON.stringify(input.signedEnvelope),
    });
    const actionBody = await actionResponse.json().catch(() => ({}));
    if (!actionResponse.ok) {
      return {
        startedAt, finishedAt: new Date().toISOString(), status: "failed",
        output: { action: actionBody }, reason: `EMPIRES_ACTION_HTTP_${actionResponse.status}`,
      };
    }
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      if (attempt > 0 && pollDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      }
      const receiptResponse = await fetcher(
        new URL(`/api/receipt/${encodeURIComponent(input.requestId)}`, baseUrl).toString(),
        { method: "GET", redirect: "error", signal, headers: { "cookie": cookie } },
      );
      const receiptBody = await receiptResponse.json().catch(() => ({}));
      if (receiptResponse.ok && receiptBody && typeof receiptBody === "object"
          && (receiptBody as Record<string, unknown>).receipt) {
        return {
          startedAt, finishedAt: new Date().toISOString(), status: "completed",
          output: receiptBody,
          evidenceRefs: [`empires-native-receipt:${input.requestId}`],
        };
      }
      if (receiptResponse.status !== 404) {
        return {
          startedAt, finishedAt: new Date().toISOString(), status: "failed",
          output: { receipt: receiptBody }, reason: `EMPIRES_RECEIPT_HTTP_${receiptResponse.status}`,
        };
      }
    }
    return {
      startedAt, finishedAt: new Date().toISOString(), status: "failed",
      output: { requestId: input.requestId }, reason: "EMPIRES_RECEIPT_NOT_OBSERVED",
    };
  };
}
