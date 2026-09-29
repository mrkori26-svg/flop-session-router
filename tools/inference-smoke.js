import { InferenceGateway, OpenAICompatibleWorker } from "../dist/src/inference-gateway.js";
const key = process.env.FLOP_CLOUD_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GEMINI_API_KEY;
if (!key) throw new Error("FLOP_CLOUD_API_KEY_REQUIRED");
const model = process.env.FLOP_INFERENCE_MODEL ?? process.env.FLOP_INFERENCE_MODELS?.split(",")[0]?.trim();
if (!model) throw new Error("FLOP_INFERENCE_MODEL_REQUIRED");
const worker = new OpenAICompatibleWorker({
  id: process.env.FLOP_CLOUD_WORKER_ID ?? "cloud-openai-compatible",
  baseUrl: process.env.FLOP_CLOUD_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: key,
  models: [model],
  timeoutMs: Number(process.env.FLOP_CLOUD_TIMEOUT_MS ?? 90000)
});
const gateway = new InferenceGateway([worker]);
const result = await gateway.generate({
  model,
  messages: [{ role: "user", content: "Reply with exactly: gateway-ok" }],
  temperature: 0,
  maxTokens: 32
});
console.log(JSON.stringify({ workerId: result.workerId, model, text: result.text.trim(), latencyMs: Math.round(result.latencyMs), metrics: gateway.metrics() }, null, 2));