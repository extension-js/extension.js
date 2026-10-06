import {existsSync, globSync, readFileSync} from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {blankOutLiterals} from './helpers/blank-out-literals'

const packageRoot = path.join(__dirname, '..')

const PRINTERS: Record<string, string> = {
  'lib/messaging.ts': 'the human and debug sinks',
  'dev-server/lifecycle-stream.ts': 'the frame printer and its human line',
  'lib/branding.ts': 'the console facade handed to the bundler logger',
  'plugin-reload/reload-lib/minimum-files/minimum-background-file-chromium.ts':
    'runs inside the browser',
  'plugin-reload/reload-lib/minimum-files/minimum-background-file-firefox.ts':
    'runs inside the browser'
}

function isExcludedPath(entry: string): boolean {
  return (
    /(^|[\\/])(node_modules|dist|\.git|\.tmp-tests|__spec__)([\\/]|$)/.test(
      entry
    ) || /\.spec\.tsx?$/.test(entry)
  )
}

function isPrinter(file: string): boolean {
  return file.replace(/\\/g, '/') in PRINTERS
}

function sourceFiles(): string[] {
  return globSync(['**/*.ts'], {cwd: packageRoot, exclude: isExcludedPath})
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !isPrinter(file))
    .sort()
}

function bareConsoleLogs(source: string, file: string): string[] {
  const {code, lineOf} = blankOutLiterals(source)
  const hits: string[] = []
  let from = 0

  while (true) {
    const k = code.indexOf('console.log(', from)
    if (k < 0) break

    hits.push(`${file}:${lineOf(k)}`)
    from = k + 1
  }

  return hits
}

function scanTree(): string[] {
  return sourceFiles().flatMap((file) =>
    bareConsoleLogs(readFileSync(path.join(packageRoot, file), 'utf8'), file)
  )
}

describe('human lines reach one printer', () => {
  it('scans a non-empty source tree', () => {
    expect(sourceFiles().length).toBeGreaterThan(100)
  })

  it('names only printers that exist', () => {
    for (const file of Object.keys(PRINTERS)) {
      expect(existsSync(path.join(packageRoot, file)), file).toBe(true)
    }
  })

  it('recognises a printer by a backslash path as well', () => {
    expect(isPrinter('lib\\messaging.ts')).toBe(true)
    expect(isPrinter('dev-server\\lifecycle-stream.ts')).toBe(true)
    expect(isPrinter('lib\\messages.ts')).toBe(false)
  })

  it('flags a console.log in code and nothing inside a literal', () => {
    const sample = [
      "console.log('a')",
      "const code = 'console.log(1)'",
      'const runtime = `function (t) { console.log(t); }`',
      '// console.log(2)',
      "humanLine('b')",
      'if (ready) {',
      "  console.log('c')",
      '}',
      ''
    ].join('\n')

    expect(bareConsoleLogs(sample, 'sample.ts')).toEqual([
      'sample.ts:1',
      'sample.ts:7'
    ])
  })

  it('leaves no bare console.log outside the printers', () => {
    expect(scanTree()).toEqual([])
  })
})
