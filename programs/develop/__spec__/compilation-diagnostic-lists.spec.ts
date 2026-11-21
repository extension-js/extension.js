import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..')

function productSources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'dist', '__spec__'].includes(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) productSources(full, found)
    else if (
      /\.[cm]?tsx?$/.test(entry.name) &&
      !entry.name.includes('.spec.')
    ) {
      found.push(full)
    }
  }

  return found
}

// A guard on a list that is always there: a default, an optional call or a
// non-null mark on the warnings or errors of a compilation.
const GUARD = /compilation\.(?:warnings|errors)(?:\s*\|\||[!?]\.)/

describe('the warnings and errors of a compilation', () => {
  it('reads the three spellings of a guard and leaves a plain push alone', () => {
    expect(
      GUARD.test('compilation.warnings = compilation.warnings || []')
    ).toBe(true)

    expect(GUARD.test('this.compilation.errors ||= []')).toBe(true)
    expect(GUARD.test('compilation.warnings?.push(warn)')).toBe(true)
    expect(GUARD.test('compilation.errors!.push(err)')).toBe(true)
    expect(GUARD.test(';(compilation.errors ||= []).push(err)')).toBe(true)
    expect(GUARD.test('const errs = compilation.errors || []')).toBe(true)
    expect(GUARD.test('compilation.warnings.push(warn)')).toBe(false)
    expect(GUARD.test('compilation.errors.length === 0')).toBe(false)
  })

  // The bundler always hands both lists. A guard hides a warning from a
  // spec whose stand-in forgot the list, and its sibling then throws.
  it('are pushed to without a guard in every product file', () => {
    const guarding = productSources(developRoot)
      .filter((file) =>
        GUARD.test(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
      )
      .map((file) => path.relative(developRoot, file).split(path.sep).join('/'))
      .sort()

    expect(guarding).toEqual([])
  })
})
