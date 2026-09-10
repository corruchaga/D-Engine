# D-Engine

**The AI thinks, the gate decides.**

A deterministic harness for LLM code edits. The model proposes `SEARCH/REPLACE` blocks; a local runtime applies them in a shadow git worktree, checks the result with `tsc --noEmit`, and merges only if compilation passes. The LLM never writes to your real branch.

📄 **Read the full story:** [The AI thinks, the gate decides — how I made LLM code edits deterministic (42× fewer tokens)](https://dev.to/sergiocorruchaga/the-ai-thinks-the-gate-decides-how-i-made-llm-code-edits-deterministic-and-cut-token-usage-42x-5cbi)
🇪🇸 [README en español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why

Agentic coding loops pay their token bill twice: every turn re-sends the whole trajectory (files, tool results, reasoning) to the model, and "thinking" modes multiply both the tokens per turn and the number of turns. D-Engine removes the loop for the bounded-edit case: one prompt, one patch set, one deterministic gate.

Same task, same model (V4.1-Flash), same literal prompt:

| Runtime | Tokens | Time |
| --- | --- | --- |
| D-Engine v0.2.2 | 2,552 | ~4 s |
| dsh Minimal (single shell tool) | 34,600 | 1m04s |
| dsh, effort off | 37,100 | 6 s |
| dsh factory defaults (thinking High) | 107,000 | 28 s |

The toolbox is not the cost — **the agentic loop is**.

## How it works

1. You describe the change; an automatic selector (P9) picks the target files by token budget.
2. The LLM returns `SEARCH/REPLACE` blocks — nothing else.
3. A 4-strategy cascade applies them locally: exact → normalized newlines → ignore trailing whitespace → fuzzy (0.85 threshold).
4. Everything happens in a shadow git worktree. `tsc --noEmit` is the only source of truth.
5. Green compile → merge. Anything else → nothing touches your branch.

## Benchmark (headline)

10 frozen tasks, same model family, one attempt each, full methodology disclosed:

| Metric | D-Engine | Agentic loop (dsh, factory) |
| --- | --- | --- |
| Quality (max 50) | 48 | 48 |
| Avg tokens per task | ~2,100 (bounded) | ~93,000 (range 32K–214K) |
| Avg time per task | ~2.7 s | ~38 s |
| Broken commits on main | 0 | 1 (Aider, trap task) |

Tied quality, **14–42× fewer tokens**, a predictable bill, zero broken merges. The full benchmark — frozen prompts, voided rows, hallucination incident and all — ships in [docs/benchmark.md](docs/benchmark.md) (Spanish, translation in progress).

## Install & usage

Requirements: Node.js, git, TypeScript in the target repo (`tsc --noEmit`).

```bash
git clone https://github.com/corruchaga/D-Engine
cd D-Engine
npm install
cp .env.example .env
```

Fill in `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` in `.env`.

Development (no build):

```bash
npm run dev
```

Local production:

```bash
npm run build
npm start
```

The TUI asks for: change description, target file (empty Enter = automatic selector), safety mode (Fast / Verify / Shadow) and confirmation. Fast merges after applying; Verify adds a semantic audit; Shadow never merges without permission.

`npm run typecheck` is equivalent to `tsc --noEmit`.

## Known limitations

- Cannot create new files (yet — see roadmap).
- Fuzzy matching (0.85 threshold) is the weak link.
- The P9 file selector is not deterministic.

## Roadmap v0.3

- New-file creation
- Retry loop with compiler feedback
- Mandatory Verify when a patch applied via fuzzy
- Time and tokens in the final summary

## License

MIT. Copyright (c) 2026 Sergi Corruchaga.
