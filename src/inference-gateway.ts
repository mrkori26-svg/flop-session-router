import { ExecutionOutcomeUnknownError } from "./execution-outcome.js";
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface InferenceRequest { model: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; }
export interface InferenceChunk { text: string; done: boolean; }
export interface WorkerHealth { ok: boolean; latencyMs: number; checkedAt: string; reason?: string; }
export interface WorkerMetrics { requests: number; failures: number; active: number; ttftMsEwma?: number; latencyMsEwma?: number; tokensPerSecondEwma?: number; }
export interface InferenceWorker {
  id: string;
  models: string[];
  health(): Promise<WorkerHealth>;
  stream(request: InferenceRequest): AsyncIterable<InferenceChunk>;
}

export interface GatewayResult {
  workerId: string;
  text: string;
  ttftMs: number;
  latencyMs: number;
  outputTokensEstimate: number;
  tokensPerSecond: number;
}

const ewma = (prev: number | undefined, next: number, alpha = 0.25) => prev === undefined ? next : prev * (1 - alpha) + next * alpha;
const tokenEstimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));
export class InferenceGateway {
  private readonly metricsByWorker = new Map<string, WorkerMetrics>();
  constructor(private readonly workers: InferenceWorker[]) {
    for (const worker of workers) this.metricsByWorker.set(worker.id, { requests: 0, failures: 0, active: 0 });
  }

  metrics(): Record<string, WorkerMetrics> {
    return Object.fromEntries([...this.metricsByWorker.entries()].map(([id, value]) => [id, { ...value }]));
  }

  private rank(model: string): InferenceWorker[] {
    return this.workers.filter((worker) => worker.models.includes(model)).sort((a, b) => {
      const am = this.metricsByWorker.get(a.id)!;
      const bm = this.metricsByWorker.get(b.id)!;
      const as = am.active * 1000 + (am.ttftMsEwma ?? 250) + am.failures * 100;
      const bs = bm.active * 1000 + (bm.ttftMsEwma ?? 250) + bm.failures * 100;
      return as - bs || a.id.localeCompare(b.id);
    });
  }

  async generate(request: InferenceRequest): Promise<GatewayResult> {
    const ranked = this.rank(request.model);
    if (ranked.length === 0) throw new Error(`NO_INFERENCE_WORKER_FOR_MODEL:${request.model}`);
    let lastError: unknown;
    for (const worker of ranked) {
      const metrics = this.metricsByWorker.get(worker.id)!;
      const health = await worker.health().catch((error: unknown) => ({ ok: false, latencyMs: 0, checkedAt: new Date().toISOString(), reason: String(error) }));
      if (!health.ok) { metrics.failures += 1; lastError = new Error(health.reason ?? "WORKER_UNHEALTHY"); continue; }
      metrics.requests += 1; metrics.active += 1;
      const started = performance.now();
      let firstAt: number | undefined;
      let text = "";
      let completed = false;
      try {
        for await (const chunk of worker.stream(request)) {
          if (typeof chunk.text !== "string" || typeof chunk.done !== "boolean" || completed) throw new Error("INVALID_INFERENCE_CHUNK");
          completed = chunk.done;
          if (chunk.text && firstAt === undefined) firstAt = performance.now();
          text += chunk.text;
        }
        if (!completed) throw new Error("INFERENCE_STREAM_INCOMPLETE");
        const ended = performance.now();
        const ttftMs = (firstAt ?? ended) - started;
        const latencyMs = ended - started;
        const outputTokensEstimate = tokenEstimate(text);
        const decodeMs = ended - (firstAt ?? started);
        const tokensPerSecond = outputTokensEstimate / Math.max(decodeMs / 1000, 0.001);
        metrics.ttftMsEwma = ewma(metrics.ttftMsEwma, ttftMs);
        metrics.latencyMsEwma = ewma(metrics.latencyMsEwma, latencyMs);
        metrics.tokensPerSecondEwma = ewma(metrics.tokensPerSecondEwma, tokensPerSecond);
        return { workerId: worker.id, text, ttftMs, latencyMs, outputTokensEstimate, tokensPerSecond };
      } catch (error) {
        metrics.failures += 1;
        // Once inference is submitted, a transport failure cannot prove non-execution.
        throw new ExecutionOutcomeUnknownError("INFERENCE_EXECUTION_OUTCOME_UNKNOWN", { cause: error });
      }
      finally { metrics.active -= 1; }
    }
    throw new Error(`ALL_INFERENCE_WORKERS_FAILED:${String(lastError)}`);
  }
}
export interface OpenAICompatibleWorkerOptions {
  id: string;
  baseUrl: string;
  models: string[];
  apiKey?: string;
  timeoutMs?: number;
}

export class OpenAICompatibleWorker implements InferenceWorker {
  readonly id: string;
  readonly models: string[];
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  constructor(options: OpenAICompatibleWorkerOptions) {
    this.id = options.id;
    this.models = options.models;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) };
  }
  async health(): Promise<WorkerHealth> {
    const started = performance.now();
    try {
      const suffix = this.baseUrl.endsWith("/v1") || this.baseUrl.endsWith("/openai") ? "" : "/v1";
      const response = await fetch(`${this.baseUrl}${suffix}/models`, { headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) });
      return { ok: response.ok, latencyMs: performance.now() - started, checkedAt: new Date().toISOString(), reason: response.ok ? undefined : `HTTP_${response.status}` };
    } catch (error) {
      return { ok: false, latencyMs: performance.now() - started, checkedAt: new Date().toISOString(), reason: String(error) };
    }
  }

  async *stream(request: InferenceRequest): AsyncIterable<InferenceChunk> {
    const suffix = this.baseUrl.endsWith("/v1") || this.baseUrl.endsWith("/openai") ? "" : "/v1";
    const response = await fetch(`${this.baseUrl}${suffix}/chat/completions`, {
      method: "POST", headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ model: request.model, messages: request.messages, temperature: request.temperature, max_tokens: request.maxTokens, stream: true })
    });
    if (!response.ok || !response.body) throw new Error(`INFERENCE_HTTP_${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw new Error("INFERENCE_STREAM_INCOMPLETE");
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 1024 * 1024) throw new Error("INFERENCE_EVENT_TOO_LARGE");
        let boundary = /\r?\n\r?\n/.exec(buffer);
        while (boundary) {
          const event = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const payload = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
            .map(line => line.slice(5).trimStart()).join("\n");
          if (payload === "[DONE]") { yield { text: "", done: true }; return; }
          if (payload) {
            const json = JSON.parse(payload);
            if (!json || typeof json !== "object" || json.error || !Array.isArray(json.choices)) throw new Error("INVALID_INFERENCE_EVENT");
            const content = json.choices[0]?.delta?.content;
            if (content !== undefined && content !== null && typeof content !== "string") throw new Error("INVALID_INFERENCE_CONTENT");
            if (content) yield { text: content, done: false };
          }
          boundary = /\r?\n\r?\n/.exec(buffer);
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}

export interface OllamaWorkerOptions {
  id: string;
  baseUrl?: string;
  models: string[];
  timeoutMs?: number;
  keepAlive?: string | number;
}

export class OllamaWorker implements InferenceWorker {
  readonly id: string;
  readonly models: string[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly keepAlive: string | number;
  constructor(options: OllamaWorkerOptions) {
    this.id = options.id;
    this.models = options.models;
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.keepAlive = options.keepAlive ?? "2m";
  }

  async health(): Promise<WorkerHealth> {
    const started = performance.now();
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(this.timeoutMs) });
      return { ok: response.ok, latencyMs: performance.now() - started, checkedAt: new Date().toISOString(), reason: response.ok ? undefined : `HTTP_${response.status}` };
    } catch (error) {
      return { ok: false, latencyMs: performance.now() - started, checkedAt: new Date().toISOString(), reason: String(error) };
    }
  }
  async *stream(request: InferenceRequest): AsyncIterable<InferenceChunk> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ model: request.model, messages: request.messages, keep_alive: this.keepAlive, options: { temperature: request.temperature, num_predict: request.maxTokens }, stream: true })
    });
    if (!response.ok || !response.body) throw new Error(`OLLAMA_HTTP_${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const text = json.message?.content ?? "";
          if (text) yield { text, done: false };
          if (json.done) yield { text: "", done: true };
        }
        newline = buffer.indexOf("\n");
      }
    }
  }
}
