import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const pkgRoot = path.resolve(__dirname, '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
)
const typesDir = path.join(pkgRoot, 'types')

// Known gaps, still resolved from the project's own install. Remove a name
// once the package declares its types, so the guard covers it too.
const KNOWN_UNDECLARED = ['node', 'webextension-polyfill']

function typesPackageName(name: string): string {
  return name.startsWith('@')
    ? `@types/${name.slice(1).replace('/', '__')}`
    : `@types/${name}`
}

function packageRoot(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0]
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
  const libraries = collectTypeLibraries()

  it('ships the types folder that extension-env.d.ts references', () => {
    expect(pkg.files).toContain('types')
    expect(libraries.length).toBeGreaterThan(0)
  })

  it('declares every type library the published types reference as a dependency', () => {
    const undeclared = libraries.filter(
      (name) =>
        !KNOWN_UNDECLARED.includes(name) &&
        !dependencies[typesPackageName(name)] &&
        !dependencies[name]
    )

    expect(undeclared).toEqual([])
  })

  it('declares @types/chrome at runtime, so chrome resolves without a project copy', () => {
    expect(libraries).toContain('chrome')
    expect(dependencies['@types/chrome']).toBeTruthy()
    expect(pkg.devDependencies?.['@types/chrome']).toBeUndefined()
  })

  it('lists only known gaps that the published types still reference', () => {
    for (const name of KNOWN_UNDECLARED) {
      expect(libraries).toContain(name)
    }
  })
})
