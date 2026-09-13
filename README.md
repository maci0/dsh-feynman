# dsh-feynman-commands

Feynman-style research workflow slash commands for DeepSeek Harness, as one out-of-tree bundle. Sources: [slash commands](https://www.feynman.is/docs/reference/slash-commands), [workflows](https://www.feynman.is/docs/workflows/deep-research), [agents](https://www.feynman.is/docs/agents/researcher), [tools](https://www.feynman.is/docs/tools/web-search), [CLI](https://www.feynman.is/docs/reference/cli-commands).

## Install

Local overlay (dev):

```sh
pnpm dsh web --patch /home/maci/Desktop/dsh-researcher/cordis.local.yml
```

Installable bundle (persists in a profile):

```sh
dsh plugin --profile <name> add ./dsh-researcher
```

## Commands

Research workflows (steer the model with Feynman's brief; retrieval maps to `web_search`/`web_fetch` + workspace tools — no separate AlphaXiv/Hub tools):

`/deepresearch` `/lit` `/review` `/audit` `/replicate` `/recipe` `/compare` `/draft` `/autoresearch` `/watch` `/rank` `/paper` `/preview`

Plus `/review-loop <artifact> [rounds]` — bounded review→fix→re-review driver (completed `turn/end` queues the next round; `/review-loop stop` ends it).

Session/utilities: `/log` `/jobs` `/help` `/feynman-model` `/init` `/outputs` `/btw` `/thinking` `/search` `/web-results` `/keys` — thin wrappers over in-box seams (`jobs`, `sessionQuery`, `credentials`) with guidance-text fallback.

## API keys (Hugging Face + AlphaXiv)

Settings → Plugins → **Plugin configuration** shows a **Research Keys** card with a password field per key, a set/unset badge, Save, and Clear. Key literals travel only through the credentials domain — the card learns just configured/writable booleans.

No browser at hand:

```sh
export HF_TOKEN=hf_… ALPHAXIV_API_KEY=…   # zero-click, before launch
```

`/keys` — status of both keys (values never echoed, input never logged); `/keys set <hf|alphaxiv> <value>` stores into the managed credentials file (`$DSH_HOME/.credentials.yaml`).

Row config in `cordis.patch.yml` renames the refs only (defaults `HF_TOKEN` / `ALPHAXIV_API_KEY`); invalid names fail at load. Every workflow brief tells the model which refs hold the keys and to treat unset ones as blocked.

## Test

```sh
node --test commands.test.js
```

## Files

- `index.js` — plugin (`feynman-commands`, injects `commands` only)
- `prompts.js` — pure workflow catalog (tested)
- `lib/client.js` — browser card (Research Keys, served via `./client`)
- `cordis.patch.yml` — bundle layer (package name; for `dsh plugin add`)
- `cordis.local.yml` — dev overlay (absolute path; for `--patch`)
