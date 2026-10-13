import { defineTool } from '@deepseek-ai/dsh-tools'
import { Value } from 'typebox/value'
import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { disconnect, isLoggedIn } from '@companion-ai/alpha-hub/lib'
import { registerAlphaTools, registerHuggingFaceTools, registerScienceDatabaseTools, withResearchRequest, createNativeExecutor, registerDocumentParseTool, registerDocumentSearchTool, registerDocumentScreenshotTool, docxText } from './upstream.js'

function valueSchema(schema) {
  const clean = JSON.parse(JSON.stringify(schema))
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) delete clean[key]
  if (clean.anyOf) {
    const branches = clean.anyOf.map(valueSchema)
    return { oneOf: branches, ...(clean.description ? { description: clean.description } : {}) }
  }
  if (!clean.type && clean.enum) clean.type = typeof clean.enum[0]
  if (clean.type === 'object') {
    clean.properties = parameterSchema(clean)
    delete clean.required
    clean.additionalProperties ??= true
  }
  if (clean.items) clean.items = valueSchema(clean.items)
  return clean
}

function parameterSchema(schema) {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, child]) => [name, {
    ...valueSchema(child), ...(schema.required?.includes(name) ? { required: true } : {}),
  }]))
}

async function credential(ctx, ref, fallback) {
  if (process.env[ref]) return process.env[ref]
  const stored = await ctx.get?.('credentials')?.resolve?.(ref)
  return stored?.value ?? fallback
}

function redact(value, secrets) {
  const spellings = secrets.filter(Boolean).flatMap((secret) => [secret, encodeURIComponent(secret), new URLSearchParams({ key: secret }).toString().slice(4)])
  const scrub = (node) => {
    if (typeof node === 'string') {
      for (const spelling of spellings) node = node.replaceAll(spelling, '[redacted]')
      return node
    }
    if (Array.isArray(node)) return node.map(scrub)
    if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, child]) => [scrub(key), scrub(child)]))
    return node
  }
  return JSON.parse(JSON.stringify(scrub(value)))
}

/** Keep upstream retrieval and parser fixes behind the DSH tool contract. */
export function createResearchTools(ctx, refs, signedIn = isLoggedIn(), executor = createNativeExecutor()) {
  const upstream = []
  const bridge = { registerTool: (tool) => upstream.push(tool), on: () => {} }
  registerScienceDatabaseTools(bridge)
  registerHuggingFaceTools(bridge)
  registerAlphaTools(bridge, signedIn)
  registerDocumentParseTool(bridge, executor)
  registerDocumentSearchTool(bridge, executor)
  registerDocumentScreenshotTool(bridge, executor)
  return upstream.map((tool) => {
    const defined = defineTool({
      name: tool.name,
      description: [tool.description, ...(tool.promptGuidelines ?? [])].join('\n'),
      parameters: parameterSchema(tool.parameters),
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => value.content,
      },
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        if (!Value.Check(tool.parameters, args)) throw new Error(`Invalid arguments for ${tool.name}`)
        const cwd = ctx.get?.('workingDirectory')?.get?.(exec.agent?.session) ?? exec.agent?.session?.header?.cwd
        let documentPath
        if (tool.name.startsWith('document_')) {
          if (!cwd) throw new Error('Document tools require a session workspace directory')
          const root = await realpath(cwd)
          documentPath = await realpath(resolve(root, args.path.replace(/^@/, '')))
          const local = relative(root, documentPath)
          if (local === '..' || local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(local)) {
            throw new Error('Document path is outside the session workspace')
          }
          args = { ...args, path: documentPath }
          if (args.tessdataPath) {
            const tessdataPath = await realpath(resolve(root, args.tessdataPath))
            const relativeData = relative(root, tessdataPath)
            if (relativeData === '..' || relativeData.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativeData)) throw new Error('OCR data path is outside the session workspace')
            args = { ...args, tessdataPath }
          }
        }
        const live = refs()
        const [hfToken, openalexToken, semanticToken] = await Promise.all([
          credential(ctx, live.hfTokenEnv, process.env.HUGGINGFACE_HUB_TOKEN),
          credential(ctx, 'OPENALEX_API_KEY'), credential(ctx, 'SEMANTIC_SCHOLAR_API_KEY'),
        ])
        const secrets = [hfToken, openalexToken, semanticToken, process.env.NCBI_API_KEY, process.env[live.alphaxivTokenEnv]]
        try {
          let result
          try {
            result = await withResearchRequest({ signal: exec.signal, hfToken, openalexToken, semanticToken },
              () => tool.execute(exec.callId, args, exec.signal, undefined, { cwd }))
          } catch (error) {
            // Native document tools throw; Pi's tool-result hook received an error block.
            if (tool.name !== 'document_parse' || !/\.doc[xm]$/i.test(documentPath ?? '') || !error.message?.includes('LibreOffice is not installed')) throw error
            result = { isError: true, content: [{ type: 'text', text: error.message }] }
          }
          if (tool.name === 'document_parse' && result.isError && /\.doc[xm]$/i.test(documentPath ?? '')
            && result.content?.some((part) => part.text?.includes('LibreOffice is not installed'))) {
            if ((await stat(documentPath)).size > 32 * 1024 * 1024) throw new Error('DOCX is too large for the paragraph-text fallback; install LibreOffice for the full parser')
            const text = docxText(await readFile(documentPath))
            if (text) {
              exec.signal.throwIfAborted()
              const outputPath = join(await mkdtemp(join(tmpdir(), 'feynman-docx-')), 'parsed.txt')
              await writeFile(outputPath, text)
              result = { content: [{ type: 'text', text: `DOCX paragraph-text fallback; layout, table structure, footnotes, and images are unverified. Full paragraph text saved to: ${outputPath}. Use read for the complete output.\n\n${text.slice(0, 60000)}` }], details: { path: documentPath, outputPath, fallback: true, truncated: text.length > 60000 } }
            }
          }
          exec.signal.throwIfAborted()
          if (result.isError) throw new Error(result.content?.map((part) => part.text ?? '').join('\n') || 'Research tool failed')
          result = { ...result, content: await Promise.all(result.content.map(async (part) => {
            if (part.type !== 'image') return part
            const store = ctx.get?.('attachments')
            if (!store?.saveImage) return { type: 'text', text: 'Screenshot saved on disk; inline image delivery is unavailable without the attachments service.' }
            return { type: 'image', attachment: await store.saveImage({ data: Buffer.from(part.data, 'base64'), mediaType: part.mimeType }) }
          })) }
          return redact(result, secrets)
        } catch (error) {
          if (exec.signal.aborted) throw exec.signal.reason
          throw new Error(redact({ message: error instanceof Error ? error.message : String(error) }, secrets).message)
        }
      },
    })
    return { ...defined, execute: (args, exec) => defined.execute(tool.prepareArguments?.(args) ?? args, exec) }
  })
}

export function mountResearchTools(ctx, refs) {
  const executor = createNativeExecutor()
  let disposers = []
  let tools = []
  const refresh = (signedIn = isLoggedIn()) => {
    for (const dispose of disposers) dispose()
    tools = createResearchTools(ctx, refs, signedIn, executor)
    disposers = tools.map((tool) => ctx.tools.register(tool))
    return tools
  }
  refresh()
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    return Promise.all([disconnect(), executor.dispose()])
  })
  return { refresh, get tools() { return tools } }
}
