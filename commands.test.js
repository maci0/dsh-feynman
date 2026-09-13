import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify, parseLoopArgs, loopFollowupPrompt, buildPrompt, WORKFLOWS, SESSION_COMMANDS, THINKING_LEVELS } from './prompts.js'
import { apply } from './index.js'

// Every Feynman workflow slash command is mapped.
test('all Feynman workflow commands mapped', () => {
  for (const cmd of ['deepresearch', 'lit', 'review', 'audit', 'replicate', 'recipe', 'compare', 'draft', 'autoresearch', 'watch', 'rank', 'paper', 'preview']) {
    assert.ok(WORKFLOWS[cmd], `missing /${cmd}`)
    assert.ok(WORKFLOWS[cmd].prompt('x').length > 100, `/${cmd} prompt is a stub`)
  }
  assert.ok(WORKFLOWS['review-loop'], 'missing /review-loop')
})

// Every Feynman session/utility command is mapped.
test('all session commands mapped', () => {
  for (const cmd of ['log', 'jobs', 'help', 'feynman-model', 'init', 'outputs', 'btw', 'thinking', 'search', 'web-results', 'keys']) {
    assert.ok(SESSION_COMMANDS[cmd], `missing /${cmd}`)
  }
  assert.ok(THINKING_LEVELS.includes('max') && THINKING_LEVELS.includes('off'))
})

// The composed brief carries live key refs and still assumes nothing else.
test('composed brief names key refs, nothing external', () => {
  for (const [cmd, spec] of Object.entries(WORKFLOWS)) {
    const p = spec.prompt('sample input').toLowerCase()
    for (const term of ['feynman', 'sota', 'pmid']) {
      assert.ok(!p.includes(term), `/${cmd} prompt references "${term}" the model cannot know`)
    }
    assert.ok(p.includes('web_search') && p.includes('web_fetch'), `/${cmd} prompt names no concrete tools`)
  }
  const full = buildPrompt('recipe', 'finetune bert', { hfTokenEnv: 'MY_HF', alphaxivTokenEnv: 'MY_AX' }).toLowerCase()
  assert.ok(full.includes('my_hf') && full.includes('my_ax'), 'brief misses live key refs')
})
test('slugify + loop args', () => {
  assert.equal(slugify('Scaling Laws! 2024'), 'scaling-laws-2024')
  assert.deepEqual(parseLoopArgs('paper.pdf 5'), { target: 'paper.pdf', rounds: 5 })
  assert.deepEqual(parseLoopArgs('paper.pdf'), { target: 'paper.pdf', rounds: 3 })
  assert.deepEqual(parseLoopArgs(''), { target: '', rounds: 3 })
  assert.ok(loopFollowupPrompt('p', 2, 1).includes('round 2'))
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
test('all handlers return valid results', async () => {
  const registered = []
  const followups = []
  const agent = { id: 'test-agent', followup: (m) => followups.push(m), inject: () => {} }
  apply({
    effect: (fn) => { fn(); return () => {} },
    commands: { register: (d) => { registered.push(d); return () => {} } },
    on: () => () => {},
    get: () => undefined,
  }, {})
  assert.equal(registered.length, Object.keys(WORKFLOWS).length + Object.keys(SESSION_COMMANDS).length)
  const keys = registered.find((d) => d.name === 'keys')
  assert.equal(keys.recordInput, false)
  for (const d of registered) {
    const result = await d.handler({ rawInput: 'sample input', agent, attachments: [] })
    assert.ok(result && (result.kind === 'success' || result.kind === 'error'), `${d.name}: bad kind`)
    assert.equal(typeof result.text, 'string', `${d.name}: text must be a string`)
    if (result.kind === 'error') assert.ok(result.text.length > 0, `${d.name}: empty error`)
  }
  assert.ok(followups.length > 0, 'workflow handlers queue model turns')
})
