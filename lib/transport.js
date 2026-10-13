import { AsyncLocalStorage } from 'node:async_hooks'

const requests = new AsyncLocalStorage()

export function withResearchRequest(options, run) {
  return requests.run(options, run)
}

/** Per-call cancellation and credentials; never mutate the host's fetch or environment. */
export async function researchFetch(input, init = {}) {
  const request = requests.getStore() ?? {}
  request.signal?.throwIfAborted()
  const url = new URL(input instanceof Request ? input.url : String(input))
  const headers = new Headers(init.headers)
  if (url.hostname === 'huggingface.co' && request.hfToken) headers.set('Authorization', `Bearer ${request.hfToken}`)
  if (url.hostname === 'api.openalex.org' && request.openalexToken) url.searchParams.set('api_key', request.openalexToken)
  if (url.hostname === 'api.semanticscholar.org' && request.semanticToken) headers.set('x-api-key', request.semanticToken)
  const signals = [init.signal, request.signal, AbortSignal.timeout(30000)].filter(Boolean)
  return globalThis.fetch(url, { ...init, headers, signal: AbortSignal.any(signals) })
}
