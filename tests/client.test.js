import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
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
function loadBundle({ snapshot, credentials, servedNamespace }) {
  const React = createReactStub()
  const dictionaries = {}
  /** Every locale.register call, so a test can assert the registration shape. */
  const localeRegistrations = []
  const scope = { subscribe: () => () => {}, getSnapshot: () => snapshot }
  /** `credentials/reference-updated` handlers the bundle registered. */
  const credentialHandlers = []
  const remote = {
    credentials,
    $on: (event, handler) => {
      if (event === 'credentials/reference-updated') credentialHandlers.push(handler)
      return () => {}
    },
  }
  const registered = []
  const decorated = []
  const submitted = []
  const requestedNamespaces = []
  // The settings domain serves one form per mounted row, keyed by the row id.
  // A `servedNamespace` narrows this stub to that one namespace: any other
  // `configForms.get` resolves to a form the Host never serves.
  const ctx = {
    configForms: {
      get: (namespace) => {
        requestedNamespaces.push(namespace)
        return servedNamespace === undefined || namespace === servedNamespace
          ? scope
          : { subscribe: () => () => {}, getSnapshot: () => ({ status: 'unavailable', value: null, writable: true }) }
      },
    },
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
  return { bundle, registered, decorated, submitted, React, localeRegistrations, requestedNamespaces, credentialHandlers }
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

  // The visible label is a sibling span, so the password field has to name
  // itself: a screen reader would otherwise announce two anonymous fields.
  const inputs = []
  const collect = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) collect(child); return }
    // A panel is a function component; its children only exist once called.
    if (typeof node.type === 'function') { collect(node.type(node.props)); return }
    if (node.type === 'input') inputs.push(node)
    collect(node.children)
  }
  collect(open)
  assert.equal(inputs.length, 2)
  assert.deepEqual(
    inputs.map((input) => input.props['aria-label']),
    // The card already names the credential ref in the visible label; the field
    // carries that same name so the two cannot drift apart.
    ['Hugging Face API key (HF_TOKEN) — new value', 'AlphaXiv API key (ALPHAXIV_API_KEY) — new value'],
  )
})

// The settings domain serves one form per mounted row, keyed by the row id
// (`feynman`, the id in this package's cordis.patch.yml). A form requested
// under any other namespace never reaches `ready`, so the card the README
// documents on the row's Configure control would never render.
test('the card binds the settings namespace its own row serves', () => {
  const { registered, requestedNamespaces } = loadBundle({
    snapshot: readySnapshot,
    servedNamespace: 'feynman',
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.deepEqual(requestedNamespaces, ['feynman'], 'the card asked for a namespace no row serves')
  const page = registered[0].component({ view: 'page' })
  assert.ok(page !== null && page !== undefined, 'the Configure page renders while the namespace is served')
  assert.ok(textOf(page).includes('HF_TOKEN'), 'the served refs reach the form')
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

// The reference is settings config, so the user can rename it. Every answer the
// credentials domain gives describes one reference: a rename must not leave an
// old answer reporting another reference's state, and an invalidation must
// re-read the reference the card now shows.
test('a renamed credential reference drops the old answer and is re-read', async () => {
  const described = []
  const snapshot = {
    status: 'ready',
    value: { hfTokenEnv: 'HF_TOKEN', alphaxivTokenEnv: 'ALPHAXIV_API_KEY' },
    user: {},
    writable: true,
  }
  const { registered, React, credentialHandlers } = loadBundle({
    snapshot,
    credentials: {
      describe: async ([ref]) => {
        described.push(ref)
        // Only the original reference is configured; the renamed one is not.
        return { ok: true, value: { [ref]: { configured: ref === 'HF_TOKEN', writable: true } } }
      },
    },
  })
  const Card = registered[0].component
  React.reset()
  Card({ view: 'page' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  React.reset()
  assert.ok(textOf(Card({ view: 'page' })).includes('HF_TOKEN: set'), 'the configured reference reads set')

  // The user renames the reference in the settings form; the credentials domain
  // then reports a change for it.
  snapshot.value.hfTokenEnv = 'HF_TOKEN_NEW'
  for (const handler of credentialHandlers) handler('HF_TOKEN')
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.ok(described.includes('HF_TOKEN_NEW'), 'the invalidation never asked about the reference the card shows')
  React.reset()
  assert.ok(
    !textOf(Card({ view: 'page' })).includes('HF_TOKEN_NEW: set'),
    'the card reports set for a reference the credentials domain reports unset',
  )
})

test('bare /feynman opens a subcommand picker matching the host catalog', async () => {
  const { WORKFLOWS, SESSION_COMMANDS } = await import('../prompts.js')
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
// CPU time, so a loaded runner's wall clock cannot move the gate.
//
// Each measurement is divided by reference work in the same resource class,
// timed next to it in the same window. The old denominator was a pure-ALU loop: it
// allocates nothing, so a host under memory/GC contention slowed the card
// render 2-3x while leaving the yardstick flat (1.7us), and the gate tripped on
// contention alone (17-31x against a 16x limit). Both halves of a pair now
// allocate elements through the same React stub, or map the same catalogue into
// option objects, and are timed in the same window, so contention lands on both
// of them and divides out; only the measured path's own growth moves a ratio.
test('picker build and card render stay inside their CPU-time budget', async () => {
  const { WORKFLOWS, SESSION_COMMANDS } = await import('../prompts.js')
  const { decorated, registered, React } = loadBundle({
    snapshot: readySnapshot,
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  const card = registered[0].component
  let sink = 0

  // Picker reference: the same catalogue-length map of option objects through
  // the same promise path, at a fixed per-row cost.
  const catalogSize = Object.keys(WORKFLOWS).length + Object.keys(SESSION_COMMANDS).length
  const REFERENCE_ROWS = Array.from({ length: catalogSize }, (_, i) => [`ref-${i}`, '<arg>', `detail ${i}`])
  const referenceOptions = () => {
    void Promise.resolve(REFERENCE_ROWS.map(([id, hint, detail]) => ({
      id,
      label: hint ? `/feynman ${id} ${hint}` : `/feynman ${id}`,
      ...(detail === undefined ? {} : { detail }),
    }))).then((o) => { sink += o.length })
    return 0
  }

  // Render reference: one key row's shape through the same stub — the same
  // hooks and a fixed element tree, at a fixed size.
  function ReferenceRow() {
    React.useState('')
    React.useState(null)
    React.useState(false)
    return React.createElement(
      'div',
      { className: 'ref-field' },
      React.createElement('span', { className: 'ref-label' }, 'reference'),
      React.createElement('span', { className: 'ref-badge' }, 'ref: set'),
      React.createElement(
        'div',
        { className: 'ref-row' },
        React.createElement('input', { type: 'password', value: '' }),
        React.createElement('button', { type: 'button' }, 'Save'),
        React.createElement('button', { type: 'button' }, 'Clear'),
      ),
      React.createElement('div', { className: 'ref-hint' }, 'reference hint'),
    )
  }

  const options = () => { void decorated[0].ui.options().then((o) => { sink += o.length }); return 0 }
  const render = () => { React.reset(); return textOf(card()).length }
  const referenceRender = () => { React.reset(); return textOf(React.createElement(ReferenceRow)).length }

  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  /**
   * Median of paired samples: each measured block is timed next to a reference
   * block, so host contention lands on both halves of a pair. Blocks of a few
   * calls amortise `process.cpuUsage`'s microsecond resolution, which on a
   * single call quantises a 10us measurement into 10% steps.
   */
  const pairedRatio = (measure, reference, samples, iterations) => {
    const run = (fn, times) => { for (let i = 0; i < times; i += 1) sink += fn() }
    run(measure, iterations * 20)
    run(reference, iterations * 20)
    const ratios = []
    for (let i = 0; i < samples; i += 1) {
      const before = process.cpuUsage()
      run(measure, iterations)
      const middle = process.cpuUsage()
      run(reference, iterations)
      const after = process.cpuUsage()
      const measured = (middle.user - before.user) + (middle.system - before.system)
      const base = (after.user - middle.user) + (after.system - middle.system)
      if (base > 0) ratios.push(measured / base)
    }
    return median(ratios)
  }

  // The picker call is ~10us, so 10-call blocks keep the microsecond resolution
  // under 1%; the render call is ~30us and needs no batching.
  const optionsRatio = pairedRatio(options, referenceOptions, 1000, 10)
  const renderRatio = pairedRatio(render, referenceRender, 4000, 1)
  assert.ok(sink > 0)
  console.log(
    `feynman-perf: picker ${optionsRatio.toFixed(2)}x the reference build, `
    + `render ${renderRatio.toFixed(2)}x the reference render`,
  )
  // Both sides of this ratio map the same catalogue through the same promise,
  // so it sits at 1.00; 1.2x is a 20% budget on the whole call (the promise path
  // is fixed, so that allows the map itself roughly half again as much work).
  assert.ok(
    optionsRatio <= 1.2,
    `picker build cost ${optionsRatio.toFixed(2)}x the reference build; limit 1.2x`,
  )
  // Recorded range for this ratio on a loaded host: 9.7-10.5x. 16x still fails
  // a real regression — a doubled render measures 18.7-19.5x — while leaving
  // half again as much room for the process-to-process spread.
  assert.ok(
    renderRatio <= 16,
    `open-card render cost ${renderRatio.toFixed(2)}x the reference render; limit 16x`,
  )
})
