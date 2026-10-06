import {globSync, readFileSync} from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const packageRoot = path.join(__dirname, '..')
const SINK = 'lib/messaging.ts'

const DEBUG_TOKEN =
  /isDebug\(\)|\bdebug\b|authorMode|isAuthor|EXTENSION_DEBUG|EXTENSION_DEV_DEBUG|debugHtmlHmr/

function isExcludedPath(entry: string): boolean {
  return (
    /(^|[\\/])(node_modules|dist|\.git|\.tmp-tests|__spec__)([\\/]|$)/.test(
      entry
    ) || /\.spec\.tsx?$/.test(entry)
  )
}

function sourceFiles(): string[] {
  return globSync(['**/*.ts'], {cwd: packageRoot, exclude: isExcludedPath})
    .filter((file) => file !== SINK)
    .sort()
}

interface Scan {
  code: string
  lineOf: (index: number) => number
}

function startsRegex(source: string, slash: number): boolean {
  let k = slash - 1
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k--
  if (k < 0) return true

  const prev = source[k]
  if ('(,=:[!&|?{};\n'.includes(prev)) return true

  return /\breturn$/.test(source.slice(Math.max(0, k - 6), k + 1))
}

function blankOutLiterals(source: string): Scan {
  const out = source.split('')
  let i = 0
  const templateDepth: number[] = []

  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? source.length : end
      blank(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && startsRegex(source, i)) {
      let j = i + 1
      let inClass = false

      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') {
          j += 2
          continue
        }

        if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break

        j++
      }

      blank(i + 1, j)
      i = j + 1
      continue
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1

      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        if (source[j] === '\\') j++

        j++
      }

      blank(i + 1, j)
      i = j + 1
      continue
    }

    if (ch === '`') {
      let j = i + 1

      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2
          continue
        }

        if (source[j] === '`') break

        if (source[j] === '$' && source[j + 1] === '{') {
          templateDepth.push(1)
          j += 2

          while (j < source.length && templateDepth.length > 0) {
            if (source[j] === '{') templateDepth[templateDepth.length - 1]++
            if (source[j] === '}') templateDepth[templateDepth.length - 1]--

            if (templateDepth[templateDepth.length - 1] === 0) {
              templateDepth.pop()
              break
            }

            j++
          }
        }

        j++
      }

      blank(i + 1, j)
      i = j + 1
      continue
    }

    i++
  }

  const code = out.join('')
  const lineStarts = [0]

  for (let k = 0; k < source.length; k++) {
    if (source[k] === '\n') lineStarts.push(k + 1)
  }

  return {
    code,
    lineOf: (index) => {
      let lo = 0
      let hi = lineStarts.length - 1

      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= index) lo = mid
        else hi = mid - 1
      }

      return lo + 1
    }
  }
}

function headerBefore(code: string, braceIndex: number): string {
  let start = braceIndex - 1
  while (start >= 0 && !'{};'.includes(code[start])) start--

  return code.slice(start + 1, braceIndex)
}

function opensDebugPath(header: string): boolean {
  const lastIf = header.match(/\bif\s*\(((?:(?!\bif\s*\().)*)\)\s*$/s)
  if (lastIf && DEBUG_TOKEN.test(lastIf[1])) return true

  if (/\?\s*$/.test(header)) {
    const tail = header.slice(
      Math.max(header.lastIndexOf(','), header.lastIndexOf('(')) + 1
    )

    return DEBUG_TOKEN.test(tail)
  }

  return false
}

function callText(code: string, openParen: number): string {
  let depth = 0

  for (let k = openParen; k < code.length; k++) {
    if (code[k] === '(') depth++
    if (code[k] === ')') depth--
    if (depth === 0) return code.slice(openParen, k + 1)
  }

  return code.slice(openParen)
}

function bareDebugLogs(source: string, file: string): string[] {
  const {code, lineOf} = blankOutLiterals(source)
  const hits: string[] = []
  const openBlocks: boolean[] = []

  for (let k = 0; k < code.length; k++) {
    const ch = code[k]

    if (ch === '{') {
      openBlocks.push(opensDebugPath(headerBefore(code, k)))
      continue
    }

    if (ch === '}') {
      openBlocks.pop()
      continue
    }

    if (code.startsWith('console.log(', k)) {
      const args = callText(code, k + 'console.log'.length)
      const rawArgs = source.slice(k, k + args.length + 'console.log'.length)
      const inDebugBlock = openBlocks.includes(true)
      const debugArgs = /prefix\('debug'\)|messages\.debug/.test(rawArgs)

      if (inDebugBlock || debugArgs) hits.push(`${file}:${lineOf(k)}`)
    }
  }

  return hits
}

function scanTree(): string[] {
  return sourceFiles().flatMap((file) =>
    bareDebugLogs(readFileSync(path.join(packageRoot, file), 'utf8'), file)
  )
}

describe('debug lines reach one sink', () => {
  it('scans a non-empty source tree', () => {
    expect(sourceFiles().length).toBeGreaterThan(100)
  })

  it('flags a console.log under a debug guard and nothing else', () => {
    const sample = [
      "const strip = (s: string) => s.replace(/[`'{]/g, '').replace(/`/g, '')",
      'if (isDebug()) {',
      "  console.log('a')",
      '}',
      'if (ready) {',
      "  console.log('b')",
      '}',
      "console.log(`${prefix('debug')} c`)",
      'const logger = isAuthor',
      '  ? {onInfo: (m) => console.log(m)}',
      '  : undefined',
      "const text = 'if (isDebug()) { console.log(1) }'",
      'if (debug) {',
      "  debugLine('d')",
      '}',
      ''
    ].join('\n')

    expect(bareDebugLogs(sample, 'sample.ts')).toEqual([
      'sample.ts:3',
      'sample.ts:8',
      'sample.ts:10'
    ])
  })

  it('leaves no bare console.log on a debug path', () => {
    expect(scanTree()).toEqual([])
  })
})
