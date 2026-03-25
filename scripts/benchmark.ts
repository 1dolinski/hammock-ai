/**
 * Quick generation benchmark: measures eval_count / total_duration via Ollama /api/generate.
 * Usage: npm run benchmark
 * Optional: OLLAMA_MODEL, OLLAMA_HOST, BENCH_TOKENS (default 80)
 */
import { config } from 'dotenv';

config();

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL =
  process.env.OLLAMA_MODEL ||
  'hf.co/Jackrong/Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-GGUF';
const NUM_PREDICT = Math.min(512, Math.max(16, Number(process.env.BENCH_TOKENS || 80)));

async function main(): Promise<void> {
  const tagsRes = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!tagsRes.ok) {
    console.error('Cannot reach Ollama at', OLLAMA_HOST, tagsRes.status);
    process.exit(1);
  }
  const tags = (await tagsRes.json()) as { models?: { name: string }[] };
  const names = (tags.models || []).map((m) => m.name);
  const bare = MODEL.split(':')[0];
  const installed = names.some((n) => n.split(':')[0] === bare || n === MODEL);
  if (!installed) {
    console.error(`Model not found locally: ${MODEL}`);
    console.error('Installed:', names.length ? names.join(', ') : '(none)');
    console.error(`Run: ollama pull ${MODEL}`);
    process.exit(1);
  }

  const t0 = performance.now();
  const genRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: 'In one short sentence, what is 2+2?',
      stream: false,
      options: { num_predict: NUM_PREDICT },
    }),
  });
  const wallMs = performance.now() - t0;

  if (!genRes.ok) {
    const t = await genRes.text();
    console.error('Generate failed', genRes.status, t);
    process.exit(1);
  }

  const d = (await genRes.json()) as {
    eval_count?: number;
    total_duration?: number;
    prompt_eval_count?: number;
    response?: string;
  };

  const sec = (d.total_duration ?? 0) / 1e9;
  const ev = d.eval_count ?? 0;
  const promptTok = d.prompt_eval_count;

  console.log('model:', MODEL);
  console.log('num_predict cap:', NUM_PREDICT);
  if (promptTok != null) console.log('prompt_eval_count:', promptTok);
  console.log('eval_count (completion tokens):', ev);
  console.log('ollama total_duration_s:', sec.toFixed(2));
  console.log('wall_clock_s:', (wallMs / 1000).toFixed(2));
  if (ev > 0 && sec > 0) {
    console.log('tok/s (eval_count / total_duration):', (ev / sec).toFixed(2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
