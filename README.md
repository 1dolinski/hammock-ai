# local-llm-memory-tools

![Hero Banner](docs/hero.png)

![Demo Screenshot](docs/demo.png)

Cloud AI knows everything about you and nothing stays on your machine. Your conversations, preferences, and context live on someone else's server. Local models fix the privacy problem but create new ones — they forget everything between sessions, can't search their own history, and have no way to call external services.

This project solves three problems:

1. **Your context stays local.** Conversations, memories, and documents never leave your machine. Everything is stored as plain markdown files you own and can read.

2. **Your AI remembers you.** Hard facts and preferences are automatically extracted from every conversation and persisted in a vectorized local index. Your zodiac sign, your job, your allergies — mentioned once, remembered forever.

3. **A powerful model gets real tool access.** A deterministic router handles API discovery, parameter extraction, and execution *before* the model even sees the message. The model stays focused on conversation while the router gives it capabilities that normally require 100B+ parameter models.

Built on **Gemma 4** via Ollama (default `gemma4` → resolves to `gemma4:latest`), **QMD** for vectorized memory/search, and **APINow** for x402-protocol paid API access.

## Quick Start

### 1. Install Ollama

Download from [ollama.com](https://ollama.com), then pull **Gemma 4** (default for this repo):

```bash
# Install Ollama (macOS)
brew install ollama

ollama pull gemma4
```

The app uses `OLLAMA_MODEL` from `.env` if set; otherwise it uses `gemma4` (matches `gemma4:latest` when that tag exists).

**Tight on VRAM?** Pull a smaller tag or another model in Ollama, then set `OLLAMA_MODEL` to match.

### Benchmark (Gemma 4)

Measures **decode throughput** (`eval_count / eval_duration`), not end-to-end wall time mixed with load/prefill.

**How to run (Gemma 4):**

```bash
ollama pull gemma4
npm run benchmark
# explicit:
npm run benchmark:gemma4
```

Optional env: `BENCH_TOKENS` (default `80`), `BENCH_NO_WARMUP=1`, `OLLAMA_HOST`, `BENCH_PROMPT` (override the long-generation prompt).

**Automated tests** (pure helpers, no Ollama required):

```bash
npm test
```

**Sample results** (one run, `gemma4:latest`, `BENCH_TOKENS=80`, warmup on, macOS dev machine, 2026-04-03):

| Metric | Value |
|--------|--------|
| `eval_count` (completion tokens) | 80 |
| Decode **tok/s** (`eval_count / eval_duration`) | **27.34** |
| End-to-end tok/s (`eval_count / total_duration`) | 24.63 |

Your hardware will differ; use the decode tok/s line as the apples-to-apples number.

### 2. QMD (bundled)

[QMD](https://github.com/tobi/qmd) is a local document search engine with BM25 + vector hybrid search. This repo depends on **`@tobilu/qmd`** — `npm install` installs it under `node_modules`, and the app invokes the CLI from there (no global install required).

Optional — `qmd` on your PATH for manual use outside this project:

```bash
npm install -g @tobilu/qmd
```

### 3. Get an APINow Private Key

[APINow](https://www.APINow.fun) uses the **x402 payment protocol** — your AI pays for API calls with **USDC** using an EVM private key. No API keys, no subscriptions.

1. Use any EVM wallet (MetaMask, Coinbase Wallet, etc.) or generate a new key
2. Fund the wallet with USDC on **Base** — even $1 is enough for hundreds of API calls
3. Copy the private key

### 4. Clone & Run

```bash
git clone https://github.com/1dolinski/local-llm-memory-tools.git
cd local-llm-memory-tools
npm install

# Set up your private key
cp .env.example .env
# Edit .env and paste your private key
```

Your `.env` file should look like:

```env
# EVM private key for USDC payments via APINow (x402 protocol)
PRIVATE_KEY=0xabc123...your_private_key_here

# Optional: override the default model (default is gemma4)
# OLLAMA_MODEL=gemma4
```

Then start chatting:

```bash
npm start

# Or with verbose logging (token counts, search timing, tool calls)
npm run start:verbose
```

### Troubleshooting: `unable to load model`

Typical causes: **stale or incomplete blobs**, **old Ollama**, or **pull vs. runtime mismatch** (e.g. Docker vs. menu-bar app).

1. **Quit Ollama** completely (menu bar → Quit), start it again.
2. **Upgrade Ollama** — e.g. `brew upgrade ollama` on macOS, or reinstall from [ollama.com](https://ollama.com).
3. **Re-pull the model** — `ollama rm <name>` then `ollama pull <name>`. If the error includes a `sha256-…` blob hash, remove that file under `~/.ollama/models/blobs/` and pull again.
4. **Same endpoint everywhere** — if you use `OLLAMA_HOST` or Docker, pull and run against the same daemon so blobs match.
5. **VRAM / memory** — check Activity Monitor and `ollama ps` if loads fail or generation is unstable.

`npm run benchmark` prints extra recovery hints when the generate API returns a 500 with a load error.

---

## Why Gemma 4?

The default is **Gemma 4** in Ollama (`gemma4` → whatever tag you installed, often `gemma4:latest`). It is a solid local choice for chat, tool calling, and the background extractor while keeping data on your machine. Ollama may expose several sizes or variants — pick one that fits your GPU/RAM and use **`npm run benchmark`** on your box to compare decode speed.

Browse models and tags on [ollama.com](https://ollama.com).

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

**6 modules, single-process:**

| File | Purpose |
|---|---|
| `src/index.ts` | Chat loop, streaming, system prompt, CLI commands |
| `src/router.ts` | Deterministic pre-LLM API routing — matches known tools or searches for new ones, extracts params, calls APIs before the model even sees the message |
| `src/extractor.ts` | Background fact extractor — mines hard facts & preferences from every conversation turn without blocking chat |
| `src/memory.ts` | Persistent state: tasks, memories, conversation history, known tools. Writes markdown for QMD indexing |
| `src/tools.ts` | Ollama tool schemas + handlers for tasks, memory, APINow, and QMD |
| `src/log.ts` | Verbose timestamped logging |

## Key Features

### Automatic Memory Extraction

Every user message is analyzed in the background by a separate model call that extracts hard facts and preferences — names, locations, zodiac signs, birthdays, job titles, allergies, favorites, relationships, tech stack, etc. These are deduplicated against existing memories and persisted to both JSON and markdown (for QMD indexing).

On startup, if conversation history exists but no memories have been extracted yet, it bootstraps by processing past messages.

### QMD — Vectorized Local Memory & Search

[QMD](https://github.com/tobi/qmd) provides the local knowledge layer:

- **BM25 keyword search** — fast exact matching across all indexed docs
- **Hybrid deep search** — BM25 + vector search + query expansion + LLM reranking
- **Auto-indexing** — conversations, memories, and tasks are written as markdown files and automatically indexed
- **Embedding** — vector embeddings generated locally for semantic search
- **Context** — collections can be annotated with descriptions to improve search relevance

The assistant's entire operational history (conversations, saved memories, task lists) lives as markdown files in `data/` and is indexed by QMD, making everything semantically searchable.

### APINow — x402 Tool Calling

[APINow](https://www.APINow.fun) is an API marketplace that uses the **x402 payment protocol** for machine-to-machine API access (integrated here via the [apinow-sdk](https://www.npmjs.com/package/apinow-sdk)):

- **Vectorized API search** — find relevant APIs by natural language description
- **x402 payments** — APIs are paid per-call using **USDC** with your private key, no subscriptions or API keys per service
- **Evals** — tools on APINow are vetted through evaluations so the AI can trust tool quality
- **Deterministic routing** — the router matches user intent to known tools instantly, or discovers new ones via search
- **Parameter resolution** — params are resolved from user memory and conversation context, only falling back to a model call for truly new tools

API providers can list their APIs on APINow and get paid in USDC every time an AI agent calls them.

### Deterministic API Router

The router runs **before** the main LLM to handle API calls reliably:

1. **Known tool match** — keyword matching against previously used tools, params resolved from memory (no model call needed)
2. **New tool discovery** — APINow search → focused param extraction model call → API execution
3. **Tool registration** — successful calls are saved with keywords for instant future matching
4. **Conflict resolution** — if memory says one thing but the cached params say another, it asks the user

### Task Management

Built-in todo / upcoming / done lists managed through natural language. Tasks persist across sessions.

## Usage

```
  Chat Assistant  |  ollama + apinow + qmd
  model: gemma4:latest
  wallet: 0x...
  qmd: chat-memory (12 docs)
  commands: /tasks  /memory  /qmd  /clear  quit

you> my zodiac is cancer, what's my horoscope
  [memory] saved: User's zodiac sign is Cancer
  [router] matched known tool: gg402/horoscope
  [router] params: {"zodiac_sign":"Cancer"}
  [router] -> called gg402/horoscope (1.2s)

assistant> Today's horoscope for Cancer: ...
```

*(This example automatically discovers and calls the [gg402/horoscope](https://www.apinow.fun/try/gg402/horoscope?tab=try) API on APINow, handling the microtransaction in the background.)*

### Commands

| Command | Description |
|---|---|
| `/tasks` | Show todo / upcoming / done lists |
| `/memory` | Show all saved memories |
| `/qmd` | Show QMD index status |
| `/clear` | Clear conversation history |
| `quit` | Save and exit |

## How It Works

1. **You type a message** → pushed to conversation history + saved as markdown for QMD
2. **Router checks** → does this match a known API tool? If yes, resolve params from memory and call it. If it looks like an API request, search APINow for tools
3. **Background extractor fires** → a separate model call extracts hard facts from the conversation turn, deduplicates, and saves to memory + QMD
4. **Main model responds** → with full context (memories, tasks, QMD status, API results if routed), streaming response with tool calling support
5. **QMD updates** → index refreshed after each turn

## Verbose Mode

`npm run start:verbose` logs everything:

- Token counts (prompt + completion) per model call
- Router decisions, keyword matching, param resolution
- APINow search timing and results
- API call timing and responses
- Extractor fact mining results and dedup decisions
- Full timestamps on every operation

## License

MIT
