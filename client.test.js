import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

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
  const scope = { subscribe: () => () => {}, getSnapshot: () => snapshot }
  const remote = { credentials, $on: () => () => {} }
  const registered = []
  const ctx = {
    settingsScope: { bind: () => scope },
    locale: {
      register: (ns, dicts) => { dictionaries[ns] = dicts.en; return () => {} },
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
  return { bundle, registered, React }
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
  const { bundle, registered } = loadBundle({
    snapshot: readySnapshot,
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.deepEqual(bundle.inject, ['slots', 'settingsScope', 'locale', 'remote', 'remote.credentials'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].entry.key, 'research-keys')
})

test('card renders nothing before settings are ready', () => {
  const { registered } = loadBundle({
    snapshot: { status: 'loading', value: null, user: {}, writable: false },
    credentials: { describe: async () => ({ ok: true, value: {} }) },
  })
  assert.equal(registered[0].component(), null)
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
  const closed = Card()
  // Closed header shows the card name and placeholder badges.
  assert.ok(textOf(closed).includes('Research Keys'))
  // Open it: the header button's onClick triggers describe + badge refresh.
  const header = closed.children.find((c) => c.type === 'button')
  header.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  React.reset()
  const open = Card()
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
    Card().children.find((c) => c.type === 'button').props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 10))
    React.reset()
    assertRenderable(Card(), JSON.stringify(payload)?.slice(0, 40))
  }
})
