import os from "node:os";
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { InferenceGateway, OllamaWorker } from "../dist/src/inference-gateway.js";
import { WindowsGpuResourceGuard, DEFAULT_RESOURCE_POLICY } from "../dist/src/inference-resource.js";
import { SafeInferenceRuntime } from "../dist/src/inference-runtime.js";
import { createInferenceServer } from "../dist/src/inference-server.js";

const pidFile = new URL("../.inference-gateway.pid", import.meta.url);
writeFileSync(pidFile, String(process.pid));
const cleanup = () => { try { rmSync(pidFile, { force: true }); } catch {} };
process.once("exit", cleanup);
process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));

try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
if (process.platform === "win32" && process.env.FLOP_LOWER_OLLAMA_PRIORITY !== "0") {
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass='BelowNormal' }"], { windowsHide: true, stdio: "ignore" });
  } catch {}
}

const models = (process.env.FLOP_INFERENCE_MODELS ?? "gemma4:12b").split(",").map((v) => v.trim()).filter(Boolean);
const worker = new OllamaWorker({ id: "ollama-local", models, keepAlive: process.env.FLOP_OLLAMA_KEEP_ALIVE ?? "2m" });
const gateway = new InferenceGateway([worker]);
const policy = {
  ...DEFAULT_RESOURCE_POLICY,
  pauseGpuUtilizationPct: Number(process.env.FLOP_GPU_PAUSE_PCT ?? 70),
  maxVramUsedMiB: Number(process.env.FLOP_GPU_MAX_VRAM_MIB ?? 9216),
  maxTemperatureC: Number(process.env.FLOP_GPU_MAX_TEMP_C ?? 82),
  waitTimeoutMs: Number(process.env.FLOP_GPU_WAIT_TIMEOUT_MS ?? 30000)
};
const pauseProcesses = (process.env.FLOP_PAUSE_PROCESSES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const guard = new WindowsGpuResourceGuard(policy, pauseProcesses);
const runtime = new SafeInferenceRuntime(gateway, guard, Number(process.env.FLOP_MAX_CONCURRENT ?? 1));
const host = process.env.FLOP_INFERENCE_HOST ?? "127.0.0.1";
const port = Number(process.env.FLOP_INFERENCE_PORT ?? 8790);

createInferenceServer(runtime, models).listen(port, host, () => {
  console.log(`FLOP inference listening on http://${host}:${port}`);
  console.log(`policy concurrency=${process.env.FLOP_MAX_CONCURRENT ?? 1} gpuPause=${policy.pauseGpuUtilizationPct}% vramMax=${policy.maxVramUsedMiB}MiB keepAlive=${process.env.FLOP_OLLAMA_KEEP_ALIVE ?? "2m"}`);
});
