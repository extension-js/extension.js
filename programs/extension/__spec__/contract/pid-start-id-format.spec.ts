import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {pidStartId} from '../../browsers/browsers-lib/resolve-live-pid'

const here = path.dirname(fileURLToPath(import.meta.url))

function sourceOf(relative: string): string {
  return fs
    .readFileSync(path.resolve(here, relative), 'utf8')
    .replace(/\r\n/g, '\n')
}

// The body of one exported function, cut at the next top-level declaration.
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`)

  expect(start, `${name} is declared`).toBeGreaterThan(-1)

  const end = source.indexOf('\n}\n', start)

  return source.slice(start, end)
}

// The steps that decide what the id is. The engine writes it and the CLI
// compares it, so one side reading another field would never match.
const FORMAT_STEPS = [
  `\`/proc/\${pid}/stat\``,
  "stat.lastIndexOf(')') + 2",
  ".split(' ')",
  'afterName[19]',
  "'/proc/sys/kernel/random/boot_id'",
  '.trim()',
  '/^\\d+$/.test(String(startTicks))',
  `return \`\${bootId}:\${startTicks}\``
]

describe('the process start id the CLI compares', () => {
  const engine = functionBody(
    sourceOf('../../../develop/lib/process-started-at.ts'),
    'processStartId'
  )
  const cli = functionBody(
    sourceOf('../../browsers/browsers-lib/resolve-live-pid.ts'),
    'pidStartId'
  )

  it.each(FORMAT_STEPS)('is built with %s on both sides', (step) => {
    expect(engine).toContain(step)
    expect(cli).toContain(step)
  })

  it('is read on Linux alone on both sides', () => {
    expect(engine).toContain("!== 'linux') return undefined")
    expect(cli).toContain("!== 'linux') return undefined")
  })

  it('is the field the engine writes and carries across a rewrite', () => {
    const writer = sourceOf('../../../develop/plugin-playwright/index.ts')

    expect(writer).toContain('pidStartId: ownProcessStartId()')
    expect(writer).toContain("  'pidStartId',\n")
  })

  it('gives the engine and the CLI one answer for one process table', () => {
    const files: Record<string, string> = {
      '/proc/77/stat':
        '77 (a (b) c) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 424242 0\n',
      '/proc/sys/kernel/random/boot_id': 'boot-a\n'
    }

    expect(
      pidStartId(77, {platform: 'linux', readFile: (file) => files[file]})
    ).toBe('boot-a:424242')
  })
})
