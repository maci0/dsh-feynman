# Audit: dsh-researcher (own codebase)

Auditor's note: the invoked `/research audit` brief targets paper-vs-code comparison, which does not fit — there is no paper here. What follows is the same two-pass discipline applied to the correct artifact: **Pass 1 extracts concrete claims from the README** (each tagged with its location); **Pass 2 verifies each claim against the implementation** (each with file path and line number). Reproducibility risks become maintenance risks. Unverifiable items are marked blocked, not inferred.

## Match Summary

33 concrete claims extracted from `README.md`. **31 confirmed, 2 mismatches found and fixed** (both stale user-visible strings naming commands that no longer exist after the v0.3.0 dispatcher change). 1 item blocked (live card rendering needs the browser; verified to the serving boundary instead).

## Confirmed Claims

- 14 workflow + 11 session subcommands (`README.md:9-10`) — `prompts.js` exports exactly those keys, verified at runtime (`Object.keys(WORKFLOWS)` = 14, `SESSION_COMMANDS` = 11). `index.js:4-8`.
- Single `/research` dispatcher, no generic top-level names (`README.md:9-10`) — `apply()` registers exactly one command (`index.js:305-312`); the all-subcommand test asserts `registered.length === 1`.
- Review-loop driver on completed `turn/end`, `/research review-loop stop` (`README.md:11`) — `index.js:313-322`; live-probed: aborted turns ignored, exactly N followups for N rounds, stop-with-empty correct.
- Research Keys card via `settings.plugin.item` + `research-keys` namespace (`README.md:12`) — `lib/client.js:259-262`, `index.js:275-285`; namespace registration proven against a fake settings service in tests.
- Key literals never touch settings (`README.md:12`) — card writes only via `remote.credentials.set/unset` (`lib/client.js:138,149` after credRef fix); settings holds only refs.
- Every brief names live key refs, unset = blocked (`README.md:13`) — `buildPrompt()` appends `KEY_PRELUDE` with live refs (`prompts.js:121-123`); asserted in tests.
- Retrieval mapping: `web_search`/`web_fetch` + read/grep/glob/bash, `subagent` fan-out (`README.md:17`) — verbatim in `TOOL_PRELUDE` (`prompts.js:27`); every prompt asserts tool grounding in tests.
- All 14 workflow rows incl. `schedule_create` gating, heuristic rank caveat, no-bypass paper access, pandoc preview (`README.md:21-34`) — each verified in its prompt builder (`prompts.js:32-118`).
- Artifacts under `outputs/`; `/research outputs` lists, `/research log` writes (`README.md:36`) — `outputsHandler`/`logHandler` queue model turns (`index.js:198-241`); `outputs/.plans`, `outputs/.drafts` created this audit.
- Three key paths, env-shadows-store precedence (`README.md:40-44`) — live-probed: `HF_TOKEN=x` in env reports `set (environment)`; `/research keys set` writes via `credentials.set`; `recordInput: false` on the dispatcher (`index.js:310`) keeps literals out of the log.
- Row config renames refs only, invalid fails at load (`README.md:46,81`) — `normalizeConfig` throws on non-`[A-Za-z_][A-Za-z0-9_]*` (`index.js:47-58`); live-probed throw on `'bad name'`.
- Install via `dsh.bundle` + profile bundles, restart required (`README.md:57`) — `package.json:29-33` declares the bundle; composed layer confirmed via `dsh --profile web --dump-config`.
- Config table defaults `HF_TOKEN` / `ALPHAXIV_API_KEY` (`README.md:78-79`) — match `cordis.patch.yml:7-8` and `ResearchKeys` schema defaults (`index.js:24-27`).
- `npm test` runs both suites with no build (`README.md:101`) — `package.json:22-24`; 10/10 green.
- Uninstall drops the bundle row (`README.md:107`) — standard `dsh plugin remove` reconcile; no owned rows left behind.
- Limits: restart semantics, process-local loop map, heuristic rank, en-only card, no bypasses (`README.md:114-119`) — `loops` is module-level (`index.js:30`); rank caveat in-prompt; card dictionaries are `en` + `zh = en` alias (`lib/client.js`).
- Plain-JS factory rationale (`README.md:95`) — `lib/client.js:15-17` uses `window.__ModuleLoader__.load`, served byte-identical (diffed against the live `/plugins/` response).

## Mismatches (fixed)

- `index.js:121` returned `Usage: /keys set …` for an invalid sub-subcommand — a command that has not existed since v0.3.0. Now `Usage: /research keys set …`.
- `index.js:180` acked `` `/${kind} workflow started` `` — e.g. `/review-loop workflow started` for a path no user can invoke. Now `/research ${kind} workflow started`.

## Missing Implementations

None. Every README capability resolves to shipped code exercised by tests or live probes above.

## Maintenance Risks

- **Card render is stub-tested, not browser-tested.** The `research-keys` namespace path is proven to the serving boundary (byte-identical bundle in the boot graph), but the expand-time React #290 from the live console is still open — the `credRef` rename + wire-boundary coercion + adversarial-payload tests address it, awaiting the user's hard-refresh retest.
- **Process-local loop map.** A restart mid-loop silently drops remaining rounds; no resume, no log record. Acceptable per Limits, but a crash between round N and N+1 leaves the artifact half-reviewed with no marker.
- **`liveRefs()` trusts settings scope shape.** A future scope returning non-string ref fields falls back to row config silently; a malformed-but-present scope could mask a real misconfiguration.
- **No integration test against real DSH services.** All seams are faked (`commands`, `settings`, `credentials`, `jobs`, `sessionQuery`); a host-side contract change (e.g. `CredentialInfo` fields) breaks silently until boot.

## Reproducibility

`npm install && npm test` — 10/10, no key, no network, no build. Commit `1d0efa1` plus the two one-line mismatch fixes above (uncommitted at audit time).
