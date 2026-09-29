import os from "node:os";
import { writeFileSync, rmSync } from "node:fs";
import { InferenceGateway, OpenAICompatibleWorker } from "../dist/src/inference-gateway.js";
import { SafeInferenceRuntime } from "../dist/src/inference-runtime.js";
import { createInferenceServer } from "../dist/src/inference-server.js";

const key = process.env.FLOP_CLOUD_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GEMINI_API_KEY;
if (!key) throw new Error("FLOP_CLOUD_API_KEY_REQUIRED");

const pidFile = new URL("../.inference-gateway.pid", import.meta.url);
writeFileSync(pidFile, String(process.pid));
const cleanup = () => { try { rmSync(pidFile, { force: true }); } catch {} };
process.once("exit", cleanup);
process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}

const models = (process.env.FLOP_INFERENCE_MODELS ?? "").split(",").map(v => v.trim()).filter(Boolean);
if (!models.length) throw new Error("FLOP_INFERENCE_MODELS_REQUIRED");
const worker = new OpenAICompatibleWorker({
  id: process.env.FLOP_CLOUD_WORKER_ID ?? "cloud-openai-compatible",
  baseUrl: process.env.FLOP_CLOUD_BASE_URL ?? "https://api.openai.com/v1",
  apiKey: key,
  models,
  timeoutMs: Number(process.env.FLOP_CLOUD_TIMEOUT_MS ?? 90000)
});
const gateway = new InferenceGateway([worker]);
const cloudSnapshot = { gpu: { available: false, observedAt: new Date().toISOString(), reason: "CLOUD_INFERENCE" }, pauseProcesses: [] };
const guard = { async waitUntilAvailable(){ return cloudSnapshot; }, async snapshot(){ return cloudSnapshot; } };
const runtime = new SafeInferenceRuntime(gateway, guard, Number(process.env.FLOP_MAX_CONCURRENT ?? 1));
const host = process.env.FLOP_INFERENCE_HOST ?? "127.0.0.1";
const port = Number(process.env.FLOP_INFERENCE_PORT ?? 8790);

createInferenceServer(runtime, models).listen(port, host, () => {
  console.log("FLOP cloud inference listening on http://" + host + ":" + port);
  console.log("worker=" + (process.env.FLOP_CLOUD_WORKER_ID ?? "cloud-openai-compatible") + " model=" + models.join(",") + " localGpu=false concurrency=" + (process.env.FLOP_MAX_CONCURRENT ?? 1));
});