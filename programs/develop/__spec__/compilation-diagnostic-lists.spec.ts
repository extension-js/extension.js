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

// One of the two lists, read off anything named as a compilation.
const LIST = String.raw`ompilation\??\.(?:warnings|errors)\b`

// A guard on a list that is always there, in any of its forms: a truth
// test, an optional read, a default, a non-null mark or an empty refill.
const GUARD = new RegExp(
  [
    String.raw`!\s*[\w.?]*${LIST}(?![\w.])`,
    String.raw`ompilation\?\.(?:warnings|errors)\b`,
    String.raw`${LIST}\s*(?:\?\.|!\.|\|\||\?\?|&&|\?(?![.?])|=\s*\[\s*\])`,
    String.raw`(?:\bif\s*\(|isArray\(|&&|\|\|)\s*[\w.?]*${LIST}\s*\)`
  ].join('|')
)

describe('the warnings and errors of a compilation', () => {
  it('reads every form of a guard and leaves a plain read alone', () => {
    for (const guarded of [
      'compilation.warnings = compilation.warnings || []',
      'this.compilation.errors ||= []',
      'compilation.warnings?.push(warn)',
      'compilation.errors!.push(err)',
      ';(compilation.errors ||= []).push(err)',
      'const errs = compilation.errors || []',
      'if (!compilation.warnings) compilation.warnings = []',
      'compilation.errors = []',
      'const failed = compilation.errors && compilation.errors.length > 0',
      'if (this._compilation?.errors) {',
      'stats?.compilation?.warnings?.push(warn)',
      'const sink = strict ? compilation?.errors : compilation?.warnings',
      'for (const issue of compilation.warnings ?? []) {',
      'Array.isArray(compilation.errors) ? compilation.errors : []',
      'if (compilation.errors) return',
      'const list = compilation.warnings ? compilation.warnings : []'
    ]) {
      expect(GUARD.test(guarded), guarded).toBe(true)
    }

    for (const plain of [
      'compilation.warnings.push(warn)',
      'compilation.errors.length === 0',
      'if (!compilation.errors.length) return',
      'if (compilation.errors.length > 0 && ready) return',
      'const said = [...compilation.warnings].some(same)',
      'for (const error of compilation.errors) {',
      'compilation.errors = kept',
      ';(strict ? compilation.errors : compilation.warnings).push(report)',
      'stats?.compilation.warnings.push(warn)',
      'warning as (typeof compilation.warnings)[number]'
    ]) {
      expect(GUARD.test(plain), plain).toBe(false)
    }
  })

  // The bundler always hands both lists. A guard hides a warning from a
  // spec whose stand-in forgot the list, and its sibling then throws.
  it('are read without a guard in every product file', () => {
    const guarding = productSources(developRoot)
      .filter((file) =>
        fs
          .readFileSync(file, 'utf8')
          .replace(/\r\n/g, '\n')
          .split('\n')
          .some(
            (line) => !line.trimStart().startsWith('//') && GUARD.test(line)
          )
      )
      .map((file) => path.relative(developRoot, file).split(path.sep).join('/'))
      .sort()

    expect(guarding).toEqual([])
  })
})
