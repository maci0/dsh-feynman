import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { slugify, stripArxivPrefix, parseLoopArgs, parseRankArgs, parsePaperArgs, loopFollowupPrompt, buildPrompt, WORKFLOWS, SESSION_COMMANDS, THINKING_LEVELS } from './prompts.js'
import { apply } from './index.js'

// Every Feynman workflow slash command is mapped.
test('all Feynman workflow commands mapped', () => {
  for (const cmd of ['deepresearch', 'lit', 'review', 'audit', 'replicate', 'recipe', 'compare', 'draft', 'autoresearch', 'watch', 'preview']) {
    assert.ok(WORKFLOWS[cmd], `missing /${cmd}`)
    assert.ok(WORKFLOWS[cmd].prompt('x').length > 100, `/${cmd} prompt is a stub`)
  }
  assert.ok(WORKFLOWS['review-loop'], 'missing /review-loop')
  assert.ok(WORKFLOWS.rank.prompt({ topic: 'x', limit: 20 }).length > 100, 'rank prompt is a stub')
  assert.ok(WORKFLOWS.paper.prompt({ id: 'x' }).length > 100, 'paper prompt is a stub')
})

// Every Feynman session/utility command is mapped.
test('all session commands mapped', () => {
  for (const cmd of ['log', 'jobs', 'help', 'feynman-model', 'init', 'outputs', 'btw', 'thinking', 'search', 'web-results', 'keys', 'doctor', 'status']) {
    assert.ok(SESSION_COMMANDS[cmd], `missing /${cmd}`)
  }
  assert.ok(THINKING_LEVELS.includes('max') && THINKING_LEVELS.includes('off'))
})

// The composed brief carries live key refs and still assumes nothing else.
test('composed brief names key refs, nothing external', () => {
  for (const [cmd, spec] of Object.entries(WORKFLOWS)) {
    const arg = cmd === 'rank' ? { topic: 'sample input', limit: 20 }
      : cmd === 'paper' ? { id: 'sample input' }
        : 'sample input'
    const p = spec.prompt(arg).toLowerCase()
    for (const term of ['sota', 'pmid']) {
      assert.ok(!p.includes(term), `/${cmd} prompt references "${term}" the model cannot know`)
    }
    assert.ok(p.includes('web_search') && p.includes('web_fetch'), `/${cmd} prompt names no concrete tools`)
  }
  const full = buildPrompt('recipe', 'finetune bert', { hfTokenEnv: 'MY_HF', alphaxivTokenEnv: 'MY_AX' }).toLowerCase()
  assert.ok(full.includes('my_hf') && full.includes('my_ax'), 'brief misses live key refs')
})
test('arxiv: prefix normalizes to the bare ID everywhere it matters', () => {
  assert.equal(stripArxivPrefix('arxiv:2401.12345'), '2401.12345')
  assert.equal(stripArxivPrefix('arXiv:2401.12345'), '2401.12345')
  assert.equal(stripArxivPrefix('2401.12345'), '2401.12345')
  assert.equal(stripArxivPrefix('attention is all you need'), 'attention is all you need')
  const prefixed = WORKFLOWS.review.prompt('arxiv:2401.12345')
  const bare = WORKFLOWS.review.prompt('2401.12345')
  assert.equal(prefixed, bare)
  assert.ok(!prefixed.includes('arxiv:'), 'prefix leaks into the brief')
  assert.equal(WORKFLOWS.audit.prompt('arxiv:2401.12345'), WORKFLOWS.audit.prompt('2401.12345'))
  assert.equal(WORKFLOWS.paper.prompt({ id: 'arxiv:2401.12345' }), WORKFLOWS.paper.prompt({ id: '2401.12345' }))
})
test('arxiv: prefixes normalize inside ID lists, flags survive', () => {
  assert.equal(stripArxivPrefix('arxiv:2401.12345 arxiv:2402.67890'), '2401.12345 2402.67890')
  assert.equal(stripArxivPrefix('scaling laws'), 'scaling laws')
  assert.equal(WORKFLOWS.compare.prompt('arxiv:2401.12345 arxiv:2402.67890'), WORKFLOWS.compare.prompt('2401.12345 2402.67890'))
  assert.ok(WORKFLOWS.draft.prompt('--from-session').includes('--from-session'), 'draft flag survives')
})
test('review names its plan and evidence artifacts', () => {
  const brief = WORKFLOWS.review.prompt('2401.12345')
  assert.ok(brief.includes('outputs/.plans/2401-12345-review-plan.md'), 'review plan path')
  assert.ok(brief.includes('outputs/.drafts/2401-12345-review-evidence.md'), 'review evidence path')
})
test('slugify + loop args', () => {
  assert.equal(slugify('Scaling Laws! 2024'), 'scaling-laws-2024')
  assert.deepEqual(parseLoopArgs('paper.pdf 5'), { target: 'paper.pdf', rounds: 5 })
  assert.deepEqual(parseLoopArgs('paper.pdf'), { target: 'paper.pdf', rounds: 3 })
  assert.deepEqual(parseLoopArgs(''), { target: '', rounds: 3 })
  assert.ok(loopFollowupPrompt('p', 2, 1).includes('round 2'))
})
test('rank args: every PaperRank flag parsed, unknowns rejected', () => {
  assert.deepEqual(parseRankArgs('scaling laws --limit 5'), {
    topic: 'scaling laws', limit: 5, expandCitations: 0, fullTextTop: 0, critiqueTop: 0,
    preferenceFile: null, reproductionNotes: null, synthesize: false, synthesisTop: 7,
    synthesisModel: null, outputDir: 'outputs', json: false, unsupported: [],
  })
  assert.deepEqual(parseRankArgs('scaling laws'), {
    topic: 'scaling laws', limit: 20, expandCitations: 0, fullTextTop: 0, critiqueTop: 0,
    preferenceFile: null, reproductionNotes: null, synthesize: false, synthesisTop: 7,
    synthesisModel: null, outputDir: 'outputs', json: false, unsupported: [],
  })
  const full = parseRankArgs('scaling laws --limit 5 --expand-citations 2 --full-text-top 3 --critique-top 4 --preference-file p.json --reproduction-notes r.json --synthesize --synthesis-top 6 --synthesis-model a/b --output-dir out --json')
  assert.deepEqual(full, {
    topic: 'scaling laws', limit: 5, expandCitations: 2, fullTextTop: 3, critiqueTop: 4,
    preferenceFile: 'p.json', reproductionNotes: 'r.json', synthesize: true, synthesisTop: 6,
    synthesisModel: 'a/b', outputDir: 'out', json: true, unsupported: [],
  })
  assert.deepEqual(parseRankArgs('scaling laws --bogus'), {
    topic: 'scaling laws', limit: 20, expandCitations: 0, fullTextTop: 0, critiqueTop: 0,
    preferenceFile: null, reproductionNotes: null, synthesize: false, synthesisTop: 7,
    synthesisModel: null, outputDir: 'outputs', json: false, unsupported: ['--bogus'],
  })
  assert.deepEqual(parseRankArgs('scaling laws --limit 200').limit, 100)
  // Bare flag values never become the topic.
  assert.equal(parseRankArgs('--limit 5').topic, '')
})
test('paper args: flags parsed, multi-word titles kept, unknowns rejected', () => {
  assert.deepEqual(parsePaperArgs('10.1234/abc --fetch-full-text --json'), { id: '10.1234/abc', fetchFullText: true, json: true, unsupported: [] })
  assert.deepEqual(parsePaperArgs('attention is all you need'), { id: 'attention is all you need', fetchFullText: false, json: false, unsupported: [] })
  assert.deepEqual(parsePaperArgs('2401.12345 --bogus'), { id: '2401.12345', fetchFullText: false, json: false, unsupported: ['--bogus'] })
  assert.deepEqual(parsePaperArgs('--json'), { id: '', fetchFullText: false, json: true, unsupported: [] })
})

// Credential refs come from the row. `/feynman doctor` prints the live values.
test('row config is the base for credential refs', async () => {
  let handler
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: (definition) => { handler = definition.handler; return () => {} } },
    on: () => () => {},
    get: () => undefined,
    inject: () => {},
  }, { hfTokenEnv: 'CUSTOM_HF' })
  const result = await handler({ rawInput: 'doctor', agent: { session: { id: 's' } } })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Hugging Face key \(CUSTOM_HF\)/)
  assert.match(result.text, /AlphaXiv key \(ALPHAXIV_API_KEY\)/)
})
test('one /feynman dispatcher covers every subcommand', async () => {
  const registered = []
  const followups = []
  const agent = { id: 'test-agent', session: { id: 'test-agent' }, followup: (m) => followups.push(m), inject: () => {} }
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: (d) => { registered.push(d); return () => {} } },
    on: () => () => {},
    get: () => undefined,
  }, {})
  assert.equal(registered.length, 1)
  const feynman = registered[0]
  assert.equal(feynman.name, 'feynman')
  assert.equal(feynman.recordInput, false)
  const run = (rawInput) => feynman.handler({ rawInput, agent, attachments: [] })
  for (const sub of [...Object.keys(WORKFLOWS), ...Object.keys(SESSION_COMMANDS)]) {
    const result = await run(`${sub} sample input`)
    assert.ok(result && (result.kind === 'success' || result.kind === 'error'), `${sub}: bad kind`)
    assert.equal(typeof result.text, 'string', `${sub}: text must be a string`)
    if (result.kind === 'error') assert.ok(result.text.length > 0, `${sub}: empty error`)
  }
  const unknown = await run('frobnicate x')
  assert.equal(unknown.kind, 'error')
  const bare = await run('')
  assert.equal(bare.kind, 'success', 'bare /feynman shows help')
  assert.ok(followups.length > 0, 'workflow handlers queue model turns')
  // Steering messages carry identity and a plugin source, never a forged human one.
  for (const m of followups) {
    assert.equal(m.role, 'user')
    assert.equal(typeof m.id, 'string')
    assert.equal(m.source.kind, 'feynman')
    // Built through createUserMessage: deep-frozen for every consumer downstream.
    assert.ok(Object.isFrozen(m), 'queued message is frozen')
    assert.ok(Object.isFrozen(m.content), 'queued message content is frozen')
  }
  assert.equal(new Set(followups.map((m) => m.id)).size, followups.length, 'steering ids collide')
  // Rank flags: everything flows through, unknowns fail loud instead of joining the topic.
  const ranked = await run('rank scaling laws --limit 5')
  assert.equal(ranked.kind, 'success')
  assert.ok(followups.at(-1).content[0].text.includes('up to 5 seed candidates'), 'limit reaches the brief')
  const flagged = await run('rank scaling laws --bogus')
  assert.equal(flagged.kind, 'error')
  assert.ok(flagged.text.includes('--bogus'), 'unsupported flag named')
  // Full PaperRank surface lands in one brief.
  const brief = WORKFLOWS.rank.prompt({
    topic: 'x', limit: 5, expandCitations: 2, fullTextTop: 3, critiqueTop: 4,
    preferenceFile: 'p.json', reproductionNotes: 'r.json', synthesize: true, synthesisTop: 6,
    synthesisModel: 'a/b', outputDir: 'out', json: true,
  })
  for (const artifact of ['research-run.json', 'paper-rank.md', 'papers.jsonl', 'scores.jsonl', 'score-audit.md',
    'rank-sensitivity.json', 'citation-graph.json', 'graph-explorer.html', 'field-map.json', 'rank.provenance.md',
    'critique.md', 'score-calibration.json', 'reproduction-ledger.json', 'replication-plan.md',
    'synthesis-packet.json', 'synthesis-prompt.md', 'model-synthesis.md']) {
    assert.ok(brief.includes(artifact), `brief omits ${artifact}`)
  }
  // Paper flags: fetch + json reach the brief, unknowns fail loud.
  const papered = await run('paper 2401.12345 --fetch-full-text --json')
  assert.equal(papered.kind, 'success')
  assert.ok(followups.at(-1).content[0].text.includes('fetch text only through source-sanctioned APIs'), 'fetch flag reaches the brief')
  const paperFlagged = await run('paper 2401.12345 --bogus')
  assert.equal(paperFlagged.kind, 'error')
  assert.ok(paperFlagged.text.includes('--bogus'), 'unsupported paper flag named')
  // Doctor + status answer directly (no followup queued).
  const before = followups.length
  const doctor = await run('doctor')
  assert.equal(doctor.kind, 'success')
  assert.ok(doctor.text.includes('pandoc'), 'doctor covers preview deps')
  const status = await run('status')
  assert.equal(status.kind, 'success')
  assert.ok(status.text.includes('setup summary'), 'status summarizes setup')
  assert.equal(followups.length, before, 'diagnostics queue no model turn')
})

test('review-loop driver advances every round through the agents registry', async () => {
  const { apply } = await import('./index.js')
  const followups = []
  const session = { id: 'loop-session' }
  const agent = { id: 'loop-session', session, followup: (m) => followups.push(m), inject: () => {} }
  let handler
  let turnListener
  const registry = new Map([['loop-session', agent]])
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: (d) => { handler = d.handler; return () => {} } },
    on: (event, fn) => { if (event === 'session/event') turnListener = fn; return () => {} },
    // `agents` is injected, so the plugin reads it directly.
    agents: { get: (id) => registry.get(id) },
    get: () => undefined,
  }, {})
  const run = (rawInput) => handler({ rawInput, agent, attachments: [] })
  const started = await run('review-loop paper.pdf 3')
  assert.equal(started.kind, 'success')
  assert.equal(followups.length, 1, 'round 1 queued at dispatch')
  const endTurn = (reason = { kind: 'completed' }) => turnListener(session, { type: 'turn/end', data: { reason } })
  endTurn()
  assert.equal(followups.length, 2, 'round 2 queued after turn 1')
  assert.ok(followups[1].content[0].text.includes('round 2'), 'round 2 brief')
  endTurn({ kind: 'error', error: { message: 'x', code: 'UNKNOWN' } })
  assert.equal(followups.length, 2, 'non-completed turn does not advance')
  endTurn()
  assert.equal(followups.length, 3, 'round 3 queued after turn 2')
  endTurn()
  assert.equal(followups.length, 3, 'loop ends after the final round')
  const stopped = await run('review-loop stop')
  assert.ok(stopped.text.includes('No review loop'), 'finished loop reports absent')
})

// Plugin state is per apply instance: a second load must not see the first
// instance's loops (module-level state would leak across a patch reload).
test('review-loop state is per apply instance', async () => {
  const make = () => {
    let handler
    const session = { id: 'shared-session' }
    const agent = { id: 'shared-session', session, followup: () => {}, inject: () => {} }
    apply({
      effect: (fn) => { fn(); return () => {} },
      commands: { register: (d) => { handler = d.handler; return () => {} } },
      on: () => () => {},
      get: () => undefined,
    }, {})
    return (rawInput) => handler({ rawInput, agent, attachments: [] })
  }
  const first = make()
  const second = make()
  await first('review-loop paper.pdf 3')
  const leaked = await second('review-loop stop')
  assert.ok(leaked.text.includes('No review loop'), 'second instance sees the first instance loop')
  const owned = await first('review-loop stop')
  assert.ok(owned.text.includes('stopped after 0 round'), 'first instance lost its own loop')
})

// /feynman search does the work it names: mounted seam → real hits, absent
// seam → an error, never a success claiming a search that never ran.
test('search returns real hits from the session-query seam', async () => {
  const calls = []
  let handler
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: (d) => { handler = d.handler; return () => {} } },
    on: () => () => {},
    get: (key) => key === 'sessionQuery' ? {
      searchSessions: async (request) => {
        calls.push(request)
        return { items: [{ header: { id: 's-42' }, bestMatch: { snippet: 'a hit about\nscaling laws' } }] }
      },
    } : undefined,
  }, {})
  const result = await handler({ rawInput: 'search scaling laws', agent: {}, attachments: [] })
  assert.equal(result.kind, 'success')
  assert.deepEqual(calls, [{ query: 'scaling laws', limit: 10 }], 'the seam was actually called')
  assert.ok(result.text.includes('s-42'), 'hit id rendered')
  assert.ok(result.text.includes('a hit about scaling laws'), 'snippet rendered')
})

test('an unmounted session-query seam is an error, not a fake success', async () => {
  let handler
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: (d) => { handler = d.handler; return () => {} } },
    on: () => () => {},
    get: () => undefined,
  }, {})
  const result = await handler({ rawInput: 'search anything', agent: {}, attachments: [] })
  assert.equal(result.kind, 'error', 'must not claim work it did not do')
  assert.ok(result.text.includes('not mounted'))
})

// docs/testing.md:37-41 — a real in-process Cordis composition, not a
// hand-built ctx: mount the shipped entry, assert its registrations, dispose
// the fiber, and assert the teardown.
test('real Cordis composition mounts the plugin and tears it down', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { name, inject, apply } = await import('./index.js')
  const registered = []
  const session = { id: 'real-session' }
  const followups = []
  const agent = { id: 'real-session', session, followup: (m) => followups.push(m), inject: () => {} }
  const ctx = new Context()
  ctx.provide('commands', {
    register: (definition) => {
      registered.push(definition)
      return () => { const i = registered.indexOf(definition); if (i >= 0) registered.splice(i, 1) }
    },
  })
  ctx.provide('agents', { get: (id) => (id === agent.id ? agent : undefined) })

  const fiber = await ctx.plugin({ name, inject, apply }, {})
  assert.equal(registered.length, 1, 'exactly one command registered')
  assert.equal(registered[0].name, 'feynman')
  assert.equal(registered[0].definitionId, 'dsh-feynman:feynman', 'branded id keeps its string value')
  const started = await registered[0].handler({ rawInput: 'review-loop paper.pdf 3', agent, attachments: [] })
  assert.equal(started.kind, 'success')
  assert.equal(followups.length, 1, 'round 1 queued through the real handler')
  // The review-loop driver is live on the real event bus.
  ctx.emit('session/event', session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(followups.length, 2, 'turn/end advanced the loop through the real bus')

  await fiber.dispose()
  assert.equal(registered.length, 0, 'command registration outlives the fiber')
  ctx.emit('session/event', session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.equal(followups.length, 2, 'session/event listener disposed with the fiber')
})

// --- perf gates -----------------------------------------------------------
// Instruction-level numbers were recorded with `taskset -c 2 perf stat -e
// instructions,cycles` over 20000 prompt builds: 3072 instructions per
// build on this host). Tests must survive a loaded runner, so they gate on
// retired CPU time and on the frozen prompt text instead of wall clock.

/** The brief args the digest was reviewed against; changing one changes the digest. */
const DIGEST_ARGS = {
  deepresearch: 'Quantum error correction — fault tolerance\nwith unicode: café, 東京, emoji 🚀',
  lit: 'arxiv:2301.00001 diffusion models',
  review: 'arxiv:2301.00001',
  'review-loop': 'paper X',
  audit: 'repo url --paper arxiv:1',
  replicate: 'claim: scaling holds',
  recipe: 'fine-tune a 7B model',
  compare: 'arxiv:1 arxiv:2',
  draft: '--from-session',
  autoresearch: 'prompt optimisation',
  watch: 'agentic coding',
  rank: parseRankArgs('graph nets --limit 50 --expand-citations 3 --full-text-top 5 --critique-top 4 --preference-file p.json --reproduction-notes r.json --synthesize --synthesis-top 9 --synthesis-model p/m --output-dir out --json'),
  paper: parsePaperArgs('arxiv:2301.00001 --fetch-full-text --json'),
  preview: 'outputs/x.md',
}

test('every workflow brief is byte-identical to the reviewed text', () => {
  const digest = createHash('sha256')
  for (const kind of Object.keys(WORKFLOWS)) {
    for (const refs of [{}, { hfTokenEnv: 'A', alphaxivTokenEnv: 'B' }]) {
      digest.update(`${kind}\u0000${JSON.stringify(refs)}\u0000${buildPrompt(kind, DIGEST_ARGS[kind], refs)}`)
    }
  }
  digest.update(loopFollowupPrompt('paper X', 2, 2))
  assert.equal(
    digest.digest('hex'),
    '4f004963fb8f1065d6e4dab4636f9cb19f988e16d6b6ee54223fa4c341864d86',
    'prompt text changed — update the digest deliberately',
  )
})

test('prompt construction stays inside its CPU-time budget', () => {
  const kinds = ['deepresearch', 'lit', 'review', 'audit', 'replicate', 'recipe', 'compare', 'draft', 'autoresearch', 'watch', 'preview', 'rank', 'paper']
  let sink = 0
  // One batch = every workflow once. CPU time, so a busy runner's wall clock
  // does not move it; the budget is ~3x the 0.64us/build baseline recorded on
  // the Ryzen 9 9950X, which catches an order-of-magnitude regression only.
  const batch = (iterations) => {
    const before = process.cpuUsage()
    for (let i = 0; i < iterations; i += 1) {
      sink += kinds.map((kind) => buildPrompt(kind, DIGEST_ARGS[kind], {})).join('\u0000').length
    }
    const delta = process.cpuUsage(before)
    return (delta.user + delta.system) / (iterations * kinds.length)
  }
  batch(200)
  const samples = []
  for (let i = 0; i < 5; i += 1) samples.push(batch(500))
  const best = Math.min(...samples)
  assert.ok(sink > 0)
  assert.ok(best <= 2.0, `prompt build cost ${best.toFixed(3)}us/build, budget 2.0us (baseline 0.64us)`)
})
