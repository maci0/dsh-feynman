/**
 * dsh-feynman — browser half.
 *
 * One card in Settings → Plugins → Plugin configuration, keyed on the
 * `research-keys` namespace the host half registers. The card edits nothing
 * in that namespace: the refs it shows are row config. It stages the two key
 * literals locally and writes them through `remote.credentials`, so a literal
 * never rides a settings response — the WebSearchCard pattern. The card learns
 * only configured/writable booleans via `remote.credentials.describe`.
 *
 * Plain JavaScript on purpose: the client module system serves this file as a
 * lazy-CJS factory on `window.__ModuleLoader__`; `react` is provided.
 */

window.__ModuleLoader__.load({
  id: 'dsh-feynman',

  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Settings namespace shared with the host half; also this card's slot key and this plugin's locale namespace. */
    const NAMESPACE = 'research-keys'

    /** Plugin version, shown in the card header. Bump with package.json. */
    const VERSION = '0.13.4'

    const CSS = [
      '.rk-card{list-style:none;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3)}',
      '.rk-card-open{background:var(--dsw-alias-bg-layer-2)}',
      '.rk-header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
      '.rk-head{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.rk-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
      '.rk-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.rk-chevron{flex:none;width:7px;height:7px;margin-top:-3px;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transition:transform .16s;transform:rotate(45deg)}',
      '.rk-chevron-open{transform:rotate(225deg);margin-top:3px}',
      '.rk-body{border-top:0.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:flex;flex-direction:column;gap:12px}',
      '.rk-field{display:flex;flex-direction:column;gap:6px}',
      '.rk-label{font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.rk-row{display:flex;gap:8px}',
      '.rk-input{flex:1;min-width:0;font:inherit;font-size:13px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-4);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}',
      '.rk-btn{appearance:none;font:inherit;font-size:13px;padding:6px 14px;cursor:pointer;color:var(--dsw-alias-label-primary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}',
      '.rk-btn:disabled{cursor:default;opacity:.5}',
      '.rk-badge{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.rk-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
      '.rk-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error)}',
    ].join('')

    if (typeof document !== 'undefined') {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.append(style)
    }

    const en = {
      card: 'Research Keys',
      version: 'v{version}',
      description: 'Hugging Face: {hf}. AlphaXiv: {ax}.',
      set: 'set',
      unset: 'not set',
      expand: 'Expand',
      collapse: 'Collapse',
      hfLabel: 'Hugging Face API key',
      axLabel: 'AlphaXiv API key',
      save: 'Save',
      clear: 'Clear',
      hint: 'Keys are stored in the managed credentials file, never in settings. Empty input clears nothing; use Clear.',
      envNote: 'A key exported in the environment shadows the stored one.',
    }

    /** Slot id → settings ref field; labels resolve as `${id}Label`. */
    const SLOTS = { hf: 'hfTokenEnv', ax: 'alphaxivTokenEnv' }

    /**
     * `/feynman` subcommand rows for the bare-invocation picker. Static copy
     * of the host catalog (prompts.js WORKFLOWS + SESSION_COMMANDS); the
     * client bundle cannot import the host module. Internal by design: the
     * `/client` entry exports nothing beyond what cordis loading needs, and
     * `client.test.js` asserts the rendered picker options instead.
     */
    const SUBCOMMANDS = [
      ['deepresearch', '<topic>', 'Source-heavy investigation → research brief'],
      ['lit', '<topic-or-lab>', 'Literature review: consensus, disagreements, open questions'],
      ['review', '<arXiv-ID | URL | file>', 'Internal review with severity-graded feedback'],
      ['review-loop', '<artifact> [rounds=3] | stop', 'Bounded review→fix→re-review loop'],
      ['audit', '<arXiv-ID | repo-URL>', "Paper's claims vs its codebase"],
      ['replicate', '<paper | claim>', 'Source-backed replication plan'],
      ['recipe', '<training-task>', 'Ranked implementable ML training recipes'],
      ['compare', '<topic | paper-IDs>', 'Agreement/disagreement matrix'],
      ['draft', '<topic | --from-session>', 'Paper-style draft from findings'],
      ['autoresearch', '<idea>', 'Hypothesis→experiment→analysis→decision loop'],
      ['watch', '<topic>', 'Baseline survey + refresh plan'],
      ['rank', '<topic> [flags]', 'Read-first paper ranking (PaperRank)'],
      ['paper', '<id> [--fetch-full-text] [--json]', 'Legal full-text access candidates'],
      ['preview', '[artifact-path]', 'Render an artifact via pandoc'],
      ['log', '', 'Write a durable session log'],
      ['jobs', '', 'Inspect background-job state'],
      ['help', '', 'Show grouped research commands'],
      ['feynman-model', '', 'How to change the model route'],
      ['init', '', 'Bootstrap AGENTS.md and session-log folders'],
      ['outputs', '', 'Browse research artifacts'],
      ['btw', '<question>', 'Side question as non-waking context'],
      ['thinking', '[level]', 'Note a thinking level'],
      ['search', '<query>', 'Search prior session transcripts'],
      ['web-results', '', 'List web sources fetched this session'],
      ['keys', '', 'Show or store research API keys'],
      ['doctor', '', 'Diagnose keys, seams, pandoc, card'],
      ['status', '', 'Setup summary'],
    ]

    /** Configured-state word; absent state renders as ellipsis. */
    const word = (t, state) => state === undefined ? '…' : t(state.configured ? 'set' : 'unset')

    function refsOf(snapshot) {
      const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {}
      return {
        hfTokenEnv: typeof value.hfTokenEnv === 'string' ? value.hfTokenEnv : 'HF_TOKEN',
        alphaxivTokenEnv: typeof value.alphaxivTokenEnv === 'string' ? value.alphaxivTokenEnv : 'ALPHAXIV_API_KEY',
      }
    }

    /**
     * One key row: status badge, password input, save/clear.
     * The staged literal lives in component state and is cleared on save.
     * @param remote - the browser remote context for credential writes.
     */
    function KeyRow(props) {
      // NOTE: `ref` is reserved by React and never arrives as a prop —
      // the credential reference rides `credRef` instead.
      const { t, remote, label, credRef, state, onRefresh } = props
      const [staged, setStaged] = React.useState('')
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const run = async (fn) => {
        setError(null)
        setBusy(true)
        try {
          const response = await fn()
          if (!response.ok) setError(response.error.message)
          else setStaged('')
          onRefresh()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        } finally {
          setBusy(false)
        }
      }

      return React.createElement(
        'div',
        { className: 'rk-field' },
        React.createElement('span', { className: 'rk-label' }, label),
        React.createElement('span', { className: 'rk-badge' }, `${credRef}: ${word(t, state)}`),
        React.createElement(
          'div',
          { className: 'rk-row' },
          React.createElement('input', {
            type: 'password',
            className: 'rk-input',
            value: staged,
            autoComplete: 'off',
            spellCheck: false,
            disabled: busy || !state.writable,
            onChange: (event) => { setStaged(event.target.value) },
          }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'rk-btn',
              disabled: busy || !state.writable || staged === '',
              onClick: () => { void run(() => remote.credentials.set(credRef, staged)) },
            },
            t('save'),
          ),
          state.configured
            ? React.createElement(
              'button',
              {
                type: 'button',
                className: 'rk-btn',
                disabled: busy || !state.writable,
                onClick: () => { void run(() => remote.credentials.unset(credRef)) },
              },
              t('clear'),
            )
            : null,
        ),
        error === null ? null : React.createElement('div', { className: 'rk-error' }, error),
      )
    }

    function createCard(scope, remote, t) {
      const useKeys = () => React.useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot(),
      )
      /** Live card refreshers, so a key written elsewhere updates open cards. */
      const refreshers = new Set()

      const Card = function ResearchKeysCard() {
        const snapshot = useKeys()
        const [open, setOpen] = React.useState(false)
        // configured/writable per slot id; absent until described.
        const [states, setStates] = React.useState({})

        if (snapshot.status !== 'ready') return null
        const refs = refsOf(snapshot)

        const refresh = async () => {
          const entries = await Promise.all(Object.entries(SLOTS).map(async ([id, refField]) => {
            const response = await remote.credentials.describe([refs[refField]]).catch(() => undefined)
            // Coerce at the wire boundary: only strict booleans reach state,
            // so no response shape can ever render as a child.
            const view = response !== null && typeof response === 'object' && response.ok === true
              ? response.value?.[refs[refField]]
              : undefined
            const info = view !== null && typeof view === 'object' ? view : undefined
            return [id, { configured: info?.configured === true, writable: info?.writable !== false }]
          }))
          setStates(Object.fromEntries(entries))
        }

        React.useEffect(() => {
          refreshers.add(refresh)
          return () => { refreshers.delete(refresh) }
        }, [])

        const statusWord = (id) => word(t, states[id])

        return React.createElement(
          'li',
          { className: `rk-card${open ? ' rk-card-open' : ''}` },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'rk-header',
              'aria-expanded': open,
              'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('card')} ${t('version', { version: VERSION })}`,
              onClick: () => {
                const next = !open
                setOpen(next)
                if (next) void refresh()
              },
            },
            React.createElement(
              'span',
              { className: 'rk-head' },
              React.createElement('span', { className: 'rk-name' }, `${t('card')} ${t('version', { version: VERSION })}`),
              React.createElement(
                'span',
                { className: 'rk-desc' },
                t('description', { hf: statusWord('hf'), ax: statusWord('ax') }),
              ),
            ),
            React.createElement('span', {
              className: open ? 'rk-chevron rk-chevron-open' : 'rk-chevron',
              'aria-hidden': true,
            }),
          ),
          open
            ? React.createElement(
              'div',
              { className: 'rk-body' },
              Object.entries(SLOTS).map(([id, refField]) => React.createElement(KeyRow, {
                key: id,
                t,
                remote,
                label: `${t(`${id}Label`)} (${refs[refField]})`,
                credRef: refs[refField],
                state: states[id] ?? { configured: false, writable: true },
                onRefresh: () => { void refresh() },
              })),
              React.createElement('div', { className: 'rk-hint' }, `${t('hint')} ${t('envNote')}`),
            )
            : null,
        )
      }

      return { Card, refreshers }
    }

    /**
     * Mount the card: locale, scope, slot registration, credential invalidation.
     * Plus the `/feynman` bare-invocation picker: a subcommand popup whose
     * pick submits the completed `/feynman <sub>` line back through the host,
     * so the row offers subcommand completion the catalog row cannot.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NAMESPACE)
      // Single-locale registration: English is the documented fallback locale,
      // and the per-key fallback resolves every other language. Registering a
      // second namespace entry here would shadow later dictionaries.
      ctx.effect(
        () => ctx.locale.register(NAMESPACE, 'en', en),
        'dsh-feynman: locale dictionary',
      )

      const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
      const { Card, refreshers } = createCard(scope, ctx.remote, t)

      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: NAMESPACE,
      }, Card))

      ctx.effect(
        () => ctx.remote.$on('credentials/reference-updated', () => {
          for (const refresh of refreshers) void refresh()
        }),
        'dsh-feynman: credential invalidations',
      )

      ctx.effect(() => ctx.commandUi.decorate({
        name: 'feynman',
        available: () => true,
        ui: {
          kind: 'popupSelect',
          options: () => Promise.resolve(SUBCOMMANDS.map(([id, hint, detail]) => ({
            id,
            label: hint ? `/feynman ${id} ${hint}` : `/feynman ${id}`,
            ...(detail === undefined ? {} : { detail }),
          }))),
          onSelect: async (option, session) => {
            const live = ctx.sessions.binding(session.sessionId)?.session
            if (live === undefined) throw new Error('this session is not materialized yet')
            const result = await live.command(`/feynman ${option.id} `)
            if (!result.ok) throw new Error(`subcommand submit failed: ${result.error.code}: ${result.error.message}`)
            if (!result.value.matched) throw new Error('the host offers no /feynman command')
          },
        },
      }), 'dsh-feynman: /feynman subcommand picker')
    }

    exports.apply = apply
    exports.inject = ['slots', 'settingsScope', 'locale', 'remote', 'remote.credentials', 'commandUi', 'sessions']
    return module.exports
  },
})
