# About local-llm-memory-tools

Cloud AI knows everything about you and nothing stays on your machine. Your conversations, preferences, and context live on someone else's server. Local models fix the privacy problem but create new ones — they forget everything between sessions, can't search their own history, and have no way to call external services.

This project solves three problems:

1. **Your context stays local.** Conversations, memories, and documents never leave your machine. Everything is stored as plain markdown files you own and can read.

2. **Your AI remembers you.** Hard facts and preferences are automatically extracted from every conversation and persisted in a vectorized local index. Your zodiac sign, your job, your allergies — mentioned once, remembered forever.

3. **A powerful model gets real tool access.** A deterministic router handles API discovery, parameter extraction, and execution *before* the model even sees the message. The model stays focused on conversation while the router gives it capabilities that normally require 100B+ parameter models.

Built on **Gemma 4** via Ollama (default `gemma4` → resolves to `gemma4:latest`), **QMD** for vectorized memory/search, and **APINow** for x402-protocol paid API access.

---

## Full setup

### 1. Ollama

```bash
brew install ollama   # macOS example
ollama pull gemma4
```

The app uses `OLLAMA_MODEL` from `.env` if set; otherwise `gemma4` (often resolves to `gemma4:latest`).

**Tight on VRAM?** Pull a smaller tag or another model, then set `OLLAMA_MODEL` to match.

### 2. QMD (bundled)

[QMD](https://github.com/tobi/qmd) is a local document search engine with BM25 + vector hybrid search. This repo depends on **`@tobilu/qmd`** — `npm install` installs it under `node_modules`, and the app invokes the CLI from there (no global install required).

Optional — `qmd` on your PATH for manual use outside this project:

```bash
npm install -g @tobilu/qmd
```

### 3. APINow private key

[APINow](https://www.APINow.fun) uses the **x402 payment protocol** — your AI pays for API calls with **USDC** using an EVM private key. No API keys, no subscriptions.

1. Use any EVM wallet (MetaMask, Coinbase Wallet, etc.) or generate a new key  
2. Fund the wallet with USDC on **Base** — even $1 is enough for hundreds of API calls  
3. Copy the private key into `.env` as `PRIVATE_KEY`

### 4. Clone & env

```bash
git clone https://github.com/1dolinski/local-llm-memory-tools.git
cd local-llm-memory-tools
npm install
cp .env.example .env
# Edit .env — PRIVATE_KEY required; OLLAMA_MODEL optional (default gemma4)
```

Example `.env`:

```env
PRIVATE_KEY=0xabc123...your_private_key_here
# OLLAMA_MODEL=gemma4
```

```bash
npm start
npm run start:verbose   # verbose logging
```

---

## Benchmark (Gemma 4)

Measures **decode throughput** (`eval_count / eval_duration`), not end-to-end wall time mixed with load/prefill.

```bash
ollama pull gemma4
npm run benchmark
npm run benchmark:gemma4   # explicit
```

Optional env: `BENCH_TOKENS` (default `80`), `BENCH_NO_WARMUP=1`, `OLLAMA_HOST`, `BENCH_PROMPT`.

**Tests** (no Ollama): `npm test`

**Sample run** (`gemma4:latest`, `BENCH_TOKENS=80`, warmup, macOS dev machine, 2026-04-03):

| Metric | Value |
|--------|--------|
| `eval_count` | 80 |
| Decode **tok/s** | **27.34** |
| End-to-end tok/s | 24.63 |

Your hardware will differ.

---

## Troubleshooting: `unable to load model`

Typical causes: **stale or incomplete blobs**, **old Ollama**, or **pull vs. runtime mismatch** (e.g. Docker vs. menu-bar app).

1. **Quit Ollama** completely (menu bar → Quit), start it again.  
2. **Upgrade Ollama** — e.g. `brew upgrade ollama` on macOS, or reinstall from [ollama.com](https://ollama.com).  
3. **Re-pull** — `ollama rm <name>` then `ollama pull <name>`. If the error includes a `sha256-…` blob hash, remove that file under `~/.ollama/models/blobs/` and pull again.  
4. **Same endpoint** — if you use `OLLAMA_HOST` or Docker, pull and run against the same daemon.  
5. **VRAM / memory** — Activity Monitor and `ollama ps`.

`npm run benchmark` prints extra hints when the generate API returns a 500 with a load error.

---

## Why Gemma 4?

The default is **Gemma 4** in Ollama (`gemma4` → whatever tag you installed, often `gemma4:latest`). Good for local chat, tool calling, and the background extractor. Ollama may expose several sizes or variants — pick one that fits your GPU/RAM and run **`npm run benchmark`** locally.

Browse models on [ollama.com](https://ollama.com).

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Chat Loop                      │
│  user message → router → model → stream response │
├──────────┬──────────┬──────────┬────────────────┤
│  Router  │ Extractor│   QMD    │    APINow      │
│ (pre-LLM │ (bg fact │ (vector  │  (x402 tool    │
│  API     │  mining) │  memory) │   calling)     │
│  dispatch│         │          │                │
└──────────┴──────────┴──────────┴────────────────┘
```

**Modules (single process):**

| File | Purpose |
|------|---------|
| `src/index.ts` | Chat loop, streaming, system prompt, CLI commands |
| `src/router.ts` | Deterministic pre-LLM API routing |
| `src/extractor.ts` | Background fact extraction |
| `src/memory.ts` | Persistent state, markdown for QMD |
| `src/tools.ts` | Ollama tools + APINow + QMD |
| `src/log.ts` | Verbose logging |

---

## Key features

### Automatic memory extraction

Background model calls extract facts and preferences from each turn; deduplicated and saved to JSON + markdown for QMD.

### QMD — local memory & search

- BM25 + hybrid / vector search  
- Auto-indexing of conversations, memories, tasks under `data/`  
- Embeddings and collection context for better retrieval  

### APINow — x402

- Natural-language API discovery  
- USDC per call via your key  
- Router + tool registration for repeat calls  

### Deterministic API router

Runs before the main LLM: known tools from memory, or APINow search → params → call.

### Tasks

Todo / upcoming / done lists, persisted across sessions.

---

## Usage example

```
  Chat Assistant  |  ollama + apinow + qmd
  model: gemma4:latest
  wallet: 0x...
  qmd: chat-memory (12 docs)
  commands: /tasks  /memory  /qmd  /clear  quit

you> my zodiac is cancer, what's my horoscope
  [memory] saved: User's zodiac sign is Cancer
  [router] matched known tool: gg402/horoscope
  ...

assistant> Today's horoscope for Cancer: ...
```

Example API: [gg402/horoscope](https://www.apinow.fun/try/gg402/horoscope?tab=try)

### Commands

| Command | Description |
|---------|-------------|
| `/tasks` | Todo / upcoming / done |
| `/memory` | Saved memories |
| `/qmd` | QMD index status |
| `/clear` | Clear conversation |
| `quit` | Save and exit |

---

## How it works

1. Message → history + markdown for QMD  
2. Router → known API or APINow search  
3. Extractor → facts to memory + QMD  
4. Main model → stream with tools + context  
5. QMD index refresh  

---

## Verbose mode

`npm run start:verbose` — token counts, router, APINow timing, extractor, timestamps.

---

## License

MIT
