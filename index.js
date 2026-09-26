/**
 * Research workflow commands for DeepSeek Harness.
 *
 * 14 workflow slash commands (deepresearch, lit, review, review-loop, audit,
 * replicate, recipe, compare, draft, autoresearch, watch, rank, paper,
 * preview) that steer the model with workflow briefs, plus session/utility
 * commands (log, jobs, help, feynman-model, init, outputs, btw, thinking,
 * search, web-results, keys).
 *
 * Load via a row in ~/.dsh/profiles/<profile>/cordis.patch.yml, or
 * `--patch cordis.local.yml`.
 */
import { WORKFLOWS, SESSION_COMMANDS, THINKING_LEVELS, buildPrompt, parseLoopArgs, parseRankArgs, parsePaperArgs, loopFollowupPrompt } from './prompts.js'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'

export const name = 'feynman'
// The review-loop driver resolves agents from the registry on turn/end;
// without 'agents' the lookup misses and rounds after the first never queue.
export const inject = ['commands', 'agents']

/** Settings namespace the browser card edits: key refs only, never secrets. */
const RESEARCH_KEYS_NAMESPACE = 'research-keys'

/**
 * The two env refs, also the settings-card schema. The loop/rank bounds are
 * destructured defaults in prompts.js, not config rows: nobody tunes them.
 */
export const Config = Schema.object({
  hfTokenEnv: Schema.string().role('credential-ref').default('HF_TOKEN').volatile(),
  alphaxivTokenEnv: Schema.string().role('credential-ref').default('ALPHAXIV_API_KEY').volatile(),
})

// --- key configuration (Hugging Face + AlphaXiv) ---
//
// Secrets live in the credentials seam ($DSH_HOME/.credentials.yaml, env, .env
// fallbacks) — never in row config. Row config names only the env refs, so one
// deployment can point at different vault names without touching code.
// Zero-click path: `export HF_TOKEN=… ALPHAXIV_API_KEY=…`; managed path: /keys.

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Per-instance plugin state. Module-level state outlives plugin unload and is
 * shared by every instance, so a patch reload would re-run apply on top of the
 * previous instance's loops.
 */
function plainConfig(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return plainConfig(value.get())
  return value
}

/** Schema input: volatile refs become their current snapshots. The live refs stay on the row. */
function detachConfig(value) {
  const plain = plainConfig(value)
  if (plain !== value) return plain
  if (Array.isArray(value)) return value.map(detachConfig)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, detachConfig(child)]))
  }
  return value
}

function createState(rawConfig) {
  const checked = resolveConfig(rawConfig)
  const read = (field) => {
    const source = rawConfig !== null && typeof rawConfig === 'object' && Object.hasOwn(rawConfig, field)
      ? rawConfig[field]
      : checked[field]
    const live = plainConfig(source)
    return typeof live === 'string' ? live : plainConfig(checked[field])
  }
  const refs = {
    hfTokenEnv: read('hfTokenEnv'),
    alphaxivTokenEnv: read('alphaxivTokenEnv'),
  }
  for (const [field, value] of Object.entries(refs)) {
    if (typeof value !== 'string' || !REF_PATTERN.test(value)) {
      throw new Error(`[feynman] ${field} must be an env-var name (letters, digits, underscore); got ${JSON.stringify(value)}`)
    }
  }
  return {
    refs,
    // Live row. v0.1.7 updates volatile fields in place.
    source: () => ({
      hfTokenEnv: read('hfTokenEnv'),
      alphaxivTokenEnv: read('alphaxivTokenEnv'),
    }),
    loops: new Map(),
  }
}

/**
 * Row config through the exported schema: defaults applied, out-of-range values
 * rejected. Cordis validates the same schema before apply; this is the
 * direct-apply and shared-code path, and it owns the plugin-facing message.
 */
function resolveConfig(rawConfig) {
  try {
    return Config(detachConfig(rawConfig))
  } catch (error) {
    throw new Error(`[feynman] ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Read live refs from the settings scope when valid, else the row fallback. */
function liveRefs(state) {
  try {
    const value = state.source()
    if (value !== null && typeof value === 'object') {
      const { hfTokenEnv, alphaxivTokenEnv } = value
      if (typeof hfTokenEnv === 'string' && typeof alphaxivTokenEnv === 'string') {
        return { hfTokenEnv, alphaxivTokenEnv }
      }
    }
  } catch { /* fall through to row config */ }
  return state.refs
}

/** Whether the settings namespace behind the config card is served. */
function cardState(ctx) {
  try {
    const settings = service(ctx, 'settings')
    if (!settings) return 'settings service absent — card unavailable on minimal profiles'
    settings.get(RESEARCH_KEYS_NAMESPACE)
    return 'namespace served — the card is on the Plugins page, on the feynman row\'s Configure control'
  } catch (error) {
    return `namespace NOT served (${error instanceof Error ? error.message : String(error)})`
  }
}

/** Optional service lookup: ctx.get returns undefined when absent. */
const service = (ctx, key) => ctx.get?.(key)

/** Configured state of one ref without ever exposing the value. */
async function keyState(ctx, ref) {
  try {
    const info = await service(ctx, 'credentials')?.describe?.(ref)
    if (info) return info.configured ? `set (${info.source ?? 'store'})` : 'unset'
  } catch { /* fall through to env */ }
  return process.env[ref] ? 'set (environment)' : 'unset'
}

/** The two key-state lines shared by /keys (no args) and /status. */
async function keySummary(ctx, refs) {
  const [hf, ax] = await Promise.all([keyState(ctx, refs.hfTokenEnv), keyState(ctx, refs.alphaxivTokenEnv)])
  return [
    `Hugging Face key (${refs.hfTokenEnv}): ${hf}`,
    `AlphaXiv key (${refs.alphaxivTokenEnv}): ${ax}`,
  ]
}

async function keysHandler(invocation, ctx, state) {
  const args = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
  const creds = service(ctx, 'credentials')
  const refs = liveRefs(state)
  if (args.length === 0) {
    return {
      kind: 'success',
      text: [
        ...await keySummary(ctx, refs),
        `Config card: ${cardState(ctx)}`,
        '',
        `Usage: /feynman keys set <hf|alphaxiv> <value> — stores in the managed credentials file.`,
        `Or export ${refs.hfTokenEnv} / ${refs.alphaxivTokenEnv} before launch; env shadows the store.`,
      ].join('\n'),
    }
  }
  if (args.length < 3 || args[0].toLowerCase() !== 'set') {
    return { kind: 'error', text: 'Usage: /feynman keys | /feynman keys set <hf|alphaxiv> <value>' }
  }
  const which = args[1].toLowerCase()
  const ref = which === 'hf' ? refs.hfTokenEnv : which === 'alphaxiv' ? refs.alphaxivTokenEnv : undefined
  if (ref === undefined) return { kind: 'error', text: 'Usage: /feynman keys set <hf|alphaxiv> <value>' }
  const value = args.slice(2).join(' ')
  if (creds?.set === undefined) {
    return { kind: 'error', text: `Credentials store is not mounted; export ${ref}=… before launch instead.` }
  }
  return creds.set(ref, value).then(
    () => ({ kind: 'success', text: `${which === 'hf' ? 'Hugging Face' : 'AlphaXiv'} key stored (${ref}). Values are never echoed.` }),
    (error) => ({ kind: 'error', text: `Could not store key: ${error instanceof Error ? error.message : String(error)}` }),
  )
}

// --- commands ---

function err(text) { return { kind: 'error', text } }

/**
 * Single dispatcher behind `/feynman`. The first token names a workflow or
 * session subcommand; the rest is that subcommand's raw input. Attachments
 * ride along on the sub-invocation.
 */
function researchHandler(invocation, ctx, sessionHandlers, state) {
  const [sub = '', ...rest] = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
  const name = sub.toLowerCase()
  if (!name) return helpHandler({ ...invocation, rawInput: '' })
  const subInvocation = { ...invocation, rawInput: rest.join(' ') }
  if (WORKFLOWS[name]) return workflowHandler(name, subInvocation, state)
  const session = sessionHandlers[name]
  if (session) return session(subInvocation, ctx)
  return err(`Usage: /feynman <${[...Object.keys(WORKFLOWS), ...Object.keys(SESSION_COMMANDS)].join(' | ')}> — unknown subcommand "${sub}".`)
}

/** Flag-parsing workflows: the parsed object replaces the raw argument text. */
const PARSERS = { rank: parseRankArgs, paper: parsePaperArgs }

function workflowHandler(kind, invocation, state) {
  const spec = WORKFLOWS[kind]
  const args = invocation.rawInput.trim()
  const usage = `Usage: /feynman ${kind} ${spec.hint}`
  if (!spec.optional && !args) return err(usage)
  if (kind === 'review-loop' && args.toLowerCase() === 'stop') {
    const loop = state.loops.get(invocation.agent.session.id)
    if (!loop) return { kind: 'success', text: 'No review loop is running.' }
    state.loops.delete(invocation.agent.session.id)
    return { kind: 'success', text: `Review loop for "${loop.target}" stopped after ${loop.round - 1} round(s).` }
  }
  // Queue the workflow brief as the agent's next turn; the followup IS the work.
  // Rank and paper parse every flag; unknown --flags are rejected, never absorbed into the topic.
  const parse = PARSERS[kind]
  if (parse) {
    const parsed = parse(args)
    if (!(parsed.topic || parsed.id)) return err(usage)
    if (parsed.unsupported.length > 0) {
      return err(`Unsupported flag(s): ${parsed.unsupported.join(', ')}. See \`Usage: /feynman ${kind} ${spec.hint}\`.`)
    }
    const body = buildPrompt(kind, parsed, liveRefs(state))
    invocation.agent.followup(userMessage(invocation, `${kind}: ${args}\n\n${body}`))
    return { kind: 'success', text: `/feynman ${kind} workflow started. Output lands in ${parsed.outputDir ?? 'outputs'}/.` }
  }
  const body = kind === 'review-loop'
    ? reviewLoopPrompt(invocation, args, state)
    : buildPrompt(kind, args, liveRefs(state))
  if (body === null) return err(usage)
  invocation.agent.followup(userMessage(invocation, `${kind}: ${args}\n\n${body}`))
  return { kind: 'success', text: `/feynman ${kind} workflow started. Output lands in outputs/.` }
}

function reviewLoopPrompt(invocation, args, state) {
  const { target, rounds } = parseLoopArgs(args)
  if (!target) return null
  state.loops.set(invocation.agent.session.id, { target, rounds, round: 1 })
  const brief = buildPrompt('review-loop', target, liveRefs(state))
  return `${brief}\n\nRound 1 of ${rounds}; follow-ups will drive re-review.`
}

/**
 * Frozen user message for the queued follow-up. Built through the llm seam so
 * identity branding, role, and deep-frozen content match every other producer;
 * the queued message is handed to followup()/inject() and must not be mutated.
 */
function userMessage(invocation, text) {
  const content = [...invocation.attachments, { type: 'text', text }]
  return createUserMessage({
    content,
    // Producer source, not forged 'user': title/outline/activity consumers gate human input on kind === 'user'.
    source: { kind: 'feynman', form: 'relay' },
  })
}

function logHandler(invocation) {
  return followupHandler(invocation,
    'Write a durable session log for this session: completed work, findings, open questions, and next steps.',
    'Session-log request queued as the next turn.')
}

function jobsHandler(invocation, ctx) {
  const lines = []
  try {
    const jobs = service(ctx, 'jobs')?.list?.(invocation.agent) ?? []
    lines.push(jobs.length ? `Background jobs (${jobs.length}):` : 'No background jobs running.')
    for (const job of jobs.slice(0, 20)) lines.push(`- ${job.id}: ${job.label} [${job.status}]`)
  } catch { lines.push('Job state is unavailable in this composition.') }
  lines.push('Durable artifacts: outputs/<slug>-baseline.md (watch), autoresearch.md + autoresearch.jsonl (autoresearch).')
  return { kind: 'success', text: lines.join('\n') }
}

async function doctorHandler(invocation, ctx, state) {
  if (invocation.rawInput.trim()) return err('Usage: /feynman doctor (no arguments)')
  const refs = liveRefs(state)
  const lines = ['Feynman diagnostics:']
  for (const [label, ref] of [['Hugging Face', refs.hfTokenEnv], ['AlphaXiv', refs.alphaxivTokenEnv]]) {
    lines.push(`- ${label} key (${ref}): ${await keyState(ctx, ref)}`)
  }
  const present = (key) => service(ctx, key) !== undefined && service(ctx, key) !== null
  for (const [label, key] of [['credentials store', 'credentials'], ['settings (config card)', 'settings'],
    ['jobs', 'jobs'], ['session search', 'sessionQuery'], ['scheduler', 'schedule']]) {
    lines.push(`- ${label}: ${present(key) ? 'mounted' : 'absent — related commands degrade to an error or guidance text'}`)
  }
  try {
    const { execFileSync } = await import('node:child_process')
    execFileSync('pandoc', ['--version'], { stdio: 'ignore' })
    lines.push('- pandoc: installed (`/feynman preview` can render)')
  } catch {
    lines.push('- pandoc: NOT found (`/feynman preview` will give the install command)')
  }
  lines.push(`- Config card: ${cardState(ctx)}`)
  return { kind: 'success', text: lines.join('\n') }
}

async function statusHandler(invocation, ctx, state) {
  if (invocation.rawInput.trim()) return err('Usage: /feynman status (no arguments)')
  const refs = liveRefs(state)
  return {
    kind: 'success',
    text: [
      'Feynman setup summary:',
      ...(await keySummary(ctx, refs)).map((line) => `- ${line}`),
      `- Key refs: hfTokenEnv=${refs.hfTokenEnv} alphaxivTokenEnv=${refs.alphaxivTokenEnv} (row config; invalid names fail at load)`,
      '- Model route: one profile route (see the agent-default-model row); per-turn overrides are not supported here.',
      `- Thinking levels: ${THINKING_LEVELS.join(', ')} (note a level with /feynman thinking <level>).`,
      '- For the full checklist run /feynman doctor.',
    ].join('\n'),
  }
}

function helpHandler() {
  const lines = ['Research workflows (`/feynman <subcommand>`):']
  for (const n of Object.keys(WORKFLOWS)) lines.push(`  ${n} ${WORKFLOWS[n].hint} — ${WORKFLOWS[n].description}`)
  lines.push('Session (`/feynman <subcommand>`):')
  for (const n of Object.keys(SESSION_COMMANDS)) lines.push(`  ${n} — ${SESSION_COMMANDS[n]}`)
  lines.push('', 'Tip: /feynman review-loop <artifact> [rounds] iterates review→fix→re-review; /feynman review-loop stop ends it.')
  return { kind: 'success', text: lines.join('\n') }
}

/** Queue a model turn from a prompt template; the Focus suffix is shared. */
function followupHandler(invocation, prompt, ack) {
  const focus = invocation.rawInput.trim()
  invocation.agent.followup(userMessage(invocation, focus ? `${prompt} Focus: ${focus}` : prompt))
  return { kind: 'success', text: ack }
}

function initHandler(invocation) {
  return followupHandler(invocation,
    'Bootstrap check for a research project: ensure AGENTS.md exists and outputs/.plans/ plus outputs/.drafts/ directories exist in the workspace, creating what is missing (ask before overwriting an existing AGENTS.md). Report what was created vs already present.',
    'Project bootstrap queued as the next turn.')
}

function outputsHandler(invocation) {
  return followupHandler(invocation,
    'List the research artifacts under outputs/ (group by workflow: *-brief.md deepresearch, *-lit-review.md lit, *-review.md review, *-audit.md audit, *-replication-plan.md replicate, *-recipe.md recipe, *-compare.md compare, *-draft.md draft, *-paper-rank.md + *-research-run.json + *-papers.jsonl + *-scores.jsonl + *-score-audit.md + *-citation-graph.json + *-graph-explorer.html + *-field-map.json + *-rank-sensitivity.json + *-rank.provenance.md rank, *-paper-access.md + *-paper-access.json paper, *-baseline.md watch). Summarize what each contains in one line.',
    'Artifact listing queued as the next turn.')
}

function btwHandler(invocation) {
  const q = invocation.rawInput.trim()
  if (!q) return err('Usage: /feynman btw <question>')
  // Non-waking context: visible at the next step boundary without hijacking the running turn.
  invocation.agent.inject(userMessage(invocation, `Side question (answer when convenient, main task first): ${q}`))
  return { kind: 'success', text: 'Side question noted as context; the main turn continues undisturbed.' }
}

function thinkingHandler(invocation) {
  const level = invocation.rawInput.trim().toLowerCase()
  if (!level) return { kind: 'success', text: `Thinking levels: ${THINKING_LEVELS.join(', ')}.` }
  if (!THINKING_LEVELS.includes(level)) return err(`Unknown thinking level "${level}". Levels: ${THINKING_LEVELS.join(', ')}.`)
  invocation.agent.inject(userMessage(invocation, `Reasoning effort preference for upcoming requests: ${level}. Apply if the route supports it.`))
  return { kind: 'success', text: `Thinking level noted: ${level}. Applies where the model route supports it.` }
}

/**
 * Run the full-text search when the session-query seam is mounted, so the
 * result is the search itself. An unmounted seam is an error, never a success
 * that claims work happened.
 */
async function searchHandler(invocation, ctx) {
  const q = invocation.rawInput.trim()
  if (!q) return err('Usage: /feynman search <query>')
  const engine = service(ctx, 'sessionQuery')
  if (typeof engine?.searchSessions !== 'function') {
    return err(`Full-text search is not mounted in this profile (session-query seam).` +
      ` Grep this session's history instead: rg -n "${q.replaceAll('"', "'")}" <session-dir>.`)
  }
  let page
  try {
    page = await engine.searchSessions({ query: q, limit: 10 })
  } catch (error) {
    return err(`Session search failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const hits = Array.isArray(page?.items) ? page.items : []
  if (hits.length === 0) return { kind: 'success', text: `No past sessions match "${q}".` }
  const lines = [`Past sessions matching "${q}" (${hits.length}):`]
  for (const hit of hits) {
    const raw = typeof hit?.bestMatch?.snippet === 'string' ? hit.bestMatch.snippet.replace(/\s+/g, ' ').trim() : ''
    lines.push(`- ${hit?.header?.id ?? 'unknown'}: ${raw.length > 160 ? `${raw.slice(0, 157)}…` : raw || '(no excerpt)'}`)
  }
  if (page.nextCursor !== undefined) lines.push('More matches exist; narrow the query to see them.')
  return { kind: 'success', text: lines.join('\n') }
}

export function apply(ctx, config = {}) {
  const state = createState(config)

  ctx.effect(() => {
    const disposers = []
    const sessionHandlers = {
      log: logHandler, jobs: jobsHandler, help: helpHandler,
      'feynman-model': () => ({
        kind: 'success',
        text: 'This profile runs one model route (see the agent-default-model row in the composed config). To change it, edit the profile patch or settings; per-turn model overrides are not supported here.',
      }),
      init: initHandler, outputs: outputsHandler, btw: btwHandler, thinking: thinkingHandler,
      search: searchHandler,
      'web-results': () => ({
        kind: 'success',
        text: 'Stored web results live in this session log (web_search/web_fetch tool calls). Ask me to summarize the sources fetched so far and I will reconstruct them from history.',
      }),
      keys: (inv, context) => keysHandler(inv, context, state),
      doctor: (inv, context) => doctorHandler(inv, context, state),
      status: (inv, context) => statusHandler(inv, context, state),
    }
    // One top-level name; everything else rides `feynman <subcommand>`.
    // Bare generic names (log, jobs, help, …) belong to the host or the user.
    disposers.push(ctx.commands.register({
      definitionId: 'dsh-feynman:feynman',
      name: 'feynman',
      description: '⟁ Research workflows and session utilities (subcommands: workflow names plus log, jobs, help, init, outputs, btw, thinking, search, web-results, keys, doctor, status)',
      input: { hint: '<workflow | subcommand> [args]', attachments: true },
      recordInput: false,
      handler: (inv) => researchHandler(inv, ctx, sessionHandlers, state),
    }))
    // /review-loop driver: after each completed turn, queue the next round.
    // Keyed by session id: the registry keys agents by session id, so the
    // lookup below resolves the same agent that stored the loop at dispatch.
    const offTurn = ctx.on('session/event', (session, event) => {
      if (event?.type !== 'turn/end' || event?.data?.reason?.kind !== 'completed') return
      // `agents` is injected, so the service is present; ctx.get is for the
      // optional seams only. The identity guard matches upstream
      // (api/session-controller): the emitted session IS agent.session.
      const agent = ctx.agents.get(session.id)
      if (!agent || agent.session !== session) return
      const loop = state.loops.get(session.id)
      if (!loop || loop.round >= loop.rounds) { state.loops.delete(session.id); return }
      loop.round += 1
      agent.followup(userMessage({ attachments: [], agent }, loopFollowupPrompt(loop.target, loop.round, loop.rounds - loop.round)))
    })
    return () => { offTurn?.(); for (const d of disposers) d() }
  })
}
