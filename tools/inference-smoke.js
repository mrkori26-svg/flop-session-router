import { InferenceGateway, OllamaWorker } from "../dist/src/inference-gateway.js";
const worker = new OllamaWorker({
  id: "ollama-local",
  models: ["gemma4:12b"],
  timeoutMs: 120000
});
const gateway = new InferenceGateway([worker]);
const result = await gateway.generate({
  model: "gemma4:12b",
  messages: [{ role: "user", content: "Reply with exactly: gateway-ok" }],
  temperature: 0
});
console.log(JSON.stringify({
  workerId: result.workerId,
  text: result.text.trim(),
  ttftMs: Math.round(result.ttftMs),
  latencyMs: Math.round(result.latencyMs),
  tokensPerSecond: Number(result.tokensPerSecond.toFixed(2)),
  metrics: gateway.metrics()
}, null, 2));
