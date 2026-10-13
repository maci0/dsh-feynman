import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'

const WEB_TOOLS = new Set(['web_search', 'web_fetch', 'fetch_content', 'code_search'])

export function storedWebResults(session, query = '') {
  const calls = new Map()
  const results = []
  for (const event of session.snapshotEvents?.() ?? []) {
    if (event.type === 'tool/call') calls.set(event.data.callId, event.data)
    if (event.type !== 'tool/result') continue
    const message = event.data.message
    const call = calls.get(message.toolCallId)
    if (!call || !WEB_TOOLS.has(call.name)) continue
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
    if (query && !`${call.arguments}\n${text}`.toLowerCase().includes(query.toLowerCase())) continue
    results.push({ id: call.callId, tool: call.name, query: call.arguments, isError: message.isError, text })
  }
  return results
}

export function createSearchContentTool() {
  return defineTool({
    name: 'feynman_search_content',
    description: 'Read bounded content of a web result already stored in this DSH session. Use /feynman search to browse result IDs; omit id for the latest result.',
    parameters: { id: { type: 'string' }, maxChars: { type: 'integer' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const results = storedWebResults(exec.agent?.session ?? {})
      const result = args.id ? results.find((item) => item.id === args.id) : results.at(-1)
      if (!result) throw new Error('No matching stored web result in this session')
      const limit = Math.max(1, Math.min(args.maxChars ?? 16000, 60000))
      return { ...result, text: result.text.slice(0, limit), truncated: result.text.length > limit }
    },
  })
}

export function createCodeSearchTool(runtime) {
  return defineTool({
    name: 'code_search',
    description: 'Find public code examples and repository documentation through the host web_search provider. Inspect returned source files before treating a snippet as implementation evidence.',
    parameters: { query: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => value.content },
    async execute({ query }, exec) {
      exec.signal.throwIfAborted()
      if (!query.trim()) throw new Error('Code search requires a query')
      const schema = runtime.schemas().find((tool) => tool.name === 'web_search')
      if (!schema) throw new Error('The host web_search tool is not mounted')
      const search = `${query} (site:github.com OR site:readthedocs.io OR site:docs.rs)`
      const properties = schema.parameters.properties ?? {}
      const args = Object.hasOwn(properties, 'queries') ? { queries: [search] } : Object.hasOwn(properties, 'query') ? { query: search } : undefined
      if (!args) throw new Error('The mounted web_search schema has no supported query field')
      const result = await runtime.execute({ callId: randomUUID(), rootCallId: exec.rootCallId, parent: exec.token, agent: exec.agent, signal: exec.signal, name: 'web_search', arguments: args })
      if (result.isError) throw new Error(result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'))
      for (const context of result.additionalContexts ?? []) exec.deferContext(context)
      return { query, content: result.content, data: result.value }
    },
  })
}
