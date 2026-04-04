# Hammock — LLM wiki schema

This repo follows the **LLM Wiki** pattern ([Karpathy gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)): a persistent, interlinked markdown layer between you and raw sources.

## Layers

| Layer | Location | Who edits |
|-------|----------|-----------|
| Raw sources | [`raw/`](raw/) | You only — immutable inputs (clippings, exports, notes) |
| Wiki | [`wiki/`](wiki/) | The assistant (tools + IDE) — summaries, entities, synthesis |
| Runtime state | `data/` (gitignored) | App — chats, memories, QMD index, SQLite |

## Special files

- [`wiki/index.md`](wiki/index.md) — catalog: every wiki page linked with a one-line summary; group by category (entities, concepts, sources, etc.). **Update on every ingest** that adds or renames pages.
- [`wiki/log.md`](wiki/log.md) — append-only timeline. Use a consistent heading prefix, e.g. `## [YYYY-MM-DD] ingest | Short title` or `query | …` / `lint | …`, so Unix tools can grep it.

## Ingest (new material in `raw/`)

1. Read the new file(s); extract claims, entities, and how they relate to existing wiki pages.
2. Create or update wiki pages; add `[[wikilinks]]` or markdown links to related pages.
3. If new information contradicts the wiki, **surface the contradiction** on the relevant pages (don’t silently overwrite without noting conflict).
4. Update `wiki/index.md` and append a section to `wiki/log.md`.
5. Run `qmd_update` (or let the app’s end-of-turn refresh run) so QMD picks up changes.

## Query (user asks something)

1. Prefer reading `wiki/index.md` first to find relevant pages, then open those files (or `qmd_search` / `qmd_query` with collection `llm-wiki` when needed).
2. Answer with citations to wiki paths or raw paths when applicable.
3. Valuable answers (comparisons, analyses) may be **saved as new wiki pages** and linked from `index.md`, then logged in `log.md`.

## Lint (periodic)

- Contradictions between pages; stale claims superseded by newer sources.
- Orphan pages (no inbound links); missing entity pages for important terms.
- Gaps worth a web search or a new raw source.

## Naming

- Prefer `wiki/topics/…`, `wiki/entities/…`, or flat `wiki/Topic-Name.md` — stay consistent once chosen.
- File names: `kebab-case` or `Title-Case` — pick one style per wiki.

## Hammock tools

- `wiki_read` / `wiki_write` — paths **relative to `wiki/`** only.
- `wiki_append_log` — appends a dated block to `wiki/log.md`.
- `raw_read` — paths **relative to `raw/`** only (read-only).
- After wiki changes, call `qmd_update` if you need immediate search visibility before the next chat turn.

## IDE agents

When editing the wiki in Cursor: follow this file, keep `raw/` read-only, and preserve append-only structure in `log.md` (append at bottom).
