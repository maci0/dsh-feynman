# Port vs upstream audit: dsh-feynman against feynman.is docs

Source: live docs fetched 2026-09-13 (slash-commands, cli-commands, all 12
workflow pages, researcher/reviewer/writer/verifier, alphaxiv/web-search/
hugging-face/session-search/preview tools, configuration, package-stack).
Our side: `prompts.js`, `index.js`, `README.md` read in full.

Counts: upstream has **10 workflow slash commands + 10 session commands**.
Ours has **14 + 11**. The extras are `review-loop` (our invention),
`rank` + `paper` (CLI-only upstream), `preview` (conditional upstream —
legit), and `keys` (needed for key management — legit).

## Major divergences

**D1 — deepresearch skips the plan-approval gate. (upstream: deep-research page)**
Upstream: plan is written, *summarized, and the workflow waits for
confirmation before executing*. Ours (`prompts.js:33`): "continue into
execution without waiting for confirmation." One-sentence fix inside the
single followup turn: write plan, present summary, wait for approval.
Costs nothing structurally — the turn itself can hold the gate.

**D2 — rank covers ~20% of the PaperRank surface. (upstream: paper-rank page)**
Matched: ReadFirstScore weights (30/20/20/10/10/10 ✓), graph-prestige
exclusion when no local edges ✓, bibliometric/quality separation ✓,
sensitivity note ✓. Missing: `--limit`, `--expand-citations`,
`--full-text-top`, `--critique-top`, `--preference-file`,
`--reproduction-notes`, `--synthesize` flags (currently swallowed into the
topic string); artifacts `*-research-run.json`, `*-papers.jsonl`,
`*-scores.jsonl`, `*-score-audit.md`, `*-citation-graph.json`,
`*-graph-explorer.html`, `*-field-map.json`, `*-rank.provenance.md`, plus
optional critique/calibration/reproduction/synthesis outputs. The README's
"live heuristic" framing is honest; minimum step is parsing `--limit` and
documenting the rest as unsupported rather than silently absorbing flags.

**D3 — the AlphaXiv key has no access route. (upstream: alphaxiv tool page)**
Upstream ships a bundled client (`feynman alpha search/get/ask/code/
annotate`) plus an `alpha-research` skill; auth via `feynman alpha login`.
Our `KEY_PRELUDE` names the env ref and the arXiv/OpenAlex fallback, but
nowhere — prompt, handler, or README — says *how* the model calls AlphaXiv
with that key (no endpoint, no tool, no skill). Either document the route
or mark the key aspirational; today the model gets a key name with nothing
to unlock.

## Minor gaps (one line each)

- **review** omits the two named artifacts: plan at
  `outputs/.plans/<slug>-review-plan.md`, evidence at
  `outputs/.drafts/<slug>-review-evidence.md`. Ours says "record evidence
  notes" with no path — traceability the docs promise is lost.
- **Provenance sidecars missing**: deepresearch, recipe, and rank all write
  `*-provenance.md` upstream. One line per prompt restores it.
- **recipe** omits the plan-file step (`outputs/.plans/<slug>-recipe.md`,
  "then continues automatically").
- **replicate** omits the replicated-label criterion: "a result is labeled
  replicated only when the planned checks actually pass."
- **lit**: lab/PI mode omits the reachable-publication log written before
  delegated synthesis, and the ranking criteria beyond contrastive
  originality (methodology strength, relation to prior art). Biomedical
  compression is defensible (no DSH bio-tool suite), but PICO framing and
  the do-not-paste-PHI boundary are two cheap high-value lines.
- **audit** repo discovery is narrower than upstream (paper links + Papers
  With Code + GitHub search vs our arxiv.org/abs-links only).
- **autoresearch** omits `CHANGELOG.md` milestone entries (upstream
  monitoring triple: `autoresearch.md` + `.jsonl` + changelog).
- **watch** omits comparing each check against the baseline so new material
  is separable. (Our `schedule_create` mapping is CORRECT for DSH —
  verified against `packages/schedule/schedule/src/tools.ts:319`; upstream
  says `schedule_prompt` because it runs on Pi.)
- **paper** omits the artifact filenames (`<slug>-paper-access.md` + `.json`).
- **TOOL_PRELUDE** never names the four agent roles. Upstream prompts
  delegate to researcher/reviewer/writer/verifier explicitly (researcher
  used by 8 workflows; reviewer by review/audit/compare; writer by
  deepresearch/lit/draft/compare; verifier by deepresearch/audit/
  replicate/recipe). Naming them costs one clause and improves delegation
  fidelity — our audit prompt already does Pass-1-researcher/Pass-2-verifier.
- **HF compat**: upstream accepts `HF_TOKEN` *or* `HUGGINGFACE_HUB_TOKEN`.
  Ours defaults to `HF_TOKEN` only (reachable via row-config rename —
  document it).

## Verified correct mappings (keep)

- HF Hub tools (`hf_dataset_info`, `hf_repo_files`, `hf_repo_read_file`)
  → `web_fetch` against `huggingface.co/api` read-only. Right call;
  DSH has no such tools.
- `/search` → `sessionQuery` seam with `rg` fallback mirrors upstream's
  optional-package + `rg ~/.feynman/sessions` fallback exactly.
- `/preview` → pandoc via bash mirrors upstream's shell fallback; install
  hint replaces `feynman setup preview` (no DSH equivalent).
- Thinking levels identical (off/minimal/low/medium/high/xhigh/max ✓).
- Severity grades, confidence scores, "not external peer review",
  verified/unverified/blocked/inferred labels, paywall boundaries — all match.
- `/btw` via non-waking `inject` matches pi-btw semantics; `/init`,
  `/log`, `/jobs`, `/outputs` all faithful.

## Structural stubs (accepted, not bugs)

- `/feynman-model` and `/web-results` are guidance text where upstream is
  interactive (model picker; stored-results browser). DSH owns model routes
  and has no results store — nothing to call. Fine as-is.
- Bare `/feynman thinking` lists levels instead of showing the current one
  (upstream views current level). No seam exposes it; fine.
- `review-loop` has no upstream equivalent — a defensible DSH-native
  extension. Keep and say so in the README.
- `rank`/`paper` as slash commands are deliberate extensions (CLI-only
  upstream). Keep, but D2's flag support decides whether they overpromise.
