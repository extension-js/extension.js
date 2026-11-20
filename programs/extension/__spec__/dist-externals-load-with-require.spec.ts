import * as fs from 'node:fs'
import {builtinModules} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const pkgRoot = path.resolve(__dirname, '..')
const distDir = path.join(pkgRoot, 'dist')

function packageRoot(specifier: string): string {
  const parts = specifier.split('/')

  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function isBuiltin(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    builtinModules.includes(packageRoot(specifier))
  )
}

// rspack writes each external as an assignment from require(), which keeps
// require() calls quoted inside help text out of the list.
function externalRequires(): Map<string, string[]> {
  const found = new Map<string, string[]>()

  for (const file of fs.readdirSync(distDir)) {
    if (!file.endsWith('.cjs')) continue

    const source = fs.readFileSync(path.join(distDir, file), 'utf8')

    for (const match of source.matchAll(/=\s*require\("([^"]+)"\)/g)) {
      const specifier = match[1]

      if (specifier.startsWith('.') || isBuiltin(specifier)) continue

      const name = packageRoot(specifier)
      found.set(name, [...(found.get(name) || []), file])
    }
  }

  return found
}

function findManifest(name: string): string | undefined {
  let dir = pkgRoot

  while (true) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json')

    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(dir)

    if (parent === dir) return undefined

    dir = parent
  }
}

function hasRequireCondition(exportsField: unknown): boolean {
  if (!exportsField || typeof exportsField !== 'object') return false

  return Object.entries(exportsField as Record<string, unknown>).some(
    ([key, value]) => key === 'require' || hasRequireCondition(value)
  )
}

describe('dist externals', () => {
  it('builds the CLI before reading it', () => {
    expect(fs.existsSync(path.join(distDir, 'cli.cjs'))).toBe(true)
  })

  // Node 22 cannot require() an ES module while Yarn PnP's loader hook runs,
  // so every package the CLI leaves external must load as CommonJS.
  it('leaves no ESM-only package behind a require() call', () => {
    const externals = externalRequires()
    const esmOnly: string[] = []
    const unresolved: string[] = []

    expect(externals.size).toBeGreaterThan(0)

    for (const [name, files] of externals) {
      const manifestPath = findManifest(name)

      if (!manifestPath) {
        unresolved.push(name)
        continue
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

      if (
        manifest.type === 'module' &&
        !hasRequireCondition(manifest.exports)
      ) {
        esmOnly.push(
          `${name} (required from ${[...new Set(files)].join(', ')})`
        )
      }
    }

    expect(unresolved).toEqual([])
    expect(esmOnly).toEqual([])
  })
})
