/**
 * Research workflow commands for DeepSeek Harness.
 *
 * One out-of-tree bundle: 14 workflow slash commands (deepresearch, lit,
 * review, review-loop, audit, replicate, recipe, compare, draft, autoresearch,
 * watch, rank, paper, preview) that steer the model with workflow briefs,
 * plus 11 session/utility commands (log, jobs, help, feynman-model, init,
 * outputs, btw, thinking, search, web-results, keys).
 *
 * Load via `--patch cordis.patch.yml` or `dsh plugin add ./dsh-feynman`.
 */
import { WORKFLOWS, SESSION_COMMANDS, THINKING_LEVELS, buildPrompt, parseLoopArgs, parseRankArgs, loopFollowupPrompt, slugify } from './prompts.js'
import Schema from '@deepseek-ai/schemastery'

export const name = 'feynman'
// Only commands is required; every other seam is read through service(),
// which returns undefined when absent, so the bundle loads on minimal profiles.
export const inject = ['commands']

/** Settings namespace the browser card edits: key refs only, never secrets. */
export const RESEARCH_KEYS_NAMESPACE = 'research-keys'

/** The two env refs, resolved from settings when mounted, else row config. */
export const ResearchKeys = Schema.object({
  hfTokenEnv: Schema.string().default('HF_TOKEN'),
  alphaxivTokenEnv: Schema.string().default('ALPHAXIV_API_KEY'),
})

// ponytail: per-agent loop state keyed by session id; upgrade to ctx on agent.ctx if multi-agent loops matter.
const loops = new Map()

// --- key configuration (Hugging Face + AlphaXiv) ---
//
// Secrets live in the credentials seam ($DSH_HOME/.credentials.yaml, env, .env
// fallbacks) — never in row config. Row config names only the env refs, so one
// deployment can point at different vault names without touching code.
// Zero-click path: `export HF_TOKEN=… ALPHAXIV_API_KEY=…`; managed path: /keys.

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Active refs; row config overrides at load. Read by /keys and the prelude. */
let keyRefs = { hfTokenEnv: 'HF_TOKEN', alphaxivTokenEnv: 'ALPHAXIV_API_KEY' }

/** Settings scope once attached; row config is the base and the fallback. */
let keySource = () => keyRefs

function normalizeConfig(config) {
  const refs = {
    hfTokenEnv: config.hfTokenEnv ?? keyRefs.hfTokenEnv,
    alphaxivTokenEnv: config.alphaxivTokenEnv ?? keyRefs.alphaxivTokenEnv,
  }
  for (const [field, value] of Object.entries(refs)) {
    if (typeof value !== 'string' || !REF_PATTERN.test(value)) {
      throw new Error(`[feynman] ${field} must be an env-var name (letters, digits, underscore); got ${JSON.stringify(value)}`)
    }
  }
  return refs
}

/** Read live refs from the settings scope when valid, else the row fallback. */
function liveRefs() {
  try {
    const value = keySource()
    if (value !== null && typeof value === 'object') {
      const { hfTokenEnv, alphaxivTokenEnv } = value
      if (typeof hfTokenEnv === 'string' && typeof alphaxivTokenEnv === 'string') {
        return { hfTokenEnv, alphaxivTokenEnv }
      }
    }
  } catch { /* fall through to row config */ }
  return keyRefs
}

/** Whether the settings namespace behind the config card is served. */
function cardState(ctx) {
  try {
    const settings = service(ctx, 'settings')
    if (!settings) return 'settings service absent — card unavailable on minimal profiles'
    settings.get(RESEARCH_KEYS_NAMESPACE)
    return 'namespace served — card should appear under Plugin configuration'
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

async function keysHandler(invocation, ctx) {
  const args = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
  const creds = service(ctx, 'credentials')
  const refs = liveRefs()
  if (args.length === 0) {
    const [hf, ax] = await Promise.all([keyState(ctx, refs.hfTokenEnv), keyState(ctx, refs.alphaxivTokenEnv)])
    return {
      kind: 'success',
      text: [
        `Hugging Face key (${refs.hfTokenEnv}): ${hf}`,
        `AlphaXiv key (${refs.alphaxivTokenEnv}): ${ax}`,
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

/** Usage line for one subcommand. */
function subUsage(sub) {
  const workflow = WORKFLOWS[sub]
  if (workflow) return `Usage: /feynman ${sub} ${workflow.hint}`
  if (sub === 'btw') return 'Usage: /feynman btw <question>'
  if (sub === 'search') return 'Usage: /feynman search <query>'
  if (sub === 'keys') return 'Usage: /feynman keys | /feynman keys set <hf|alphaxiv> <value>'
  return `Usage: /feynman <${[...Object.keys(WORKFLOWS), ...Object.keys(SESSION_COMMANDS)].join(' | ')}>`
}

/**
 * Single dispatcher behind `/feynman`. The first token names a workflow or
 * session subcommand; the rest is that subcommand's raw input. Attachments
 * ride along on the sub-invocation.
 */
function researchHandler(invocation, ctx, sessionHandlers) {
  const [sub = '', ...rest] = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
  const name = sub.toLowerCase()
  if (!name) return helpHandler({ ...invocation, rawInput: '' })
  const subInvocation = { ...invocation, rawInput: rest.join(' ') }
  if (WORKFLOWS[name]) return workflowHandler(name)(subInvocation)
  const session = sessionHandlers[name]
  if (session) return session(subInvocation, ctx)
  return err(`${subUsage('')} — unknown subcommand "${sub}".`)
}

function workflowHandler(kind) {
  const spec = WORKFLOWS[kind]
  const usage = `Usage: /feynman ${kind} ${spec.hint}`
  return (invocation) => {
    const args = invocation.rawInput.trim()
    if (spec.required && !args) return err(usage)
    if (kind === 'review-loop' && args.toLowerCase() === 'stop') {
      const loop = loops.get(invocation.agent.session.id)
      if (!loop) return { kind: 'success', text: 'No review loop is running.' }
      loops.delete(invocation.agent.session.id)
      return { kind: 'success', text: `Review loop for "${loop.target}" stopped after ${loop.round - 1} round(s).` }
    }
    // Queue the workflow brief as the agent's next turn; the followup IS the work.
    // Rank parses every PaperRank flag; unknown --flags are rejected, never absorbed into the topic.
    if (kind === 'rank') {
      const parsed = parseRankArgs(args)
      if (!parsed.topic) return err(usage)
      if (parsed.unsupported.length > 0) {
        return err(`Unsupported flag(s): ${parsed.unsupported.join(', ')}. See \`Usage: /feynman rank ${WORKFLOWS.rank.hint}\`.`)
      }
      const body = buildPrompt(kind, parsed, liveRefs())
      invocation.agent.followup(userMessage(invocation, `${kind}: ${args}\n\n${body}`))
      return { kind: 'success', text: `/feynman ${kind} workflow started. Output lands in ${parsed.outputDir}/.` }
    }
    const body = kind === 'review-loop'
      ? reviewLoopPrompt(invocation, args)
      : buildPrompt(kind, args, liveRefs())
    if (body === null) return err(usage)
    invocation.agent.followup(userMessage(invocation, `${kind}: ${args}\n\n${body}`))
    return { kind: 'success', text: `/feynman ${kind} workflow started. Output lands in outputs/.` }
  }
}

function reviewLoopPrompt(invocation, args) {
  const { target, rounds } = parseLoopArgs(args)
  if (!target) return null
  loops.set(invocation.agent.session.id, { target, rounds, round: 1 })
  const brief = buildPrompt('review-loop', target, liveRefs())
  return `${brief}\n\nRound 1 of ${rounds}; follow-ups will drive re-review.`
}

/** Minimal user message; avoids importing dsh-llm out-of-tree. */
function userMessage(invocation, text) {
  const blocks = [...invocation.attachments, { type: 'text', text }]
  return {
    content: blocks,
    // Plugin source, not forged 'user': title/outline/activity consumers gate human input on kind === 'user'.
    source: { kind: 'plugin', plugin: 'feynman', form: 'relay' },
    id: crypto.randomUUID(),
    role: 'user',
  }
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
    'List the research artifacts under outputs/ (group by workflow: *-brief.md deepresearch, *-lit-review.md lit, *-review.md review, *-audit.md audit, *-replication-plan.md replicate, *-recipe.md recipe, *-compare.md compare, *-draft.md draft, *-paper-rank.md rank, *-baseline.md watch). Summarize what each contains in one line.',
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

function searchHandler(invocation, ctx) {
  const q = invocation.rawInput.trim()
  if (!q) return err('Usage: /feynman search <query>')
  if (typeof service(ctx, 'sessionQuery')?.searchSessions === 'function') {
    return {
      kind: 'success',
      text: `Searching past sessions for "${q}" via full-text search. Ask me and I will run it and summarize the hits.`,
    }
  }
  return {
    kind: 'success',
    text: `Full-text search is not mounted in this profile (session-query seam with openAt startup or first-search).` +
      ` Ask me and I will grep this session's history, or run: rg -n "${q.replaceAll('"', "'")}" <session-dir>.`,
  }
}

export function apply(ctx, config = {}) {
  keyRefs = normalizeConfig(config)

  // Settings namespace for the browser card: refs only, never secrets.
  // Row config is the base layer and the fallback when settings is absent.
  ctx.inject?.(['settings'], (scope) => {
    scope.settings.installSection(ctx, RESEARCH_KEYS_NAMESPACE, ResearchKeys, { ...keyRefs }, {
      setSource: (current) => { keySource = current },
      onChange: () => {},
    })
  })

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
      keys: keysHandler,
    }
    // One top-level name; everything else rides `feynman <subcommand>`.
    // Bare generic names (log, jobs, help, …) belong to the host or the user.
    disposers.push(ctx.commands.register({
      definitionId: 'dsh-feynman:feynman',
      name: 'feynman',
      description: 'Research workflows and session utilities (subcommands: workflow names plus log, jobs, help, init, outputs, btw, thinking, search, web-results, keys)',
      input: { hint: '<workflow | subcommand> [args]', attachments: true },
      recordInput: false,
      handler: (inv) => researchHandler(inv, ctx, sessionHandlers),
    }))
    // /review-loop driver: after each completed turn, queue the next round.
    // Keyed by session id: the registry keys agents by session id, so the
    // lookup below resolves the same agent that stored the loop at dispatch.
    const offTurn = ctx.on('session/event', (session, event) => {
      if (event?.type !== 'turn/end' || event?.data?.reason?.kind !== 'completed') return
      const agent = service(ctx, 'agents')?.get?.(session.id)
      if (!agent || agent.session !== session) return
      const loop = loops.get(session.id)
      if (!loop || loop.round >= loop.rounds) { loops.delete(session.id); return }
      loop.round += 1
      agent.followup(userMessage({ attachments: [], agent }, loopFollowupPrompt(loop.target, loop.round, loop.rounds - loop.round)))
    })
    return () => { offTurn?.(); for (const d of disposers) d() }
  })
}

// Re-exported for tests.
export { slugify, parseLoopArgs, parseRankArgs, loopFollowupPrompt }
