import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const pkgRoot = path.resolve(__dirname, '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
)
const typesDir = path.join(pkgRoot, 'types')

// chrome-types ships its own declarations, so it has no @types twin.
const SELF_TYPED = ['chrome-types']

function typesPackageName(name: string): string {
  if (SELF_TYPED.includes(name)) return name

  return name.startsWith('@')
    ? `@types/${name.slice(1).replace('/', '__')}`
    : `@types/${name}`
}

function packageRoot(specifier: string): string {
  const parts = specifier.split('/')

  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function collectTypeLibraries(): string[] {
  const names = new Set<string>()

  for (const file of fs.readdirSync(typesDir)) {
    if (!file.endsWith('.d.ts')) continue

    const source = fs.readFileSync(path.join(typesDir, file), 'utf8')

    for (const match of source.matchAll(
      /\/\/\/\s*<reference\s+types="([^"]+)"\s*\/>/g
    )) {
      names.add(packageRoot(match[1]))
    }

    for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!match[1].startsWith('.')) names.add(packageRoot(match[1]))
    }
  }

  return Array.from(names).sort()
}

const programsRoot = path.resolve(pkgRoot, '..')
const SKIPPED_FOLDERS = ['node_modules', 'dist', '__spec__', 'spec']

function sourceFiles(dir: string): string[] {
  const files: string[] = []

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (SKIPPED_FOLDERS.includes(entry.name) || entry.name.startsWith('.')) {
        continue
      }

      if (full === typesDir) continue

      files.push(...sourceFiles(full))
    } else if (/\.(?:ts|mts|cts|tsx)$/.test(entry.name)) {
      if (!/\.spec\.[a-z]+$/.test(entry.name)) files.push(full)
    }
  }

  return files
}

// Every file a published types entry loads through reference path lines.
function referencedFiles(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen

  seen.add(entry)

  const source = fs.readFileSync(path.join(typesDir, entry), 'utf8')

  for (const match of source.matchAll(
    /\/\/\/\s*<reference\s+path="\.\/([^"]+)"\s*\/>/g
  )) {
    referencedFiles(match[1], seen)
  }

  return seen
}

function declaresBrowser(file: string): boolean {
  return /^\s*(?:declare\s+)?(?:const|let|var|namespace)\s+browser\b/m.test(
    fs.readFileSync(path.join(typesDir, file), 'utf8')
  )
}

describe('published types dependencies (extension package)', () => {
  const dependencies: Record<string, string> = pkg.dependencies || {}
  const devDependencies: Record<string, string> = pkg.devDependencies || {}
  const peerDependencies: Record<string, string> = pkg.peerDependencies || {}
  const libraries = collectTypeLibraries()
  const typePackages = libraries.map(typesPackageName)

  it('ships the types folder that extension-env.d.ts references', () => {
    expect(pkg.files).toContain('types')
    expect(libraries).toEqual(['chrome-types', 'node', 'webextension-polyfill'])
  })

  // @types/chrome and chrome-types both declare the chrome global. The CLI
  // installs one, and a project that wants the other installs it itself.
  it('types the extension APIs from chrome-types and never installs @types/chrome', () => {
    expect(dependencies['@types/chrome']).toBeUndefined()
    expect(dependencies['chrome-types']).toBe('>=0.1.460')
    expect(pkg.exports['./types/legacy']).toEqual({
      types: './types/legacy.d.ts'
    })

    const read = (file: string) =>
      fs.readFileSync(path.join(typesDir, file), 'utf8')

    expect(read('index.d.ts')).toContain('<reference types="chrome-types" />')
    expect(read('index.d.ts')).not.toContain("import('webextension-polyfill')")
    expect(read('legacy.d.ts')).not.toContain('chrome-types')
    expect(read('legacy.d.ts')).toContain("import('webextension-polyfill')")
  })

  it('installs the types of every library the published types reference', () => {
    const undeclared = typePackages.filter((name) => !dependencies[name])

    expect(undeclared).toEqual([])
  })

  // A "*" range lets npm, pnpm and bun reuse the copy the project already has,
  // so a project that pins its own version never gets a second one on disk.
  it('accepts any version, so the project copy wins', () => {
    for (const name of typePackages) {
      if (SELF_TYPED.includes(name)) continue

      expect(dependencies[name]).toBe('*')
    }
  })

  // A peer is skipped by Yarn and by npm --legacy-peer-deps, and a
  // devDependency never reaches the user, so both would bring the bug back.
  it('declares them only as regular dependencies', () => {
    for (const name of typePackages) {
      expect(devDependencies[name]).toBeUndefined()
      expect(peerDependencies[name]).toBeUndefined()
    }
  })

  // chrome.runtime.ManifestV3 exists in @types/chrome and not in chrome-types,
  // so a declaration that names it fails for a project on the other package.
  it('names no extension API namespace type in the source of the four packages', () => {
    const offenders: string[] = []

    for (const program of ['create', 'develop', 'extension', 'install']) {
      for (const file of sourceFiles(path.join(programsRoot, program))) {
        const source = fs.readFileSync(file, 'utf8')

        if (/\b(?:chrome|browser)\.[A-Za-z]+\.[A-Z][A-Za-z]+/.test(source)) {
          offenders.push(path.relative(programsRoot, file))
        }
      }
    }

    expect(offenders).toEqual([])
  })

  // The generated extension-env.d.ts names one of the two entries, and each
  // one types the browser global its own way, so they never share a program.
  it('declares the browser global once in each of the two alternative entries', () => {
    const defaultFiles = referencedFiles('index.d.ts')
    const fromDefault = Array.from(defaultFiles)
    const fromLegacy = Array.from(referencedFiles('legacy.d.ts'))

    // These files only add to the namespace chrome-types declares.
    expect(fromDefault.filter(declaresBrowser).sort()).toEqual([
      'callbacks.d.ts',
      'chrome.d.ts',
      'enums.d.ts',
      'firefox.d.ts'
    ])

    expect(fromLegacy.filter(declaresBrowser)).toEqual(['legacy.d.ts'])
    expect(fromDefault).not.toContain('legacy.d.ts')
    expect(fromLegacy).not.toContain('index.d.ts')

    const others = fs
      .readdirSync(typesDir)
      .filter((file) => file.endsWith('.d.ts'))
      .filter((file) => !defaultFiles.has(file) && file !== 'legacy.d.ts')

    expect(others.filter(declaresBrowser)).toEqual([])
  })
})
