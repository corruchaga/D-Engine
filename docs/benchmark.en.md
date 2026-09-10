# D-Engine v0.1 Benchmark — toy repo (bench-repo)

**v0.1 round**: run in the `deepseek-chat` alias era → V4-Flash, non-thinking (August–early September 2026). **Document and annexes**: September 10, 2026.

**Model (v0.1)**: deepseek-chat (no extended reasoning / low) across ALL contenders

**Contenders**: OpenCode · Aider · D-Engine Fast · D-Engine Verify · dsh (2nd round, Sep 10, 2026, V4.1-Flash)

**Rules**: same literal prompt, one attempt per contender, reset to `benchmark-base` before each run (`git reset --hard benchmark-base` + `git clean -fd`), engine frozen during the benchmark

**Prompts**: FROZEN in this document since Sep 10, 2026 — each task carries its literal prompt in a code block. Every future run copies them verbatim. Prompts remain in the original Spanish: they are canonical and must not be altered. (See note 10: declared registry incident.)

**Current base**: tag `benchmark-base` → commit `afef8bd` (moved twice due to defective tasks, see incidents)

---

## T1 — formatDate DD/MM/YYYY in utils.ts

**Literal prompt (canonical — attested: same text in v0.1, dsh Sep 10 and v0.2.2 control):**

```javascript
En utils.ts, añade una función formatDate que reciba un Date y devuelva DD/MM/YYYY
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2102 | 156 | ~0.0002 | 2.5s | Yes | 5 | No |
| D-Engine Verify | 2103 + 396 | 187 + 1 | ~0.0002 | 4s | Yes (audit OK) | 5 (extra TypeError guard) | No |
| OpenCode | ~8898 ctx | — | 0.00 | 10s | Yes | 5 | No |
| Aider | 2.1k | 458 | ~0.0002 | 5s | Yes (auto-commit 8f7b96b) | 5 | Yes: `.gitignore` |
| dsh — V4.1-Flash, thinking ON, effort High (factory) | ~107K total (web UI) | — | n/a | 48.9s wall (28s per UI) | Yes | 5 (TypeError guard + padStart) | No |

*dsh row (Sep 10, 2026): 12 tool calls; tokens read from dsh web UI (session stats, no in/out breakdown); 48.9s measured with Stopwatch includes process startup. Factory headless config, no flags.*

## T2 — rename TAX_RATE → IVA_RATE (multi-file)

**Literal prompt (canonical — frozen Sep 10, 2026 per execution evidence, see note 10):**

```javascript
Renombra la constante TAX_RATE a IVA_RATE en todo el proyecto
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast (1st attempt, 1 file) | — (see log) | — | — | 2s | **Did not merge** — safe rejection (TS2305 in index.ts) | — | No |
| D-Engine Fast (2nd attempt, 2 files) | — (see log) | — | — | 2.5s | Yes | 5 | No |
| D-Engine Verify | 2849 + 743 | 295 + 1 | ~0.0003 | 4s | Yes (audit OK) | 5 | No |
| OpenCode | ~10003 ctx | — | 0.00 | 9s | Yes | 5 | No |
| Aider | — (see log) | — | — | 4s | **No** — committed broken master (TS2305) **with warning** and auto-commit included | 2 | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~43.9K total (web UI) | — | n/a | 19.0s wall (9s per UI) | Yes (tsc self-verified by the agent) | 5 (5 occurrences, 2 files; no unrequested renames) | No |

*dsh row T2 (Sep 10, 2026): 7 tool calls. Direct contrast with Aider's "front-page moment" on this same task: dsh verified with tsc inside its loop and merged nothing broken. Cost: 43.9K tok vs ~3.3K for D-Engine Fast v0.2 + P9 on the same task (~13×).*

## T3 — applyDiscount guard (>100 or negative)

*First round VOIDED (defective task: the guard already existed in the base). Rows below = valid round.*

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
En pricing.ts, haz que applyDiscount lance un error si el porcentaje es mayor de 100 o negativo
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1996 | 188 | ~0.0002 | 2s | Yes | 5 | No |
| D-Engine Verify | 1996 + 329 | 156 + 1 | ~0.0002 | 2.85s | Yes (audit OK) | 5 | No |
| OpenCode | ~8831 ctx | — | 0.00 | 8.1s | Yes | 5 | No |
| Aider | 2.1k | 364 | ~0.0002 | 5s | Yes (auto-commit eaf2d4b) | 5 | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~32.4K total (web UI) | — | n/a | 72.2s wall (6s per UI) | Yes | 5 (correct RangeError; propagates via calculateTotal) | No |

*dsh row T3 (Sep 10, 2026): only 3 tool calls. 66s wall/UI gap with no clear explanation (startup + API latency/queue) — both measures are reported in the article. dsh trend: 107K → 43.9K → 32.4K tok correlates with loop turns (12 → 7 → 3 tool calls), not with task difficulty.*

## T4 — JSDoc on all utils.ts functions

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
Documenta todas las funciones de utils.ts con JSDoc
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2079 | 677 | ~0.0002 | 4s | Yes | 5 (6/6 functions) | No |
| D-Engine Verify | 2079 + 983 | 662 + 1 | ~0.0003 | 4.5s | Yes (audit OK) | 5 (6/6) | No |
| OpenCode | ~9703 ctx | — | 0.00 | 19s | Yes | 5 (6/6) | No |
| Aider | 2.0k | 804 | ~0.0002 | 5s | Yes (auto-commit f953a42) | 5 (6/6) | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~103K total (web UI) | — | n/a | 32.0s wall (21s per UI) | Yes (tsc self-verified) | 5 (6/6 functions; @throws only where actually thrown; internal {@link}; declares not having run tests) | No |

*dsh row T4 (Sep 10, 2026): the mass-writing task (JSDoc ×6) spikes consumption to 103K tok — breaking the downward trend (107→44→32→**103**). Agentic loop cost depends on how much the model reads/writes, not on difficulty. D-Engine Fast on this same task: ~2.8K tok (~37× less).*

## T5 — addToCart without duplicate lines

*First round VOIDED (defective task: the base already incremented). Rows below = valid round (base `afef8bd`).*

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
En cart.ts, haz que addToCart incremente la cantidad si el producto ya está en el carrito, en vez de duplicar la línea
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2143 | 136 | ~0.0002 | 2s | Yes | 5 (dedup + stock against total) | No |
| D-Engine Verify | 2143 + 370 | 146 + 1 | ~0.0002 | 2.5s | Yes (audit OK) | 5 | No |
| OpenCode | ~9232 ctx | — | 0.00 | 13s | Yes | 5 | No |
| Aider | 2.1k | 474 | ~0.0002 | 4s | Yes (auto-commit e83dd8c) | 5 | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~32.5K total (web UI) | — | n/a | 14.6s wall (5s per UI) | Yes | 5 (dedup + stock against accumulated quantity — same solution as D-Engine in v0.1) | No |

*dsh row T5 (Sep 10, 2026): 3 tool calls. Another convergence sample: dsh reached the same solution (validate stock against accumulated `newQuantity`) as D-Engine Fast in August.*

## T6 — TRAP: discount-after-tax bug

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
En pricing.ts hay un bug: calculateTotal aplica el descuento después del IVA y debería aplicarlo antes. Arréglalo
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1998 | 145 | ~0.0002 | 2s | Yes | 5 | No |
| D-Engine Verify | 1998 + 350 | 145 + 35 | ~0.0002 | 2.5s | **Did not merge** — false rejection due to parsing bug (verbose `OK —`) | — | No |
| OpenCode | ~9115 ctx | — | 0.00 | 12s | Yes | 5 | No |
| Aider | 2.0k | 452 | ~0.0002 | 4s | Yes (auto-commit bc4d496) | 5 | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~32.3K total (web UI) | — | n/a | 35.4s wall (5s per UI) | Yes | 5 (minimal fix: discount on subtotal, tax after; reduce untouched) | No |

*dsh row T6 (Sep 10, 2026): 3 tool calls. The fix converges with v0.1's "textbook" solution (note 5). Wall/UI gap: 30 ghost seconds.*

## T7 — formatPrice with currency parameter (multi-file)

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
Haz que formatPrice acepte la moneda como parámetro con € por defecto, y actualiza pricing.ts para usarlo
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2863 | 428 | ~0.0003 | 3s | Yes | 5 (signature + 4 explicit uses) | No |
| D-Engine Verify | 2892 + 481 | 199 + 85 | ~0.0003 | 4s | Yes (accurate OK_CON_OBSERVACIONES) | 4 (unrequested EURO_SYMBOL rename; didn't touch index.ts) | No |
| OpenCode | ~9949 ctx | — | 0.00 | 10s | Yes | 5 (minimal and justified) | No |
| Aider | 2.2k | 1100 | ~0.0003 | 7s | Yes (auto-commit 60d85ec) | 4 (same unrequested rename) | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~73.6K total (web UI; 96% cache hit) | — | n/a | 24.6s wall (16s per UI) | Yes (tsc self-verified) | 4 (correct signature, EURO_SYMBOL intact, index.ts callers untouched; but adds formatTotal — unrequested new API, transparently declared) | No |

*dsh row T7 (Sep 10, 2026): 9 tool calls. The task has a mild spec defect (third one, after T3/T5): pricing.ts didn't call formatPrice, so "update pricing.ts to use it" forces inventing a usage point. dsh resolved it by declaring its interpretation and offering adjustment — exemplary behavior, scored 4 for consistency with the v0.1 rubric (unrequested changes = -1). Data point for the article: 96% DeepSeek cache hit — tokens ≠ real cost.*

## T8 — extract calculateTax

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
Extrae el cálculo del IVA a una función calculateTax en pricing.ts y reutilízala en calculateTotal
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1999 | 141 | ~0.0002 | 2s | Yes | 5 (nuance: double rounding in applyTax) | No |
| D-Engine Verify | 1999 + 428 | 167 + 1 | ~0.0002 | 3s | Yes (audit OK) | 5 (extra TypeError guard, consistent) | No |
| OpenCode | ~11591 ctx | — | 0.00 | 25.1s | Yes | 5 (byte-identical to Fast) | No |
| Aider | 2.0k | 410 | ~0.0002 | 3.5s | Yes (auto-commit 38fa465) | 5 (byte-identical too) | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~113K total (web UI) — round maximum | — | n/a | 29.2s wall (21s per UI) | Yes (tsc + real execution: identical output €243.27) | 5 (calculateTax extracted and reused; preserves the base's discount/tax order — correct, T8 didn't ask to fix it; declares duplication with taxAmount and unused applyTax) | No |

*dsh row T8 (Sep 10, 2026): 11 tool calls. Verification level above any v0.1 contender: it compiled AND ran the program to confirm identical output. It detected that taxAmount already had the same body and that applyTax was left with no consumers, and reported it as out of scope without touching the public API — exemplary scope discipline. The cost of so much diligence: 113K tok (~53× D-Engine Fast v0.1, which made the same byte-equivalent change for 2.1K tok).*

## T9 — TRAP: "optimize" calculateTotal with reduce (already uses reduce)

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text):**

```javascript
Optimiza calculateTotal usando Array.reduce manteniendo el redondeo a 2 decimales correcto
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 1993 | 148 | ~0.0002 | 2.5s | Yes | 4 (rounding intact; cosmetic "optimization") | No |
| D-Engine Verify | 1993 + 352 | 151 + 86 | ~0.0002 | 4.5s | Yes (OK_CON_OBSERVACIONES caught the cosmetic change) | 4 | No |
| OpenCode | ~10490 ctx | — | 0.00 | 24.7s | Yes | 4 (only one to admit "already used reduce") | No |
| Aider | 2.0k | 503 | ~0.0002 | 5s | Yes (auto-commit db851c8) | 4 (byte-identical to Fast) | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~214K total (web UI) — absolute round maximum | — | n/a | 60.1s wall (49s per UI) | Yes | 4 (admits "already used reduce" — like OpenCode in v0.1; but cosmetic compaction in calculateTotal + UNREQUESTED round2 fix in utils.ts that changes the whole system's rounding (1.005: 1.00→1.01); **confirmed hallucination**: reported products.ts corrupted ("line 16: ndProduct") and the file is healthy — findProduct intact, tsc clean) | **Yes: utils.ts** |

*dsh row T9 (Sep 10, 2026): 20 tool calls — the trap produces the most complex behavior of the round. The exemplary part: it admitted the trap ("already used reduce") and found a real binary-rounding bug in round2 (1.005*100 = 100.49999… → Math.round drops to 1.00). The debatable part: the prompt asked to keep "the correct rounding" and dsh interpreted it as license to CHANGE the whole system's rounding (fix with toPrecision(15)) — the ideal trap answer was to report the finding, not apply it; and it reported products.ts corrupted ("line 16: ndProduct, missing fi; breaks compilation of the entire project") while tsc was passing — **confirmed hallucination**: verified with Test-Path + type, the file is intact. First documented dsh hallucination in the benchmark (with line-level false evidence and self-contradiction in the same message). Pending: review the Trajectory tab to distinguish model hallucination vs tool-read bug. Documentary nod: same filename as D-Engine v0.2's "phantom products.ts" (pure coincidence, different systems). First dsh row with files outside the target. Cost of unleashed diligence: 214K tok — **100× D-Engine Fast** on the same task (2.1K), and 6.6× variance across dsh tasks (32K–214K).*

## T10 — coupon system with expiry

**Literal prompt (canonical — frozen Sep 10, 2026, original spec text; deliberately not naming a file):**

```javascript
Añade un sistema de cupones: tipo Coupon con código, porcentaje y fecha de expiración, y una función applyCoupon que valide la fecha antes de aplicar
```

| Contender | Tokens in | Tokens out | Cost € | Time | Compiles 1st? | Meets 1-5 | Extra files? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-Engine Fast | 2049 | 268 | ~0.0002 | 3.5s | Yes | 5 (injectable now — testable) | No |
| D-Engine Verify | 2049 + 512 | 226 + 1 | ~0.0003 | 4s | Yes (audit OK) | 5 | No |
| OpenCode | ~9101 ctx | — | 0.00 | 16.5s | Yes | 5 | No |
| Aider | 2.1k | 591 | ~0.0002 | 6s | Yes (auto-commit 469bc9e) | 5 (extra percentage validation) | Yes: `.gitignore` |
| dsh (V4.1-Flash, factory) | ~179K total (web UI) | — | n/a | 46.8s wall (39s per UI) | Yes (tsc + executed demo + 23 edge-case suite written, run and deleted) | 5 (Coupon + applyCoupon with injectable now; calendar day, local time, rejection of invalid/NaN dates, JS overflow, validation order; detected the base's applyDiscount 0-100 gap and did NOT touch it) | No (created src/coupons.ts — the deliverable itself — and integrated the demo in index.ts) |

*dsh row T10 (Sep 10, 2026): 19 tool calls, planning with task list (4 completed). The most complete implementation in the benchmark's history on this task — including new-file creation, which D-Engine v0.1 lacked (limitation 8). Coherence bonus: it re-discovered the base's applyDiscount gap that T3 asked to fix, and reported it without touching it.*

---

## Global results (v0.1 + full dsh round Sep 10, 2026)

**Total compliance (max 50):**

| Contender | Points | Incidents |
| --- | --- | --- |
| OpenCode | 49/50 | 4 on T9 |
| D-Engine Fast | 48/50 | 4 on T9; safe rejection in T3 1st round (defective task) |
| dsh (V4.1-Flash, factory) | 48/50 | 4 on T7 (unrequested formatTotal), 4 on T9 (unrequested round2 fix); **confirmed products.ts hallucination on T9** (asked permission, didn't touch); compiles 10/10 with self-verification |
| Aider | 47/50 | 4 on T7, 4 on T9; **broken master committed on T2** |
| D-Engine Verify | 46/50 | 4 on T7, 4 on T9; false rejection on T6 (parsing bug) |

**Tokens per task (approx. average):** Fast ~2,100 · Verify ~2,600 · Aider ~2,100 · OpenCode ~9,700 (4-5× Fast) · **dsh ~93,000 (range 32K–214K; ~44× Fast; round total ~931K vs ~21K for Fast)**

**Average time per task:** Fast ~2.7s · Verify ~3.7s · Aider ~4.9s · OpenCode ~14.9s · **dsh ~38s wall (~20s per its UI; the gap between both measures is erratic: 9-66 ghost seconds)**

**Extra files:** D-Engine and OpenCode: none. Aider: `.gitignore` in all 10 tasks (its own config). dsh: `utils.ts` on T9 (unrequested round2 fix); on T10 it created `coupons.ts` (deliverable) and integrated `index.ts` (demo).

**Reading of the dsh round:** the benchmark's highest quality (diligence, self-verification with tsc and real execution, scope transparency, ad-hoc testing) at unpredictable cost (6.6× variance across tasks). The thesis is not "agents fail" — it's that **the agent decides how much you spend and when it goes out of scope; the deterministic pipeline doesn't**.

---

## Notes and incidents

1. **Defective tasks caught live (T3 and T5)**: the bench-repo, generated by OpenCode, already included guards the tasks asked to add. OpenCode detected it and reported honestly ("already implemented"); D-Engine, forced by its contract to produce SEARCH/REPLACE blocks, generated garbage patches that the compile gate rejected (TS1128 via fuzzy). Lesson: audit the base before benchmarking. Base corrected and `benchmark-base` tag moved twice (cf50c3c → afef8bd). Voided rows preserved as evidence.
2. **T2, front-page moment**: Aider warned it didn't have all the files in the chat ("I don't have them in the chat. Let me know if you want me to review them")… and **auto-committed a master that doesn't compile anyway** (TS2305). Without a compile gate, the AI breaks and consolidates.
3. **T6, Verify false negative**: the auditor APPROVED the correct fix but replied `OK — explanation` (verbose); the parser only accepts exact `OK` / `OK_CON_OBSERVACIONES:` / `FALLO:` and treated it as FALLO. The system fails safe (master intact). **Critical v0.2 fix**: accept prefixes or re-ask on unknown format.
4. **T9, the auditor shows judgment**: faced with a cosmetic change (reduce already existed), the auditor answered OK_CON_OBSERVACIONES noting "no evidence of additional optimization". The semantic audit is not a rubber stamp.
5. **Model convergence**: on T6, T8 and T9, three contenders produced byte-identical files (same hash). With the same model, the "textbook" solution converges — what differentiates the tools is the mechanism around the model.
6. **Verify audit cost**: between 330 and 984 tokens per task (+15-30% over the proposal). Almost-free semantic safety.
7. **Fuzzy is the weak link**: the only patch that broke syntax in the entire benchmark came via fuzzy (T3, 1st round). v0.2 candidate: retry once with the compile error as feedback, or require Verify when the patch only applies via fuzzy.
8. **Documented limitation**: D-Engine v0.1 requires explicit file scope (P9 automatic selector planned for v0.2; T2/T7/T10 will be re-run). It also cannot create new files (the TUI validates existence).
9. **Post-benchmark known issue**: `commitAndMerge` does `git add -A` in the shadow copy — it would drag untracked files if any existed (it happened with node_modules in a previous session). Pending fix: stage only files touched by the patch.
10. **Prompt registry — methodological incident (declared Sep 10, 2026)**: the literal prompts typed in the v0.1 round were not preserved. Earlier versions of this document only stored summary headers per task, and the Aider/OpenCode histories didn't survive on disk (`.aider*` wasn't in `.gitignore` and the `git clean -fd` wipes removed it; OpenCode keeps no locatable JSONs). The **original specs** of the 10 tasks were recovered from the design conversation (August 2026). Declared consequences:

    - v0.1 rows ran on **paraphrases** of those specs; the exact text is only attested for **T1** (reused verbatim on Sep 10 in the dsh round and in the v0.2.2 control, making it the cross-era comparability anchor).
    - **T2** is frozen as «Renombra la constante TAX_RATE a IVA_RATE **en todo el proyecto**» per execution evidence (post-run verification on `pricing.ts` + `index.ts` in the PowerShell history; v0.2 annex "'en todo el proyecto' prompt"), although the original spec said «en pricing.ts».
    - **T3–T10** are frozen with the exact text of the recovered design spec.
    - Since Sep 10, 2026 every run uses the canonical prompt copied verbatim from this document. This note appears in the article's limitations section.

11. **dsh hallucinates a corruption (T9, Sep 10, 2026 round)**: dsh reported `src/products.ts` corrupted ("line 16: `ndProduct`, missing `fi`; breaks compilation of the entire project") and offered to fix it. Manual verification: the file is intact and `tsc` passes. The line-level evidence was invented and the message itself was contradictory (it also claimed "verified with tsc, no errors"). Safe conduct (it asked permission before touching anything), but a user who had said "yes, fix it" would have introduced a change motivated by a false fact. Architectural contrast: D-Engine cannot report false repo state because it doesn't hold opinions about files — it reads them, patches and compiles deterministically; system truth comes from `tsc`, not from the model.

## v0.2 Annex — fixes + P9 (automatic file selector)

Fixes applied after the benchmark: (1) prefix-based auditor parser (case-insensitive), (2) git add only patched files + hardened porcelain guard, (3) single retry with tsc feedback, (4) P9: empty Enter = automatic selector with user confirmation.

| Task | Contender | Tokens in | Tokens out | Result |
| --- | --- | --- | --- | --- |
| T6 discount/tax bug | Verify v0.2 | 1998 + 350 | 145 + 41 | ✅ Merged — verbose auditor (41 tok) accepted by the new parser. FIX 1 validated. |
| T2 rename ("en todo el proyecto" prompt) | Fast v0.2 + P9 | 264 + 2762 | 11 + 295 | ✅ 5/5 — selector picked pricing.ts + index.ts alone. The "explicit scope" limitation solved. |
| T7 formatPrice (run A) | Fast v0.2 + P9 | 289 + 4453 | 23 + 406 | 🛡️ Over-selection (5 files); a phantom products.ts appeared and the porcelain guard (FIX 2) aborted the merge. Master intact. |
| T7 formatPrice (run B) | Fast v0.2 + P9 | 270 + 2086 | 5 + 151 | ✅ 4/5 — under-selection (utils.ts only); compiles and works, uses not updated. |
| T10 coupons (no file named) | Fast v0.2 + P9 | 324 + 2822 | 11 + 226 | ✅ 5/5 — selector picked pricing.ts + index.ts; the proposer only touched pricing.ts. Wide scope, precise scalpel. |

P9 findings: the selector is NOT deterministic (same prompt, 3 different scopes); scope variance translates into result variance, but the architecture absorbs it safely. Selector cost: 264-324 tokens per run.

Pending v0.2.1: selector prompt asking for "minimum necessary set"; log the offending file diff when the guard fires; the guard should present itself as a controlled rejection, not "Unexpected error"; investigate the phantom products.ts (not reproduced).

| T7 formatPrice (run C, v0.2.1) | Fast v0.2.1 + P9 | 336 + 3975 | 22 + 213 | ✅ 4/5 — selector asked for 4 files ("minimum set" instruction improves but doesn't eliminate variance); proposer only touched utils.ts; NO phantom (FIX D validated); uses not updated. |

v0.2.1 note: the porcelain guard now logs the offending diff before destroying the shadow copy and presents itself as a controlled rejection ("The gate rejected the change: ...") instead of "Unexpected error". Root cause of the phantom products.ts identified and fixed: ensureDemoFile copied all targets to the worktree before patching.

### T1 control run — D-Engine v0.2.2 (Sep 10, 2026)

Context: DeepSeek retires V4-Flash and the deepseek-chat alias. Every row
run from today onwards runs on V4.1-Flash. D-Engine updated:
.env → deepseek-flash + thinking disabled (preserves the effective config
of the v0.1 era: non-thinking). Commit 9b3739f.
T1 result: 2,552 tokens (selector 314 + proposal 2,238), 2 LLM calls,
normalize-newlines match, compiles, only src/utils.ts (+7 lines).
Same-model comparison (V4.1-Flash): D-Engine 2,552 tok vs dsh 107,000
tok → 42× less. The token gap is architectural, not model-driven.
Note: v0.2.2 includes the P9 selector (314 tok), absent in v0.1 — it does
not affect the conclusion.
Time: ~4s machine time (operator estimate, consistent with v0.1:
Fast T1 = 2.5s without selector). Total wall-clock measured with Stopwatch
in a rerun was 85.9s — it includes the human confirmation of the P9
selector in the TUI, a component headless dsh doesn't have; the honest
comparison is machine time: ~4s vs 48.9s. Exact measurement pending v0.3
(print time and tokens in the TUI final summary).

### dsh T1 control — effort Off (Sep 10, 2026) — COMPLETED

Goal: non-thinking replica of the v0.1 era's effective config, to
bulletproof the thesis against the "the gap is just effort/thinking"
critique. Run from dsh's web UI (effort → Off) with T1's canonical prompt
and reset to benchmark-base.

Result: **37.1K tok, 6s (UI), 3 tool calls**, same 5/5 solution
(formatDate with TypeError guard + padStart — converges with
D-Engine and with dsh-High itself).

T1 gap decomposition (same V4.1-Flash model, same literal prompt, same task):

| Config | Tokens | vs D-Engine |
| --- | --- | --- |
| D-Engine v0.2.2 (thinking off) | 2,552 | 1× |
| dsh Minimal (single shell, thinking High) | ~34,600 | 13.6× |
| dsh Off (Standard, thinking off) | ~37,100 | **14.5×** ← pure architectural overhead |
| dsh High (Standard, thinking on, factory) | ~107,000 | 42× |

Conclusion: thinking AMPLIFIES the gap (~2.9× more tokens and 4× more
loop turns: 12 vs 3 tool calls) but does NOT explain it. With an identical
model and reasoning off, the agentic loop still burns 14.5×
more tokens than the deterministic pipeline to produce the same diff.
The gap is architectural. Thesis bulletproofed.

### dsh T1 control — Minimal mode (Sep 10, 2026)

Goal: close the objection "benchmark in Standard, the fat mode".
Minimal = ONE-tool agent (persistent shell); it's the mode
DeepSeek used in its official benchmarks (Jul 31, 2026 changelog).

Result: **34.6K tok, 1m04s, 11 tool calls** (all Pwsh: Get-ChildItem,
Get-Content ×4, Add-Content for the edit, verification re-read,
npm run build + executed example). Correct solution (no
TypeError guard this time — quality variance between configs of the same model).

Finding that crowns the benchmark: **Minimal ≈ Standard-Off (34.6K vs
37.1K)**. Shrinking the toolbox does NOT reduce tokens: the cost
is not in the schemas or the arsenal, it's in the LOOP — every turn
re-sends system prompt + full trajectory. With a single primitive
tool the agent needs even MORE turns (11 vs 3) to do the
same thing, and takes longer (1m04s, the slowest T1). Neither toolbox nor thinking
explains the gap: the agentic loop's structure is the cost. D-Engine
eliminates it by construction (2 calls, fixed cost).
