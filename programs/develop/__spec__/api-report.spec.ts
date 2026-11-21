import * as fs from 'node:fs'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {
  publishedEntries,
  signatureReports
} from '../../../scripts/lib/api-signatures.mjs'

const packageDir = path.resolve(__dirname, '..')

// The source file behind each published entry of the package.
const ENTRIES: Record<string, string> = {
  '.': 'module.ts',
  './preview': 'preview-entry.ts',
  './bridge': 'bridge-entry.ts',
  './contracts': 'contracts-entry.ts'
}

const TYPE_KINDS = new Set(['interface', 'type'])

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function resolveModule(from: string, specifier: string): string {
  const base = path.resolve(path.dirname(from), specifier)
  const found = [`${base}.ts`, path.join(base, 'index.ts')].find((file) =>
    fs.existsSync(file)
  )

  if (!found) throw new Error(`${specifier} from ${from} has no source file`)

  return found
}

// Every name a file exports, marked when it exists only as a type.
function exportsOf(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return []

  seen.add(file)

  const source = withoutComments(fs.readFileSync(file, 'utf8'))
  const names: string[] = []
  const add = (name: string, typeOnly: boolean) =>
    names.push(typeOnly ? `${name} (type)` : name)

  for (const [, kind, name] of source.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(const|let|function\*?|class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    add(name, TYPE_KINDS.has(kind))
  }

  for (const [, allTypes, list] of source.matchAll(
    /^export\s+(type\s+)?\{([^}]*)\}/gm
  )) {
    for (const item of list.split(',')) {
      const words = item.trim().split(/\s+/).filter(Boolean)
      if (words.length === 0) continue

      const typeOnly = Boolean(allTypes) || words[0] === 'type'

      add(words[words.length - 1], typeOnly)
    }
  }

  for (const [, specifier] of source.matchAll(
    /^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm
  )) {
    names.push(...exportsOf(resolveModule(file, specifier), seen))
  }

  return names
}

// A caller of the package compiles against these names. An export added,
// removed, or turned from a value into a type changes the report.
describe('the public API of the package, entry by entry', () => {
  it.each(Object.entries(ENTRIES))('reports what %s exports', (entry, file) => {
    const report = [...new Set(exportsOf(path.join(packageDir, file)))].sort()

    expect(report.length).toBeGreaterThan(0)
    expect(report.join('\n')).toMatchSnapshot(entry)
  })

  // The loaded module is the check on the reader above.
  it.each([
    ['./contracts', () => import('../contracts-entry')],
    ['./bridge', () => import('../bridge-entry')]
  ])('reports every value %s has when it is loaded', async (entry, load) => {
    const values = exportsOf(path.join(packageDir, ENTRIES[entry])).filter(
      (name) => !name.endsWith(' (type)')
    )

    expect([...new Set(values)].sort()).toEqual(
      Object.keys(await load()).sort()
    )
  })
})

// A caller compiles against the declarations too, not only the names. A
// parameter, a return type or a field that changes is a line of this diff.
describe('the signatures of the package, entry by entry', () => {
  const entries = publishedEntries(packageDir).map((entry) => entry.subpath)
  let reports: Record<string, string> = {}

  // The declarations are emitted from source once for every entry.
  beforeAll(() => {
    reports = signatureReports(packageDir)
  }, 120_000)

  it('reads the entries the exports map publishes with types', () => {
    expect(entries).toEqual(Object.keys(ENTRIES))
  })

  it.each(entries)('pins what %s declares', (entry) => {
    expect(reports[entry].length).toBeGreaterThan(0)
    expect(reports[entry]).toMatchSnapshot(entry)
  })
})
