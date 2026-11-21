import * as fs from 'node:fs'
import * as path from 'node:path'

const developRoot = path.resolve(__dirname, '..', '..')
const repoRoot = path.resolve(developRoot, '..', '..')

const SOURCE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js)$/
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '_FUTURE'])

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) sources(full, found)
    else if (SOURCE.test(entry.name)) found.push(full)
  }

  return found
}

// Develop files other programs hold a copy of, each with one such copy.
// The copies read the names, and a spec there fails when the text differs.
export const COPIED_ELSEWHERE = new Map([
  ['lib/corepack-registry.ts', 'install/lib/corepack-registry.ts'],
  ['lib/messaging.ts', 'extension/helpers/messaging.ts']
])

const isSpecFile = (file: string) =>
  file.split(path.sep).includes('__spec__') ||
  /\.spec\.[cm]?[jt]sx?$/.test(file)

const named = (file: string) =>
  path.relative(developRoot, file).split(path.sep).join('/')

const DECLARED =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm

const LISTED = /^export\s+(?:type\s+)?\{([^}]*)\}/gm

// Every name a file exports. A default export has no name to import.
export function exportedNames(text: string): string[] {
  const names = new Set<string>()

  for (const match of text.matchAll(DECLARED)) names.add(match[1])

  for (const match of text.matchAll(LISTED)) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()

      if (name && name !== 'default') names.add(name)
    }
  }

  return [...names]
}

// A static import, a re-export, a dynamic import, a require and a type
// import all name the file they read by a quoted relative path.
const SPECIFIER = /['"](\.{1,2}\/[^'"\n]*|\.{1,2})['"]/g
const STAR_FROM = /^export\s+\*\s+from\s+['"]([^'"\n]+)['"]/gm

function resolved(from: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(from), specifier)
  const bare = base.replace(/\.[cm]?js$/, '')

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${bare}.ts`,
    path.join(base, 'index.ts')
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }

  return undefined
}

// The files the bundle is built from: whatever they export is public.
function bundleEntries(): Set<string> {
  const config = fs
    .readFileSync(path.join(developRoot, 'rslib.config.ts'), 'utf8')
    .replace(/\r\n/g, '\n')
  const entries = new Set<string>()

  for (const match of config.matchAll(
    /['"](\.\/[^'"\n]+\.[cm]?[jt]sx?)['"]/g
  )) {
    entries.add(path.resolve(developRoot, match[1]))
  }

  return entries
}

export interface ExportUse {
  file: string
  name: string
  readBy: 'nothing' | 'specs'
  // Whether the exporting file itself names it again past the declaration.
  usedInFile: boolean
}

// Every export of a develop product file that no other product file reads.
// A file reads a name when it names the exporting file and holds the name.
export function exportsNoProductFileReads(): ExportUse[] {
  const all = ['programs', 'scripts', 'extensions']
    .map((folder) => path.join(repoRoot, folder))
    .filter((folder) => fs.existsSync(folder))
    .flatMap((folder) => sources(folder))
  const entries = bundleEntries()
  const product = new Map<string, string[]>()
  const texts = new Map<string, string>()

  for (const file of all) {
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

    texts.set(file, text)

    if (
      file.startsWith(developRoot + path.sep) &&
      !isSpecFile(file) &&
      !file.endsWith('.d.ts') &&
      !entries.has(file) &&
      !COPIED_ELSEWHERE.has(named(file))
    ) {
      product.set(file, exportedNames(text))
    }
  }

  const byProduct = new Map<string, Set<string>>()
  const bySpec = new Map<string, Set<string>>()

  const mark = (uses: Map<string, Set<string>>, file: string, name: string) => {
    const names = uses.get(file) ?? new Set<string>()

    names.add(name)
    uses.set(file, names)
  }

  for (const [file, text] of texts) {
    const words = new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])
    const uses = isSpecFile(file) ? bySpec : byProduct
    const whole = new Set<string>()

    for (const match of text.matchAll(STAR_FROM)) {
      const target = resolved(file, match[1])

      if (target) whole.add(target)
    }

    for (const match of text.matchAll(SPECIFIER)) {
      const target = resolved(file, match[1])

      if (!target || target === file) continue

      for (const name of product.get(target) ?? []) {
        if (whole.has(target) || words.has(name)) mark(uses, target, name)
      }
    }
  }

  const found: ExportUse[] = []

  for (const [file, names] of product) {
    const words = texts.get(file)?.match(/[A-Za-z_$][\w$]*/g) ?? []

    for (const name of names) {
      if (byProduct.get(file)?.has(name)) continue

      found.push({
        file: named(file),
        name,
        readBy: bySpec.get(file)?.has(name) ? 'specs' : 'nothing',
        usedInFile: words.filter((word) => word === name).length > 1
      })
    }
  }

  return found.sort((a, b) =>
    `${a.file} ${a.name}`.localeCompare(`${b.file} ${b.name}`)
  )
}
