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
})
