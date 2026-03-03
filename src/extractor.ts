import ollama from 'ollama';
import { type AppState, addMemory, formatMemories } from './memory.js';
import { qmd } from './tools.js';
import { vlog } from './log.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

interface ExtractionJob {
  userMessage: string;
  assistantResponse: string | null;
}

let queue: ExtractionJob[] = [];
let running = false;
let stateRef: AppState | null = null;
let modelRef = '';

export function extractFactsInBackground(
  userMessage: string,
  assistantResponse: string | null,
  state: AppState,
  model: string
): void {
  stateRef = state;
  modelRef = model;
  queue.push({ userMessage, assistantResponse });
  vlog('extractor', `queued job (${queue.length} in queue)`);
  drain();
}

export function bootstrapMemories(state: AppState, model: string): void {
  if (state.memories.length > 0 || state.history.length < 2) return;

  stateRef = state;
  modelRef = model;

  const recent = state.history.slice(-20);
  const userTurns: ExtractionJob[] = [];
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].role === 'user') {
      const assistantReply =
        i + 1 < recent.length && recent[i + 1].role === 'assistant'
          ? recent[i + 1].content
          : null;
      userTurns.push({ userMessage: recent[i].content, assistantResponse: assistantReply });
    }
  }

  if (userTurns.length === 0) return;

  vlog('extractor', `bootstrapping from ${userTurns.length} historical turns`);
  console.log(dim(`  [memory] bootstrapping from ${userTurns.length} past messages...`));
  queue.push(...userTurns);
  drain();
}

export async function waitForExtractor(): Promise<void> {
  while (running || queue.length > 0) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

function drain(): void {
  if (running) return;
  processNext();
}

async function processNext(): Promise<void> {
  if (queue.length === 0) {
    running = false;
    return;
  }

  running = true;
  const job = queue.shift()!;

  try {
    await doExtract(job.userMessage, job.assistantResponse, stateRef!, modelRef);
  } catch (e: any) {
    vlog('extractor', 'job error:', e.message);
  }

  processNext();
}

async function doExtract(
  userMessage: string,
  assistantResponse: string | null,
  state: AppState,
  model: string
): Promise<void> {
  const t0 = Date.now();
  vlog('extractor', 'processing:', userMessage.slice(0, 80));

  try {
    const existing = formatMemories(state);

    const context = assistantResponse
      ? `User: "${userMessage}"\nAssistant: "${assistantResponse}"`
      : `User: "${userMessage}"`;

    const response = await ollama.chat({
      model,
      messages: [
        {
          role: 'user',
          content: `Extract hard facts and personal preferences from this conversation turn. Only extract concrete, reusable information — things like names, locations, zodiac signs, birthdays, ages, job titles, preferences, allergies, favorites, relationships, pets, tech stack, etc.

Do NOT extract:
- Questions or requests ("user wants to know X")
- Transient conversation context
- Vague or subjective statements
- Things already known

Already known facts:
${existing}

Conversation:
${context}

Return a JSON object: { "facts": ["fact 1", "fact 2"] }
If there are no new hard facts, return { "facts": [] }`,
        },
      ],
      format: 'json',
    });

    vlog('extractor', 'raw output:', response.message.content);
    if (response.eval_count) {
      vlog('extractor', `tokens: prompt=${response.prompt_eval_count || '?'} completion=${response.eval_count}`);
    }

    const parsed = JSON.parse(response.message.content);
    const facts: string[] = parsed.facts || [];

    if (facts.length === 0) {
      vlog('extractor', `no new facts (${Date.now() - t0}ms)`);
      return;
    }

    const existingLower = state.memories.map((m) => m.content.toLowerCase());

    let saved = 0;
    for (const fact of facts) {
      if (!fact || fact.length < 3) continue;
      const factLower = fact.toLowerCase();
      if (existingLower.some((e) => e === factLower || e.includes(factLower) || factLower.includes(e))) {
        vlog('extractor', 'skipping duplicate:', fact);
        continue;
      }

      addMemory(state, fact);
      existingLower.push(factLower);
      saved++;
      console.log(dim(`  [memory] saved: ${fact}`));
      vlog('extractor', 'saved fact:', fact);
    }

    if (saved > 0) {
      try {
        qmd('update', 10_000);
        vlog('extractor', 'qmd updated');
      } catch {}
    }

    vlog('extractor', `done: ${saved} facts saved in ${Date.now() - t0}ms`);
  } catch (e: any) {
    vlog('extractor', 'error:', e.message);
  }
}
