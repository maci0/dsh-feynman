# dsh-feynman

**Research workflow slash commands for DeepSeek Harness, as one out-of-tree bundle.**

Adapted from [Feynman](https://www.feynman.is/docs/reference/slash-commands) (see [attribution](#attribution-and-license)). "What are the current approaches to mechanistic interpretability?" → `/feynman deepresearch`, and a brief with inline citations lands in `outputs/`.

| Capability | Extension point | Effect |
|---|---|---|
| 14 workflow subcommands | one `/feynman` dispatcher | `deepresearch`, `lit`, `review`, `review-loop`, `audit`, `replicate`, `recipe`, `compare`, `draft`, `autoresearch`, `watch`, `rank`, `paper`, `preview` queue a workflow brief as the agent's next turn. |
| 11 session subcommands | one `/feynman` dispatcher | `log`, `jobs`, `help`, `feynman-model`, `init`, `outputs`, `btw`, `thinking`, `search`, `web-results`, `keys` reuse the in-box `jobs`, `sessionQuery`, and `credentials` seams with guidance-text fallback. |
| Review loop driver | `ctx.on('session/event')` | After each completed `turn/end`, `/feynman review-loop` queues the next fix→re-review round until rounds run out; `/feynman review-loop stop` ends it early. |
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
| `/feynman rank <topic> [--limit N]` | Transparent read-first paper ranking with per-paper score math (+ sensitivity note + provenance). `--limit` only — `--expand-citations`, `--full-text-top`, `--critique-top`, `--preference-file`, `--reproduction-notes`, `--synthesize` are rejected, not absorbed (see Limits) |
| `/feynman paper <id> [--fetch-full-text]` | Legal full-text access candidates, no paywall bypasses; writes `<slug>-paper-access.md` + `.json` |
| `/feynman preview [artifact]` | Pandoc render of a research artifact (HTML/PDF) |

Artifacts land under `outputs/` (`*-brief.md`, `*-lit-review.md`, `*-review.md`, `*-audit.md`, …); `/feynman outputs` lists them, `/feynman log` writes the session log.

## API keys (Hugging Face + AlphaXiv)

Three ways, in precedence order (environment shadows the store):

1. **Config UI** — the Research Keys card: password field per key, set/unset badge, Save, Clear.
2. **Shell** — `export HF_TOKEN=hf_… ALPHAXIV_API_KEY=…` before launch.
3. **Command** — `/feynman keys` shows status (values never echoed, input never logged); `/feynman keys set <hf|alphaxiv> <value>` stores into `$DSH_HOME/.credentials.yaml`.

Row config renames the refs only (defaults `HF_TOKEN` / `ALPHAXIV_API_KEY`); `HUGGINGFACE_HUB_TOKEN` works too — point the ref at it via row config. Invalid names fail at load.

The AlphaXiv key is spent via `web_fetch` against the AlphaXiv API (paper search, section-filtered content, Q&A, linked-repo code, annotations); without it the briefs fall back to arXiv + OpenAlex and mark citation-metadata/discussion checks blocked.

## Install

```sh
# straight from GitHub
dsh plugin --profile web add github:maci0/dsh-feynman
# or from a local checkout
dsh plugin --profile web add /path/to/dsh-feynman
```

That is the whole install. The package declares `dsh.bundle`, so `dsh plugin` adds it to the profile's `dsh.profile.bundles`, and the boot reads the plugin row from this package's own `cordis.patch.yml`. **Restart the profile**: a bundle list is composed at boot, so a running profile does not pick it up from a live patch reload.

Local overlay for development (no install; absolute path required):

```sh
pnpm dsh web --patch /path/to/dsh-feynman/cordis.local.yml
```

### Verify

After a restart of the profile and a **page refresh** of the Web client:

- `/feynman help` lists the 25 subcommands;
- `/feynman keys` reports both key states;
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
cordis.patch.yml  the bundle layer: the one plugin row the boot mounts
cordis.local.yml  dev overlay: same row with an absolute path, for --patch
commands.test.js  host tests (prompts + registration + handler results)
client.test.js    card tests (registration, ready-gating, badges, no literal leaks)
```

`lib/client.js` is plain JavaScript on purpose. The client module system serves a package's `exports["./client"]` artifact as a lazy-CJS factory registered on `window.__ModuleLoader__`; an out-of-tree plugin authors that directly instead of reproducing the repository's tsdown client preset. `react` is provided by the module system; nothing else is required.

## Development

```sh
npm install       # schemastery (settings namespace schema)
npm test          # node --test commands.test.js client.test.js (no build step)
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-feynman
```

then restart the profile. The same reconcile pass that added the package to `dsh.profile.bundles` drops it again, so there is no row left behind.

## Limits

- **A plugin source edit needs a profile restart.** The Loader imports plugin modules with ESM semantics, so a live patch reload re-runs `apply` from the module already in memory.
- **A browser-half edit needs a page refresh.** The client module system serves `exports["./client"]` from the package, so the host half can stay up.
- **Review-loop state is process-local.** Loop rounds live in a module-level map keyed by session id; a profile restart forgets them. Durable loop state arrives when it needs to survive restarts.
- **Ranking is a live heuristic.** `/rank` scores are computed transparently in-session and say so in the output; they are not a fitted model or a deterministic scorer. Only `--limit` is supported; the remaining PaperRank flags (`--expand-citations`, `--full-text-top`, `--critique-top`, `--preference-file`, `--reproduction-notes`, `--synthesize`) and their JSONL/graph-explorer/calibration artifacts are not ported — the handler rejects them instead of absorbing them into the topic.
- **One locale.** The card ships English copy; other active locales fall back to it.
- **No paywall bypasses, ever.** Unreachable sources are marked blocked, never inferred.

## Attribution and license

MIT. Workflow behavior adapted from [Feynman](https://www.feynman.is/docs) © Companion, Inc. — the prompts are original briefs written from the documented behavior (workflows, agents, tools, slash-commands, CLI references), not copied text. DSH port: see `LICENSE`.
