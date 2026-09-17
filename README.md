# dsh-feynman

**Research workflow slash commands for DeepSeek Harness.**

Adapted from [Feynman](https://www.feynman.is/docs/reference/slash-commands) (see [attribution](#attribution-and-license)). "What are the current approaches to mechanistic interpretability?" → `/feynman deepresearch`, and a brief with inline citations lands in `outputs/`.

| Capability | Extension point | Effect |
|---|---|---|
| 14 workflow subcommands | one `/feynman` dispatcher | `deepresearch`, `lit`, `review`, `review-loop`, `audit`, `replicate`, `recipe`, `compare`, `draft`, `autoresearch`, `watch`, `rank`, `paper`, `preview` queue a workflow brief as the agent's next turn. |
| 13 session subcommands | one `/feynman` dispatcher | `log`, `jobs`, `help`, `feynman-model`, `init`, `outputs`, `btw`, `thinking`, `search`, `web-results`, `keys`, `doctor`, `status` reuse the in-box `jobs`, `sessionQuery`, and `credentials` seams. `/feynman search <query>` runs the full-text query and returns its hits; the other seam-backed commands fall back to guidance text. |
| Review loop driver | `ctx.on('session/event')` | After each completed `turn/end`, `/feynman review-loop` queues the next fix→re-review round until rounds run out; `/feynman review-loop stop` ends it early. |
| Subcommand picker | `commandUi.decorate('feynman')` | Bare `/feynman` (menu pick or enter) opens a subcommand popup; a pick submits the completed `/feynman <sub>` line, so every subcommand is completable from the `/` menu. |
| Research Keys card | `settings.plugin.item` slot + `research-keys` settings namespace | A **Research Keys** card in Settings → Plugins → **Plugin configuration** saves the Hugging Face and AlphaXiv keys through the credentials domain — key literals never touch settings. |
| Key-aware briefs | `buildPrompt()` | Every workflow brief names the live key refs and tells the model to treat unset ones as blocked. |

## Workflows

Each subcommand queues its brief as the agent's next turn; the followup IS the work. Retrieval maps to `web_search`/`web_fetch` plus workspace tools (`read`, `grep`, `glob`, `bash`) — there are no separate paper or dataset tools. Broad work fans out through the `subagent` tool; narrow explainers stay lead-owned.

| Command | Produces |
|---|---|
| `/feynman deepresearch <topic>` | Research brief: Summary, Background, Key Findings, Open Questions, References (+ provenance sidecar). Plan is summarized and confirmed before execution |
| `/feynman lit <topic-or-lab>` | Literature review: Consensus, Disagreements, Open Questions, Timeline (or lab/PI corpus mode with reachable-publication log) |
| `/feynman review <artifact>` | Severity-graded critique (critical/major/minor/nit) with confidence scores; evidence notes under `outputs/.drafts/` |
| `/feynman review-loop <artifact> [rounds]` | Bounded review→fix→re-review loop, default 3 rounds, max 10 (a DSH-native extension — no upstream equivalent) |
| `/feynman audit <repo> [--paper <id>]` | Paper-vs-code mismatch report with file paths and line numbers (repo found via paper links, Papers With Code, GitHub search) |
| `/feynman replicate <paper-or-claim>` | Replication plan; executes only after you pick an environment; a result is `replicated` only when the planned checks pass |
| `/feynman recipe <task>` | Ranked implementable ML training recipes with dataset/method/hyperparameter links (+ provenance sidecar) |
| `/feynman compare <topic-or-sources>` | Agreement/disagreement matrix across sources |
| `/feynman draft <topic \| --from-session>` | Academic draft with inline citations; unsupported claims become TODOs, never invented |
| `/feynman autoresearch <idea>` | Bounded hypothesis→experiment→analysis→decision loop against a benchmark (log + JSONL + CHANGELOG milestones) |
| `/feynman watch <topic>` | Baseline survey plus a refresh plan (`schedule_create` when mounted); each check compares against the baseline |
| `/feynman rank <topic> [flags]` | Full PaperRank port: run manifest, ranked brief, paper/score JSONL, score audit, citation graph + HTML explorer, field map, sensitivity data, provenance — plus critique, calibration, reproduction, and synthesis artifacts when the matching flags are passed |
| `/feynman paper <id> [--fetch-full-text] [--json]` | Legal full-text access candidates, no paywall bypasses; writes `<slug>-paper-access.md` + `.json` |
| `/feynman preview [artifact]` | Pandoc render of a research artifact (HTML/PDF) |

```
/feynman rank "scaling laws" --limit 20 --json
/feynman rank "scaling laws" --expand-citations 2 --full-text-top 3 --critique-top 5
/feynman rank "scaling laws" --preference-file preferences.json --reproduction-notes notes.json --synthesize --synthesis-model provider/model --output-dir outputs
```

Artifacts land under `outputs/` (`*-brief.md`, `*-lit-review.md`, `*-review.md`, `*-audit.md`, …); `/feynman outputs` lists them, `/feynman log` writes the session log. Rank writes the full PaperRank set (`*-research-run.json`, `*-papers.jsonl`, `*-scores.jsonl`, `*-score-audit.md`, `*-citation-graph.json`, `*-graph-explorer.html`, `*-field-map.json`, `*-rank-sensitivity.json`, `*-rank.provenance.md`, plus critique/calibration/reproduction/synthesis outputs when flagged).

## API keys (Hugging Face + AlphaXiv)

Three ways, in precedence order (environment shadows the store):

1. **Config UI** — the Research Keys card: password field per key, set/unset badge, Save, Clear.
2. **Shell** — `export HF_TOKEN=hf_… ALPHAXIV_API_KEY=…` before launch.
3. **Command** — `/feynman keys` shows status (values never echoed, input never logged); `/feynman keys set <hf|alphaxiv> <value>` stores into `$DSH_HOME/.credentials.yaml`.

Row config renames the refs only (defaults `HF_TOKEN` / `ALPHAXIV_API_KEY`); `HUGGINGFACE_HUB_TOKEN` works too — point the ref at it via row config. Invalid names fail at load.

Row config also carries the loop and rank bounds: `loopDefaultRounds` (3), `loopMaxRounds` (10), `rankLimitDefault` (20), `rankLimitCap` (100). A deployment can widen the review loop or raise `--limit` without a code edit; invalid values fail at load.

The AlphaXiv key is spent via `web_fetch` against the AlphaXiv API (paper search, section-filtered content, Q&A, linked-repo code, annotations); without it the briefs fall back to arXiv + OpenAlex and mark citation-metadata/discussion checks blocked.

## Install

```sh
dsh plugin --profile web add /path/to/dsh-feynman
```

The package declares `dsh.bundle`, so `dsh plugin add` appends it to `dsh.profile.bundles` and the shipped `cordis.patch.yml` applies as a layer. Nothing to paste by hand:

```yaml
- insert:
    - id: feynman
      name: dsh-feynman
      config:
        hfTokenEnv: HF_TOKEN
        alphaxivTokenEnv: ALPHAXIV_API_KEY
```

Saving a profile patch remounts the plugin. No profile restart. `dsh.profile.bundles` is frozen at boot — do not also paste that row into the profile's own `cordis.patch.yml`, or `insert` will register it twice.

Local overlay for a one-shot boot (absolute path required):

```sh
pnpm dsh web --patch /path/to/dsh-feynman/cordis.local.yml
```

### Verify

After the profile patch save (and a **page refresh** of the Web client the first time):

- `/feynman help` lists the 27 subcommands;
- `/feynman keys` reports both key states;
- `/feynman doctor` reports key state, mounted seams, pandoc, and the card;
- Settings → Plugins → **Plugin configuration** shows the Research Keys card;
- `/feynman deepresearch <topic>` queues a brief and writes `outputs/<slug>-brief.md`.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `hfTokenEnv` | `HF_TOKEN` | Env-var name holding the Hugging Face key. Must match `[A-Za-z_][A-Za-z0-9_]*`. |
| `alphaxivTokenEnv` | `ALPHAXIV_API_KEY` | Env-var name holding the AlphaXiv key. Same grammar. |

Invalid configuration fails while the plugin loads rather than silently pointing at nothing.

## Layout

```
index.js          host plugin: /feynman dispatcher, review-loop driver, research-keys namespace
prompts.js        pure workflow catalog (no harness imports; unit-tested with plain node)
lib/client.js     browser half: the Research Keys card (loader factory format)
cordis.patch.yml  the bundle layer: the Loader row applied when a profile lists this bundle
cordis.local.yml  dev overlay: same row with an absolute path, for --patch
commands.test.js  host tests (prompts + registration + handler results)
client.test.js    card tests (registration, ready-gating, badges, no literal leaks)
```

`lib/client.js` is plain JavaScript on purpose. The client module system serves a package's `exports["./client"]` artifact as a lazy-CJS factory registered on `window.__ModuleLoader__`; an out-of-tree plugin authors that directly instead of reproducing the repository's tsdown client preset. `react` is provided by the module system; nothing else is required.

## Development

```sh
npm test          # node --test commands.test.js client.test.js (Node ^22.19 || >=24, no build step)
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-feynman
```

and delete the `id: feynman` row from `~/.dsh/profiles/<profile>/cordis.patch.yml`. Saving unmounts it.

## Limits

- **Host source edits remount when `id: hmr` is enabled** with this checkout in `config.root`. Without that, a live patch reload re-runs `apply` from the ESM module already in memory.
- **A browser-half edit needs a page refresh.** The client module system serves `exports["./client"]` from the package, so the host half can stay up.
- **Review-loop state is instance-local.** Loop rounds live in the `apply` closure, keyed by session id; a profile restart forgets them. Durable loop state arrives when it needs to survive restarts.
- **Ranking is a live heuristic.** `/rank` scores are computed transparently in-session and say so in the output; they are not a fitted model or a deterministic scorer. Unknown `--flags` are rejected instead of absorbed into the topic.
- **One locale.** The card ships English copy; other active locales fall back to it.
- **No paywall bypasses, ever.** Unreachable sources are marked blocked, never inferred.

## Attribution and license

MIT. Workflow behavior adapted from [Feynman](https://www.feynman.is/docs) © Companion, Inc. — the prompts are original briefs written from the documented behavior (workflows, agents, tools, slash-commands, CLI references), not copied text. DSH port: see `LICENSE`.
