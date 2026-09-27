const endpoint = process.env.FLOP_INFERENCE_URL ?? "http://127.0.0.1:8790/v1/chat/completions";
const count = Number(process.env.FLOP_BENCH_REQUESTS ?? 3);
const maxTokens = Number(process.env.FLOP_BENCH_MAX_TOKENS ?? 16);
const body = {
  model: process.env.FLOP_BENCH_MODEL ?? "gemma4:12b",
  messages: [{ role: "user", content: "In one short sentence, explain why deterministic routing matters." }],
  temperature: 0,
  max_tokens: maxTokens
};

const started = performance.now();
const jobs = Array.from({ length: count }, async (_, index) => {
  const t0 = performance.now();
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  return { index, status: response.status, wallMs: performance.now() - t0, xFlop: data.x_flop, error: data.error };
});
const results = await Promise.all(jobs);
console.log(JSON.stringify({ requests: count, totalWallMs: performance.now() - started, results }, null, 2));
