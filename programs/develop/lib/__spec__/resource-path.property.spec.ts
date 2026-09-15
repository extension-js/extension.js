import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import fc from 'fast-check'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  canonicalizeDir,
  canonicalizeResourcePath,
  toResourceKey
} from '../resource-path'

const RUNS = {numRuns: 200}
const sep = path.sep

// A symlink-free real root with a few existing dirs so realpath has work to
// do, plus one symlink into it so the resolver's reason to exist is exercised.
let root = ''
let link = ''
beforeAll(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'resource-path-prop-'))
  )
  fs.mkdirSync(path.join(root, 'src', 'nested'), {recursive: true})
  fs.mkdirSync(path.join(root, 'lib'))
  link = path.join(root, 'link')
  fs.symlinkSync(path.join(root, 'src'), link, 'junction')
})
afterAll(() => fs.rmSync(root, {recursive: true, force: true}))

// Lowercase only: macOS realpath returns on-disk casing, which would make two
// case variants of one existing dir agree while path.resolve disagrees.
const name = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,7}$/)
const segment = fc.oneof(
  fc.constantFrom('src', 'nested', 'lib', 'ghost', '.', '..'),
  name
)
const file = fc
  .tuple(name, fc.constantFrom('', '?url', '?raw', '?v=1'))
  .map(([n, q]) => `${n}.js${q}`)

// `..` must not climb above the root, where system symlinks (/etc on macOS)
// would fold two different resolved paths into one key.
function bounded(segments: string[]): string[] {
  const kept: string[] = []
  let depth = 0
  for (const s of segments) {
    if (s === '..') {
      if (depth === 0) continue
      depth--
    } else if (s !== '.') depth++
    kept.push(s)
  }
  return kept
}
// String joins on purpose: path.join would normalize the dot segments away
// before the functions under test ever see them.
const dir = fc
  .array(segment, {maxLength: 4})
  .map((s) => [root, ...bounded(s)].join(sep))
const existingDir = dir.filter((d) => fs.existsSync(d))
const missingDir = dir.filter((d) => !fs.existsSync(d))
const resource = fc.tuple(dir, file).map(([d, f]) => d + sep + f)
const respell = (p: string) =>
  fc.constantFrom(
    p,
    p + sep,
    `${path.dirname(p)}${sep}.${sep}${path.basename(p)}`,
    `${path.dirname(p)}${sep}.${sep}${path.basename(p)}${sep}`
  )
const noBackslash = (s: string) =>
  process.platform === 'win32' || !s.includes('\\')

describe('resource-path properties', () => {
  it('is idempotent and never emits a backslash on posix', () => {
    fc.assert(
      fc.property(resource, (r) => {
        for (const f of [canonicalizeResourcePath, toResourceKey]) {
          expect(f(f(r))).toBe(f(r))
          expect(noBackslash(f(r))).toBe(true)
        }
        const d = path.dirname(r)
        expect(canonicalizeDir(canonicalizeDir(d))).toBe(canonicalizeDir(d))
      }),
      RUNS
    )
  })

  it('agrees across a ./ segment and a trailing separator', () => {
    fc.assert(
      fc.property(
        resource.chain((r) => fc.tuple(fc.constant(r), respell(r))),
        ([a, b]) => {
          expect(canonicalizeResourcePath(b)).toBe(canonicalizeResourcePath(a))
          expect(toResourceKey(b)).toBe(toResourceKey(a))
        }
      ),
      RUNS
    )
  })

  it('canonicalizes an existing dir the same across a ./ segment and a trailing separator', () => {
    fc.assert(
      fc.property(existingDir, (d) => {
        expect(canonicalizeDir(d + sep)).toBe(canonicalizeDir(d))
        expect(canonicalizeDir(`${d}${sep}.`)).toBe(canonicalizeDir(d))
      }),
      RUNS
    )
  })

  it('compares two spellings exactly when path.resolve says they are one file', () => {
    const pair = resource.chain((a) =>
      fc.tuple(fc.constant(a), fc.oneof(respell(a), resource))
    )
    fc.assert(
      fc.property(pair, ([a, b]) => {
        expect(toResourceKey(a) === toResourceKey(b)).toBe(
          path.resolve(a) === path.resolve(b)
        )
      }),
      RUNS
    )
  })

  it('sees through a symlinked parent that exists', () => {
    fc.assert(
      fc.property(fc.constantFrom('', `${sep}nested`), file, (sub, f) => {
        expect(toResourceKey(`${link}${sub}${sep}${f}`)).toBe(
          toResourceKey(`${root}${sep}src${sub}${sep}${f}`)
        )
      }),
      RUNS
    )
  })

  // Defect: canonicalizeDir returns the raw spelling when the dir does not exist
  // yet, so the same not-yet-created dir spelled with a trailing separator or a
  // ./ segment gets a different key from its plain spelling.
  it('agrees across a trailing separator for a dir that does not exist yet', () => {
    fc.assert(
      fc.property(missingDir, (d) => {
        expect(canonicalizeDir(d + sep)).toBe(canonicalizeDir(d))
      }),
      RUNS
    )
  })
})
