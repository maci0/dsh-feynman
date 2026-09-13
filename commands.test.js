import { test } from 'node:test'
import assert from 'node:assert/strict'
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

// The research-keys namespace registers with row config as its base layer.
test('settings namespace serves row config as base', () => {
  let captured
  let hooks
  const fakeSettings = {
    installSection: (ctx, ns, schema, entry, h) => {
      captured = { ns, resolved: schema(entry), json: schema.toJSON() }
      hooks = h
      h.setSource(() => captured.resolved)
      h.onChange()
    },
  }
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: () => () => {} },
    on: () => () => {},
    get: () => undefined,
    inject: (deps, cb) => { if (deps.includes('settings')) cb({ settings: fakeSettings }) },
  }, { hfTokenEnv: 'CUSTOM_HF' })
  assert.equal(captured.ns, 'research-keys')
  assert.deepEqual(captured.resolved, { hfTokenEnv: 'CUSTOM_HF', alphaxivTokenEnv: 'ALPHAXIV_API_KEY' })
  assert.ok(captured.json && typeof captured.json === 'object', 'schema serializes for describe()')
  assert.equal(typeof hooks.setSource, 'function')
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
    assert.equal(m.source.kind, 'plugin')
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
