# Review: dsh-feynman workspace (`*` resolved to local repo)

Artifact: `/home/maci/Desktop/dsh-feynman` — `index.js`, `prompts.js`, `lib/client.js`,
`commands.test.js`, `client.test.js`, `README.md`, `cordis.patch.yml`, `cordis.local.yml`.
Read in full (all 8 files). External-source checks (arXiv/OpenAlex/Europe PMC/HF Hub)
are N/A — nothing here requires them; no key-gated calls were needed, so no blocked checks.

Evidence base: `npm test` → 10 pass / 0 fail; `node --check` clean on all three
source files; `ls` confirms no `LICENSE` file; `git ls-files` confirms
`outputs/our-code-base-audit.md` is tracked; only one command (`feynman`) is registered.

## Summary Assessment

Revision priority: **fix the two user-facing docs defects (M1, M2), then verify the
loop-driver identity assumption (M3)** — everything else can ride the normal queue.
No criticals: the plugin loads, all tests pass, secrets handling is sound
(`recordInput: false`, literals never touch settings), and the documented
subcommand count (14 + 11 = 25) checks out against the code. The headline risk is
that the review-loop driver — the feature this very session exercises — has zero
committed test coverage and rests on an unverified `agent.id === session.id` assumption.

## Strengths

- Secrets architecture is right: refs in config, literals only via credentials seam,
  `recordInput: false` on the dispatcher (`index.js:310`), adversarial client tests
  for malformed `describe` payloads (`client.test.js:148-167`).
- Pure `prompts.js` (no harness imports) keeps workflow briefs unit-testable; brief
  content test guards against unknowable terms (`commands.test.js:24-34`).
- Fail-fast config validation (`normalizeConfig`, `index.js:47-58`) matches the
  documented "fails at load" claim (`README.md:81`).
- Round accounting in the loop driver is correct *given* the identity assumption:
  rounds=3 yields exactly initial + 2 followups before cleanup (`index.js:319-321`).

## Critical Issues

None. (Confidence 0.85 — full read, green tests; the loop-identity item below is
the closest candidate but is unverifiable from inside this repo, so it stays major.)

## Major Issues (should fix)

**M1 — README points at a `LICENSE` file that does not exist. (conf 0.95)**
`README.md:123` says "DSH port: see `LICENSE`", but `ls` shows no such file.
`package.json` also declares `"license": "MIT"`. Either add the MIT text or drop
the pointer; as-is the license claim is unverifiable.

**M2 — README documents a `/keys` command that is not registered. (conf 0.9)**
`README.md:44` says "`/keys` shows status", but `apply()` registers exactly one
command, `feynman` (`index.js:305-312`). The real invocation is `/feynman keys`.
A user following the docs hits an unknown command.

**M3 — Loop driver assumes `invocation.agent.id === session.id`, unverified. (conf 0.6)**
Loops are stored under `invocation.agent.id` (`index.js:169,187`) but the
`turn/end` driver resolves the agent via `agents.get(session.id)` (`index.js:317`).
If the agents seam keys differently, loops silently never advance (or misroute).
Verify against the harness seam; encode the answer in a test.

**M4 — No committed test covers the loop driver or the keys store path. (conf 0.9)**
`commands.test.js` covers registration, prompt shapes, and one-shot handler kinds —
but not the `session/event` driver, `review-loop stop`, or `credentials.set`
success/failure. The prior session's "live-probed" claims
(`outputs/our-code-base-audit.md:12-20`) are not reproducible from the repo.
Add one driver test (fake `ctx.on` + fake agents seam, N rounds → N followups).

## Minor Issues (suggestion)

- **m1 — `liveRefs()` is all-or-nothing (conf 0.75).** `index.js:61-72`: a settings
  value with only one valid string field discards both refs to row config. Accept
  per-field fallback.
- **m2 — Stored key values are never trimmed (conf 0.8).** `index.js:122`:
  `args.slice(2).join(' ')` keeps pasted leading/trailing whitespace, which
  silently breaks auth. Trim (and reject empty).
- **m3 — Round counts outside 1–10 are silently reinterpreted (conf 0.85).**
  `parseLoopArgs` (`prompts.js:17-25`): `review-loop <target> 15` becomes
  target-`"… 15"` with 3 rounds; a target legitimately ending in digits is
  misread as a round count. Clamp-or-error loudly instead.
- **m4 — Tracked session artifact with stale names (conf 0.9).**
  `outputs/our-code-base-audit.md` is committed yet references `dsh-researcher`
  and `/research` throughout. Either gitignore `outputs/` or refresh/remove it.
- **m5 — Card refresher closes over first-render refs (conf 0.55).**
  `lib/client.js:192-195`: `useEffect(…, [])` pins the first `refresh`; renaming
  env refs while the card is mounted refreshes stale refs. Re-bind on snapshot change.
- **m6 — Any completed turn consumes a loop round (conf 0.7).** The driver
  (`index.js:314-321`) advances on every `turn/end`, including unrelated user
  turns mid-loop. Consider gating on loop-initiated turns if this bites.

## Nits (style)

- **n1:** `searchHandler` fallback "with openAt startup or first-search"
  (`index.js:270`) is jargon; one plain clause would do. (conf 0.8)
- **n2:** Client appends a fresh `<style>` on every factory load
  (`lib/client.js:52-56`); guard with an id check. (conf 0.7)
- **n3:** `const zh = en` (`lib/client.js:73`) — consistent with the documented
  one-locale limit (`README.md:118`), so fine; a real fallback note would be kinder. (conf 0.9)
- **n4:** `slugify` truncates at 60 chars (`prompts.js:12`); two long URLs can
  collide on one review filename. Suffix on collision if it ever happens. (conf 0.5)

## Inline Annotations

| Location | Note |
|---|---|
| `README.md:44` | M2: `/keys` → `/feynman keys` |
| `README.md:123` | M1: `LICENSE` missing from repo |
| `index.js:169,187` vs `index.js:317` | M3: loop key vs driver lookup identity |
| `commands.test.js` (whole) | M4: driver + keys-store paths untested |
| `index.js:61-72` | m1: all-or-nothing `liveRefs` |
| `index.js:122` | m2: untrimmed key value |
| `prompts.js:17-25` | m3: silent round-count reinterpretation |
| `outputs/our-code-base-audit.md:1-32` | m4: stale pre-rename names, tracked artifact |
| `lib/client.js:192-195` | m5: stale refresher closure |
| `index.js:314-321` | m6: unrelated turns consume rounds |
| `index.js:270` | n1: unclear fallback phrasing |
| `lib/client.js:52-56` | n2: duplicate `<style>` |
| `lib/client.js:73` | n3: `zh = en` alias (documented) |
| `prompts.js:12` | n4: 60-char slug collision |
