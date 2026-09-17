# dsh-feynman

A question lands mid-session: *what are the current approaches to mechanistic interpretability?* You type:

```
/feynman deepresearch "mechanistic interpretability"
```

The brief becomes the agent's next turn. A cited research document lands in `outputs/`. That is the whole trick — 27 subcommands that queue a workflow as the next turn instead of making you describe the workflow in prose.

Adapted from [Feynman](https://www.feynman.is/docs/reference/slash-commands) (see [licence](#licence)). Prompts are original briefs written from the documented behaviour, not copied text.

## What you get

- **14 research workflows** behind one `/feynman` dispatcher: deep research, literature review, severity-graded critique, a bounded review loop, paper-vs-code audit, replication plans, ML recipes, source comparison, drafting, autonomy loops, topic watching, PaperRank, full-text access, pandoc preview.
- **13 session commands** for the housekeeping around that work: logs, jobs, artifact listing, key status, session search, doctor.
- **A real review loop.** `/feynman review-loop` keeps iterating review → fix → re-review on its own, after every completed turn, until rounds run out. `/feynman review-loop stop` ends it early.
- **A subcommand picker.** Bare `/feynman` opens a popup; picking a row submits the completed `/feynman <sub> …` line, so nothing has to be memorised.
- **A Research Keys card** in Settings → Plugins → **Plugin configuration**. Hugging Face and AlphaXiv keys are stored through the credentials domain, never in settings.
- **Key-aware briefs.** Every workflow brief names the live credential refs and treats an unset one as blocked instead of guessing.

## Install

```sh
dsh plugin --profile web add github:maci0/dsh-feynman
dsh plugin --profile web update dsh-feynman   # refresh later
```

Then **restart `dsh web`**: bundle layers compose at boot.

The package declares `dsh.bundle`, so `dsh plugin add` appends it to `dsh.profile.bundles` and the shipped `cordis.patch.yml` applies as a layer. Do not also paste that row into the profile's own `cordis.patch.yml` — `insert` does not dedupe ids, so the plugin would mount twice.

Quick check after the restart: `/feynman doctor` reports key state, mounted seams, pandoc, and the config card.

## Commands

Every workflow subcommand queues its brief as the agent's next turn; the queued turn *is* the work.

| Command | What it produces |
|---|---|
| `/feynman deepresearch <topic>` | Research brief: Summary, Background, Key Findings, Open Questions, References, plus a provenance sidecar. Plan is confirmed before execution. |
| `/feynman lit <topic-or-lab>` | Literature review: consensus, disagreements, open questions, timeline. Lab/PI corpus mode keeps a reachable-publication log. |
| `/feynman review <arXiv-ID \| URL \| file>` | Severity-graded critique (critical/major/minor/nit) with confidence scores. Draft evidence under `outputs/.drafts/`. |
| `/feynman review-loop <artifact> [rounds]` | Bounded review → fix → re-review loop. Default 3 rounds, capped at 10. `stop` ends it early. DSH-native, no upstream equivalent. |
| `/feynman audit <repo> [--paper <id>]` | Paper-vs-code mismatch report with file paths and line numbers. Repo found via paper links, Papers With Code, GitHub search. |
| `/feynman replicate <paper-or-claim>` | Replication plan. Executes only after you pick an environment; a result is `replicated` only when the planned checks pass. |
| `/feynman recipe <task>` | Ranked implementable ML training recipes with dataset, method, and hyperparameter links. |
| `/feynman compare <topic-or-sources>` | Agreement/disagreement matrix across sources. |
| `/feynman draft <topic \| --from-session>` | Academic draft with inline citations. Unsupported claims become TODOs, never invented. |
| `/feynman autoresearch <idea>` | Bounded hypothesis → experiment → analysis → decision loop against a benchmark (log, JSONL, CHANGELOG milestones). |
| `/feynman watch <topic>` | Baseline survey plus a refresh plan. Each check compares against the baseline. |
| `/feynman rank <topic> [flags]` | PaperRank: run manifest, ranked brief, paper/score JSONL, score audit, citation graph + HTML explorer, field map, sensitivity data, provenance. |
| `/feynman paper <id> [--fetch-full-text] [--json]` | Legal full-text access candidates — no paywall bypasses. Writes `<slug>-paper-access.md` and `.json`. |
| `/feynman preview [artifact]` | Pandoc render of an artifact (HTML/PDF). |

Session subcommands: `log`, `jobs`, `help`, `feynman-model`, `init`, `outputs`, `btw`, `thinking`, `search`, `web-results`, `keys`, `doctor`, `status`.

`/feynman search <query>` runs a real full-text search over prior sessions and prints matching session ids with excerpts. The other seam-backed commands (`jobs`, `web-results`) degrade to an error or one line of guidance when their seam is not mounted — never to a success message claiming work happened.

Rank example:

```
/feynman rank "scaling laws" --limit 20 --json
/feynman rank "scaling laws" --expand-citations 2 --full-text-top 3 --critique-top 5
/feynman rank "scaling laws" --preference-file preferences.json --reproduction-notes notes.json --synthesize --synthesis-model provider/model
```

Unknown `--flags` are rejected, never absorbed into the topic.

## How a run works

Each subcommand queues a frozen user message — built with `createUserMessage`, branded with a plugin source so the harness does not mistake it for human typing — as the agent's next turn. The queued turn is the work.

Retrieval maps to `web_search` / `web_fetch` plus the workspace tools (`read`, `grep`, `glob`, `bash`); there are no separate paper or dataset tools. Broad work fans out through the `subagent` tool, narrow explainers stay lead-owned.

Artifacts land under `outputs/`: `*-brief.md`, `*-lit-review.md`, `*-review.md`, `*-audit.md`, and so on. `/feynman outputs` lists them; `/feynman log` writes the session log. Rank writes the full PaperRank set (`*-research-run.json`, `*-papers.jsonl`, `*-scores.jsonl`, `*-score-audit.md`, `*-citation-graph.json`, `*-graph-explorer.html`, `*-field-map.json`, `*-rank-sensitivity.json`, `*-rank.provenance.md`) plus critique, calibration, reproduction, and synthesis outputs when the matching flags are passed.

## Configure

Row config in the Loader entry:

| Field | Default | Meaning |
|---|---|---|
| `hfTokenEnv` | `HF_TOKEN` | Env-var name holding the Hugging Face key. |
| `alphaxivTokenEnv` | `ALPHAXIV_API_KEY` | Env-var name holding the AlphaXiv key. |
| `loopDefaultRounds` | `3` | Rounds `/feynman review-loop` runs when none are given. |
| `loopMaxRounds` | `10` | Upper bound for an explicit round count. |
| `rankLimitDefault` | `20` | `/feynman rank` papers when `--limit` is absent. |
| `rankLimitCap` | `100` | Upper bound for `--limit`. |

A deployment can widen the review loop or raise the rank limit without a code edit. Invalid values fail at load: refs must match `[A-Za-z_][A-Za-z0-9_]*`, bounds must be positive integers, and a default may not exceed its cap.

Keys, in precedence order (environment shadows the store):

1. **Config card** — password field per key, set/unset badge, Save, Clear.
2. **Shell** — `export HF_TOKEN=hf_… ALPHAXIV_API_KEY=…` before launch.
3. **Command** — `/feynman keys` shows status without echoing values; `/feynman keys set <hf|alphaxiv> <value>` stores into `$DSH_HOME/.credentials.yaml`.

`HUGGINGFACE_HUB_TOKEN` works too — point `hfTokenEnv` at it. The AlphaXiv key is spent through `web_fetch` against the AlphaXiv API; without it, briefs fall back to arXiv and OpenAlex and mark citation-metadata and discussion checks blocked.

## Limits

- **Review-loop state is instance-local.** Loops live in the `apply` closure, keyed by session id. A profile restart forgets them.
- **A browser-half edit needs a page refresh.** The client module system serves `exports["./client"]` from the package; the host half can stay up.
- **Host source edits remount only with `id: hmr` enabled** and this checkout in `config.root`. Without it, a live patch reload re-runs `apply` from the module already in memory.
- **Ranking is a live heuristic.** Scores are computed transparently in-session and the output says so. They are not a fitted model and not a deterministic scorer.
- **One locale.** The card ships English copy; other active locales fall back to it. The browser bundle exports only `apply` and `inject`, and registers one locale dictionary.
- **No paywall bypasses, ever.** Unreachable sources are marked blocked, never inferred.

## Development

Plain JavaScript, no build step. `index.js` is the host half, `prompts.js` is the pure workflow catalog (no harness imports), `lib/client.js` is the browser half.

```sh
npm test    # node --test commands.test.js client.test.js (Node ^22.19 || >=24)
```

Coverage: prompt construction, dispatcher registration for every subcommand, review-loop rounds through the agents registry, per-instance loop state, row-config bounds and their validation failures, session search against a fake seam, and the card's registration, ready-gating, and non-leaking of key literals.

For a one-shot boot without installing:

```sh
pnpm dsh web --patch /path/to/dsh-feynman/cordis.local.yml
```

## Licence

MIT. Workflow behaviour adapted from [Feynman](https://www.feynman.is/docs) © Companion, Inc. — prompts are original briefs. DSH port: see `LICENSE`.
