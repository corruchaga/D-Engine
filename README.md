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

## Token ceilings per call type

On metered tiers (for example Groq's free tier), the TPM quota is charged against the **declared** `max_tokens`, not the tokens actually produced — overshoot it and the request is rejected with HTTP 413. D-Engine's outputs are small by construction (selector ~5 completion tokens; proposer and audit 26–225 in measured runs), so every call declares its own ceiling instead of letting the provider assume a huge default:

| Call | Env var | Default | Emergency | Absolute max |
| --- | --- | --- | --- | --- |
| Selector (P9) | `D_ENGINE_MAX_TOKENS_SELECTOR` | 500 | 2000 | 4000 |
| Proposer | `D_ENGINE_MAX_TOKENS_PROPOSER` | 4096 | 16384 | 16384 |
| Semantic audit | `D_ENGINE_MAX_TOKENS_AUDIT` | 500 | 2000 | 2000 |

If the provider reports `finish_reason="length"`, the response is truncated and is never parsed as complete: that single call is retried once with the emergency ceiling (a visible warning), and the final summary counts it under `Escaladas por truncado`. If the emergency ceiling also truncates, the run fails with an explicit message. Garbage or non-positive values fall back to the default, and every value is clamped to its absolute max. Note that the emergency ceilings can exceed some providers' maximum output tokens (the provider would answer HTTP 400); in that case lower the absolute cap through the corresponding environment variable.

## Benchmark (headline)

10 frozen tasks, same model family, one attempt each, full methodology disclosed:

| Metric | D-Engine | Agentic loop (dsh, factory) |
| --- | --- | --- |
| Quality (max 50) | 48 | 48 |
| Avg tokens per task | ~2,100 (bounded) | ~93,000 (range 32K–214K) |
| Avg time per task | ~2.7 s | ~38 s |
| Broken commits on main | 0 | 1 (Aider, trap task) |

Tied quality, **14–42× fewer tokens**, a predictable bill, zero broken merges. The full benchmark — frozen prompts, voided rows, hallucination incident and all — ships in [docs/benchmark.en.md](docs/benchmark.en.md) ([español](docs/benchmark.md)).

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

The TUI asks for: change description, target file (empty Enter = automatic selector), safety mode (Fast / Verify / Shadow) and confirmation. The target file may not exist yet: it gets labeled NEW and the proposer creates it with a NEW FILE block. Fast merges after applying; Verify adds a semantic audit; Shadow never merges without permission.

`npm run typecheck` is equivalent to `tsc --noEmit`.

## Known limitations

- Fuzzy matching (0.85 threshold) is the weak link.
- The P9 file selector is not deterministic.
- Creates files but does not rename or delete them (planned for a later phase).

## Roadmap v0.3

- ~~New-file creation~~ (done)
- Retry loop with compiler feedback
- Mandatory Verify when a patch applied via fuzzy
- Time and tokens in the final summary

**License:** [MIT](LICENSE)