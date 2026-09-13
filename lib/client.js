/**
 * dsh-researcher — browser half.
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
  id: 'dsh-researcher',

  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** Settings namespace shared with the host half; also this card's slot key. */
    const NAMESPACE = 'research-keys'

    /** Locale namespace for this plugin's copy. */
    const LOCALE_NS = 'research-keys'

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

    const zh = {
      card: '研究密钥',
      description: 'Hugging Face：{hf}。AlphaXiv：{ax}。',
      set: '已设置',
      unset: '未设置',
      expand: '展开',
      collapse: '收起',
      hfLabel: 'Hugging Face API 密钥',
      axLabel: 'AlphaXiv API 密钥',
      save: '保存',
      clear: '清除',
      hint: '密钥保存在托管凭据文件中，不会进入设置。空输入不会清除；请使用“清除”。',
      envNote: '环境中导出的密钥优先于已存储的密钥。',
    }

    /** The two key slots, in card order. */
    const SLOTS = [
      { id: 'hf', label: 'hfLabel', refField: 'hfTokenEnv' },
      { id: 'ax', label: 'axLabel', refField: 'alphaxivTokenEnv' },
    ]

    function useScope(scope) {
      const subscribe = (listener) => scope.subscribe(listener)
      const getSnapshot = () => scope.getSnapshot()
      return () => React.useSyncExternalStore(subscribe, getSnapshot)
    }

    function refsOf(snapshot) {
      const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {}
      return {
        hfTokenEnv: typeof value.hfTokenEnv === 'string' ? value.hfTokenEnv : 'HF_TOKEN',
        alphaxivTokenEnv: typeof value.alphaxivTokenEnv === 'string' ? value.alphaxivTokenEnv : 'ALPHAXIV_API_KEY',
      }
    }

    /**
     * Describe/set/clear credentials through the remote domain.
     * @param remote - the browser remote context.
     * @returns the three operations the card calls.
     */
    function credentialOps(remote) {
      return {
        describe: async (ref) => {
          const response = await remote.credentials.describe([ref])
          return response.ok ? response.value[ref] : undefined
        },
        save: async (ref, value) => {
          const response = await remote.credentials.set(ref, value)
          return response.ok ? undefined : response.error.message
        },
        clear: async (ref) => {
          const response = await remote.credentials.unset(ref)
          return response.ok ? undefined : response.error.message
        },
      }
    }

    /**
     * One key row: status badge, password input, save/clear.
     * The staged literal lives in component state and is cleared on save.
     */
    function KeyRow(props) {
      const { t, ops, label, ref, state, onRefresh } = props
      const [staged, setStaged] = React.useState('')
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const run = async (fn) => {
        setError(null)
        setBusy(true)
        try {
          const message = await fn()
          if (message !== undefined) setError(message)
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
        React.createElement('span', { className: 'rk-badge' }, `${ref}: ${state.configured ? t('set') : t('unset')}`),
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
              onClick: () => { void run(() => ops.save(ref, staged)) },
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
                onClick: () => { void run(() => ops.clear(ref)) },
              },
              t('clear'),
            )
            : null,
        ),
        error === null ? null : React.createElement('div', { className: 'rk-error' }, error),
      )
    }

    function createCard(scope, remote, t) {
      const useKeys = useScope(scope)
      const ops = credentialOps(remote)
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
          const entries = await Promise.all(SLOTS.map(async (slot) => {
            const view = await ops.describe(refs[slot.refField]).catch(() => undefined)
            return [slot.id, { configured: view?.configured ?? false, writable: view?.writable ?? true }]
          }))
          setStates(Object.fromEntries(entries))
        }

        React.useEffect(() => {
          refreshers.add(refresh)
          return () => { refreshers.delete(refresh) }
        }, [])

        const statusWord = (id) => {
          const state = states[id]
          if (state === undefined) return '…'
          return state.configured ? t('set') : t('unset')
        }

        return React.createElement(
          'li',
          { className: `rk-card${open ? ' rk-card-open' : ''}` },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'rk-header',
              'aria-expanded': open,
              'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('card')}`,
              onClick: () => {
                const next = !open
                setOpen(next)
                if (next) void refresh()
              },
            },
            React.createElement(
              'span',
              { className: 'rk-head' },
              React.createElement('span', { className: 'rk-name' }, t('card')),
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
              SLOTS.map((slot) => React.createElement(KeyRow, {
                key: slot.id,
                t,
                ops,
                label: `${t(slot.label)} (${refs[slot.refField]})`,
                ref: refs[slot.refField],
                state: states[slot.id] ?? { configured: false, writable: true },
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
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(LOCALE_NS)
      ctx.effect(
        () => ctx.locale.register(LOCALE_NS, { en, zh }),
        'dsh-researcher: locale dictionary',
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
        'dsh-researcher: credential invalidations',
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'settingsScope', 'locale', 'remote', 'remote.credentials']
    return module.exports
  },
})
