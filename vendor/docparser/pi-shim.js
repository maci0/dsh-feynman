import { Type } from 'typebox'

export const StringEnum = (values, options = {}) => Type.Unsafe({ type: 'string', enum: values, ...options })

function truncate(text, options, tail) {
  const lines = text.split('\n')
  let content = (tail ? lines.slice(-options.maxLines) : lines.slice(0, options.maxLines)).join('\n')
  const chars = [...content]
  let bytes = 0
  let length = 0
  for (const char of tail ? chars.slice().reverse() : chars) {
    const next = Buffer.byteLength(char)
    if (bytes + next > options.maxBytes) break
    bytes += next
    length += 1
  }
  content = (tail ? chars.slice(chars.length - length) : chars.slice(0, length)).join('')
  return { content, truncated: content !== text }
}

export const truncateHead = (text, options) => truncate(text, options, false)
export const truncateTail = (text, options) => truncate(text, options, true)
