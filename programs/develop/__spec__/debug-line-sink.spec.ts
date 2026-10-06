import {globSync, readFileSync} from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {blankOutLiterals} from './helpers/blank-out-literals'

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
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file !== SINK)
    .sort()
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
