# local-llm-memory-tools

![Hero Banner](docs/hero.png)

![Demo Screenshot](docs/demo.png)

Local chat assistant with persistent memory, document search, and paid API calls—without shipping your life story to a hosted model.

## Why QMD + Gemma 4 + APINow (x402)

| Piece | What it gives you |
|--------|-------------------|
| **Gemma 4** ([Ollama](https://ollama.com)) | A capable **local** default (`gemma4`) for chat, tool calling, and background fact extraction—your prompts and memories stay on your machine. |
| **QMD** | **Hybrid search** (BM25 + vectors + optional rerank) over markdown you own—conversations, memories, tasks—so answers can use *your* corpus, not just the last few turns. |
| **APINow + HTTP 402 (x402)** | **Machine-to-machine payments**: the assistant calls real HTTP APIs and pays **USDC on Base** per request from your wallet key—discover APIs in one place instead of juggling keys for every vendor. |

Together you get: **privacy-first inference**, **retrieval over local files**, and **real APIs** with a single payment model instead of scattered subscriptions.

## Install

1. Install [Ollama](https://ollama.com), then pull the default model: `ollama pull gemma4`
2. Clone this repo, then `npm install`
3. `cp .env.example .env` and set `PRIVATE_KEY` (EVM key with USDC on **Base** for APINow)
4. Optional: set `OLLAMA_MODEL` if you use another tag/model

QMD is bundled (`@tobilu/qmd`). Optional global CLI: `npm install -g @tobilu/qmd`

## Use

```bash
npm start
```

In the REPL: **`/tasks`** · **`/memory`** · **`/qmd`** · **`/clear`** · **`quit`**

Verbose logging: `npm run start:verbose`

---

**Details:** [ABOUT.md](ABOUT.md) — deep dive, architecture, benchmark, troubleshooting, license.
