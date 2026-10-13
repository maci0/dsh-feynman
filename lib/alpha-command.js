import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isLoggedIn, logout } from '@companion-ai/alpha-hub/lib'
import { verifyLogin } from '@companion-ai/alpha-hub/lib/auth'
import { randomUUID } from 'node:crypto'

export function parseAlphaArgs(raw) {
  const tokens = (raw.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^(["'])([\s\S]*)\1$/, '$2'))
  const action = tokens.shift()?.toLowerCase() ?? 'status'
  if (['login', 'logout', 'status'].includes(action)) return { action, rest: tokens.join(' ') }
  if (action === 'search') {
    let mode = 'semantic'
    const position = tokens.indexOf('--mode')
    if (position >= 0) { mode = tokens[position + 1]; tokens.splice(position, 2) }
    if (!['semantic', 'keyword', 'both', 'agentic', 'all'].includes(mode) || tokens.some((token) => token.startsWith('--'))) throw new Error('Usage: /feynman alpha search <query> [--mode semantic|keyword|both|agentic|all]')
    return { action, name: 'alpha_search', args: { query: tokens.join(' '), mode } }
  }
  if (action === 'get') {
    const fullText = tokens.includes('--full-text')
    const paper = tokens.filter((token) => token !== '--full-text').join(' ')
    if (paper.includes('--')) throw new Error('Usage: /feynman alpha get <paper> [--full-text]')
    return { action, name: 'alpha_get_paper', args: { paper, fullText } }
  }
  if (action === 'ask') return { action, name: 'alpha_ask_paper', args: { paper: tokens.shift() ?? '', question: tokens.join(' ') } }
  if (action === 'code') return { action, name: 'alpha_read_code', args: { githubUrl: tokens.shift() ?? '', path: tokens.join(' ') || '/' } }
  if (action === 'annotate') {
    if (tokens.length === 1 && tokens[0] === '--list') return { action, name: 'alpha_list_annotations', args: {} }
    const clear = tokens.includes('--clear')
    const filtered = tokens.filter((token) => token !== '--clear')
    return { action, name: 'alpha_annotate_paper', args: { paper: filtered.shift() ?? '', ...(clear ? { clear: true } : { note: filtered.join(' ') }) } }
  }
  throw new Error('Usage: /feynman alpha login|logout|status|search|get|ask|code|annotate')
}

/** OAuth stays in the bundled client's isolated process; only its consent URL crosses into chat. */
export async function alphaCommand(invocation, state, notify) {
  const parsed = parseAlphaArgs(invocation.rawInput)
  if (parsed.action === 'status') {
    if (parsed.rest) throw new Error('Usage: /feynman alpha status')
    const status = await verifyLogin()
    state.research?.refresh(status.loggedIn)
    return status.loggedIn ? 'AlphaXiv sign-in verified; authenticated tools are mounted when the tools service is available.' : 'AlphaXiv is not signed in or its session expired. Use /feynman alpha login.'
  }
  if (parsed.action === 'logout') {
    if (parsed.rest) throw new Error('Usage: /feynman alpha logout')
    state.loginProcess?.kill()
    logout()
    state.research?.refresh()
    return 'AlphaXiv signed out; account tools removed. Local annotations remain available.'
  }
  if (parsed.action === 'login') {
    if (parsed.rest) {
      const callback = new URL(parsed.rest)
      if (!state.loginProcess || callback.origin !== 'http://127.0.0.1:9876' || callback.pathname !== '/callback') throw new Error('Pass the callback URL only while an AlphaXiv login is running')
      state.loginProcess.stdin.write(`${parsed.rest}\n`)
      return 'Callback sent to the login process; waiting for the account result.'
    }
    if (state.loginProcess) return 'AlphaXiv login is already running; finish the browser sign-in or use /feynman alpha logout to cancel.'
    const cli = fileURLToPath(new URL('../../bin/alpha', import.meta.resolve('@companion-ai/alpha-hub/lib')))
    const child = spawn(process.execPath, [cli, 'login'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ALPHA_HUB_CLI: '/feynman alpha' } })
    state.loginProcess = child
    return await new Promise((resolve, reject) => {
      let settled = false
      let output = ''
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; child.kill(); reject(new Error('AlphaXiv login did not provide a consent URL within 30 seconds')) }
      }, 30000)
      const capture = (chunk) => {
        output = (output + chunk.toString()).slice(-12000)
        const url = /https:\/\/api\.alphaxiv\.org\/auth\/oauth2\/authorize\?[^\s]+/.exec(output)?.[0]
        if (!settled && url) {
          settled = true; clearTimeout(timeout)
          resolve(`Sign in to AlphaXiv: ${url}\nOn a remote host, paste the final callback URL with /feynman alpha login <callback-URL>.`)
        }
      }
      child.stdout.on('data', capture)
      child.stderr.on('data', capture)
      child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timeout); reject(error) } })
      child.on('close', (code) => {
        clearTimeout(timeout)
        if (state.loginProcess === child) state.loginProcess = undefined
        if (code === 0 && isLoggedIn()) {
          if (!state.disposed) state.research?.refresh()
          if (!settled) { settled = true; resolve('AlphaXiv sign-in completed.') }
          else notify('AlphaXiv sign-in completed; authenticated research tools are now available.')
        } else if (!settled) { settled = true; reject(new Error('AlphaXiv sign-in failed; retry /feynman alpha login.')) }
        else notify('AlphaXiv sign-in did not complete. Use /feynman alpha login to retry.')
      })
    })
  }
  if (Object.values(parsed.args).some((value) => typeof value === 'string' && !value)) throw new Error(`Missing argument for /feynman alpha ${parsed.action}`)
  const tool = state.research?.tools.find((entry) => entry.name === parsed.name)
  if (!tool) throw new Error('AlphaXiv account tool unavailable; sign in with /feynman alpha login or use the literature tools')
  if (!state.toolRuntime?.execute) throw new Error('The DSH tools execution service is unavailable')
  const outcome = await state.toolRuntime.execute({ name: parsed.name, arguments: parsed.args, agent: invocation.agent, signal: invocation.signal ?? new AbortController().signal, callId: randomUUID() })
  if (outcome.isError) throw new Error(outcome.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n') || 'AlphaXiv tool failed')
  const value = outcome.value
  const text = value.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  return text.length <= 16000 ? text : `${text.slice(0, 16000)}\n[truncated; use the model-facing AlphaXiv tool for further inspection]`
}
