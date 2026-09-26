import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/** Installed version from package.json: the card header must show it. */
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

/** Stateful React stub: createElement tree + hooks that survive re-render. */
function createReactStub() {
  const hooks = []
  let cursor = 0
  return {
    reset: () => { cursor = 0 },
    createElement: (type, props, ...children) => ({
      type, props: props ?? {}, children: children.flat(),
    }),
    useSyncExternalStore: (_sub, getSnapshot) => getSnapshot(),
    useState: (initial) => {
      const slot = cursor
      cursor += 1
      if (hooks.length <= slot) hooks[slot] = initial
      return [hooks[slot], (next) => {
        hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next
      }]
    },
    useEffect: (fn) => { fn() },
  }
}

/** Load the factory the way the client module system does. */
function loadBundle({ snapshot, credentials }) {
  const React = createReactStub()
  const dictionaries = {}
  /** Every locale.register call, so a test can assert the registration shape. */
  const localeRegistrations = []
  const scope = { subscribe: () => () => {}, getSnapshot: () => snapshot }
  const remote = { credentials, $on: () => () => {} }
  const registered = []
  const decorated = []
  const submitted = []
  const ctx = {
    configForms: { get: () => scope },
    locale: {
      register: (ns, localeOrDicts, dict) => {
        localeRegistrations.push({ ns, localeOrDicts, dict })
        // Single-locale form is register(ns, 'en', dict); the map form is register(ns, { en, zh }).
        dictionaries[ns] = typeof localeOrDicts === 'string' ? dict : localeOrDicts.en
        return () => {}
      },
      bind: (ns) => (key, params) => {
        const template = dictionaries[ns]?.[key] ?? key
        return params === undefined ? template
          : template.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m))
      },
    },
    slots: {
      inject: (_slot, fn) => { fn() },
      register: (entry, component) => { registered.push({ entry, component }); return () => {} },
    },
    remote,
    effect: (fn) => { fn() },
    commandUi: { decorate: (spec) => { decorated.push(spec); return () => {} } },
    sessions: {
      binding: () => ({ session: { command: (line) => { submitted.push(line); return Promise.resolve({ ok: true, value: { matched: true } }) } } }),
    },
  }
  const factorySrc = src
  let bundle
  const fakeWindow = {
    __ModuleLoader__: { load: ({ factory }) => { bundle = factory(() => React) } },
  }
  new Function('window', 'module', 'exports', 'require', factorySrc)(
    fakeWindow, {}, {}, () => { throw new Error('no require') },
  )
  bundle.apply(ctx)
  return { bundle, registered, decorated, submitted, React, localeRegistrations }
}

const readySnapshot = {
  status: 'ready',
  value: { hfTokenEnv: 'HF_TOKEN', alphaxivTokenEnv: 'ALPHAXIV_API_KEY' },
  user: {},
  writable: true,
}

/** Render the card tree to text for assertions. */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  return textOf(node.children)
}

/** Every direct child must be renderable: no raw objects reach React. */
function assertRenderable(node, path = 'root') {
  if (node === null || node === undefined || typeof node === 'string'
    || typeof node === 'number' || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertRenderable(child, `${path}[${i}]`))
    return
  }
  if (typeof node === 'object' && node.type === undefined) {
    throw new Error(`${path} renders a raw object with keys: ${Object.keys(node).join(',')}`)
  }
  if (typeof node.type === 'function') {
    assertRenderable(node.type(node.props), `${path}()`)
    return
  }
  assertRenderable(node.children, `${path}.${node.type}`)
}

test('card registers under the research-keys namespace', () => {
  const { bundle, registered, localeRegistrations } = loadBundle({
    snapshot: readySnapshot,
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.deepEqual(bundle.inject, ['slots', 'configForms', 'locale', 'remote', 'remote.credentials', 'commandUi', 'sessions'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].entry.key, 'dsh-feynman#feynman')
  assert.equal(registered[0].entry.name, 'plugins.row.config')
  // English only, in the single-locale overload: the locale service resolves
  // every other language through its per-key fallback. A `{ en, zh }` map here
  // would shadow later Chinese dictionaries.
  assert.equal(localeRegistrations.length, 1)
  const [locale] = localeRegistrations
  assert.equal(locale.ns, 'research-keys')
  assert.equal(locale.localeOrDicts, 'en', 'registered through the single-locale form')
  assert.equal(typeof locale.dict, 'object')
  assert.ok(locale.dict.card && locale.dict.hint, 'English copy present')
})

test('client entry exports no values beyond cordis loading', () => {
  const { bundle } = loadBundle({
    snapshot: readySnapshot,
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.deepEqual(Object.keys(bundle).sort(), ['apply', 'inject'])
})

test('card renders nothing before settings are ready', () => {
  const { registered } = loadBundle({
    snapshot: { status: 'loading', value: null, user: {}, writable: false },
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.equal(registered[0].component({ view: 'page' }), null)
})

test('open card shows configured badges without leaking literals', async () => {
  const { registered, React } = loadBundle({
    snapshot: readySnapshot,
    credentials: {
      describe: async ([ref]) => ({
        ok: true,
        value: { [ref]: { configured: ref === 'HF_TOKEN', writable: true } },
      }),
    },
  })
  const Card = registered[0].component
  React.reset()
  assert.equal(Card({ view: 'summary' }), 'Hugging Face and AlphaXiv keys, stored in the credentials file.')
  Card({ view: 'page' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  React.reset()
  const open = Card({ view: 'page' })
  assertRenderable(open)
  const text = textOf(open)
  assert.ok(text.includes('HF_TOKEN') && text.includes('ALPHAXIV_API_KEY'), 'refs shown')
  assert.ok(!text.includes('hf-sk-') && !text.includes('ax-sk-'), 'literal leaked')
})

// Adversarial describe payloads must degrade to badges, never object children.
test('malformed describe responses cannot reach the render', async () => {
  for (const payload of [
    { ok: true, value: { HF_TOKEN: { configured: {}, writable: [] } } },
    { ok: true, value: null },
    { ok: false, error: { message: 'nope' } },
    null,
    [1, 2],
  ]) {
    const { registered, React } = loadBundle({
      snapshot: readySnapshot,
      credentials: { describe: async () => payload },
    })
    const Card = registered[0].component
    React.reset()
    Card({ view: 'page' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    React.reset()
    assertRenderable(Card({ view: 'page' }), JSON.stringify(payload)?.slice(0, 40))
  }
})

test('bare /feynman opens a subcommand picker matching the host catalog', async () => {
  const { WORKFLOWS, SESSION_COMMANDS } = await import('./prompts.js')
  const { decorated, submitted } = loadBundle({
    snapshot: readySnapshot,
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.equal(decorated.length, 1)
  assert.equal(decorated[0].name, 'feynman')
  assert.equal(decorated[0].ui.kind, 'popupSelect')
  assert.equal(decorated[0].available({ sessionId: 's' }), true)
  // The rendered options ARE the assertion: the catalogue stays internal to the
  // bundle, so this is the only path that can see it.
  const options = await decorated[0].ui.options({ sessionId: 's' }, new AbortController().signal)
  const ids = options.map((o) => o.id)
  // Every host subcommand is pickable, nothing extra.
  assert.deepEqual([...ids].sort(), [...Object.keys(WORKFLOWS), ...Object.keys(SESSION_COMMANDS)].sort())
  for (const o of options) {
    assert.ok(o.label.startsWith('/feynman '), `label claims the line: ${o.label}`)
    assert.equal(typeof o.detail, 'string')
  }
  // A pick submits the completed line back through the host.
  await decorated[0].ui.onSelect(options.find((o) => o.id === 'review'), { sessionId: 's' })
  assert.deepEqual(submitted, ['/feynman review '])
})

// --- perf gate ------------------------------------------------------------
// Instruction-level numbers on this host: ~18k instructions per picker build,
// ~45k per open-card render. CPU time, so a loaded runner's wall clock cannot
// move the gate. The budget is a ratio against a fixed in-process yardstick,
// because an absolute microsecond ceiling that holds on the Ryzen 9 9950X does
// not hold on a slower CI runner.
test('picker build and card render stay inside their CPU-time budget', async () => {
  const { decorated, registered, React } = loadBundle({
    snapshot: readySnapshot,
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  const card = registered[0].component
  let sink = 0
  const batch = (iterations, fn) => {
    const before = process.cpuUsage()
    for (let i = 0; i < iterations; i += 1) sink += fn()
    const delta = process.cpuUsage(before)
    return (delta.user + delta.system) / iterations
  }
  const best = (fn) => {
    batch(200, fn)
    const samples = []
    for (let i = 0; i < 5; i += 1) samples.push(batch(2000, fn))
    return Math.min(...samples)
  }
  const options = () => { void decorated[0].ui.options().then((o) => { sink += o.length }); return 0 }
  const render = () => { React.reset(); return textOf(card()).length }
  const optionsUs = best(options)
  const renderUs = best(render)
  assert.ok(sink > 0)

  // Host-speed yardstick: a fixed slice of plain JS work, measured the same way.
  const yardstickUs = best(() => {
    let acc = 0
    for (let i = 0; i < 200; i += 1) acc += (i * 2654435761) % 97
    return acc & 1
  })
  const optionsRatio = optionsUs / yardstickUs
  const renderRatio = renderUs / yardstickUs
  assert.ok(yardstickUs > 0, 'yardstick measured zero')
  console.log(
    `feynman-perf: picker ${optionsUs.toFixed(2)}us (${optionsRatio.toFixed(1)}x), `
    + `render ${renderUs.toFixed(2)}us (${renderRatio.toFixed(1)}x), `
    + `yardstick ${yardstickUs.toFixed(2)}us`,
  )
  assert.ok(
    optionsRatio <= 8,
    `picker build cost ${optionsRatio.toFixed(2)}x the yardstick `
    + `(${optionsUs.toFixed(2)}us vs ${yardstickUs.toFixed(2)}us); limit 8x`,
  )
  assert.ok(
    renderRatio <= 10,
    `open-card render cost ${renderRatio.toFixed(2)}x the yardstick `
    + `(${renderUs.toFixed(2)}us vs ${yardstickUs.toFixed(2)}us); limit 10x`,
  )
})
