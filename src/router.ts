import ollama from 'ollama';
import {
  type AppState,
  type KnownTool,
  findMatchingTool,
  registerTool,
  formatMemories,
} from './memory.js';
import { vlog } from './log.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** Substrings that indicate the user wants an external API call — not product names, docs, or meta questions. */
const API_INTENT_PHRASES = [
  'get my',
  'tell me my',
  'use the',
  'call the',
  'call an',
  'call a',
  'run the',
  'invoke',
  'fetch ',
  ' fetch',
  'horoscope',
  'translate',
  'summarize',
  'weather like',
  'weather today',
  'weather tomorrow',
  'weather for',
  'weather in',
  'weather forecast',
  'weather api',
  'current weather',
  "what's the weather",
  'what is the weather',
  'forecast for',
  'stock price',
  'stock market',
  'bitcoin price',
  'bitcoin',
  'api request',
  'external api',
  'rest api',
  'lookup ',
  ' lookup',
  'query the',
  'endpoint ',
  ' endpoint',
];

/** Standalone tokens (after stripping punctuation). Avoid bare "api" — it matches inside "apinow". */
const API_INTENT_TOKENS = new Set([
  'fetch',
  'invoke',
  'endpoint',
  'request',
  'lookup',
  'query',
  'translate',
  'summarize',
  'horoscope',
  'bitcoin',
]);

function normalizeToken(w: string): string {
  return w.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
}

export function looksLikeApiIntent(message: string): boolean {
  const lower = message.toLowerCase();
  for (const p of API_INTENT_PHRASES) {
    if (lower.includes(p)) return true;
  }
  const tokens = lower.split(/\s+/).map(normalizeToken).filter(Boolean);
  for (const t of tokens) {
    if (API_INTENT_TOKENS.has(t)) return true;
  }
  return false;
}

export interface RouteResult {
  namespace: string;
  endpoint: string;
  data: any;
  needsConfirmation?: { key: string; memoryValue: string; cachedValue: string }[];
}

function resolveParamsFromMemory(
  userMessage: string,
  tool: KnownTool,
  state: AppState
): { params: Record<string, any>; diffs: { key: string; memoryValue: string; cachedValue: string }[] } {
  const params: Record<string, any> = {};
  const diffs: { key: string; memoryValue: string; cachedValue: string }[] = [];
  const msg = userMessage.toLowerCase();
  const memories = state.memories.map((m) => m.content);

  for (const [key, cachedVal] of Object.entries(tool.lastBody)) {
    const keyWords = key.replace(/_/g, ' ').toLowerCase().split(' ');
    let fromMessage: string | null = null;
    let fromMemory: string | null = null;

    // scan user message for explicit override values
    for (const mem of memories) {
      const memLower = mem.toLowerCase();
      if (keyWords.some((kw) => memLower.includes(kw))) {
        const match = mem.match(/is\s+(.+?)\.?$/i) || mem.match(/:\s*(.+?)\.?$/i);
        if (match) {
          fromMemory = match[1].trim();
        }
      }
    }

    // check if user message explicitly mentions a different value
    const words = msg.split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && word !== String(cachedVal).toLowerCase()) {
        if (keyWords.some((kw) => {
          const idx = msg.indexOf(kw);
          if (idx === -1) return false;
          const after = msg.slice(idx + kw.length).trim().split(/\s+/)[0];
          return after === word;
        })) {
          fromMessage = word.charAt(0).toUpperCase() + word.slice(1);
        }
      }
    }

    // priority: explicit message > memory > cache
    const resolved = fromMessage || fromMemory || cachedVal;
    params[key] = resolved;

    if (fromMemory && String(resolved).toLowerCase() !== String(cachedVal).toLowerCase()) {
      diffs.push({ key, memoryValue: String(resolved), cachedValue: String(cachedVal) });
    }
  }

  return { params, diffs };
}

export async function tryRoute(
  userMessage: string,
  state: AppState,
  apinow: any,
  model: string,
  askUser?: (question: string) => Promise<string>
): Promise<RouteResult | null> {
  const t0 = Date.now();
  vlog('router', 'starting route check');
  vlog('router', 'known tools:', state.knownTools.length);
  vlog('router', 'memories:', state.memories.length);

  if (!looksLikeApiIntent(userMessage)) {
    vlog('router', 'no API intent — skip deterministic APINow routing');
    return null;
  }

  // 1. Known tool path — resolve params from memory, no model call
  const known = findMatchingTool(state, userMessage);
  if (known) {
    console.log(dim(`  [router] matched known tool: ${known.namespace}/${known.endpoint}`));
    vlog('router', 'matched keywords for', `${known.namespace}/${known.endpoint}`, '(useCount:', known.useCount, ')');

    const { params, diffs } = resolveParamsFromMemory(userMessage, known, state);
    vlog('router', 'resolved from memory:', params);
    vlog('router', 'diffs from cache:', diffs);

    // if memory says something different than cache, show the user
    if (diffs.length && askUser) {
      for (const d of diffs) {
        console.log(yellow(`  [router] ${d.key}: memory says "${d.memoryValue}" but last call used "${d.cachedValue}"`));
        const answer = await askUser(`  Use "${d.memoryValue}" for ${d.key}? (y/n) `);
        if (answer.toLowerCase().startsWith('n')) {
          params[d.key] = d.cachedValue;
        }
      }
    }

    console.log(dim(`  [router] params: ${JSON.stringify(params)}`));

    try {
      const callT0 = Date.now();
      const url = `https://www.apinow.fun/api/endpoints/${known.namespace}/${known.endpoint}`;
      vlog('router', 'calling', url);
      const data = await apinow.call(url, { method: 'POST', body: params });
      const elapsed = ((Date.now() - callT0) / 1000).toFixed(1);
      console.log(dim(`  [router] -> called ${known.namespace}/${known.endpoint} (${elapsed}s)`));
      vlog('router', 'api response:', data);
      registerTool(state, known.namespace, known.endpoint, known.description, known.keywords, params);
      vlog('router', 'total route time:', `${Date.now() - t0}ms`);
      return { namespace: known.namespace, endpoint: known.endpoint, data };
    } catch (e: any) {
      console.log(dim(`  [router] call failed: ${e.message}`));
      vlog('router', 'call error:', e.message);
    }
  }

  // 2. Intent already verified — search APINow for first-time discovery (optional extra hints for logs)
  const lower = userMessage.toLowerCase();
  const searchHints = [
    'endpoint',
    'fetch',
    'get my',
    'tell me my',
    'use the',
    'horoscope',
    'translate',
    'summarize',
    'invoke',
    'lookup',
    'weather',
    'forecast',
    'bitcoin',
    'stock',
  ];
  const matchedHints = searchHints.filter((s) => lower.includes(s));
  vlog('router', 'search hints:', matchedHints);

  // 3. Search APINow for matching tools
  console.log(dim(`  [router] searching apinow...`));
  try {
    const searchT0 = Date.now();
    const results = await apinow.search(userMessage, 3);
    const searchElapsed = ((Date.now() - searchT0) / 1000).toFixed(1);
    vlog('router', `search took ${searchElapsed}s, found ${results?.endpoints?.length || 0} endpoints`);
    vlog('router', 'search results:', results?.endpoints?.map((e: any) => `${e.namespace}/${e.endpointName}: ${e.description?.slice(0, 60)}`));

    if (!results?.endpoints?.length) {
      console.log(dim(`  [router] no APIs found (${searchElapsed}s)`));
      return null;
    }

    const best = results.endpoints[0];
    console.log(dim(`  [router] found: ${best.namespace}/${best.endpointName} (${searchElapsed}s)`));

    // 4. Extract params — new tool, need model call
    const paramT0 = Date.now();
    const params = await extractParams(userMessage, best.description, null, state, model);
    vlog('router', 'param extraction took', `${Date.now() - paramT0}ms`);
    console.log(dim(`  [router] params: ${JSON.stringify(params)}`));
    vlog('router', 'full params:', params);

    // 5. Call it
    const callT0 = Date.now();
    const url = `https://www.apinow.fun/api/endpoints/${best.namespace}/${best.endpointName}`;
    vlog('router', 'calling', url);
    const data = await apinow.call(url, { method: 'POST', body: params });
    const callElapsed = ((Date.now() - callT0) / 1000).toFixed(1);
    console.log(dim(`  [router] -> called ${best.namespace}/${best.endpointName} (${callElapsed}s)`));
    vlog('router', 'api response:', data);

    // 6. Register for future use
    const stopWords = ['call', 'the', 'apinow', 'endpoint', 'about', 'tell', 'what', 'with', 'from', 'this', 'that', 'your', 'have', 'been', 'will', 'would', 'could', 'should', 'their', 'there', 'where', 'when', 'which', 'while', 'into', 'then', 'than', 'them', 'they', 'these', 'those', 'some', 'more', 'most', 'other', 'using', 'make', 'like', 'just', 'also'];
    const keywords = userMessage
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.includes(w));
    registerTool(state, best.namespace, best.endpointName, best.description, keywords, params);
    vlog('router', 'registered tool, keywords:', keywords);
    vlog('router', 'total route time:', `${Date.now() - t0}ms`);

    return { namespace: best.namespace, endpoint: best.endpointName, data };
  } catch (e: any) {
    console.log(dim(`  [router] error: ${e.message}`));
    vlog('router', 'error:', e.message, e.stack);
    return null;
  }
}

async function extractParams(
  userMessage: string,
  description: string,
  sampleBody: Record<string, any> | null,
  state: AppState,
  model: string
): Promise<Record<string, any>> {
  try {
    const memories = formatMemories(state);
    const prompt = sampleBody
      ? `Extract API parameters from this context.
API: ${description}
Expected params (use these keys): ${JSON.stringify(sampleBody)}
User message: "${userMessage}"
Known facts: ${memories}
Return ONLY a JSON object with the parameter values. No explanation.`
      : `Extract API parameters from this context.
API: ${description}
User message: "${userMessage}"
Known facts: ${memories}
Return ONLY a JSON object with the parameter values. No explanation.`;

    vlog('extract', 'prompt length:', prompt.length, 'chars');

    const response = await ollama.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      format: 'json',
    });

    vlog('extract', 'raw model output:', response.message.content);
    if (response.prompt_eval_count || response.eval_count) {
      vlog('extract', `tokens: prompt=${response.prompt_eval_count || '?'} completion=${response.eval_count || '?'}`);
    }

    const parsed = JSON.parse(response.message.content);
    return parsed;
  } catch (e: any) {
    vlog('extract', 'parse error:', e.message);
    return sampleBody || {};
  }
}
